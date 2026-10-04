import { afterEach, expect, test, vi } from 'vitest';
import { EventQueue, QUEUE_KEY } from '../src/background/queue';
import { EventSync, SYNC_KEY } from '../src/background/sync';
import { fakeStorage } from './fake-chrome.mjs';

const event = n => ({ type: 'CLOSE', event_id: `synthetic-${n}`, tab_ref: 'synthetic-tab', ts: '2026-10-03T00:00:00.000Z' });
const reply = (accepted, duplicates = 0) => new Response(JSON.stringify({ accepted, duplicates }), { status: 202 });
function setup(count = 1, options = {}) {
  const storage = fakeStorage().local;
  storage.data[QUEUE_KEY] = { events: Array.from({ length: count }, (_, n) => event(n)), dropped_events: 0 };
  let time = 0;
  const request = vi.fn(async (_url, init) => reply(JSON.parse(init.body).events.length));
  const queue = new EventQueue(storage);
  const sync = new EventSync(queue, storage, { fetch: request, now: () => time, ...options });
  return { storage, queue, sync, request, advance: n => { time += n; } };
}
afterEach(() => vi.useRealTimers());

test('sender takes 500 oldest, commits receipt and replaces last batch on next success', async () => {
  const h = setup(501);
  await h.sync.flushNow();
  expect(JSON.parse(h.request.mock.calls[0][1].body).events.length).toBe(500);
  expect((await h.queue.snapshot()).events.length).toBe(1);
  expect(h.storage.data.last_sent_batch.length).toBe(500);
  await h.sync.flushNow();
  expect(h.storage.data.last_sent_batch.length).toBe(1);
  expect((await h.queue.snapshot()).events.length).toBe(0);
});

test('in-flight request never blocks enqueue, concurrent triggers do not send, ack removes by IDs after overflow', async () => {
  const h = setup(5000); let release;
  h.request.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const sending = h.sync.flushNow();
  await vi.waitFor(() => expect(h.request).toHaveBeenCalledTimes(1));
  await h.queue.enqueue(event(5000));
  await h.sync.flushNow(); await h.sync.resendLastBatch();
  expect(h.request).toHaveBeenCalledTimes(1);
  release(reply(500)); await sending;
  const remaining = (await h.queue.snapshot()).events;
  expect(remaining.length).toBe(4501);
  expect(remaining[0].event_id === event(500).event_id).toBe(true);
  expect(remaining.at(-1).event_id === event(5000).event_id).toBe(true);
});

test.each(['network', 500, 503])('failure %s retains queue order/identity and retry sends identical bytes', async failure => {
  const h = setup(3);
  const before = JSON.stringify(await h.queue.snapshot());
  if (failure === 'network') h.request.mockRejectedValueOnce(new Error('offline'));
  else h.request.mockResolvedValueOnce(new Response(null, { status: failure }));
  await h.sync.onEvent();
  expect(JSON.stringify(await h.queue.snapshot()) === before).toBe(true);
  await h.sync.onEvent(); expect(h.request).toHaveBeenCalledTimes(1);
  h.advance(10000); await h.sync.onEvent();
  expect(h.request.mock.calls[0][1].body === h.request.mock.calls[1][1].body).toBe(true);
});

test.each([429, 503])('Retry-After %s survives restart and prevents early request', async status => {
  const h = setup();
  h.request.mockResolvedValueOnce(new Response(null, { status, headers: { 'Retry-After': '30' } }));
  await h.sync.onEvent();
  let time = 29999;
  const next = new EventSync(new EventQueue(h.storage), h.storage, { fetch: h.request, now: () => time });
  await next.onEvent(); expect(h.request).toHaveBeenCalledTimes(1);
  time = 30000; await next.onEvent(); expect(h.request).toHaveBeenCalledTimes(2);
});

test('Retry-After HTTP date is respected', async () => {
  const h = setup();
  h.request.mockResolvedValueOnce(new Response(null, { status: 503, headers: { 'Retry-After': new Date(60000).toUTCString() } }));
  await h.sync.onEvent(); h.advance(59999); await h.sync.onEvent();
  expect(h.request).toHaveBeenCalledTimes(1);
  h.advance(1); await h.sync.onEvent(); expect(h.request).toHaveBeenCalledTimes(2);
});

