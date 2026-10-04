import { expect, test, vi } from 'vitest';
import { registerBridge } from '../src/background/bridge';
import { AuthStore, AUTH_KEY } from '../src/background/auth';
import { createAuthService } from '../src/background/signin';
import { fakeChrome } from './fake-chrome.mjs';

const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
const jwt = claims => `${b64({ alg: 'HS256' })}.${b64(claims)}.sig`;
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const GROVE = { id: 'test', url: 'chrome-extension://test/grove.html' };
const POPUP = { id: 'test', url: 'chrome-extension://test/signin.html' };

function setup({ login, withIdentity = true, withAuth = true } = {}) {
  const fake = fakeChrome();
  if (!withIdentity) delete fake.api.identity;
  let now = 1_000_000;
  const fetchFn = vi.fn(login ?? (async (url, init) => {
    const body = JSON.parse(init.body);
    return body.password === 'right'
      ? json(200, { access_token: jwt({ sub: 'user-1', email: body.email }), token_type: 'Bearer', expires_in: 3600 })
      : json(401, { title: 'Email or password is incorrect' });
  }));
  const store = new AuthStore(fake.api.storage.session, () => now);
  const auth = createAuthService({ api: fake.api, store, fetchFn, apiBase: 'https://api.example', now: () => now });
  const signOut = vi.fn(async () => { await auth.signOut(); });
  registerBridge(fake.api, { settled: async () => {}, sendPreview: async () => ({ pending_count: 0, sample_events: [] }), ...(withAuth ? { auth, signOut } : {}) });
  const send = (message, sender = GROVE) => new Promise(resolve => fake.api.runtime.onMessage.fire(message, sender, resolve));
  return { fake, send, fetchFn, auth, signOut, advance: ms => { now += ms; } };
}

test('signed out: the auth state is signed_out and there is no token', async () => {
  const { send } = setup();
  expect(await send({ type: 'GET_AUTH_STATE' })).toEqual({ ok: true, data: { signed_in: false } });
  expect(await send({ type: 'GET_TOKEN' })).toEqual({ ok: true, data: { token: null } });
});

test('SIGN_IN opens the popup, the popup signs in, and the token ends up in session storage only', async () => {
  const { fake, send, fetchFn } = setup();
  const pending = send({ type: 'SIGN_IN' });
  await vi.waitFor(() => expect(fake.api.windows.create).toHaveBeenCalledTimes(1));
  expect(fake.api.windows.create).toHaveBeenCalledWith(expect.objectContaining({ url: 'chrome-extension://test/signin.html', type: 'popup' }));
  expect(await send({ type: 'AUTH_FALLBACK', email: 'maya@example.com', password: 'right' }, POPUP)).toEqual({ ok: true });
  expect(await pending).toEqual({ ok: true, data: { signed_in: true, user_id: 'user-1', email: 'maya@example.com' } });
  const token = (await send({ type: 'GET_TOKEN' })).data.token;
  expect(token.split('.').length).toBe(3);
  expect(fake.api.storage.session.data[AUTH_KEY].token).toBe(token);
  expect(JSON.stringify(fake.api.storage.local.data)).not.toContain(token);
  expect(fetchFn).toHaveBeenCalledTimes(1);
});

test('a pending SIGN_IN does not hold up other messages, and a second SIGN_IN shares the same window', async () => {
  const { fake, send } = setup();
  const first = send({ type: 'SIGN_IN' });
  const second = send({ type: 'SIGN_IN' });
  await vi.waitFor(() => expect(fake.api.windows.create).toHaveBeenCalled());
  expect(await send({ type: 'GET_AUTH_STATE' })).toEqual({ ok: true, data: { signed_in: false } });
  await send({ type: 'AUTH_FALLBACK', email: 'a@b.c', password: 'right' }, POPUP);
  expect((await first).data.signed_in).toBe(true);
  expect((await second).data.signed_in).toBe(true);
  expect(fake.api.windows.create).toHaveBeenCalledTimes(1);
});

test('a wrong password is reported to the popup and SIGN_IN keeps waiting', async () => {
  const { fake, send } = setup();
  const pending = send({ type: 'SIGN_IN' });
  await vi.waitFor(() => expect(fake.api.windows.create).toHaveBeenCalled());
  expect(await send({ type: 'AUTH_FALLBACK', email: 'a@b.c', password: 'wrong' }, POPUP)).toEqual({ ok: false, error: 'invalid_credentials' });
  expect((await send({ type: 'GET_AUTH_STATE' })).data.signed_in).toBe(false);
  await send({ type: 'AUTH_FALLBACK', email: 'a@b.c', password: 'right' }, POPUP);
  expect((await pending).ok).toBe(true);
});

test('cancelling or closing the popup ends SIGN_IN with cancelled', async () => {
  const one = setup();
  const p1 = one.send({ type: 'SIGN_IN' });
  await vi.waitFor(() => expect(one.fake.api.windows.create).toHaveBeenCalled());
  await one.send({ type: 'AUTH_CANCEL' }, POPUP);
  expect(await p1).toEqual({ ok: false, error: 'cancelled' });
  const two = setup();
  const p2 = two.send({ type: 'SIGN_IN' });
  await vi.waitFor(() => expect(two.fake.api.windows.create).toHaveBeenCalled());
  await vi.waitFor(() => {}); // let the window id be recorded
  two.fake.api.windows.onRemoved.fire(99);
  expect(await p2).toEqual({ ok: false, error: 'cancelled' });
});

