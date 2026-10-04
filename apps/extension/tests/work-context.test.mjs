import { afterEach, expect, test, vi } from 'vitest';
import { registerBridge } from '../src/background/bridge';
import { ITEMS_KEY, MAX_CHARS, MAX_ITEMS, MENU_ID, createWorkContext, grabPageText } from '../src/background/work-context';
import { fakeChrome, tab } from './fake-chrome.mjs';

afterEach(() => { vi.useRealTimers(); });

const page = (text, title = 'Ticket CAM-142 - Jira') => vi.fn(async () => [{ result: { text, title } }]);
function setup(execute = page('The migration decision is Azure Functions.')) {
  const fake = fakeChrome();
  fake.api.scripting.executeScript = execute;
  let id = 0; let time = Date.parse('2026-10-04T05:00:00Z');
  const work = createWorkContext({ api: fake.api, now: () => time, uuid: () => `item-${++id}` });
  const items = () => fake.api.storage.local.data[ITEMS_KEY] ?? [];
  return { fake, work, items, tick: ms => { time += ms; } };
}
const web = (extra = {}) => tab(7, { url: 'https://jira.contoso.com/browse/CAM-142?token=SECRET#comment', title: 'Ticket CAM-142', active: true, ...extra });
const badges = fake => fake.api.action.setBadgeText.mock.calls.map(c => c[0].text);

test('register creates the menu item and reacts only to its own menu id', async () => {
  const { fake, work, items } = setup();
  work.register();
  expect(fake.api.contextMenus.create).toHaveBeenCalledWith(
    { id: MENU_ID, title: 'Add page to Work Context', contexts: ['page', 'selection'] }, expect.any(Function));
  fake.api.contextMenus.onClicked.fire({ menuItemId: 'something-else' }, web());
  await new Promise(r => setTimeout(r, 20));
  expect(items()).toHaveLength(0);
  fake.api.contextMenus.onClicked.fire({ menuItemId: MENU_ID }, web());
  await vi.waitFor(() => expect(items()).toHaveLength(1));
});

test('a page is read through the injected function and stored with a stripped URL', async () => {
  const { fake, work, items } = setup();
  expect(await work.add(web())).toEqual({ ok: true });
  expect(fake.api.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 7 }, func: grabPageText });
  expect(items()[0]).toMatchObject({
    id: 'item-1', title: 'Ticket CAM-142 - Jira', url: 'https://jira.contoso.com/browse/CAM-142',
    text: 'The migration decision is Azure Functions.', source_type: 'page_text', captured_at: '2026-10-04T05:00:00.000Z',
  });
  expect(JSON.stringify(items())).not.toMatch(/SECRET|comment/);
  expect(badges(fake)).toContain('✓');
});

test('list returns the bridge shape without internal fields', async () => {
  const { work } = setup();
  await work.add(web());
  const [item] = await work.list();
  expect(Object.keys(item).sort()).toEqual(['captured_at', 'id', 'source_type', 'text', 'title', 'url']);
});

test('a selection is used as it is, without injecting any script', async () => {
  const { fake, work, items } = setup();
  await work.add(web(), '  Decision: use Azure Functions.  ');
  expect(fake.api.scripting.executeScript).not.toHaveBeenCalled();
  expect(items()[0]).toMatchObject({ source_type: 'selection', text: 'Decision: use Azure Functions.' });
});

test('both a selection and page text are cut at 12,000 characters', async () => {
  const { work, items } = setup(page('x'.repeat(20_000)));
  await work.add(web());
  await work.add(web({ url: 'https://example.com/other' }), 'y'.repeat(15_000));
  expect(items().map(i => i.text.length)).toEqual([MAX_CHARS, MAX_CHARS]);
});

test('the Hollow runs first: a private page is never read', async () => {
  const { fake, work, items } = setup();
  const result = await work.add(web({ url: 'https://www.chase.com/accounts' }));
  expect(result.ok).toBe(false);
  expect(fake.api.scripting.executeScript).not.toHaveBeenCalled();
  expect(items()).toHaveLength(0);
  expect(badges(fake)).toContain('!');
  expect((await work.add(web({ url: 'https://example.com/login' }))).ok).toBe(false);
});

test('a selection on a private page is not taken either, and a paused capture blocks it', async () => {
  const { fake, work, items } = setup();
  expect((await work.add(web({ url: 'https://mail.google.com/mail' }), 'secret text')).ok).toBe(false);
  fake.api.storage.local.data.paused_until = 'until resumed';
  expect((await work.add(web(), 'some text')).ok).toBe(false);
  expect(items()).toHaveLength(0);
});