test('401 retains queue and stops across restart until token exists', async () => {
  let token = null;
  const h = setup(2, { token: async () => token });
  h.request.mockResolvedValueOnce(new Response(null, { status: 401 }));
  await h.sync.onEvent(); h.advance(60000); await h.sync.onEvent();
  const next = new EventSync(h.queue, h.storage, { fetch: h.request, token: async () => token });
  await next.onEvent(); expect(h.request).toHaveBeenCalledTimes(1);
  expect((await h.queue.snapshot()).events.length).toBe(2);
  token = 'test-token'; await next.onEvent();
  expect(h.request.mock.calls[1][1].headers.Authorization === 'Bearer test-token').toBe(true);
});

test('422 stores only rejected count/IDs and allows following batch to continue', async () => {
  const h = setup(501);
  h.request.mockResolvedValueOnce(new Response(null, { status: 422 }));
  await h.sync.flushNow();
  expect((await h.queue.snapshot()).events.length).toBe(1);
  const rejected = h.storage.data.rejected_events;
  expect(Object.keys(rejected).sort()).toEqual(['count', 'event_ids']);
  expect(rejected.count).toBe(500); expect(rejected.event_ids.length).toBe(500);
  await h.sync.flushNow(); expect((await h.queue.snapshot()).events.length).toBe(0);
});

test.each([200, 202])('2xx %s with invalid accounting never removes events', async status => {
  const h = setup(2);
  h.request.mockResolvedValueOnce(new Response(JSON.stringify({ accepted: 1, duplicates: 0 }), { status }));
  await h.sync.flushNow();
  expect((await h.queue.snapshot()).events.length).toBe(2);
  expect(h.storage.data.last_sent_batch).toBeUndefined();
});

test('empty queue and absent resend batch do not request; dev header is opt-in', async () => {
  const h = setup(0);
  await h.sync.flushNow(); await h.sync.resendLastBatch(); expect(h.request).not.toHaveBeenCalled();
  await h.queue.enqueue(event(1)); await h.sync.flushNow();
  expect(Object.keys(h.request.mock.calls[0][1].headers)).toEqual(['Content-Type']);
  h.storage.data.dev_user_id = '00000000-0000-4000-8000-000000000001';
  await h.queue.enqueue(event(2)); await h.sync.flushNow();
  expect(h.request.mock.calls[1][1].headers['X-Dev-User'] === h.storage.data.dev_user_id).toBe(true);
});

test('timer flushes each 10s and event trigger observes interval', async () => {
  vi.useFakeTimers();
  const h = setup(1, { now: () => Date.now() });
  h.sync.start(); h.sync.start();
  await vi.advanceTimersByTimeAsync(9999); expect(h.request).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(h.request).toHaveBeenCalledTimes(1);
  await h.queue.enqueue(event(2)); await h.sync.onEvent(); expect(h.request).toHaveBeenCalledTimes(1);
  h.sync.stop(); await vi.advanceTimersByTimeAsync(10000);
  await h.sync.onEvent(); expect(h.request).toHaveBeenCalledTimes(2);
});

test('restart during in-flight send retains unsent batch and identical retry', async () => {
  const h = setup(2); let release;
  h.request.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = h.sync.flushNow(); await vi.waitFor(() => expect(h.request).toHaveBeenCalledTimes(1));
  const nextQueue = new EventQueue(h.storage);
  expect((await nextQueue.snapshot()).events.length).toBe(2);
  // Old worker disappears before receipt; persisted queue remains authoritative.
  release(new Response(null, { status: 503 })); await pending;
  const next = new EventSync(nextQueue, h.storage, { fetch: h.request, now: () => 10000 });
  await next.flushNow();
  expect(h.request.mock.calls[0][1].body === h.request.mock.calls[1][1].body).toBe(true);
});

