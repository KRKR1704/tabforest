import { expect, test, vi } from 'vitest';
import {
  AUTH_KEY, AuthError, AuthStore, buildAuthorizeUrl, challengeFor, claimsOf, entraSignIn, exchangeCode,
  fallbackLogin, parseRedirect, recordFromToken, toState,
} from '../src/background/auth';
import { fakeStorage } from './fake-chrome.mjs';

const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
const jwt = claims => `${b64({ alg: 'HS256' })}.${b64(claims)}.sig`;
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const fail = async (promise) => { try { await promise; } catch (error) { return error; } throw new Error('expected a rejection'); };

test('claimsOf decodes a token payload for display and tolerates garbage', () => {
  expect(claimsOf(jwt({ sub: 'u1', email: 'a@b.c' }))).toMatchObject({ sub: 'u1', email: 'a@b.c' });
  expect(claimsOf('not-a-jwt')).toBeNull();
  expect(claimsOf('a.%%%.c')).toBeNull();
});

test('recordFromToken uses the earlier of expires_in and exp and fills the profile', () => {
  const token = jwt({ sub: 'user-1', email: 'maya@example.com', name: 'Maya', exp: 1_000 + 600 });
  const record = recordFromToken(token, 3600, 'fallback', 1_000_000);
  expect(record).toMatchObject({ provider: 'fallback', user_id: 'user-1', email: 'maya@example.com', display_name: 'Maya', expires_at: 1_600_000 });
  expect(recordFromToken(jwt({ preferred_username: 'x@y.z' }), 60, 'entra', 0)).toMatchObject({ email: 'x@y.z', expires_at: 60_000 });
  expect(recordFromToken(jwt({ sub: 's' }), 60, 'entra', 0).user_id).toBeUndefined();
  expect(() => recordFromToken(jwt({}), undefined, 'entra', 0)).toThrow();
});

test('the token store keeps a valid token, drops an expired one and clears on request', async () => {
  const storage = fakeStorage(); let now = 0;
  const store = new AuthStore(storage.session, () => now);
  await store.save({ token: 't', expires_at: 100_000, provider: 'fallback' });
  expect((await store.load()).token).toBe('t');
  now = 80_000; // inside the 30 s safety margin
  expect(await store.load()).toBeNull();
  expect(storage.session.data[AUTH_KEY]).toBeUndefined();
  await store.save({ token: 't2', expires_at: 500_000, provider: 'fallback' });
  await store.clear();
  expect(await store.load()).toBeNull();
  expect(Object.keys(storage.local.data)).toEqual([]); // never in local storage
});

test('toState hides the token and shows only the profile', () => {
  expect(toState(null)).toEqual({ signed_in: false });
  const state = toState({ token: 'secret', expires_at: 1, provider: 'fallback', email: 'a@b.c', user_id: 'u', display_name: 'A' });
  expect(state).toEqual({ signed_in: true, user_id: 'u', display_name: 'A', email: 'a@b.c' });
  expect(JSON.stringify(state)).not.toContain('secret');
});

test('fallbackLogin posts the credentials as JSON and returns a record', async () => {
  const token = jwt({ sub: 'u1', email: 'maya@example.com' });
  const fetchFn = vi.fn(async () => json(200, { access_token: token, token_type: 'Bearer', expires_in: 3600 }));
  const record = await fallbackLogin({ fetchFn, apiBase: 'https://api.example/', email: 'maya@example.com', password: 'pw', now: () => 0 });
  expect(fetchFn).toHaveBeenCalledWith('https://api.example/api/auth/login', expect.objectContaining({ method: 'POST' }));
  expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({ email: 'maya@example.com', password: 'pw' });
  expect(record).toMatchObject({ token, provider: 'fallback', user_id: 'u1', expires_at: 3_600_000 });
});

test.each([
  [401, 'invalid_credentials'], [422, 'invalid_credentials'], [404, 'not_available'], [429, 'rate_limited'], [500, 'provider_error'],
])('fallbackLogin maps HTTP %i to %s', async (status, code) => {
  const error = await fail(fallbackLogin({ fetchFn: async () => json(status, {}), apiBase: 'https://a', email: 'a@b.c', password: 'x' }));
  expect(error).toBeInstanceOf(AuthError); expect(error.code).toBe(code);
});

test('fallbackLogin reports a network failure and a malformed answer', async () => {
  expect((await fail(fallbackLogin({ fetchFn: async () => { throw new Error('down'); }, apiBase: 'https://a', email: 'a@b.c', password: 'x' }))).code).toBe('network');
  expect((await fail(fallbackLogin({ fetchFn: async () => new Response('<html>', { status: 200 }), apiBase: 'https://a', email: 'a@b.c', password: 'x' }))).code).toBe('bad_response');
  expect((await fail(fallbackLogin({ fetchFn: async () => json(200, { nope: 1 }), apiBase: 'https://a', email: 'a@b.c', password: 'x' }))).code).toBe('bad_response');
});

