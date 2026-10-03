import {
  GroveResponse,
  StreamMessage,
  UpdateClaimRequest,
  UpdateClaimResponse,
  AssignTabRequest,
  AssignTabResponse,
  AddNoteRequest,
  AddNoteResponse,
  SnapshotPayload,
  TokenData,
} from '../types';
import { mockGroveResponse, mockClaimsResponse } from '../mocks/mockData';
import { sendBridgeMessage } from './bridge';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export const isMockMode = (): boolean => {
  return import.meta.env.VITE_MOCK !== '0';
};

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
    return await res.json();
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
    return await res.json();
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
          const parsed = JSON.parse(line) as StreamMessage;
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

export async function analyzeProject(projectId: string): Promise<GroveResponse> {
  if (isMockMode()) {
    return mockGroveResponse;
  }

  try {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE_URL}/api/projects/${projectId}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('[Grove Adapter] analyzeProject fallback:', err);
    return mockGroveResponse;
  }
}

export async function updateClaim(
  claimId: string,
  request: UpdateClaimRequest
): Promise<UpdateClaimResponse> {
  if (isMockMode()) {
    return {
      id: claimId,
      status: request.action === 'confirm' ? 'confirmed' : 'updated',
      provenance: request.action === 'confirm' ? 'stated' : 'inferred',
      user_note_id: request.action === 'confirm' ? 'n-user-note' : undefined,
      confirmed_at: new Date().toISOString(),
      answer: request.answer || undefined,
    };
  }

  try {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE_URL}/api/claims/${claimId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(request),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('[Grove Adapter] updateClaim fallback:', err);
    return mockClaimsResponse.updateClaim;
  }
}

export async function assignTab(
  tabRef: string,
  request: AssignTabRequest
): Promise<AssignTabResponse> {
  if (isMockMode()) {
    return {
      tab_ref: tabRef,
      cluster_id: request.target_cluster_id,
      branch_id: request.target_branch_id,
      assigned_by: 'user',
      pinned: true,
    };
  }

  try {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE_URL}/api/tabs/${tabRef}/assign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(request),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('[Grove Adapter] assignTab fallback:', err);
    return mockClaimsResponse.assignTab;
  }
}

export async function addNote(request: AddNoteRequest): Promise<AddNoteResponse> {
  if (isMockMode()) {
    return {
      note_id: `note-${Date.now()}`,
      cluster_id: request.cluster_id,
      text: request.text,
      created_at: new Date().toISOString(),
      cleared_fog: true,
    };
  }

  try {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE_URL}/api/notes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(request),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('[Grove Adapter] addNote fallback:', err);
    return mockClaimsResponse.addNote;
  }
}
