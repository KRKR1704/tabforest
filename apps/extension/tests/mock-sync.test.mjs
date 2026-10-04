import { afterEach, beforeEach, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createMockServer } from '../mock-api/server.mjs';
import { EventQueue } from '../src/background/queue';
import { EventSync } from '../src/background/sync';
import { fakeStorage } from './fake-chrome.mjs';
const fixture = JSON.parse(readFileSync(new URL('../../../contracts/events.example.json', import.meta.url), 'utf8'));
let server, base;
beforeEach(async () => {
  server = createMockServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});
const post = body => fetch(`${base}/api/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test.each(['empty', 'oversized', 'root field', 'event field', 'unknown type'])('mock rejects %s atomically', async kind => {
  const one = fixture.batch_request.events[0];
  const body = kind === 'empty' ? { events: [] }
    : kind === 'oversized' ? { events: Array(501).fill(one) }
    : kind === 'root field' ? { events: [one], unexpected: true }
    : kind === 'event field' ? { events: [one, { ...one, unexpected: true }] }
    : { events: [one, { ...one, type: 'UNKNOWN' }] };
  expect((await post(body)).status).toBe(422);
  expect(server.storedEventCount).toBe(0);
});

test('real sender then persisted resend returns duplicates without new mock rows', async () => {
  const storage = fakeStorage().local;
  const queue = new EventQueue(storage);
  for (const event of fixture.batch_request.events) await queue.enqueue(event);
  const sync = new EventSync(queue, storage, { apiBase: base });
  const size = fixture.batch_request.events.length;
  expect(await sync.flushNow()).toEqual({ accepted: size, duplicates: 0 });
  expect(server.storedEventCount).toBe(size);
  const restarted = new EventSync(new EventQueue(storage), storage, { apiBase: base });
  expect(await restarted.resendLastBatch()).toEqual({ accepted: 0, duplicates: size });
  expect(server.storedEventCount).toBe(size);
  expect((await queue.snapshot()).events.length).toBe(0);
});
