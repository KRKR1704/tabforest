import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createMockServer, defaultOrigin } from '../mock-api/server.mjs';

const fixture = JSON.parse(readFileSync(new URL('../../../contracts/events.example.json', import.meta.url), 'utf8'));
let server;
let base;
beforeEach(async () => {
  server = createMockServer(defaultOrigin);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => {
  if (!server.listening) return;
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});
const post = body => fetch(`${base}/api/events`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('health returns 200', async () => {
  const response = await fetch(`${base}/health`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
});
test('accepts the contract batch and counts a duplicate resend', async () => {
  const response = await post(fixture.batch_request);
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual(fixture.batch_response);
  const resend = await post(fixture.batch_request);
  expect(resend.status).toBe(202);
  expect(await resend.json()).toEqual({ accepted: 0, duplicates: fixture.batch_request.events.length });
});
test('counts duplicates within a batch', async () => {
  const event = fixture.batch_request.events[0];
  expect(await (await post({ events: [event, event] })).json()).toEqual({ accepted: 1, duplicates: 1 });
});
test('accepts 500 and rejects 501 events without recording the rejected batch', async () => {
  const events = Array.from({ length: 501 }, (_, i) => ({ ...fixture.batch_request.events[0], event_id: `test-${i}` }));
  expect((await post({ events })).status).toBe(422);
  const response = await post({ events: events.slice(0, 500) });
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ accepted: 500, duplicates: 0 });
});
test('rejects user_id at the root or inside an event', async () => {
  expect((await post({ ...fixture.batch_request, user_id: 'forbidden' })).status).toBe(422);
  expect((await post({ events: [{ ...fixture.batch_request.events[0], user_id: 'forbidden' }] })).status).toBe(422);
});
test('rejects malformed batches', async () => {
  for (const body of [null, {}, { events: [null] }, { events: [{}] }]) expect((await post(body)).status).toBe(422);
});
test('CORS permits only the configured origin, including preflight', async () => {
  const allowed = await fetch(`${base}/health`, { headers: { Origin: defaultOrigin } });
  expect(allowed.headers.get('access-control-allow-origin')).toBe(defaultOrigin);
  const denied = await fetch(`${base}/health`, { headers: { Origin: 'https://other.invalid' } });
  expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  const preflight = await fetch(`${base}/api/events`, { method: 'OPTIONS', headers: { Origin: defaultOrigin } });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get('access-control-allow-origin')).toBe(defaultOrigin);
  expect((await fetch(`${base}/api/events`, { method: 'OPTIONS', headers: { Origin: 'https://other.invalid' } })).status).toBe(403);
});
