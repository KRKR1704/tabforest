import { readFileSync } from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
import { registerCapture } from '../src/background/capture';
import { emit } from '../src/background/emit';
import { fakeChrome, tab } from './fake-chrome.mjs';

const contract = JSON.parse(readFileSync(new URL('../../../contracts/events.example.json', import.meta.url), 'utf8'));
const firstSend = contract.examples.find(example => example.name === 'first_send').request.body.events;
const contractKeys = Object.fromEntries(firstSend.map(event => [event.type, Object.keys(event).sort()]));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function setup(tabs = [], window) {
  const fake = fakeChrome(tabs, window);
  const events = [];
  let time = Date.UTC(2026, 9, 3);
  const capture = registerCapture(fake.api, event => events.push(event), () => time);
  await capture.settled();
  return { ...fake, events, settle: capture.settled, advance: ms => { time += ms; } };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test('initial focused tab emits FOCUS before its first BLUR', async () => {
  const h = await setup([tab(1, { active: true }), tab(2)]);
  expect(h.events).toHaveLength(1);
  expect(h.events[0]).toMatchObject({ type: 'FOCUS', previous_tab_ref: null });
  const ref = h.events[0].tab_ref;
  h.advance(750);
  h.api.tabs.onActivated.fire({ tabId: 2, windowId: 1 }); await h.settle();
  expect(h.events.map(e => e.type)).toEqual(['FOCUS', 'BLUR', 'FOCUS']);
  expect(h.events[1]).toMatchObject({ tab_ref: ref, active_ms: 750 });
  expect(h.events[2].previous_tab_ref).toBe(ref);
});

test.each(['removed-first', 'activated-first'])('closing focused tab preserves dwell and previous ref: %s', async order => {
  const h = await setup([tab(1), tab(2)]);
  h.api.tabs.onActivated.fire({ tabId: 1, windowId: 1 }); await h.settle();
  const ref = h.events[0].tab_ref;
  h.advance(1250);
  if (order === 'removed-first') {
    h.api.tabs.onRemoved.fire(1);
    h.api.tabs.onActivated.fire({ tabId: 2, windowId: 1 });
  } else {
    h.api.tabs.onActivated.fire({ tabId: 2, windowId: 1 });
    h.api.tabs.onRemoved.fire(1);
  }
  await h.settle();
  expect(h.events.slice(1).map(e => e.type)).toEqual(order === 'removed-first'
    ? ['BLUR', 'CLOSE', 'FOCUS'] : ['BLUR', 'FOCUS', 'CLOSE']);
  const blurs = h.events.filter(e => e.type === 'BLUR' && e.tab_ref === ref);
  expect(blurs).toHaveLength(1);
  expect(blurs[0].active_ms).toBe(1250);
  expect(h.events.find(e => e.type === 'CLOSE').tab_ref).toBe(ref);
  expect(h.events.filter(e => e.type === 'FOCUS')[1].previous_tab_ref).toBe(ref);
  expect(new Set(h.events.slice(1).map(e => e.ts)).size).toBe(1);
});

test('all lifecycle events match first_send keys, stable refs and opener relationships', async () => {
  const h = await setup();
  const parent = tab(1001);
  const child = tab(1002, { openerTabId: 1001, title: 'research notes '.repeat(25), url: 'https://www.google.com/search?q=refresh+token' });
  h.tabs.set(parent.id, parent); h.api.tabs.onCreated.fire(parent);
  h.tabs.set(child.id, child); h.api.tabs.onCreated.fire(child);
  await h.settle();
  const parentRef = h.events[0].tab_ref;
  const childRef = h.events[1].tab_ref;
  expect(h.events[1].opener_tab_ref).toBe(parentRef);
  expect(h.events[1].title).toHaveLength(300);
  expect(h.events[1].search_query).toBe('refresh token');
  expect(h.events[1].domain).toBe('www.google.com');
  h.api.tabs.onActivated.fire({ tabId: parent.id, windowId: 1 }); await h.settle();
  expect(h.events.at(-1).previous_tab_ref).toBeNull();
  h.advance(1500);
  h.api.tabs.onActivated.fire({ tabId: child.id, windowId: 1 }); await h.settle();
  expect(h.events.at(-2)).toMatchObject({ type: 'BLUR', tab_ref: parentRef, active_ms: 1500 });
  expect(h.events.at(-1)).toMatchObject({ type: 'FOCUS', tab_ref: childRef, previous_tab_ref: parentRef });
  h.api.tabs.onUpdated.fire(child.id, { status: 'complete' }, child);
  h.api.tabs.onUpdated.fire(child.id, { title: 'New title' }, { ...child, title: 'New title' });
  h.api.idle.onStateChanged.fire('idle'); h.api.idle.onStateChanged.fire('active');
  h.api.tabs.onRemoved.fire(child.id); await h.settle();
  expect(new Set(h.events.map(e => e.type))).toEqual(new Set(Object.keys(contractKeys)));
  expect(new Set(h.events.map(e => e.event_id)).size).toBe(h.events.length);
  for (const event of h.events) {
    expect(Object.keys(event).sort()).toEqual(contractKeys[event.type]);
    expect(event.event_id).toMatch(uuid); expect(event.tab_ref).toMatch(uuid);
    expect(new Date(event.ts).toISOString()).toBe(event.ts);
    expect(JSON.stringify(event)).not.toMatch(/https?:\/\//);
    expect(event).not.toHaveProperty('tabId'); expect(event).not.toHaveProperty('windowId');
    expect(event).not.toHaveProperty('url'); expect(event).not.toHaveProperty('openerTabId');
    if ('dup_key' in event) expect(event.dup_key).toMatch(/^[0-9a-f]{64}$/);
    if (event.type === 'UPDATE' || event.type === 'CLOSE') expect(event.tab_ref).toBe(childRef);
  }
  h.api.tabs.onCreated.fire(child); await h.settle();
  expect(h.events.at(-1).tab_ref).not.toBe(childRef); // Reused Chrome ID is a new tab life.
});

test('window blur and idle overlap do not count inactive time', async () => {
  const a = tab(1, { active: true }); const b = tab(2);
  const h = await setup([a, b]);
  h.advance(1000); h.api.windows.onFocusChanged.fire(-1); await h.settle();
  h.advance(1000); h.api.idle.onStateChanged.fire('idle'); await h.settle();
  expect(h.events.map(e => e.type)).toEqual(['FOCUS']); // Only initial focus; no event while window is blurred.
  h.advance(3000); h.api.windows.onFocusChanged.fire(1); await h.settle();
  h.advance(2000); h.api.idle.onStateChanged.fire('active'); await h.settle();
  h.advance(500); h.api.tabs.onActivated.fire({ tabId: 2, windowId: 1 }); await h.settle();
  expect(h.events.find(e => e.type === 'BLUR').active_ms).toBe(1500);
});

test('install/startup snapshot sorts eligible tabs, caps at 60 and maps openers before emitting', async () => {
  const items = Array.from({ length: 65 }, (_, i) => tab(i + 1));
  items[64].openerTabId = 1;
  items.push(tab(100, { url: 'chrome://settings', lastAccessed: 10000 }));
  items.push(tab(101, { url: undefined, lastAccessed: 10001 }));
  const h = await setup(items);
  h.api.runtime.onInstalled.fire(); await h.settle();
  expect(h.api.tabs.query).toHaveBeenCalledWith({});
  expect(h.events).toHaveLength(60);
  expect(h.events.every(e => e.type === 'OPEN')).toBe(true);
  expect(h.events.map(e => e.title)).toEqual(items.slice(0, 65).reverse().slice(0, 60).map(t => t.title));
  const opens = [...h.events];
  h.api.runtime.onStartup.fire(); await h.settle();
  expect(h.events).toHaveLength(60);
  expect(new Set(h.events.map(e => e.tab_ref)).size).toBe(60);
  expect(new Set(h.events.map(e => e.event_id)).size).toBe(60);
  h.api.tabs.onUpdated.fire(1, { status: 'complete' }, items[0]); await h.settle();
  expect(opens[0].opener_tab_ref).toBe(h.events.at(-1).tab_ref);
});

test('idle/active without a focused tab emits nothing; locked uses IDLE', async () => {
  const h = await setup();
  expect(h.api.idle.setDetectionInterval).toHaveBeenCalledWith(60);
  h.api.idle.onStateChanged.fire('idle'); h.api.idle.onStateChanged.fire('active');
  await h.settle(); expect(h.events).toHaveLength(0);
  h.tabs.set(1, tab(1)); h.api.tabs.onActivated.fire({ tabId: 1, windowId: 1 }); await h.settle();
  h.api.idle.onStateChanged.fire('locked'); await h.settle();
  expect(h.events.at(-1)).toMatchObject({ type: 'IDLE', tab_ref: h.events[0].tab_ref });
});

test('ignores background activation and irrelevant updates; handles a new-tab HTTP navigation', async () => {
  const h = await setup();
  h.tabs.set(1, tab(1, { url: 'chrome://newtab/', active: true }));
  h.api.tabs.onActivated.fire({ tabId: 1, windowId: 1 }); await h.settle();
  expect(h.events).toHaveLength(0);
  const ready = tab(1, { active: true }); h.tabs.set(1, ready);
  h.api.tabs.onUpdated.fire(1, { status: 'loading' }, ready); await h.settle();
  expect(h.events).toHaveLength(0);
  h.api.tabs.onUpdated.fire(1, { status: 'complete' }, ready); await h.settle();
  h.tabs.set(2, tab(2, { windowId: 2 }));
  h.api.tabs.onActivated.fire({ tabId: 2, windowId: 2 }); await h.settle();
  expect(h.events.map(e => e.type)).toEqual(['UPDATE']);
  h.api.idle.onStateChanged.fire('idle'); await h.settle();
  expect(h.events.at(-1).tab_ref).toBe(h.events[0].tab_ref);
});

test('rapid callbacks retain callback timing and BLUR/FOCUS order through async hashing', async () => {
  const h = await setup();
  const a = tab(1), b = tab(2); h.tabs.set(1, a); h.tabs.set(2, b);
  h.api.tabs.onCreated.fire(a); h.api.tabs.onActivated.fire({ tabId: 1, windowId: 1 });
  h.advance(250); h.api.tabs.onCreated.fire(b); h.api.tabs.onActivated.fire({ tabId: 2, windowId: 1 });
  h.advance(10000); await h.settle();
  expect(h.events.map(e => e.type)).toEqual(['OPEN', 'FOCUS', 'OPEN', 'BLUR', 'FOCUS']);
  expect(h.events[3].active_ms).toBe(250);
  expect(h.events[3].ts).toBe(h.events[4].ts);
});

test('emit logs exactly one contract event; toolbar listener still opens grove', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  emit(firstSend[0]); expect(log.mock.calls).toEqual([[{ type: firstSend[0].type, event_id: firstSend[0].event_id }]]);
  const { api } = fakeChrome(); vi.stubGlobal('chrome', api);
  await import('../src/background/index');
  api.action.onClicked.fire();
  expect(api.tabs.create).toHaveBeenCalledWith({ url: 'chrome-extension://test/grove.html' });
});
