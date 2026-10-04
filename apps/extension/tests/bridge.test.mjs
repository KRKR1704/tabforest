import { afterEach, expect, test, vi } from 'vitest';
import { registerBridge } from '../src/background/bridge';
import { registerCapture } from '../src/background/capture';
import { fakeChrome, tab } from './fake-chrome.mjs';

async function setup(tabs = []) {
  const fake = fakeChrome(tabs);
  fake.api.runtime.id = 'self';
  let listener;
  fake.api.runtime.onMessage = { addListener: fn => { listener = fn; } };
  const events = [];
  const capture = registerCapture(fake.api, e => events.push(e), () => 1000);
  const preview = vi.fn(async () => ({ pending_count: 0, sample_events: [] }));
  registerBridge(fake.api, { settled: capture.settled, sendPreview: preview });
  const message = (request, sender = { id: 'self' }) => new Promise(resolve => {
    expect(listener(request, sender, resolve)).toBe(true);
  });
  await capture.settled();
  return { ...fake, capture, events, preview, message };
}
afterEach(() => vi.restoreAllMocks());

test('router rejects foreign sender and unknown type; registers before async work', async () => {
  const h = await setup();
  expect(await h.message({ type: 'GET_TOKEN' }, { id: 'other' })).toEqual({ ok: false, error: 'forbidden' });
  expect(await h.message({ type: 'GET_TOKEN' }, {})).toEqual({ ok: false, error: 'forbidden' });
  expect(await h.message({ type: 'UNKNOWN' })).toEqual({ ok: false, error: 'unknown_message' });
  expect(await h.message(null)).toEqual({ ok: false, error: 'unknown_message' });
});

test('read-only stubs and preview match reply shapes; errors log only known type', async () => {
  const h = await setup();
  expect(await h.message({ type: 'GET_AUTH_STATE' })).toEqual({ ok: true, data: { signed_in: false } });
  expect(await h.message({ type: 'GET_TOKEN' })).toEqual({ ok: true, data: { token: null } });
  expect(await h.message({ type: 'GET_WORK_ITEMS' })).toEqual({ ok: true, data: { items: [] } });
  expect(await h.message({ type: 'GET_SEND_PREVIEW' })).toEqual({ ok: true, data: { pending_count: 0, sample_events: [] } });
  const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
  h.preview.mockRejectedValueOnce(new Error('private contents'));
  expect(await h.message({ type: 'GET_SEND_PREVIEW' })).toEqual({ ok: false, error: 'handler_failed' });
  expect(log.mock.calls).toEqual([['GET_SEND_PREVIEW']]);
});

test('snapshot includes only opened eligible tabs with persisted OPEN time and nullable redacted titles', async () => {
  const h = await setup([tab(1, { active: true }), tab(2, { url: 'https://chase.com/' })]);
  const page = tab(3, { url: 'https://example.com/path?secret=1#fragment', title: 'example.com/path?secret=1' });
  h.tabs.set(3, page); h.api.tabs.onCreated.fire(page); await h.capture.settled();
  const ref = h.events.find(e => e.type === 'OPEN').tab_ref;
  const reply = await h.message({ type: 'GET_SNAPSHOT' });
  expect(reply.ok).toBe(true); expect(reply.data.open_tabs).toHaveLength(1);
  expect(reply.data.open_tabs[0]).toMatchObject({ tab_ref: ref, title: null, opened_at: new Date(1000).toISOString() });
  expect(Object.keys(reply.data.open_tabs[0]).sort()).toEqual(['active', 'domain', 'dup_key', 'opened_at', 'opener_tab_ref', 'pinned', 'search_query', 'tab_ref', 'title']);
  const serialized = JSON.stringify(reply);
  expect(serialized.includes('https://')).toBe(false); expect(serialized.includes('secret=1')).toBe(false);
  expect(h.api.storage.session.data.tf_capture_session.snapshotItems[0][1].opened_at).toBe(new Date(1000).toISOString());
  const restarted = fakeChrome([...h.tabs.values()], { id: 1, focused: true }, h.api.storage);
  await registerCapture(restarted.api, () => {}, () => 5000).settled();
  expect(h.api.storage.session.data.tf_capture_session.snapshotItems[0][1].opened_at).toBe(new Date(1000).toISOString());
  expect(await h.message({ type: 'GET_HOLLOW_COUNT' })).toEqual({ ok: true, data: { count: 1 } });
});

