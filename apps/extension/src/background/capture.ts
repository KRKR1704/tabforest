import { emit, type CaptureEvent } from './emit';
import { FocusTracker } from './focus-tracker';
import { dupKey, httpUrl, searchQuery } from './url';

export function registerCapture(
  api: typeof chrome = chrome,
  output: (event: CaptureEvent) => void = emit,
  now: () => number = Date.now,
): { settled: () => Promise<void> } {
  // Chrome IDs and full URLs remain private to this capture instance.
  const refs = new Map<number, string>();
  const localUrls = new Map<string, string>();
  const eligible = new Set<number>();
  const tracker = new FocusTracker(now);
  let focusedWindow: number = api.windows.WINDOW_ID_NONE;
  let previousRef: string | null = null;
  let pending = Promise.resolve();

  // Serialize async Chrome lookups/hashes, keeping callback timestamps for timing.
  // This is not the D-5 event queue: there is no persistence, retry or delivery.
  function run(work: (at: number) => void | Promise<void>): void {
    const at = now();
    pending = pending.then(() => work(at)).catch(() => {
      console.warn('[tf-capture] Capture callback failed');
    });
  }

  function refFor(id: number): string {
    let ref = refs.get(id);
    if (!ref) { ref = crypto.randomUUID(); refs.set(id, ref); }
    return ref;
  }

  function remember(tab: chrome.tabs.Tab): string | null {
    if (tab.id === undefined) return null;
    const ref = refFor(tab.id);
    const url = httpUrl(tab.url ?? tab.pendingUrl);
    if (!url) { eligible.delete(tab.id); return null; }
    eligible.add(tab.id);
    localUrls.set(ref, url.href);
    return ref;
  }

  function base(tab_ref: string, at: number) {
    return { event_id: crypto.randomUUID(), ts: new Date(at).toISOString(), tab_ref };
  }

  async function pageEvent(type: 'OPEN' | 'UPDATE', tab: chrome.tabs.Tab, at: number): Promise<void> {
    const ref = remember(tab);
    if (!ref) return;
    // An activated new-tab page may only acquire its HTTP URL on update.
    if (type === 'UPDATE' && tab.active && tab.windowId === focusedWindow && tracker.tabRef === null) {
      tracker.select(ref, at);
    }
    const url = localUrls.get(ref)!;
    const fields = {
      ...base(ref, at), domain: new URL(url).hostname,
      title: tab.title === undefined ? null : Array.from(tab.title).slice(0, 300).join(''),
      dup_key: await dupKey(url), search_query: searchQuery(url),
    };
    if (type === 'OPEN') {
      output({ ...fields, type, opener_tab_ref: tab.openerTabId === undefined ? null : refFor(tab.openerTabId) });
    } else output({ ...fields, type });
  }

  async function getTab(id: number): Promise<chrome.tabs.Tab | null> {
    try { return await api.tabs.get(id); } catch { return null; } // Tab may already be closed.
  }

  async function selectWindow(id: number, at: number): Promise<void> {
    tracker.setWindowFocused(false, at);
    focusedWindow = id;
    if (id === api.windows.WINDOW_ID_NONE) return;
    const tabs = await api.tabs.query({ active: true, windowId: id });
    tracker.select(tabs[0] ? remember(tabs[0]) : null, at);
    tracker.setWindowFocused(true, at);
  }

  api.idle.setDetectionInterval(60);
  run(async at => {
    tracker.setActive((await api.idle.queryState(60)) === 'active', at);
    const window = await api.windows.getLastFocused();
    if (window.focused && window.id !== undefined) await selectWindow(window.id, at);
    if (tracker.tabRef) {
      output({ ...base(tracker.tabRef, at), type: 'FOCUS', previous_tab_ref: null });
      previousRef = tracker.tabRef;
    }
  });

  api.tabs.onCreated.addListener(tab => {
    const copy = { ...tab };
    run(at => pageEvent('OPEN', copy, at));
  });
  api.tabs.onActivated.addListener(info => run(async at => {
    if (info.windowId !== focusedWindow) return; // A background window is not user focus.
    const tab = await getTab(info.tabId);
    const next = tab ? remember(tab) : null;
    const prior = tracker.tabRef;
    if (prior) {
      output({ ...base(prior, at), type: 'BLUR', active_ms: tracker.take(prior, at) });
      previousRef = prior;
    }
    tracker.select(next, at);
    if (next) {
      output({ ...base(next, at), type: 'FOCUS', previous_tab_ref: previousRef });
      previousRef = next;
    }
  }));
  api.tabs.onUpdated.addListener((id, change, tab) => {
    const copy = { ...tab };
    // Stop counting an eligible page as soon as it navigates to a restricted URL.
    if (change.url !== undefined) run(at => {
      const ref = remember(copy);
      if (!ref && refs.get(id) === tracker.tabRef) tracker.select(null, at);
    });
    if (change.status === 'complete' || change.title !== undefined) run(at => pageEvent('UPDATE', copy, at));
  });
  api.tabs.onRemoved.addListener(id => run(at => {
    const ref = refs.get(id);
    if (ref && tracker.tabRef === ref) {
      output({ ...base(ref, at), type: 'BLUR', active_ms: tracker.take(ref, at) });
      previousRef = ref;
    }
    if (ref && eligible.has(id)) output({ ...base(ref, at), type: 'CLOSE' });
    if (ref) tracker.remove(ref, at);
    refs.delete(id);
    eligible.delete(id);
  }));
  api.windows.onFocusChanged.addListener(id => run(at => selectWindow(id, at)));
  api.idle.onStateChanged.addListener(state => run(at => {
    const active = state === 'active';
    tracker.setActive(active, at);
    if (focusedWindow !== api.windows.WINDOW_ID_NONE && tracker.tabRef) {
      output({ ...base(tracker.tabRef, at), type: active ? 'ACTIVE' : 'IDLE' });
    }
  }));

  async function snapshot(at: number): Promise<void> {
    const tabs = (await api.tabs.query({})).filter(tab => remember(tab) !== null)
      .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0)).slice(0, 60);
    for (const tab of tabs) await pageEvent('OPEN', tab, at);
  }
  api.runtime.onInstalled.addListener(() => run(snapshot));
  api.runtime.onStartup.addListener(() => run(snapshot));
  return { settled: () => pending };
}
