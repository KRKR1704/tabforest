import streamContract from '@contracts/grove.stream.example.ndjson?raw';
import { GroveResponse, StreamMessage, SnapshotPayload, TokenData } from '../types';
import { mockGroveResponse } from '../mocks/mockData';
import { sendBridgeMessage } from './bridge';
import { apiBaseUrl, authHeaderFor, isMockMode } from './live';
import {
  indexTabs,
  normalizeGrove,
  normalizeStreamMessage,
  type TabIndex,
  type WireGrove,
  type WireStreamMessage,
} from './groveContract';

// Kept here as well: the other adapters import these from this file.
export { apiBaseUrl, isMockMode };

/** Bearer token from the extension bridge; held in memory only, never stored. */
export const authHeaders = (): Promise<Record<string, string>> => getAuthHeader();

async function getAuthHeader(): Promise<Record<string, string>> {
  const tokenRes = await sendBridgeMessage<void, TokenData>('GET_TOKEN');
  return authHeaderFor(tokenRes.data?.token);
}

/**
 * The grow request as R's route accepts it (apps/api/app/engine/routes.py):
 * the nine snapshot fields per tab and the Hollow count. The route rejects any
 * unknown field, so nothing else the extension keeps on a tab is passed on.
 */
export function growRequestBody(snapshot: SnapshotPayload, hollowCount?: number) {
  const open_tabs = snapshot.open_tabs.map((tab) => ({
    tab_ref: tab.tab_ref,
    domain: tab.domain,
    title: tab.title,
    opener_tab_ref: tab.opener_tab_ref ?? null,
    opened_at: tab.opened_at,
    active: tab.active === true,
    pinned: tab.pinned === true,
    dup_key: tab.dup_key ?? null,
    search_query: tab.search_query ?? null,
  }));
  return hollowCount === undefined ? { open_tabs } : { open_tabs, hollow_count: hollowCount };
}

export async function getGrove(): Promise<GroveResponse> {
  if (isMockMode('grove')) {
    return mockGroveResponse;
  }

  try {
    const headers = await getAuthHeader();
    const res = await fetch(`${apiBaseUrl()}/api/grove`, { method: 'GET', headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return normalizeGrove((await res.json()) as WireGrove);
  } catch (err) {
    console.warn('[Grove Adapter] getGrove failed, using contract mock fallback:', err);
    return mockGroveResponse;
  }
}

/**
 * The grove the server stored last (GET /api/grove). Null when there is none or it cannot be read: unlike
 * getGrove, this never falls back to the sample, because it is shown as the user's own memory.
 */
export async function fetchStoredGrove(): Promise<GroveResponse | null> {
  if (isMockMode('grove')) return null;
  try {
    const headers = await getAuthHeader();
    const res = await fetch(`${apiBaseUrl()}/api/grove`, { method: 'GET', headers });
    if (!res.ok) return null;
    const grove = normalizeGrove((await res.json()) as WireGrove);
    return grove.trees.length > 0 ? grove : null;
  } catch {
    return null;
  }
}

export async function growGrove(snapshot: SnapshotPayload): Promise<GroveResponse> {
  if (isMockMode('grove')) {
    return mockGroveResponse;
  }

  try {
    const headers = await getAuthHeader();
    const res = await fetch(`${apiBaseUrl()}/api/grove/grow`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(growRequestBody(snapshot)),
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
  /** From GET_HOLLOW_COUNT; the server echoes it back with the grove. */
  hollowCount?: number;
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
  if (isMockMode('grove')) {
    await streamStandIn(index, onMessage, options.standInDelayMs);
    return;
  }

  const headers =
    options.token !== undefined ? authHeaderFor(options.token) : await getAuthHeader();
  const res = await fetch(`${apiBaseUrl()}/api/grove/grow?stream=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(growRequestBody(snapshot, options.hollowCount)),
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
