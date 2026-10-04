import { afterEach, expect, test, vi } from 'vitest';
import { fakeChrome, tab } from './fake-chrome.mjs';
import { EventQueue } from '../src/background/queue';
import { EventSync } from '../src/background/sync';
afterEach(() => {
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  for (const key of ['flushNow', 'resendLastBatch', 'sendPreview', 'hollowCount']) delete globalThis[key];
});

test('worker registers bridge synchronously before storage resolves and keeps global helpers', async () => {
  vi.useFakeTimers(); vi.resetModules();
  const fake = fakeChrome(); let listener, release;
  fake.api.runtime.onMessage.addListener = fn => { listener = fn; };
  fake.api.storage.session.get.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({}); }));
  for (const area of [fake.api.storage.local, fake.api.storage.session]) {
    area.clear = vi.fn(async () => { for (const key of Object.keys(area.data)) delete area.data[key]; });
  }
  vi.stubGlobal('chrome', fake.api);
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  await import('../src/background/index');
  expect(typeof listener).toBe('function');
  const message = type => new Promise(resolve => expect(listener({ type }, { id: 'test' }, resolve)).toBe(true));
  expect(await message('GET_TOKEN')).toEqual({ ok: true, data: { token: null } });
  release();
  const page = tab(1); fake.tabs.set(1, page); fake.api.tabs.onCreated.fire(page);
  await vi.waitFor(() => expect(fake.api.storage.local.data.tf_event_queue?.events.length).toBe(1));
  expect((await message('GET_SNAPSHOT')).data.open_tabs).toHaveLength(1);
  expect(await message('WIPE_LOCAL')).toEqual({ ok: true, data: null });
  expect(fake.api.storage.local.data).toEqual({}); expect(fake.api.storage.session.data).toEqual({});
  for (const key of ['flushNow', 'resendLastBatch', 'sendPreview', 'hollowCount']) expect(typeof globalThis[key]).toBe('function');
});

test('wipe pauses manual/automatic sends and drains aborted request before clearing storage', async () => {
  const local = fakeChrome().api.storage.local;
  const queue = new EventQueue(local);
  await queue.enqueue({ type: 'CLOSE', event_id: 'synthetic', tab_ref: 'synthetic', ts: new Date(0).toISOString() });
  let started;
  const request = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
    started = true;
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  const sync = new EventSync(queue, local, { fetch: request });
  const sending = sync.flushNow(); await vi.waitFor(() => expect(started).toBe(true));
  let clear;
  const resetting = sync.reset(() => new Promise(resolve => { clear = () => {
    for (const key of Object.keys(local.data)) delete local.data[key]; resolve();
  }; }));
  await vi.waitFor(() => expect(typeof clear).toBe('function'));
  await sync.flushNow(); await sync.onEvent(); await sync.resendLastBatch();
  expect(request).toHaveBeenCalledTimes(1);
  clear(); await resetting; await sending;
  expect(local.data).toEqual({});
});
