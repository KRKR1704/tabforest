import type { BridgeRequest, BridgeReply, MessageType, SendPreviewData } from '../../../../contracts/bridge.types';
import { CaptureStateStore, type SnapshotItem } from './state';
import { Hollow } from './hollow';
import { httpUrl } from './url';
import { AuthError } from './auth';
import type { WorkContext } from './work-context';
import type { PrivacySync } from './privacy-sync';
import { INTERNAL_AUTH_TYPES, type AuthService, type InternalAuthMessage } from './signin';

type SnapshotData = { open_tabs: SnapshotItem[] };
type Reply = BridgeReply<Exclude<MessageType, 'GET_SNAPSHOT'>> | { ok: boolean; data?: SnapshotData; error?: string };
export interface BridgeServices {
  settled: () => Promise<void>;
  wipeLocal?: () => Promise<void>;
  sendPreview: () => Promise<SendPreviewData>;
  auth?: AuthService;
  workItems?: Pick<WorkContext, 'list' | 'clear'>;
  privacy?: Pick<PrivacySync, 'record' | 'onSignedIn'>;
  signOut?: () => Promise<void>;
}
const known = new Set<MessageType>([
  'GET_SNAPSHOT', 'OPEN_TAB', 'CLOSE_TABS', 'RESTORE', 'GET_URLS', 'SIGN_IN', 'SIGN_OUT',
  'GET_AUTH_STATE', 'GET_TOKEN', 'PAUSE', 'EXCLUDE_DOMAIN', 'GET_HOLLOW_COUNT',
  'GET_SEND_PREVIEW', 'GET_WORK_ITEMS', 'CLEAR_WORK_ITEMS', 'WIPE_LOCAL',
]);
const refsPayload = (value: unknown): value is string[] => Array.isArray(value) && value.every(x => typeof x === 'string');

