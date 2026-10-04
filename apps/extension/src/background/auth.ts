/// <reference types="vite/client" />
// D-6: tokens and the two ways to get one (fallback login, Microsoft Entra ID with PKCE).
// The token lives only in chrome.storage.session. Passwords are never stored or logged.
import type { AuthStateData } from '../../../../contracts/bridge.types';

export const AUTH_KEY = 'tf_auth';
// The public client ID is the only identifier allowed in the bundle (CLAUDE.md H8).
export const ENTRA_CLIENT_ID = import.meta.env.VITE_ENTRA_CLIENT_ID || '84bf8d79-85c2-463d-a8eb-c0a4d22bdb24';
export const ENTRA_TENANT = import.meta.env.VITE_ENTRA_TENANT || 'common';
export const ENTRA_SCOPE = import.meta.env.VITE_ENTRA_SCOPE
  || `api://${ENTRA_CLIENT_ID}/user_impersonation openid profile`;
const EXPIRY_MARGIN_MS = 30_000;

export type AuthErrorCode =
  | 'invalid_credentials' | 'not_available' | 'rate_limited' | 'network' | 'bad_response'
  | 'provider_error' | 'state_mismatch' | 'cancelled';

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode) { super(code); }
}

export interface AuthRecord {
  token: string;
  expires_at: number;
  provider: 'fallback' | 'entra';
  user_id?: string;
  email?: string;
  display_name?: string;
}

interface Area {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export class AuthStore {
  constructor(private readonly area: Area, private readonly now: () => number = Date.now) {}

  async load(): Promise<AuthRecord | null> {
    const raw = (await this.area.get(AUTH_KEY))[AUTH_KEY] as AuthRecord | undefined;
    if (!raw || typeof raw.token !== 'string' || typeof raw.expires_at !== 'number') return null;
    if (raw.expires_at <= this.now() + EXPIRY_MARGIN_MS) { await this.area.remove(AUTH_KEY); return null; }
    return raw;
  }

  save(record: AuthRecord): Promise<void> { return this.area.set({ [AUTH_KEY]: record }); }
  clear(): Promise<void> { return this.area.remove(AUTH_KEY); }
}

export function toState(record: AuthRecord | null): AuthStateData {
  if (!record) return { signed_in: false };
  return {
    signed_in: true,
    ...(record.user_id ? { user_id: record.user_id } : {}),
    ...(record.display_name ? { display_name: record.display_name } : {}),
    ...(record.email ? { email: record.email } : {}),
  };
}

const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Claims of a JWT for display only; the server is the one that verifies the token. */
export function claimsOf(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const padded = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const value = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), c => c.charCodeAt(0))));
    return value && typeof value === 'object' ? value : null;
  } catch { return null; }
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);

export function recordFromToken(
  token: string, expiresInSeconds: number | undefined, provider: AuthRecord['provider'], now: number,
): AuthRecord {
  const claims = claimsOf(token) ?? {};
  const exp = typeof claims.exp === 'number' ? claims.exp * 1000 : undefined;
  const byLifetime = typeof expiresInSeconds === 'number' && expiresInSeconds > 0 ? now + expiresInSeconds * 1000 : undefined;
  const expires_at = Math.min(...[exp, byLifetime].filter((x): x is number => x !== undefined));
  if (!Number.isFinite(expires_at)) throw new AuthError('bad_response');
  return {
    token, expires_at, provider,
    // The fallback token's sub is the user id; for Entra the server derives it from tid and oid.
    ...(provider === 'fallback' && text(claims.sub) ? { user_id: text(claims.sub) } : {}),
    ...(text(claims.email) ?? text(claims.preferred_username) ? { email: text(claims.email) ?? text(claims.preferred_username) } : {}),
    ...(text(claims.name) ? { display_name: text(claims.name) } : {}),
  };
}