test('AUTH messages are accepted only from the sign-in page, and only while a sign-in is in progress', async () => {
  const { fake, send } = setup();
  expect(await send({ type: 'AUTH_FALLBACK', email: 'a@b.c', password: 'right' }, GROVE)).toEqual({ ok: false, error: 'forbidden' });
  expect(await send({ type: 'AUTH_FALLBACK', email: 'a@b.c', password: 'right' }, { id: 'other', url: 'chrome-extension://test/signin.html' })).toEqual({ ok: false, error: 'forbidden' });
  expect(await send({ type: 'AUTH_FALLBACK', email: 'a@b.c', password: 'right' }, POPUP)).toEqual({ ok: false, error: 'no_sign_in_in_progress' });
  expect(fake.api.storage.session.data[AUTH_KEY]).toBeUndefined();
  const pending = send({ type: 'SIGN_IN' });
  await vi.waitFor(() => expect(fake.api.windows.create).toHaveBeenCalled());
  expect(await send({ type: 'AUTH_FALLBACK', email: 5, password: 'right' }, POPUP)).toEqual({ ok: false, error: 'invalid_payload' });
  expect(await send({ type: 'AUTH_FALLBACK', email: 'a@b.c', password: 'right' }, GROVE)).toEqual({ ok: false, error: 'forbidden' });
  await send({ type: 'AUTH_CANCEL' }, POPUP); await pending;
});

test('an already signed-in user does not get a second window', async () => {
  const { fake, send } = setup();
  const pending = send({ type: 'SIGN_IN' });
  await vi.waitFor(() => expect(fake.api.windows.create).toHaveBeenCalled());
  await send({ type: 'AUTH_FALLBACK', email: 'a@b.c', password: 'right' }, POPUP); await pending;
  expect((await send({ type: 'SIGN_IN' })).data.signed_in).toBe(true);
  expect(fake.api.windows.create).toHaveBeenCalledTimes(1);
});

test('SIGN_OUT clears the token and runs the sign-out hook; an expired token is not returned', async () => {
  const { fake, send, signOut, advance } = setup();
  const pending = send({ type: 'SIGN_IN' });
  await vi.waitFor(() => expect(fake.api.windows.create).toHaveBeenCalled());
  await send({ type: 'AUTH_FALLBACK', email: 'a@b.c', password: 'right' }, POPUP); await pending;
  expect(await send({ type: 'SIGN_OUT' })).toEqual({ ok: true, data: null });
  expect(signOut).toHaveBeenCalledTimes(1);
  expect((await send({ type: 'GET_TOKEN' })).data.token).toBeNull();
  const again = send({ type: 'SIGN_IN' });
  await vi.waitFor(() => expect(fake.api.windows.create).toHaveBeenCalledTimes(2));
  await send({ type: 'AUTH_FALLBACK', email: 'a@b.c', password: 'right' }, POPUP); await again;
  advance(3600 * 1000);
  expect((await send({ type: 'GET_TOKEN' })).data.token).toBeNull();
  expect((await send({ type: 'GET_AUTH_STATE' })).data).toEqual({ signed_in: false });
});

test('the password is never stored and never logged', async () => {
  const spies = ['log', 'warn', 'error', 'info', 'debug'].map(name => vi.spyOn(console, name).mockImplementation(() => {}));
  const { fake, send } = setup();
  const pending = send({ type: 'SIGN_IN' });
  await vi.waitFor(() => expect(fake.api.windows.create).toHaveBeenCalled());
  await send({ type: 'AUTH_FALLBACK', email: 'a@b.c', password: 'right' }, POPUP);
  await send({ type: 'AUTH_FALLBACK', email: 'a@b.c', password: 'super-secret-pw' }, POPUP);
  await pending;
  expect(JSON.stringify(fake.api.storage)).not.toContain('super-secret-pw');
  expect(JSON.stringify(fake.api.storage)).not.toContain('"right"');
  for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toMatch(/super-secret-pw|right/);
  vi.restoreAllMocks();
});

test('Microsoft sign-in through the popup resolves SIGN_IN', async () => {
  const token = jwt({ preferred_username: 'maya@contoso.com', name: 'Maya' });
  const { fake, send } = setup({ login: async () => json(200, { access_token: token, expires_in: 3600 }) });
  fake.api.identity.launchWebAuthFlow = vi.fn(async ({ url }) => `https://test.chromiumapp.org/?code=C&state=${new URL(url).searchParams.get('state')}`);
  const pending = send({ type: 'SIGN_IN' });
  await vi.waitFor(() => expect(fake.api.windows.create).toHaveBeenCalled());
  expect(await send({ type: 'AUTH_ENTRA' }, POPUP)).toEqual({ ok: true });
  expect(await pending).toEqual({ ok: true, data: { signed_in: true, display_name: 'Maya', email: 'maya@contoso.com' } });
});

test('Microsoft sign-in without the identity API reports not_available', async () => {
  const { fake, send } = setup({ withIdentity: false });
  const pending = send({ type: 'SIGN_IN' });
  await vi.waitFor(() => expect(fake.api.windows.create).toHaveBeenCalled());
  expect(await send({ type: 'AUTH_ENTRA' }, POPUP)).toEqual({ ok: false, error: 'not_available' });
  await send({ type: 'AUTH_CANCEL' }, POPUP); await pending;
});

test('without an auth service the sign-in messages keep their earlier behaviour', async () => {
  const { send } = setup({ withAuth: false });
  expect(await send({ type: 'SIGN_IN' })).toEqual({ ok: false, error: 'not_implemented' });
  expect(await send({ type: 'SIGN_OUT' })).toEqual({ ok: false, error: 'not_implemented' });
  expect(await send({ type: 'AUTH_CANCEL' }, POPUP)).toEqual({ ok: false, error: 'not_implemented' });
  expect(await send({ type: 'GET_TOKEN' })).toEqual({ ok: true, data: { token: null } });
});