test('PKCE challenge matches the RFC 7636 test vector', async () => {
  expect(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('the authorize URL carries the PKCE and redirect parameters', () => {
  const url = new URL(buildAuthorizeUrl({ redirectUri: 'https://x.chromiumapp.org/', challenge: 'CH', state: 'ST' }));
  expect(url.origin + url.pathname).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    response_type: 'code', redirect_uri: 'https://x.chromiumapp.org/', code_challenge: 'CH', code_challenge_method: 'S256', state: 'ST',
  });
  expect(url.searchParams.get('client_id')).toMatch(/^[0-9a-f-]{36}$/);
  expect(url.searchParams.get('scope')).toContain('user_impersonation');
});

test('parseRedirect returns the code and rejects errors, a wrong state and a missing code', () => {
  expect(parseRedirect('https://x.chromiumapp.org/?code=abc&state=ST', 'ST')).toBe('abc');
  expect(() => parseRedirect('https://x.chromiumapp.org/?error=access_denied&state=ST', 'ST')).toThrow(AuthError);
  expect(() => parseRedirect('https://x.chromiumapp.org/?code=abc&state=OTHER', 'ST')).toThrow(/state_mismatch/);
  expect(() => parseRedirect('https://x.chromiumapp.org/?state=ST', 'ST')).toThrow(/bad_response/);
  expect(() => parseRedirect(undefined, 'ST')).toThrow(/bad_response/);
});

test('exchangeCode posts the code and verifier as a form and returns a record', async () => {
  const token = jwt({ preferred_username: 'maya@contoso.com', name: 'Maya' });
  const fetchFn = vi.fn(async () => json(200, { access_token: token, expires_in: 3599 }));
  const record = await exchangeCode({ fetchFn, redirectUri: 'https://x.chromiumapp.org/', code: 'CODE', verifier: 'VER', now: () => 0 });
  const [url, init] = fetchFn.mock.calls[0];
  expect(url).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token');
  const form = new URLSearchParams(init.body);
  expect(Object.fromEntries(form)).toMatchObject({ grant_type: 'authorization_code', code: 'CODE', code_verifier: 'VER', redirect_uri: 'https://x.chromiumapp.org/' });
  expect(record).toMatchObject({ provider: 'entra', email: 'maya@contoso.com', display_name: 'Maya', expires_at: 3_599_000 });
  expect((await fail(exchangeCode({ fetchFn: async () => json(400, { error: 'invalid_grant' }), redirectUri: 'r', code: 'c', verifier: 'v' }))).code).toBe('provider_error');
});

test('entraSignIn runs the whole flow and keeps the state check', async () => {
  const token = jwt({ preferred_username: 'maya@contoso.com' });
  let seenUrl;
  const identity = {
    getRedirectURL: () => 'https://x.chromiumapp.org/',
    launchWebAuthFlow: vi.fn(async ({ url }) => { seenUrl = new URL(url); return `https://x.chromiumapp.org/?code=C1&state=${seenUrl.searchParams.get('state')}`; }),
  };
  const fetchFn = vi.fn(async () => json(200, { access_token: token, expires_in: 3600 }));
  const record = await entraSignIn({ identity, fetchFn, now: () => 0 });
  expect(identity.launchWebAuthFlow).toHaveBeenCalledWith({ url: expect.stringContaining('code_challenge='), interactive: true });
  expect(record.provider).toBe('entra');
  // the verifier sent to the token endpoint hashes to the challenge sent to the authorize endpoint
  const verifier = new URLSearchParams(fetchFn.mock.calls[0][1].body).get('code_verifier');
  expect(await challengeFor(verifier)).toBe(seenUrl.searchParams.get('code_challenge'));
  // a redirect with the wrong state is refused before any token request
  const tampered = { ...identity, launchWebAuthFlow: async () => 'https://x.chromiumapp.org/?code=C1&state=WRONG' };
  const fetch2 = vi.fn();
  expect((await fail(entraSignIn({ identity: tampered, fetchFn: fetch2 }))).code).toBe('state_mismatch');
  expect(fetch2).not.toHaveBeenCalled();
});

test('entraSignIn reports a closed window as cancelled', async () => {
  const identity = { getRedirectURL: () => 'https://x/', launchWebAuthFlow: async () => { throw new Error('The user did not approve access.'); } };
  expect((await fail(entraSignIn({ identity, fetchFn: vi.fn() }))).code).toBe('cancelled');
});
