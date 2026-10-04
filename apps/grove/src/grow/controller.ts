// Grow orchestration (BUILD_TASKS.md S-6, SPEC §4.1 steps 6–10). The Grove page
// owns the whole flow: read the open tabs from the extension, send them to the
// API, and let the forest fill in as the stream arrives.
import { sendBridgeMessage } from '../adapters/bridge';
import { fetchStoredGrove, streamGrow, streamStandIn } from '../adapters/grove';
import { indexTabs } from '../adapters/groveContract';
import { isHeldOnStandIn } from '../adapters/live';
import { loadLastGrove, saveLastGrove } from '../lib/lastGrove';
import { useBridgeStore } from '../store/useBridgeStore';
import { useGroveStore } from '../store/useGroveStore';
import type { HollowCountData, SnapshotPayload, TokenData } from '../types';

export interface GrowOptions {
  /** Pause before each stand-in tree. Tests pass 0. */
  standInDelayMs?: number;
  /** Started by the page opening, not by the user's click: with fewer than two tabs it asks the server for nothing. */
  auto?: boolean;
}

export type GrowOutcome = 'grown' | 'last-grove' | 'stand-in' | 'no-snapshot' | 'busy';

export const NOTICES = {
  offlineLastGrove: 'The grove service is unreachable. Showing your last grove.',
  offlineStandIn: 'The grove service is unreachable. Showing sample data, not your tabs.',
  notConnected: 'The grove service is not connected yet. Showing sample data, not your tabs.',
  noSnapshot: 'Could not read your open tabs from the extension.',
  degraded: 'AI unavailable — showing groups only',
} as const;

let running = false;
// Counts grows that really asked the server, so a slow restore never replaces a grove that grew after it was asked for.
// A grow that returns early (no tab to grow from, or too few on open) does not count: it changes nothing.
let growsStarted = 0;

/**
 * Show the grove the server stored last, so the page is never empty on open while the user has history.
 * Skipped when a grow has started or finished meanwhile. Returns whether it filled the page.
 */
export async function restoreStoredGrove(): Promise<boolean> {
  const before = growsStarted;
  const stored = await fetchStoredGrove();
  if (!stored || growsStarted !== before) return false;
  useGroveStore.getState().setGrove(stored);
  saveLastGrove(stored);
  return true;
}

export async function runGrow(options: GrowOptions = {}): Promise<GrowOutcome> {
  if (running) return 'busy';
  running = true;
  const grove = useGroveStore.getState();
  grove.setGroveNotice(null);
  grove.setStreaming(true);

  try {
    // The three bridge calls, in this order (S-6).
    const snapshotReply = await sendBridgeMessage<void, SnapshotPayload>('GET_SNAPSHOT');
    const hollowReply = await sendBridgeMessage<void, HollowCountData>('GET_HOLLOW_COUNT');
    const tokenReply = await sendBridgeMessage<void, TokenData>('GET_TOKEN');

    if (hollowReply.ok && hollowReply.data) {
      useBridgeStore.setState({ hollowCount: hollowReply.data.count });
    }
    const snapshot = snapshotReply.data;
    if (!snapshotReply.ok || !snapshot || !Array.isArray(snapshot.open_tabs)) {
      grove.setGroveNotice(NOTICES.noSnapshot);
      return 'no-snapshot';
    }
    if (snapshot.open_tabs.length === 0 && useGroveStore.getState().grove) {
      // Nothing is open to grow from: keep showing the grove the user already has instead of an empty one.
      return 'last-grove';
    }
    if (options.auto && snapshot.open_tabs.length < 2) {
      // The server stores every grow, an empty one included, and serves the newest as the "last grove".
      // Opening the page with one or no tab must not bury the user's real grove under an empty one.
      return 'last-grove';
    }

    growsStarted += 1;
    const { handleStreamMessage } = useGroveStore.getState();
    try {
      await streamGrow(snapshot, handleStreamMessage, {
        token: tokenReply.data?.token ?? null,
        hollowCount: hollowReply.ok ? hollowReply.data?.count : undefined,
        standInDelayMs: options.standInDelayMs,
      });
    } catch (err) {
      console.warn('[Grow] The grove service could not be reached:', err);
      const last = loadLastGrove();
      if (last) {
        // Something true beats something new: show the grove we last finished.
        useGroveStore.getState().setGrove(last);
        grove.setGroveNotice(NOTICES.offlineLastGrove);
        return 'last-grove';
      }
      await streamStandIn(indexTabs(snapshot.open_tabs), handleStreamMessage, options.standInDelayMs);
      grove.setGroveNotice(NOTICES.offlineStandIn);
      return 'stand-in';
    }

    if (isHeldOnStandIn('grove')) {
      // The rest of the app is live but this endpoint is not served yet: what
      // grew is the contract's sample, so it is labelled and not kept.
      grove.setGroveNotice(NOTICES.notConnected);
      return 'stand-in';
    }

    const finished = useGroveStore.getState().grove;
    if (finished) saveLastGrove(finished);
    return 'grown';
  } finally {
    useGroveStore.getState().setStreaming(false);
    running = false;
  }
}
