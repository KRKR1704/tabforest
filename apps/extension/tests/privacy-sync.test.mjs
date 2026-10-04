import { expect, test, vi } from 'vitest';
import { PENDING_KEY, RESUMED_FOREVER, createPrivacySync, pausedToIso } from '../src/background/privacy-sync';
import { registerBridge } from '../src/background/bridge';
import { fakeChrome, fakeStorage } from './fake-chrome.mjs';

const ok = body => ({ ok: true, status: 200, json: async () => body });
const status = code => ({ ok: code < 300, status: code, json: async () => ({}) });
function setup({ token = 'tok', fetchFn } = {}) {
  const storage = fakeStorage();
  const calls = [];
  const fetchStub = fetchFn ?? vi.fn(async () => ok({ excluded_domains: [], paused_until: null }));
  const wrapped = vi.fn(async (url, init) => { calls.push({ url, ...init, body: init.body ? JSON.parse(init.body) : undefined }); return fetchStub(url, init); });
  let currentToken = token;
  const sync = createPrivacySync({ storage, token: async () => currentToken, apiBase: 'https://api.test/', fetchFn: wrapped, now: () => Date.parse('2026-10-04T12:00:00Z') });
  return { sync, storage, calls, fetchStub, local: storage.local.data, setToken: t => { currentToken = t; } };
}
const settle = () => new Promise(r => setTimeout(r, 10));

test('pausedToIso maps every pause value the bridge accepts', () => {
  expect(pausedToIso(null)).toBeNull();
  expect(pausedToIso('until resumed')).toBe(RESUMED_FOREVER);
  expect(pausedToIso(Date.parse('2026-10-04T12:51:00Z'))).toBe('2026-10-04T12:51:00.000Z');
  expect(pausedToIso('2026-10-04T12:51:00Z')).toBe('2026-10-04T12:51:00.000Z');
  expect(pausedToIso('nonsense')).toBeUndefined();
});

test('a new exclusion and a pause are sent to PATCH /api/privacy with the bearer token and then forgotten', async () => {
  const t = setup();
  await t.sync.record({ addDomain: 'mybank.com' });
  await t.sync.record({ paused: 'until resumed' });
  await settle();
  const patches = t.calls.filter(c => c.method === 'PATCH');
  expect(patches[0].url).toBe('https://api.test/api/privacy');
  expect(patches[0].headers.Authorization).toBe('Bearer tok');
  expect(patches[0].body).toEqual({ excluded_domains_add: ['mybank.com'] });
  expect(patches.at(-1).body.paused_until).toBe(RESUMED_FOREVER);
  expect(t.local[PENDING_KEY]).toBeUndefined();
});

test('resuming sends paused_until null', async () => {
  const t = setup();
  await t.sync.record({ paused: null });
  await settle();
  expect(t.calls.find(c => c.method === 'PATCH').body).toEqual({ paused_until: null });
});

test('without a token the change is kept, and goes out after sign-in', async () => {
  const t = setup({ token: null });
  await t.sync.record({ addDomain: 'a.com' });
  await settle();
  expect(t.calls).toHaveLength(0);
  expect(t.local[PENDING_KEY]).toEqual({ add: ['a.com'] });
  t.setToken('tok');
  await t.sync.onSignedIn();
  expect(t.calls.find(c => c.method === 'PATCH').body).toEqual({ excluded_domains_add: ['a.com'] });
  expect(t.local[PENDING_KEY]).toBeUndefined();
});

test.each([[404], [500], [401], [429]])('a %i answer keeps the change waiting', async code => {
  const t = setup({ fetchFn: vi.fn(async () => status(code)) });
  await t.sync.record({ addDomain: 'a.com' });
  await settle();
  expect(t.local[PENDING_KEY]).toEqual({ add: ['a.com'] });
});

test('a network failure keeps the change waiting, and the timer retries it', async () => {
  let down = true;
  const t = setup({ fetchFn: vi.fn(async () => { if (down) throw new TypeError('offline'); return ok({ excluded_domains: [] }); }) });
  await t.sync.record({ addDomain: 'a.com' });
  await settle();
  expect(t.local[PENDING_KEY]).toEqual({ add: ['a.com'] });
  down = false;
  await t.sync.tick();
  expect(t.local[PENDING_KEY]).toBeUndefined();
});