test('resend uses persisted successful batch unchanged, returns receipt and never changes queue', async () => {
  const h = setup(2); await h.sync.flushNow();
  await h.queue.enqueue(event(3));
  const before = JSON.stringify(await h.queue.snapshot());
  const next = new EventSync(h.queue, h.storage, { fetch: h.request });
  h.request.mockResolvedValueOnce(reply(0, 2));
  expect(await next.resendLastBatch()).toEqual({ accepted: 0, duplicates: 2 });
  expect(h.request.mock.calls[0][1].body === h.request.mock.calls[1][1].body).toBe(true);
  expect(JSON.stringify(await h.queue.snapshot()) === before).toBe(true);
});

test('preview shape limits samples to five and excludes titles and tab refs', async () => {
  const h = setup(6);
  h.storage.data[QUEUE_KEY].events[0] = { ...event(0), type: 'UPDATE', domain: 'example.test', title: 'private', dup_key: 'synthetic', search_query: null };
  const preview = await h.sync.sendPreview();
  expect(preview.pending_count).toBe(6); expect(preview.sample_events.length).toBe(5);
  expect(Object.keys(preview.sample_events[0]).sort()).toEqual(['domain', 'event_id', 'event_type', 'ts']);
  expect(Object.keys(preview.sample_events[1]).sort()).toEqual(['event_id', 'event_type', 'ts']);
});

test('401 auto path recovers with dev user after backoff and clears unauthorized', async () => {
  const h = setup();
  h.request.mockResolvedValueOnce(new Response(null, { status: 401 }));
  await h.sync.onEvent(); h.advance(10000); await h.sync.onEvent();
  expect(h.request).toHaveBeenCalledTimes(1);
  h.storage.data.dev_user_id = 'synthetic-dev-user';
  await h.sync.onEvent(); expect(h.request).toHaveBeenCalledTimes(2);
  expect((await h.queue.snapshot()).events.length).toBe(0);
  expect(h.storage.data[SYNC_KEY].unauthorized).toBe(false);
});

test.each(['flushNow', 'resendLastBatch'])('manual %s bypasses retry and unauthorized but remains single flight', async method => {
  const h = setup(); await h.sync.flushNow(); await h.queue.enqueue(event(9));
  h.request.mockResolvedValueOnce(new Response(null, { status: 401 }));
  await h.sync.flushNow();
  expect(h.storage.data[SYNC_KEY].unauthorized).toBe(true);
  expect(h.storage.data[SYNC_KEY].nextAttempt).toBe(10000);
  let release;
  h.request.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = h.sync[method]();
  await vi.waitFor(() => expect(h.request).toHaveBeenCalledTimes(3));
  await h.sync.flushNow(); await h.sync.resendLastBatch(); await h.sync.onEvent();
  expect(h.request).toHaveBeenCalledTimes(3);
  release(reply(1)); await pending;
  expect(h.storage.data[SYNC_KEY].unauthorized).toBe(false);
});

test('automatic 401 backoff doubles to 300 seconds even with dev credentials', async () => {
  const h = setup(); h.storage.data.dev_user_id = 'synthetic-dev-user';
  h.request.mockImplementation(async () => new Response(null, { status: 401 }));
  let elapsed = 0;
  for (const delay of [10000, 20000, 40000, 80000, 160000, 300000, 300000]) {
    await h.sync.onEvent();
    expect(h.storage.data[SYNC_KEY].nextAttempt - elapsed).toBe(delay);
    h.advance(delay - 1); await h.sync.onEvent();
    expect(h.storage.data[SYNC_KEY].nextAttempt).toBe(elapsed + delay);
    h.advance(1); elapsed += delay;
  }
  expect(h.request).toHaveBeenCalledTimes(7);
});

test('timer respects unauthorized and retry state', async () => {
  vi.useFakeTimers();
  const h = setup(1, { now: () => Date.now() });
  h.request.mockResolvedValueOnce(new Response(null, { status: 401 }));
  h.sync.start(); await vi.advanceTimersByTimeAsync(60000);
  expect(h.request).toHaveBeenCalledTimes(1);
  h.storage.data.dev_user_id = 'synthetic-dev-user';
  await vi.advanceTimersByTimeAsync(10000);
  expect(h.request).toHaveBeenCalledTimes(2); h.sync.stop();
});