test('snapshot sorts latest accessed first and caps at 60 without Chrome ids', async () => {
  const h = await setup();
  for (let id = 1; id <= 65; id++) {
    const page = tab(id); h.tabs.set(id, page); h.api.tabs.onCreated.fire(page);
  }
  await h.capture.settled();
  const reply = await h.message({ type: 'GET_SNAPSHOT' });
  expect(reply.data.open_tabs).toHaveLength(60);
  expect(reply.data.open_tabs.map(t => t.title)).toEqual(Array.from({ length: 60 }, (_, n) => `Page ${65 - n}`));
  expect(reply.data.open_tabs.every(t => !('id' in t) && !('windowId' in t))).toBe(true);
});

test('GET_URLS strips query/fragment and suppresses Hollow tabs and unknown refs', async () => {
  const h = await setup();
  const page = tab(1, { url: 'https://example.com/path?private=1#frag' });
  h.tabs.set(1, page); h.api.tabs.onCreated.fire(page); await h.capture.settled();
  const ref = h.events[0].tab_ref;
  expect(await h.message({ type: 'GET_URLS', tab_refs: [ref, 'missing'] })).toEqual({ ok: true, data: { urls: { [ref]: 'https://example.com/path' } } });
  h.tabs.set(1, tab(1, { url: 'https://chase.com/' }));
  expect(await h.message({ type: 'GET_URLS', tab_refs: [ref] })).toEqual({ ok: true, data: { urls: {} } });
  expect(await h.message({ type: 'GET_URLS', tab_refs: 3 })).toEqual({ ok: false, error: 'invalid_payload' });
});

