import { GroveResponse, StreamMessage, SnapshotPayload, TokenData } from '../types';
import { mockGroveResponse } from '../mocks/mockData';
import { sendBridgeMessage } from './bridge';
import {
  indexTabs,
  normalizeGrove,
  normalizeStreamMessage,
  type WireGrove,
  type WireStreamMessage,
} from './groveContract';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export const isMockMode = (): boolean => {
  return import.meta.env.VITE_MOCK !== '0';
};

export const apiBaseUrl = (): string => API_BASE_URL;

/** Bearer token from the extension bridge; held in memory only, never stored. */
export const authHeaders = (): Promise<Record<string, string>> => getAuthHeader();

async function getAuthHeader(): Promise<Record<string, string>> {
  const tokenRes = await sendBridgeMessage<void, TokenData>('GET_TOKEN');
  const token = tokenRes.data?.token;
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  return { 'X-Dev-User': 'usr-5d0a-9b1e-3f4a' };
}

export async function getGrove(): Promise<GroveResponse> {
  if (isMockMode()) {
    return mockGroveResponse;
  }

  try {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE_URL}/api/grove`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return normalizeGrove((await res.json()) as WireGrove);
  } catch (err) {
    console.warn('[Grove Adapter] getGrove failed, using contract mock fallback:', err);
    return mockGroveResponse;
  }
}

export async function growGrove(snapshot: SnapshotPayload): Promise<GroveResponse> {
  if (isMockMode()) {
    return mockGroveResponse;
  }

  try {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE_URL}/api/grove/grow`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(snapshot),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return normalizeGrove((await res.json()) as WireGrove, indexTabs(snapshot.tabs));
  } catch (err) {
    console.warn('[Grove Adapter] growGrove failed, using contract mock fallback:', err);
    return mockGroveResponse;
  }
}

export async function streamGrowGrove(
  snapshot: SnapshotPayload,
  onMessage: (msg: StreamMessage) => void,
  onDone?: (runId: string, degraded: boolean) => void,
  onError?: (err: Error) => void
): Promise<void> {
  if (isMockMode()) {
    onMessage({
      type: 'clusters',
      clusters: mockGroveResponse.trees.map((t) => ({
        cluster_ref: t.cluster_ref,
        project_name: t.project.name,
        tab_refs: t.tabs.map((tab) => tab.tab_ref),
      })),
      sprouts: mockGroveResponse.sprouts.map((s) => ({
        sprout_ref: s.sprout_ref,
        label: s.label,
        tab_count: s.tab_count,
      })),
      meadow_tab_refs: mockGroveResponse.meadow.tabs.map((t) => t.tab_ref),
    });

    for (let i = 0; i < mockGroveResponse.trees.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const tree = mockGroveResponse.trees[i];
      onMessage({
        type: 'tree',
        ...tree,
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
    onMessage({
      type: 'done',
      run_id: mockGroveResponse.run_id,
      degraded: mockGroveResponse.degraded,
    });
    if (onDone) onDone(mockGroveResponse.run_id, mockGroveResponse.degraded);
    return;
  }

  try {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE_URL}/api/grove/grow?stream=1`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(snapshot),
    });

    if (!res.ok || !res.body) {
      throw new Error(`Streaming failed with status ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = normalizeStreamMessage(JSON.parse(line) as WireStreamMessage);
          onMessage(parsed);
          if (parsed.type === 'done' && onDone) {
            onDone(parsed.run_id, parsed.degraded);
          }
        } catch (parseErr) {
          console.error('[NDJSON Parse Error]', parseErr, line);
        }
      }
    }
  } catch (err: any) {
    console.warn('[Grove Stream Adapter] Stream failed, falling back to mock stream:', err);
    if (onError) onError(err);
    streamGrowGrove(snapshot, onMessage, onDone);
  }
}
