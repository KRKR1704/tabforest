import { expect, test } from 'vitest';
import { registerCapture } from '../src/background/capture';
import { SESSION_KEY, URLS_KEY } from '../src/background/state';
import { fakeChrome, fakeStorage, tab } from './fake-chrome.mjs';

function worker(storage, tabs, clock) {
  const fake = fakeChrome(tabs, { id: 1, focused: true }, storage);
  const events = [];
  const capture = registerCapture(fake.api, e => events.push(e), clock);
  return { ...fake, events, settle: capture.settled };
}

test.each([5000, 120000])('restart preserves refs and counts sleep once, capped at 60s: %i', async sleep => {
  const storage = fakeStorage(); let time = 0;
  const tabs = [tab(1, { active: true }), tab(2)];
  const first = worker(storage, tabs, () => time); await first.settle();
  const ref = first.events[0].tab_ref;
  time = 1000;
  first.api.tabs.onUpdated.fire(1, { title: 'Updated' }, { ...tabs[0], title: 'Updated' }); await first.settle();
  time += sleep;
  const second = worker(storage, tabs, () => time); await second.settle();
  expect(second.events.filter(e => e.type === 'OPEN').map(e => e.title)).toEqual(['Page 2']);
  expect(second.events.some(e => e.type === 'FOCUS')).toBe(false);
  expect(new Map(storage.session.data[SESSION_KEY].refs).get(1)).toBe(ref);
  // Another restart at the same instant must not add the sleep twice.
  const third = worker(storage, tabs, () => time); await third.settle();
  expect(third.events).toHaveLength(0);
  time += 500;
  third.api.tabs.onActivated.fire({ tabId: 2, windowId: 1 }); await third.settle();
  expect(third.events[0]).toMatchObject({ type: 'BLUR', tab_ref: ref, active_ms: 1500 + Math.min(sleep, 60000) });
  expect(third.events[1].previous_tab_ref).toBe(ref);
});

test('drops disappeared mappings and keeps full URLs exclusively in local storage', async () => {
  const storage = fakeStorage(); let time = 0;
  const first = worker(storage, [tab(1, { active: true })], () => time); await first.settle();
  const oldRef = first.events[0].tab_ref;
  time = 4000;
  const second = worker(storage, [tab(3, { active: true })], () => time); await second.settle();
  const session = storage.session.data[SESSION_KEY];
  expect(session.refs.map(([id]) => id)).toEqual([3]);
  expect(session.eligible).toEqual([3]);
  expect(session.focus.totals.some(([ref]) => ref === oldRef)).toBe(false);
  expect(second.events.map(e => e.type)).toEqual(['OPEN', 'FOCUS']);
  expect(session.focus.current).toBe(second.events[0].tab_ref);
  expect(second.events[1].previous_tab_ref).toBe(oldRef);
  expect(JSON.stringify(storage.session.data)).not.toContain('https://');
  expect(Object.keys(storage.local.data)).toEqual([URLS_KEY]);
  expect(storage.local.data[URLS_KEY]).toContainEqual([oldRef, 'https://example.com/page-1']);
  expect(storage.local.data[URLS_KEY].every(([ref, url]) => typeof ref === 'string' && typeof url === 'string')).toBe(true);
  expect(session.lastSeenAt).toBe(time);
});

test('fresh browser session creates new refs and startup OPENs while retaining local URLs', async () => {
  const storage = fakeStorage();
  const first = worker(storage, [tab(1, { active: true })], () => 0); await first.settle();
  const oldRef = first.events[0].tab_ref;
  storage.session = fakeStorage().session;
  const second = worker(storage, [tab(1, { active: true })], () => 5000); await second.settle();
  second.api.runtime.onStartup.fire(); await second.settle();
  expect(second.events.map(e => e.type)).toEqual(['FOCUS', 'OPEN']);
  expect(second.events[1].tab_ref).not.toBe(oldRef);
  expect(storage.local.data[URLS_KEY].map(([ref]) => ref)).toContain(oldRef);
});