test('a 422 drops the request instead of retrying forever, and keeps the local setting', async () => {
  const t = setup({ fetchFn: vi.fn(async () => status(422)) });
  t.local.user_excluded_domains = ['a.com'];
  await t.sync.record({ addDomain: 'a.com' });
  await settle();
  expect(t.local[PENDING_KEY]).toBeUndefined();
  expect(t.local.user_excluded_domains).toEqual(['a.com']);
});

test('a change made while a request is in flight is not lost', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const t = setup({ fetchFn: vi.fn(async () => { await gate; return ok({}); }) });
  await t.sync.record({ addDomain: 'a.com' });
  await settle();
  await t.sync.record({ addDomain: 'b.com' });
  release();
  await settle(); await settle();
  expect(t.local[PENDING_KEY]).toBeUndefined();
  expect(t.calls.filter(c => c.method === 'PATCH').flatMap(c => c.body.excluded_domains_add)).toEqual(expect.arrayContaining(['a.com', 'b.com']));
});

test('after sign-in the server exclusions are added to the local ones, never removed', async () => {
  const t = setup({ fetchFn: vi.fn(async () => ok({ excluded_domains: ['bank.test', 'x.test'], paused_until: null })) });
  t.local.user_excluded_domains = ['mine.test', 'x.test'];
  await t.sync.onSignedIn();
  expect(t.local.user_excluded_domains).toEqual(['mine.test', 'x.test', 'bank.test']);
});

test('a bad domain from the server is ignored', async () => {
  const t = setup({ fetchFn: vi.fn(async () => ok({ excluded_domains: ['ok.test', 'http://evil/', 5, 'a b'] })) });
  await t.sync.pull();
  expect(t.local.user_excluded_domains).toEqual(['ok.test']);
});

test('a pause set elsewhere applies here only when this device has no pause of its own', async () => {
  const future = '2026-10-04T13:00:00Z';
  const t = setup({ fetchFn: vi.fn(async () => ok({ excluded_domains: [], paused_until: future })) });
  await t.sync.pull();
  expect(t.local.paused_until).toBe(future);
  const forever = setup({ fetchFn: vi.fn(async () => ok({ paused_until: RESUMED_FOREVER })) });
  await forever.sync.pull();
  expect(forever.local.paused_until).toBe('until resumed');
  const own = setup({ fetchFn: vi.fn(async () => ok({ paused_until: future })) });
  own.local.paused_until = 'until resumed';
  await own.sync.pull();
  expect(own.local.paused_until).toBe('until resumed');
  const past = setup({ fetchFn: vi.fn(async () => ok({ paused_until: '2026-10-04T11:00:00Z' })) });
  await past.sync.pull();
  expect(past.local.paused_until).toBeUndefined();
});

test('the server settings are read once per sign-in, again after a sign-out', async () => {
  const t = setup();
  await t.sync.tick(); await t.sync.tick();
  expect(t.calls.filter(c => c.method === 'GET')).toHaveLength(1);
  t.sync.onSignedOut();
  await t.sync.tick();
  expect(t.calls.filter(c => c.method === 'GET')).toHaveLength(2);
});

test('the bridge records PAUSE and EXCLUDE_DOMAIN with the privacy sync and answers without waiting for the network', async () => {
  const fake = fakeChrome();
  fake.api.runtime.id = 'self';
  let listener;
  fake.api.runtime.onMessage = { addListener: fn => { listener = fn; } };
  const record = vi.fn(async () => {});
  registerBridge(fake.api, { settled: async () => {}, sendPreview: async () => ({}), privacy: { record, onSignedIn: vi.fn() } });
  const send = m => new Promise(resolve => listener(m, { id: 'self' }, resolve));
  expect(await send({ type: 'EXCLUDE_DOMAIN', domain: 'MyBank.com' })).toEqual({ ok: true, data: null });
  expect(record).toHaveBeenLastCalledWith({ addDomain: 'mybank.com' });
  expect(await send({ type: 'PAUSE', until: 'until resumed' })).toEqual({ ok: true, data: null });
  expect(record).toHaveBeenLastCalledWith({ paused: 'until resumed' });
  expect(await send({ type: 'PAUSE', until: 'bad' })).toEqual({ ok: false, error: 'invalid_payload' });
  expect(await send({ type: 'EXCLUDE_DOMAIN', domain: 'bad/path' })).toEqual({ ok: false, error: 'invalid_payload' });
  expect(record).toHaveBeenCalledTimes(2);
});