/** POST /api/auth/login (SPEC §11.1 fallback). The deployed API answers 404 while FALLBACK_LOGIN is off. */
export async function fallbackLogin(options: {
  fetchFn: typeof fetch; apiBase: string; email: string; password: string; now?: () => number;
}): Promise<AuthRecord> {
  let response: Response;
  try {
    response = await options.fetchFn(`${options.apiBase.replace(/\/$/, '')}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: options.email, password: options.password }),
    });
  } catch { throw new AuthError('network'); }
  if (response.status === 401 || response.status === 422) throw new AuthError('invalid_credentials');
  if (response.status === 404) throw new AuthError('not_available');
  if (response.status === 429) throw new AuthError('rate_limited');
  if (!response.ok) throw new AuthError('provider_error');
  let body: { access_token?: unknown; expires_in?: unknown };
  try { body = await response.json(); } catch { throw new AuthError('bad_response'); }
  if (typeof body.access_token !== 'string' || !body.access_token) throw new AuthError('bad_response');
  return recordFromToken(body.access_token, typeof body.expires_in === 'number' ? body.expires_in : undefined,
    'fallback', (options.now ?? Date.now)());
}

// ---- Microsoft Entra ID, authorization code flow with PKCE (SPEC §11.1) ----

export async function challengeFor(verifier: string, cryptoApi: Crypto = crypto): Promise<string> {
  return b64url(new Uint8Array(await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

export function randomToken(bytes: number, cryptoApi: Crypto = crypto): string {
  return b64url(cryptoApi.getRandomValues(new Uint8Array(bytes)));
}

export function buildAuthorizeUrl(options: {
  tenant?: string; clientId?: string; redirectUri: string; scope?: string; challenge: string; state: string;
}): string {
  const url = new URL(`https://login.microsoftonline.com/${options.tenant ?? ENTRA_TENANT}/oauth2/v2.0/authorize`);
  const params: Record<string, string> = {
    client_id: options.clientId ?? ENTRA_CLIENT_ID, response_type: 'code', redirect_uri: options.redirectUri,
    response_mode: 'query', scope: options.scope ?? ENTRA_SCOPE, state: options.state,
    code_challenge: options.challenge, code_challenge_method: 'S256', prompt: 'select_account',
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.href;
}

export function parseRedirect(redirected: string | undefined, expectedState: string): string {
  let params: URLSearchParams;
  try { params = new URL(redirected ?? '').searchParams; } catch { throw new AuthError('bad_response'); }
  if (params.get('error')) throw new AuthError('provider_error');
  if (params.get('state') !== expectedState) throw new AuthError('state_mismatch');
  const code = params.get('code');
  if (!code) throw new AuthError('bad_response');
  return code;
}

export async function exchangeCode(options: {
  fetchFn: typeof fetch; tenant?: string; clientId?: string; redirectUri: string; scope?: string;
  code: string; verifier: string; now?: () => number;
}): Promise<AuthRecord> {
  let response: Response;
  try {
    response = await options.fetchFn(
      `https://login.microsoftonline.com/${options.tenant ?? ENTRA_TENANT}/oauth2/v2.0/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: options.clientId ?? ENTRA_CLIENT_ID, grant_type: 'authorization_code', code: options.code,
          redirect_uri: options.redirectUri, code_verifier: options.verifier, scope: options.scope ?? ENTRA_SCOPE,
        }).toString(),
      });
  } catch { throw new AuthError('network'); }
  if (!response.ok) throw new AuthError('provider_error');
  let body: { access_token?: unknown; expires_in?: unknown };
  try { body = await response.json(); } catch { throw new AuthError('bad_response'); }
  if (typeof body.access_token !== 'string' || !body.access_token) throw new AuthError('bad_response');
  return recordFromToken(body.access_token, typeof body.expires_in === 'number' ? body.expires_in : undefined,
    'entra', (options.now ?? Date.now)());
}

export async function entraSignIn(options: {
  identity: Pick<typeof chrome.identity, 'getRedirectURL' | 'launchWebAuthFlow'>;
  fetchFn: typeof fetch; cryptoApi?: Crypto; now?: () => number;
}): Promise<AuthRecord> {
  const cryptoApi = options.cryptoApi ?? crypto;
  const redirectUri = options.identity.getRedirectURL();
  const verifier = randomToken(64, cryptoApi);
  const state = randomToken(16, cryptoApi);
  const url = buildAuthorizeUrl({ redirectUri, challenge: await challengeFor(verifier, cryptoApi), state });
  let redirected: string | undefined;
  try {
    redirected = await options.identity.launchWebAuthFlow({ url, interactive: true });
  } catch (error) {
    throw new AuthError(/did not approve|canceled|cancelled|closed/i.test(String((error as Error)?.message)) ? 'cancelled' : 'provider_error');
  }
  return exchangeCode({
    fetchFn: options.fetchFn, redirectUri, verifier, code: parseRedirect(redirected, state), now: options.now,
  });
}