test('tab actions focus mapped live tabs, reopen locally, close only named refs', async () => {
  const h = await setup();
  h.api.tabs.update = vi.fn(async () => {}); h.api.windows.update = vi.fn(async () => {});
  h.api.tabs.remove = vi.fn(async () => {});
  for (const id of [1, 2]) { const page = tab(id); h.tabs.set(id, page); h.api.tabs.onCreated.fire(page); }
  await h.capture.settled();
  const refs = h.events.filter(e => e.type === 'OPEN').map(e => e.tab_ref);
  expect(await h.message({ type: 'OPEN_TAB', tab_ref: refs[0] })).toEqual({ ok: true, data: null });
  expect(h.api.tabs.update).toHaveBeenCalledWith(1, { active: true });
  expect(h.api.windows.update).toHaveBeenCalledWith(1, { focused: true });
  expect(h.api.tabs.remove).not.toHaveBeenCalled();
  h.tabs.delete(1); h.api.tabs.onRemoved.fire(1); await h.capture.settled();
  expect(await h.message({ type: 'OPEN_TAB', tab_ref: refs[0] })).toEqual({ ok: true, data: null });
  expect(h.api.tabs.create).toHaveBeenCalledWith({ url: 'https://example.com/page-1' });
  expect(await h.message({ type: 'OPEN_TAB', tab_ref: 'missing' })).toEqual({ ok: false, error: 'not_found' });
  expect(await h.message({ type: 'CLOSE_TABS', tab_refs: refs }, { id: 'other' })).toEqual({ ok: false, error: 'forbidden' });
  expect(h.api.tabs.remove).not.toHaveBeenCalled();
  expect(await h.message({ type: 'CLOSE_TABS', tab_refs: [refs[1], 'missing'] })).toEqual({ ok: true, data: null });
  expect(h.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([2]);
});

test('RESTORE uses positional fallback only without local entry, focuses existing and rejects unsafe fallback', async () => {
  const h = await setup();
  h.api.tabs.update = vi.fn(async () => {}); h.api.windows.update = vi.fn(async () => {});
  h.api.tabs.remove = vi.fn();
  const page = tab(1); h.tabs.set(1, page); h.api.tabs.onCreated.fire(page); await h.capture.settled();
  const ref = h.events[0].tab_ref;
  expect(await h.message({ type: 'RESTORE', tab_refs: [ref], fallback_urls: ['https://ignored.test/'], group_name: 'Name' })).toEqual({ ok: true, data: null });
  expect(h.api.tabs.create).not.toHaveBeenCalled();
  h.tabs.delete(1); h.api.tabs.onRemoved.fire(1); await h.capture.settled();
  expect(await h.message({ type: 'RESTORE', tab_refs: [ref, 'new'], fallback_urls: ['https://ignored.test/', 'https://fallback.test/path'] })).toEqual({ ok: true, data: null });
  expect(h.api.tabs.create.mock.calls.map(([x]) => x.url)).toEqual(['https://example.com/page-1', 'https://fallback.test/path']);
  expect(await h.message({ type: 'RESTORE', tab_refs: ['bad'], fallback_urls: ['javascript:alert(1)'] })).toEqual({ ok: false, error: 'not_found' });
  expect(h.api.tabs.remove).not.toHaveBeenCalled();
});

test('PAUSE writes supported values and null removes key; auth/work-item stubs', async () => {
  const h = await setup();
  h.api.storage.local.remove = vi.fn(async key => { delete h.api.storage.local.data[key]; });
  for (const until of [Date.now() + 60000, '2099-01-01T00:00:00Z', 'until resumed']) {
    expect(await h.message({ type: 'PAUSE', until })).toEqual({ ok: true, data: null });
    expect(h.api.storage.local.data.paused_until).toBe(until);
  }
  expect(await h.message({ type: 'PAUSE', until: null })).toEqual({ ok: true, data: null });
  expect(h.api.storage.local.data.paused_until).toBeUndefined();
  expect(await h.message({ type: 'PAUSE', until: 'invalid' })).toEqual({ ok: false, error: 'invalid_payload' });
  for (const type of ['SIGN_IN', 'SIGN_OUT']) expect(await h.message({ type })).toEqual({ ok: false, error: 'not_implemented' });
  expect(await h.message({ type: 'CLEAR_WORK_ITEMS' })).toEqual({ ok: true, data: null });
});

test('EXCLUDE_DOMAIN normalizes and deduplicates concurrent writes and immediately gates next capture', async () => {
  const h = await setup();
  await Promise.all(['EXAMPLE.COM', 'example.com', 'other.test'].map(domain => h.message({ type: 'EXCLUDE_DOMAIN', domain })));
  expect(h.api.storage.local.data.user_excluded_domains).toEqual(['example.com', 'other.test']);
  for (const domain of ['https://bad.test/', 'bad.test/path', 'bad..test']) {
    expect(await h.message({ type: 'EXCLUDE_DOMAIN', domain })).toEqual({ ok: false, error: 'invalid_payload' });
  }
  const page = tab(1); h.tabs.set(1, page); h.api.tabs.onCreated.fire(page); await h.capture.settled();
  expect(h.events).toHaveLength(0);
  expect(h.capture.hollowCount()).toBe(1);
});

test('WIPE_LOCAL clears both stores and live capture memory without restart', async () => {
  const h = await setup();
  for (const area of [h.api.storage.local, h.api.storage.session]) {
    area.clear = vi.fn(async () => { for (const key of Object.keys(area.data)) delete area.data[key]; });
  }
  const page = tab(1); h.tabs.set(1, page); h.api.tabs.onCreated.fire(page); await h.capture.settled();
  const oldRef = h.events[0].tab_ref;
  h.api.storage.local.data.extra = 'settings';
  registerBridge(h.api, { settled: h.capture.settled, sendPreview: h.preview, wipeLocal: h.capture.reset });
  expect(await h.message({ type: 'WIPE_LOCAL' })).toEqual({ ok: true, data: null });
  expect(h.api.storage.local.data).toEqual({}); expect(h.api.storage.session.data).toEqual({});
  expect(h.capture.hollowCount()).toBe(0);
  expect((await h.message({ type: 'GET_SNAPSHOT' })).data.open_tabs).toEqual([]);
  h.api.tabs.onCreated.fire(page); await h.capture.settled();
  expect(h.events.at(-1).tab_ref).not.toBe(oldRef);
});

test('RESTORE opens every ref, brings only the first to the front, and keeps going when one cannot be opened', async () => {
  const h = await setup();
  h.api.tabs.update = vi.fn(async () => {}); h.api.windows.update = vi.fn(async () => {});
  expect(await h.message({ type: 'RESTORE', tab_refs: ['a', 'b', 'c'],
    fallback_urls: ['https://one.test/', 'javascript:alert(1)', 'https://three.test/'] })).toEqual({ ok: true, data: null });
  expect(h.api.tabs.create.mock.calls.map(([x]) => x)).toEqual([
    { url: 'https://one.test/' }, { url: 'https://three.test/', active: false }]);
});

test('RESTORE groups the opened tabs under the name when tabGroups was granted', async () => {
  const h = await setup();
  let id = 10;
  h.api.tabs.create = vi.fn(async () => ({ id: ++id, windowId: 1 }));
  h.api.tabs.group = vi.fn(async () => 77);
  h.api.tabGroups = { update: vi.fn(async () => ({})) };
  h.api.permissions = { contains: vi.fn(async () => true) };
  const urls = ['https://one.test/', 'https://two.test/', 'https://three.test/'];
  expect(await h.message({ type: 'RESTORE', tab_refs: ['a', 'b', 'c'], fallback_urls: urls, group_name: 'Backend Authentication' }))
    .toEqual({ ok: true, data: null });
  expect(h.api.permissions.contains).toHaveBeenCalledWith({ permissions: ['tabGroups'] });
  expect(h.api.tabs.group).toHaveBeenCalledExactlyOnceWith({ tabIds: [11, 12, 13] });
  expect(h.api.tabGroups.update).toHaveBeenCalledExactlyOnceWith(77, { title: 'Backend Authentication', color: 'green', collapsed: false });
});

test('RESTORE opens plain tabs when tabGroups was declined, and a failing group call does not fail the restore', async () => {
  const h = await setup();
  h.api.tabs.create = vi.fn(async () => ({ id: 5, windowId: 1 }));
  h.api.tabs.group = vi.fn(async () => 77);
  h.api.tabGroups = { update: vi.fn() };
  h.api.permissions = { contains: vi.fn(async () => false) };
  const body = { type: 'RESTORE', tab_refs: ['a'], fallback_urls: ['https://one.test/'], group_name: 'Name' };
  expect(await h.message(body)).toEqual({ ok: true, data: null });
  expect(h.api.tabs.group).not.toHaveBeenCalled();
  h.api.permissions.contains = vi.fn(async () => true);
  h.api.tabs.group = vi.fn(async () => { throw new Error('boom'); });
  expect(await h.message(body)).toEqual({ ok: true, data: null });
});

test('RESTORE only groups tabs of one window and ignores a blank group name', async () => {
  const h = await setup();
  const windows = [1, 2];
  let id = 20;
  h.api.tabs.create = vi.fn(async () => ({ id: ++id, windowId: windows[id - 21] }));
  h.api.tabs.group = vi.fn(async () => 1);
  h.api.tabGroups = { update: vi.fn(async () => ({})) };
  h.api.permissions = { contains: vi.fn(async () => true) };
  const urls = ['https://one.test/', 'https://two.test/'];
  await h.message({ type: 'RESTORE', tab_refs: ['a', 'b'], fallback_urls: urls, group_name: 'G' });
  expect(h.api.tabs.group).toHaveBeenCalledExactlyOnceWith({ tabIds: [21] });
  h.api.tabs.group.mockClear();
  await h.message({ type: 'RESTORE', tab_refs: ['a', 'b'], fallback_urls: urls, group_name: '   ' });
  expect(h.api.tabs.group).not.toHaveBeenCalled();
});