test('built-in and non-web pages are refused without trying to inject', async () => {
  const { fake, work } = setup();
  for (const url of ['chrome://settings', 'about:blank', 'chrome-extension://x/grove.html', 'file:///tmp/a.txt', undefined]) {
    expect((await work.add(web({ url }))).ok).toBe(false);
  }
  expect(fake.api.scripting.executeScript).not.toHaveBeenCalled();
});

test('a page that refuses injection is reported kindly and nothing is stored', async () => {
  const { fake, work, items } = setup(vi.fn(async () => { throw new Error('The extensions gallery cannot be scripted.'); }));
  const result = await work.add(web({ url: 'https://chromewebstore.google.com/detail/x' }));
  expect(result).toEqual({ ok: false, error: 'this page does not allow it' });
  expect(items()).toHaveLength(0);
  expect(fake.api.action.setTitle.mock.calls.some(c => /did not read this page/.test(c[0].title))).toBe(true);
});

test('a page without any text is not stored', async () => {
  const { work, items } = setup(page('   \n  '));
  expect((await work.add(web())).ok).toBe(false);
  expect(items()).toHaveLength(0);
});

test('titles are redacted, cut at 300 characters and fall back to the site name', async () => {
  const redacted = setup(page('t', 'Receipt for jane.doe@example.com order 123456789012'));
  await redacted.work.add(web());
  expect(redacted.items()[0].title).toBe('Receipt for [redacted] order [redacted]');
  const long = setup(page('t', 'word '.repeat(100)));
  await long.work.add(web());
  expect(Array.from(long.items()[0].title)).toHaveLength(300);
  const empty = setup(page('t', ''));
  await empty.work.add(web());
  expect(empty.items()[0].title).toBe('jira.contoso.com');
});

test('adding the same page again replaces it, different selections are kept', async () => {
  const { work, items, tick } = setup();
  await work.add(web()); tick(1000); await work.add(web({ url: 'https://jira.contoso.com/browse/CAM-142?token=SECRET&utm_source=mail#x' }));
  expect(items()).toHaveLength(1);
  expect(items()[0].captured_at).toBe('2026-10-04T05:00:01.000Z');
  await work.add(web(), 'first note'); await work.add(web(), 'second note'); await work.add(web(), 'first note');
  expect(items().map(i => i.source_type + ':' + i.text.slice(0, 5))).toEqual(['page_text:The m', 'selection:secon', 'selection:first']);
});

test('only the 20 newest items are kept', async () => {
  const { work, items } = setup();
  for (let i = 0; i < MAX_ITEMS + 5; i++) await work.add(web({ url: `https://example.com/page-${i}` }), `note ${i}`);
  expect(items()).toHaveLength(MAX_ITEMS);
  expect(items()[0].text).toBe('note 5');
  expect(items().at(-1).text).toBe(`note ${MAX_ITEMS + 4}`);
});

test('clear removes everything, and items live only in local storage', async () => {
  const { fake, work, items } = setup();
  await work.add(web());
  expect(Object.keys(fake.api.storage.session.data)).not.toContain(ITEMS_KEY);
  await work.clear();
  expect(items()).toHaveLength(0);
  expect(await work.list()).toEqual([]);
});

test('the badge goes back to normal after a few seconds', async () => {
  vi.useFakeTimers();
  const { fake, work } = setup();
  await work.add(web());
  expect(badges(fake)).toEqual(['✓']);
  await vi.advanceTimersByTimeAsync(4000);
  expect(badges(fake)).toEqual(['✓', '']);
});

test('the bridge answers GET_WORK_ITEMS and CLEAR_WORK_ITEMS from the store', async () => {
  const { fake, work } = setup();
  registerBridge(fake.api, { settled: async () => {}, sendPreview: async () => ({ pending_count: 0, sample_events: [] }), workItems: work });
  const send = message => new Promise(resolve => fake.api.runtime.onMessage.fire(message, { id: 'test', url: 'chrome-extension://test/grove.html' }, resolve));
  expect(await send({ type: 'GET_WORK_ITEMS' })).toEqual({ ok: true, data: { items: [] } });
  await work.add(web());
  const reply = await send({ type: 'GET_WORK_ITEMS' });
  expect(reply.data.items).toHaveLength(1);
  expect(reply.data.items[0]).toMatchObject({ title: 'Ticket CAM-142 - Jira', url: 'https://jira.contoso.com/browse/CAM-142' });
  expect(await send({ type: 'CLEAR_WORK_ITEMS' })).toEqual({ ok: true, data: null });
  expect((await send({ type: 'GET_WORK_ITEMS' })).data.items).toEqual([]);
});

test('addActiveTab uses the active tab of the focused window', async () => {
  const { fake, work, items } = setup();
  fake.tabs.set(7, web());
  expect((await work.addActiveTab()).ok).toBe(true);
  expect(items()).toHaveLength(1);
});