export function registerBridge(api: typeof chrome, services: BridgeServices): void {
  const store = new CaptureStateStore(api.storage);
  async function read() {
    await services.settled();
    const saved = await store.load();
    const hollow = new Hollow(api.storage.local);
    await hollow.refresh();
    const tabs = await api.tabs.query({});
    for (const tab of tabs) hollow.observe(tab);
    return { saved, hollow, tabs, refs: new Map(saved.session?.refs ?? []) };
  }

  /** Brings a tab for the ref to the front, or opens it from the local URL store (else the fallback). */
  async function openRef(ref: string, fallback?: string, options: { active?: boolean } = {}):
  Promise<{ id?: number; windowId?: number } | null> {
    const { saved, tabs, refs } = await read();
    const live = tabs.find(tab => refs.get(tab.id!) === ref);
    if (live?.id !== undefined) {
      if (options.active !== false) {
        await api.tabs.update(live.id, { active: true });
        await api.windows.update(live.windowId, { focused: true });
      }
      return { id: live.id, windowId: live.windowId };
    }
    const stored = new Map(saved.urls);
    const value = stored.has(ref) ? stored.get(ref) : fallback;
    const url = httpUrl(value);
    if (!url) return null;
    const created = await api.tabs.create({ url: url.href, ...(options.active === false ? { active: false } : {}) });
    return { id: created?.id, windowId: created?.windowId };
  }

  /** Puts the restored tabs into one named group when the optional tabGroups permission was granted. */
  async function groupTabs(opened: { id?: number; windowId?: number }[], name: string): Promise<void> {
    const first = opened.find(tab => tab.id !== undefined);
    if (!first || !api.tabs.group || !api.tabGroups) return;
    try {
      if (!await api.permissions.contains({ permissions: ['tabGroups'] })) return;
      // A group lives in one window: the ones that were already open elsewhere stay where they are.
      const tabIds = opened.filter(tab => tab.id !== undefined && tab.windowId === first.windowId).map(tab => tab.id!);
      const groupId = await api.tabs.group({ tabIds });
      await api.tabGroups.update(groupId, { title: name.trim().slice(0, 60), color: 'green', collapsed: false });
    } catch { /* the tabs are open already; a group is only a convenience */ }
  }

  async function handle(request: BridgeRequest): Promise<Reply> {
    switch (request.type) {
      case 'SIGN_IN': {
        if (!services.auth) return { ok: false, error: 'not_implemented' };
        try {
          const state = await services.auth.signIn();
          void services.privacy?.onSignedIn();
          return { ok: true, data: state };
        }
        catch (error) { return { ok: false, error: error instanceof AuthError ? error.code : 'handler_failed' }; }
      }
      case 'SIGN_OUT': {
        if (!services.signOut) return { ok: false, error: 'not_implemented' };
        await services.signOut();
        return { ok: true, data: null };
      }
      case 'CLEAR_WORK_ITEMS': { await services.workItems?.clear(); return { ok: true, data: null }; }
      case 'WIPE_LOCAL': {
        if (!services.wipeLocal) return { ok: false, error: 'not_implemented' };
        await services.wipeLocal();
        return { ok: true, data: null };
      }
      case 'PAUSE': {
        const until: unknown = request.until;
        if (until !== null && !(typeof until === 'number' && Number.isFinite(until))
          && !(typeof until === 'string' && (until === 'until resumed' || Number.isFinite(Date.parse(until))))) {
          return { ok: false, error: 'invalid_payload' };
        }
        if (until === null) await api.storage.local.remove('paused_until');
        else await api.storage.local.set({ paused_until: until });
        await services.privacy?.record({ paused: until });
        return { ok: true, data: null };
      }
      case 'EXCLUDE_DOMAIN': {
        if (typeof request.domain !== 'string') return { ok: false, error: 'invalid_payload' };
        const domain = request.domain.trim().toLowerCase();
        if (!domain || domain.length > 253 || !domain.split('.').every(label =>
          /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return { ok: false, error: 'invalid_payload' };
        const saved = await api.storage.local.get('user_excluded_domains');
        const existing = Array.isArray(saved.user_excluded_domains)
          ? saved.user_excluded_domains.filter((x: unknown): x is string => typeof x === 'string').map((x: string) => x.toLowerCase()) : [];
        await api.storage.local.set({ user_excluded_domains: [...new Set([...existing, domain])] });
        await services.privacy?.record({ addDomain: domain });
        return { ok: true, data: null };
      }
      case 'OPEN_TAB': {
        if (typeof request.tab_ref !== 'string') return { ok: false, error: 'invalid_payload' };
        return await openRef(request.tab_ref) ? { ok: true, data: null } : { ok: false, error: 'not_found' };
      }
      case 'CLOSE_TABS': {
        if (!refsPayload(request.tab_refs)) return { ok: false, error: 'invalid_payload' };
        const { tabs, refs } = await read();
        const wanted = new Set(request.tab_refs);
        const ids = tabs.filter(tab => tab.id !== undefined && wanted.has(refs.get(tab.id) ?? '')).map(tab => tab.id!);
        if (ids.length) await api.tabs.remove(ids);
        return { ok: true, data: null };
      }
      case 'RESTORE': {
        if (!refsPayload(request.tab_refs) || (request.fallback_urls !== undefined && !refsPayload(request.fallback_urls))
          || (request.group_name !== undefined && typeof request.group_name !== 'string')) return { ok: false, error: 'invalid_payload' };
        const visited = new Set<string>();
        const opened: { id?: number; windowId?: number }[] = [];
        for (const [index, ref] of request.tab_refs.entries()) {
          if (visited.has(ref)) continue;
          visited.add(ref);
          // The first tab comes to the front; the others open quietly behind it.
          const tab = await openRef(ref, request.fallback_urls?.[index], { active: opened.length === 0 });
          if (tab) opened.push(tab);
        }
        if (!opened.length) return { ok: false, error: 'not_found' };
        if (request.group_name?.trim()) await groupTabs(opened, request.group_name);
        return { ok: true, data: null };
      }
      case 'GET_AUTH_STATE': return { ok: true, data: services.auth ? await services.auth.state() : { signed_in: false } };
      case 'GET_TOKEN': return { ok: true, data: { token: services.auth ? await services.auth.token() : null } };
      case 'GET_WORK_ITEMS': return { ok: true, data: { items: services.workItems ? await services.workItems.list() : [] } };
      case 'GET_SEND_PREVIEW': return { ok: true, data: await services.sendPreview() };
      case 'GET_HOLLOW_COUNT': return { ok: true, data: { count: (await read()).hollow.hollowCount() } };
      case 'GET_SNAPSHOT': {
        const { saved, hollow, tabs, refs } = await read();
        const opened = new Set(saved.session?.openedRefs ?? []);
        const items = new Map(saved.session?.snapshotItems ?? []);
        const open_tabs = tabs.filter(tab => tab.id !== undefined && opened.has(refs.get(tab.id) ?? '')
          && items.has(refs.get(tab.id) ?? '') && !hollow.excluded(tab))
          .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0)).slice(0, 60)
          .map(tab => ({ ...items.get(refs.get(tab.id!)!)!, active: tab.active, pinned: tab.pinned }));
        return { ok: true, data: { open_tabs } };
      }
      case 'GET_URLS': {
        if (!refsPayload(request.tab_refs)) return { ok: false, error: 'invalid_payload' };
        const { saved, hollow, tabs, refs } = await read();
        const blocked = new Set(tabs.filter(tab => hollow.excluded(tab)).map(tab => refs.get(tab.id!)));
        const urls: Record<string, string> = Object.create(null);
        const stored = new Map(saved.urls);
        for (const ref of request.tab_refs) {
          const value = stored.get(ref);
          if (!value || blocked.has(ref) || hollow.excluded({ url: value })) continue;
          const url = httpUrl(value);
          if (url) { url.search = ''; url.hash = ''; url.username = ''; url.password = ''; urls[ref] = url.href; }
        }
        return { ok: true, data: { urls } };
      }
      default: return { ok: false, error: 'not_implemented' };
    }
  }

  let pending = Promise.resolve();
  // Synchronous registration is required before worker rehydration awaits storage.
  api.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!api.runtime.id || sender.id !== api.runtime.id) { sendResponse({ ok: false, error: 'forbidden' }); return true; }
    const type = message && typeof message === 'object' ? (message as { type?: unknown }).type : undefined;
    // The sign-in window talks to the worker directly. These messages are never queued behind SIGN_IN,
    // which waits for that window, and they are accepted only from the sign-in page (checked in the service).
    if (typeof type === 'string' && INTERNAL_AUTH_TYPES.has(type)) {
      if (!services.auth) { sendResponse({ ok: false, error: 'not_implemented' }); return true; }
      void services.auth.handleInternal(message as InternalAuthMessage, sender.url)
        .then(sendResponse).catch(() => sendResponse({ ok: false, error: 'handler_failed' }));
      return true;
    }
    if (typeof type !== 'string' || !known.has(type as MessageType)) {
      sendResponse({ ok: false, error: 'unknown_message' }); return true;
    }
    if (type === 'SIGN_IN') {
      // Waits for the user in the sign-in window, so it must not hold up the other messages.
      void handle(message as BridgeRequest).then(sendResponse).catch(() => sendResponse({ ok: false, error: 'handler_failed' }));
      return true;
    }
    pending = pending.then(() => handle(message as BridgeRequest)).then(sendResponse).catch(() => {
      console.warn(type);
      sendResponse({ ok: false, error: 'handler_failed' });
    });
    return true;
  });
}
