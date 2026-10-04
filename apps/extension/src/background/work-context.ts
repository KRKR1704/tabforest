// D-9: "Add page to Work Context". Reads only what the user hands over: the selection, or the visible text of
// the page they right-clicked. Nothing is read in the background (SPEC §3.5). Items stay on this device.
import type { WorkItem } from '../../../../contracts/bridge.types';
import { Hollow, redactText } from './hollow';
import { dupKey, httpUrl } from './url';

export const MENU_ID = 'tf-add-work-context';
export const ITEMS_KEY = 'tf_work_items';
export const MAX_CHARS = 12_000;
export const MAX_ITEMS = 20;
const TITLE_MAX = 300;

type StoredItem = WorkItem & { page_key: string };

interface Area {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

/**
 * Runs inside the page (chrome.scripting.executeScript). It has to stay self-contained: no outside helpers.
 * It returns the visible text of the main content and skips form fields, editable regions, scripts, styles
 * and hidden elements. It never reads input values, cookies or storage.
 */
export function grabPageText(): { text: string; title: string } {
  const SKIP = 'input,textarea,select,option,[contenteditable],script,style,noscript,template';
  const root: Element = document.querySelector('main, article, [role="main"]') ?? document.body;
  const parts: string[] = [];
  let length = 0;
  let lastBlock: Element | null = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node && length < 30_000; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || parent.closest(SKIP)) continue;
    if (typeof parent.checkVisibility === 'function' && !parent.checkVisibility({ checkVisibilityCSS: true })) continue;
    const value = (node.nodeValue ?? '').replace(/\s+/g, ' ');
    if (!value.trim()) continue;
    let block: Element = parent;
    while (block !== root && getComputedStyle(block).display.startsWith('inline')) block = block.parentElement ?? root;
    if (lastBlock && block !== lastBlock) parts.push('\n');
    parts.push(value);
    length += value.length;
    lastBlock = block;
  }
  const text = parts.join('').replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text, title: document.title };
}

const cap = (text: string, max: number): string => Array.from(text).slice(0, max).join('');

export function createWorkContext(deps: {
  api: Pick<typeof chrome, 'storage' | 'tabs' | 'scripting' | 'contextMenus' | 'action'>;
  now?: () => number;
  uuid?: () => string;
  hollow?: () => Promise<Hollow>;
}) {
  const { api } = deps;
  const area = api.storage.local as unknown as Area;
  const now = deps.now ?? Date.now;
  const uuid = deps.uuid ?? (() => crypto.randomUUID());
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const result = chain.then(work);
    chain = result.catch(() => {});
    return result;
  };

  async function load(): Promise<StoredItem[]> {
    const saved = (await area.get(ITEMS_KEY))[ITEMS_KEY];
    return Array.isArray(saved) ? (saved as StoredItem[]) : [];
  }

  function feedback(tabId: number | undefined, ok: boolean, reason?: string): void {
    if (tabId === undefined) return;
    const badge = (text: string, color: string, title: string) => {
      void api.action.setBadgeText({ text, tabId });
      void api.action.setBadgeBackgroundColor({ color, tabId });
      void api.action.setTitle({ title, tabId });
    };
    badge(ok ? '✓' : '!', ok ? '#2f7d52' : '#b23b2a',
      ok ? 'Added to Work Context' : `TabForest did not read this page: ${reason ?? 'it cannot be read'}`);
    setTimeout(() => {
      void api.action.setBadgeText({ text: '', tabId });
      void api.action.setTitle({ title: 'Open your Grove', tabId });
    }, 3500);
  }

  async function read(tab: chrome.tabs.Tab, selectionText: string | undefined):
  Promise<{ type: WorkItem['source_type']; text: string; title: string } | { error: string }> {
    const url = httpUrl(tab.url);
    if (!url || tab.id === undefined) return { error: 'this kind of page cannot be read' };
    const hollow = deps.hollow ? await deps.hollow() : new Hollow(api.storage.local);
    await hollow.refresh();
    // The Hollow runs first: a private, paused or incognito page is never read.
    if (hollow.excluded({ url: tab.url, pendingUrl: tab.pendingUrl, incognito: tab.incognito })) {
      return { error: 'it is private or capture is paused' };
    }
    const selected = selectionText?.trim();
    if (selected) return { type: 'selection', text: cap(selected, MAX_CHARS), title: tab.title ?? '' };
    try {
      const results = await api.scripting.executeScript({ target: { tabId: tab.id }, func: grabPageText });
      const page = results?.[0]?.result as { text?: unknown; title?: unknown } | undefined;
      if (!page || typeof page.text !== 'string' || !page.text.trim()) return { error: 'there is no text to read on it' };
      return { type: 'page_text', text: cap(page.text, MAX_CHARS), title: typeof page.title === 'string' ? page.title : (tab.title ?? '') };
    } catch {
      // Restricted pages (the Chrome Web Store, built-in pages, PDFs) refuse injection.
      return { error: 'this page does not allow it' };
    }
  }

  async function add(tab: chrome.tabs.Tab | undefined, selectionText?: string): Promise<{ ok: boolean; error?: string }> {
    if (!tab) return { ok: false, error: 'no page' };
    const read_ = await read(tab, selectionText);
    if ('error' in read_) { feedback(tab.id, false, read_.error); return { ok: false, error: read_.error }; }
    const url = httpUrl(tab.url)!;
    const shown = new URL(url.href);
    shown.search = ''; shown.hash = ''; shown.username = ''; shown.password = '';
    const key = await dupKey(url.href);
    const title = cap(redactText(read_.title).trim() || url.hostname, TITLE_MAX);
    const item: StoredItem = {
      id: uuid(), title, url: shown.href, text: read_.text, source_type: read_.type,
      captured_at: new Date(now()).toISOString(), page_key: key,
    };
    await serial(async () => {
      const kept = (await load()).filter(old => !(old.page_key === key && old.source_type === item.source_type
        && (item.source_type === 'page_text' || old.text === item.text)));
      kept.push(item);
      await area.set({ [ITEMS_KEY]: kept.slice(-MAX_ITEMS) });
    });
    feedback(tab.id, true);
    return { ok: true };
  }

  return {
    /** Registered synchronously at worker start; the menu item is created again on every start (it is idempotent). */
    register(): void {
      api.contextMenus.onClicked.addListener((info, tab) => {
        if (info.menuItemId === MENU_ID) void add(tab, info.selectionText);
      });
      api.contextMenus.create({ id: MENU_ID, title: 'Add page to Work Context', contexts: ['page', 'selection'] }, () => {
        void (globalThis as { chrome?: typeof chrome }).chrome?.runtime?.lastError; // a menu that already exists is fine
      });
    },
    add,
    /** Same path as the menu, for the active tab (used for manual testing from the worker console). */
    async addActiveTab(selectionText?: string) {
      const [tab] = await api.tabs.query({ active: true, lastFocusedWindow: true });
      return add(tab, selectionText);
    },
    async list(): Promise<WorkItem[]> {
      return (await serial(load)).map(({ page_key: _key, ...item }) => item);
    },
    clear(): Promise<void> { return serial(() => area.remove(ITEMS_KEY)); },
  };
}

export type WorkContext = ReturnType<typeof createWorkContext>;