test('listeners register before storage loads and rapid callbacks serialize saves', async () => {
  const storage = fakeStorage(); let release;
  storage.session.get.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({}); }));
  let writing = false;
  const original = storage.session.set.getMockImplementation();
  storage.session.set.mockImplementation(async items => {
    expect(writing).toBe(false); writing = true;
    await Promise.resolve(); await original(items); writing = false;
  });
  const h = worker(storage, [], () => 1000);
  h.api.tabs.onCreated.fire(tab(10));
  h.api.tabs.onCreated.fire(tab(11, { openerTabId: 10 }));
  await Promise.resolve(); release(); await h.settle();
  expect(h.events.map(e => e.type)).toEqual(['OPEN', 'OPEN']);
  expect(h.events[1].opener_tab_ref).toBe(h.events[0].tab_ref);
  expect(storage.session.data[SESSION_KEY].refs).toHaveLength(2);
  expect(storage.session.set).toHaveBeenCalledTimes(3);
});

test('idle interval is not counted across restart', async () => {
  const storage = fakeStorage(); let time = 0;
  const tabs = [tab(1, { active: true }), tab(2)];
  const first = worker(storage, tabs, () => time); await first.settle();
  time = 2000; first.api.idle.onStateChanged.fire('idle'); await first.settle();
  time = 120000;
  const second = worker(storage, tabs, () => time); await second.settle();
  second.api.tabs.onActivated.fire({ tabId: 2, windowId: 1 }); await second.settle();
  expect(second.events.find(e => e.type === 'BLUR').active_ms).toBe(2000);
});

test('activation waking the worker blurs the persisted tab before focusing the new active tab', async () => {
  const storage = fakeStorage(); let time = 0;
  const first = worker(storage, [tab(1, { active: true }), tab(2)], () => time); await first.settle();
  const oldRef = first.events[0].tab_ref;
  time = 40000;
  const next = worker(storage, [tab(1), tab(2, { active: true })], () => time);
  next.api.tabs.onActivated.fire({ tabId: 2, windowId: 1 });
  await next.settle();
  expect(next.events.map(e => e.type)).toEqual(['OPEN', 'BLUR', 'FOCUS']);
  expect(next.events[1]).toMatchObject({ tab_ref: oldRef, active_ms: 40000 });
  expect(next.events[2].previous_tab_ref).toBe(oldRef);
});

test('onCreated waking a sleeping worker emits one OPEN and UPDATE remains unaffected', async () => {
  const storage = fakeStorage();
  const first = worker(storage, [], () => 0); await first.settle();
  const created = tab(9);
  const next = worker(storage, [created], () => 40000);
  next.api.tabs.onCreated.fire(created); await next.settle();
  expect(next.events.filter(e => e.type === 'OPEN')).toHaveLength(1);
  const ref = next.events[0].tab_ref;
  expect(storage.session.data[SESSION_KEY].openedRefs).toEqual([ref]);
  next.api.tabs.onUpdated.fire(9, { title: 'Changed' }, { ...created, title: 'Changed' });
  await next.settle();
  expect(next.events.at(-1)).toMatchObject({ type: 'UPDATE', tab_ref: ref, title: 'Changed' });
});

test('persisted OPEN refs suppress onCreated and snapshots after restart', async () => {
  const storage = fakeStorage();
  const first = worker(storage, [], () => 0); await first.settle();
  const created = tab(9);
  first.api.tabs.onCreated.fire(created); await first.settle();
  const next = worker(storage, [created], () => 1000);
  next.api.runtime.onInstalled.fire();
  next.api.runtime.onStartup.fire();
  next.api.tabs.onCreated.fire(created); await next.settle();
  expect(next.events).toHaveLength(0);
  expect(storage.session.data[SESSION_KEY].openedRefs).toEqual([first.events[0].tab_ref]);
});

test.each(['removed', 'disappeared'])('drops OPEN refs for a tab that is %s', async reason => {
  const storage = fakeStorage();
  const first = worker(storage, [], () => 0); await first.settle();
  first.api.tabs.onCreated.fire(tab(9)); await first.settle();
  const oldRef = first.events[0].tab_ref;
  let current = first;
  if (reason === 'removed') {
    first.api.tabs.onRemoved.fire(9); await first.settle();
  } else {
    current = worker(storage, [], () => 1000); await current.settle();
  }
  expect(storage.session.data[SESSION_KEY].openedRefs).not.toContain(oldRef);
  current.api.tabs.onCreated.fire(tab(9)); await current.settle();
  expect(current.events.at(-1).type).toBe('OPEN');
  expect(current.events.at(-1).tab_ref).not.toBe(oldRef);
});
