import { afterEach, expect, test, vi } from 'vitest';
import { fakeChrome, tab } from './fake-chrome.mjs';
import { QUEUE_KEY } from '../src/background/queue';
import { registerCapture } from '../src/background/capture';

afterEach(() => {
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  for (const key of ['flushNow', 'resendLastBatch', 'sendPreview', 'hollowCount']) delete globalThis[key];
});

test('worker wires durable capture, sanitized logging, globals, timer and toolbar flush', async () => {
  vi.useFakeTimers(); vi.resetModules();
  const fake = fakeChrome();
  vi.stubGlobal('chrome', fake.api);
  const request = vi.fn(async () => { throw new Error('offline'); });
  vi.stubGlobal('fetch', request);
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  await import('../src/background/index');
  const page = tab(1); fake.tabs.set(1, page); fake.api.tabs.onCreated.fire(page);
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  expect(fake.api.storage.local.data[QUEUE_KEY].events.length).toBe(1);
  expect(Object.keys(log.mock.calls[0][0]).sort()).toEqual(['event_id', 'type']);
  expect((await globalThis.sendPreview()).pending_count).toBe(1);
  for (const name of ['flushNow', 'resendLastBatch', 'sendPreview', 'hollowCount']) expect(typeof globalThis[name]).toBe('function');
  const bank = tab(2, { url: 'https://chase.com/' }); fake.tabs.set(2, bank); fake.api.tabs.onCreated.fire(bank);
  // Initial async capture can finish just after the first timer tick origin.
  await vi.advanceTimersByTimeAsync(20000);
  expect(request).toHaveBeenCalledTimes(2);
  expect(fake.api.storage.local.data[QUEUE_KEY].events.length).toBe(1);
  fake.api.action.onClicked.fire();
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));
  expect(fake.api.tabs.create).toHaveBeenCalledWith({ url: 'chrome-extension://test/grove.html' });
});

test('capture waits for durable async output before marking an event emitted', async () => {
  const fake = fakeChrome(); let release;
  const output = vi.fn(() => new Promise(resolve => { release = resolve; }));
  const capture = registerCapture(fake.api, output); await capture.settled();
  fake.api.tabs.onCreated.fire(tab(1));
  await vi.waitFor(() => expect(output).toHaveBeenCalledTimes(1));
  expect(fake.api.storage.session.data.tf_capture_session.openedRefs.length).toBe(0);
  release(); await capture.settled();
  expect(fake.api.storage.session.data.tf_capture_session.openedRefs.length).toBe(1);
});
