import streamContract from '@contracts/grove.stream.example.ndjson?raw';
import { GroveResponse, StreamMessage, SnapshotPayload, TokenData } from '../types';
import { mockGroveResponse } from '../mocks/mockData';
import { sendBridgeMessage } from './bridge';
import {
  indexTabs,
  normalizeGrove,
  normalizeStreamMessage,
  type TabIndex,
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

function headersFor(token: string | null | undefined): Record<string, string> {
  if (token) return { Authorization: `Bearer ${token}` };
  return { 'X-Dev-User': 'usr-5d0a-9b1e-3f4a' };
}

async function getAuthHeader(): Promise<Record<string, string>> {
  const tokenRes = await sendBridgeMessage<void, TokenData>('GET_TOKEN');
  return headersFor(tokenRes.data?.token);
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
    return normalizeGrove((await res.json()) as WireGrove, indexTabs(snapshot.open_tabs));
  } catch (err) {
    console.warn('[Grove Adapter] growGrove failed, using contract mock fallback:', err);
    return mockGroveResponse;
  }
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Splits a byte stream into NDJSON lines. A line can arrive in pieces, so the
 * unfinished tail is held until its newline comes.
 */
export async function readNdjson(
  body: ReadableStream<Uint8Array>,
  onLine: (line: string) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) onLine(line);
  }
  buffer += decoder.decode();
  if (buffer.trim()) onLine(buffer);
}

export interface StreamGrowOptions {
  /** Token from GET_TOKEN. Left out, the adapter asks the bridge itself. */
  token?: string | null;
  /** Pause before each stand-in tree, so trees visibly arrive one by one. */
  standInDelayMs?: number;
}

/** The stand-in server: the contract's stream example, replayed line by line. */
export async function streamStandIn(
  index: TabIndex,
  onMessage: (message: StreamMessage) => void,
  delayMs = 350
): Promise<void> {
  const lines = streamContract.trim().split('\n');
  for (const line of lines) {
    const message = normalizeStreamMessage(JSON.parse(line) as WireStreamMessage, index);
    if (message.type !== 'clusters' && delayMs > 0) await wait(delayMs);
    onMessage(message);
  }
}

/**
 * POST /api/grove/grow?stream=1 (BUILD_TASKS.md §4.7): a `clusters` line, one
 * `tree` line per cluster, then `done`. Throws when the API cannot be reached
 * or answers with an error, so the caller decides what to show instead.
 */
export async function streamGrow(
  snapshot: SnapshotPayload,
  onMessage: (message: StreamMessage) => void,
  options: StreamGrowOptions = {}
): Promise<void> {
  const index = indexTabs(snapshot.open_tabs);
  if (isMockMode()) {
    await streamStandIn(index, onMessage, options.standInDelayMs);
    return;
  }

  const headers =
    options.token !== undefined ? headersFor(options.token) : await getAuthHeader();
  const res = await fetch(`${API_BASE_URL}/api/grove/grow?stream=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(snapshot),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

  await readNdjson(res.body, (line) => {
    onMessage(normalizeStreamMessage(JSON.parse(line) as WireStreamMessage, index));
  });
}

/** Stream with the stand-in as fallback. Kept for the dev contract inspector. */
export async function streamGrowGrove(
  snapshot: SnapshotPayload,
  onMessage: (msg: StreamMessage) => void,
  onDone?: (runId: string, degraded: boolean) => void,
  onError?: (err: Error) => void
): Promise<void> {
  const relay = (message: StreamMessage) => {
    onMessage(message);
    if (message.type === 'done') onDone?.(message.run_id, message.degraded);
  };
  try {
    await streamGrow(snapshot, relay);
  } catch (err) {
    console.warn('[Grove Stream Adapter] Stream failed, replaying the stand-in:', err);
    onError?.(err as Error);
    await streamStandIn(indexTabs(snapshot.open_tabs), relay);
  }
}
