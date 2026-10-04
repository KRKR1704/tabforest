import { expect, test } from 'vitest';
import { EventQueue, QUEUE_CAP, QUEUE_KEY } from '../src/background/queue';
import { fakeStorage } from './fake-chrome.mjs';

const event = n => ({ type: 'CLOSE', event_id: `test-${n}`, tab_ref: 'synthetic-tab', ts: '2026-10-03T00:00:00.000Z' });

test('queue persists each enqueue and reloads unchanged across restart', async () => {
  const storage = fakeStorage().local;
  const queue = new EventQueue(storage);
  const original = [event(1), event(2)];
  for (const item of original) await queue.enqueue(item);
  expect(storage.set).toHaveBeenCalledTimes(2);
  expect(storage.data[QUEUE_KEY].events).toEqual(original);
  expect(await new EventQueue(storage).snapshot()).toEqual({ events: original, dropped_events: 0 });
});

test('queue serializes rapid writes without losing events or order', async () => {
  const storage = fakeStorage().local;
  const queue = new EventQueue(storage);
  const originals = Array.from({ length: 50 }, (_, n) => event(n));
  await Promise.all(originals.map(item => queue.enqueue(item)));
  expect((await queue.snapshot()).events).toEqual(originals);
  expect(storage.set).toHaveBeenCalledTimes(50);
});

test('queue drops oldest at 5000 and persists cumulative drop count', async () => {
  const storage = fakeStorage().local;
  const originals = Array.from({ length: QUEUE_CAP }, (_, n) => event(n));
  storage.data[QUEUE_KEY] = { events: originals, dropped_events: 3 };
  const queue = new EventQueue(storage);
  await Promise.all([queue.enqueue(event(5000)), queue.enqueue(event(5001))]);
  const state = await new EventQueue(storage).snapshot();
  expect(state.events).toEqual([...originals.slice(2), event(5000), event(5001)]);
  expect(state.events).toHaveLength(5000);
  expect(state.dropped_events).toBe(5);
});

test('queue copies arrivals and snapshots without modifying original identity or timestamp', async () => {
  const storage = fakeStorage().local;
  const queue = new EventQueue(storage);
  const input = event(1); const original = structuredClone(input);
  const writing = queue.enqueue(input); input.event_id = 'caller-mutated'; await writing;
  const snapshot = await queue.snapshot(); snapshot.events[0].ts = 'caller-mutated';
  expect((await queue.snapshot()).events).toEqual([original]);
});

test('failed persistence rejects without losing saved events or blocking later operations', async () => {
  const storage = fakeStorage().local;
  const queue = new EventQueue(storage);
  await queue.enqueue(event(1));
  storage.set.mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(queue.enqueue(event(2))).rejects.toThrow('storage unavailable');
  expect((await queue.snapshot()).events).toEqual([event(1)]);
  await queue.enqueue(event(2));
  expect((await queue.snapshot()).events).toEqual([event(1), event(2)]);
});
