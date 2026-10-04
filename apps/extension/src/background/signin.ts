// D-6: the sign-in window flow. SIGN_IN from the Grove page opens signin.html in a small popup;
// that page sends AUTH_* messages (accepted only from that exact page) and the worker does the network work.
import type { AuthStateData } from '../../../../contracts/bridge.types';
import {
  AuthError, entraSignIn, fallbackLogin, toState, type AuthRecord, type AuthStore,
} from './auth';

export type InternalAuthMessage =
  | { type: 'AUTH_FALLBACK'; email: unknown; password: unknown }
  | { type: 'AUTH_ENTRA' }
  | { type: 'AUTH_CANCEL' };

export const INTERNAL_AUTH_TYPES = new Set(['AUTH_FALLBACK', 'AUTH_ENTRA', 'AUTH_CANCEL']);

export interface AuthService {
  signinUrl: string;
  state(): Promise<AuthStateData>;
  token(): Promise<string | null>;
  signIn(): Promise<AuthStateData>;
  signOut(): Promise<void>;
  handleInternal(message: InternalAuthMessage, senderUrl: string | undefined): Promise<{ ok: boolean; error?: string }>;
}

export function createAuthService(deps: {
  api: Pick<typeof chrome, 'windows' | 'runtime'> & { identity?: typeof chrome.identity };
  store: AuthStore;
  fetchFn: typeof fetch;
  apiBase: string;
  now?: () => number;
  cryptoApi?: Crypto;
}): AuthService {
  const { api, store } = deps;
  const signinUrl = api.runtime.getURL('signin.html');
  type Flow = {
    promise: Promise<AuthStateData>; resolve: (state: AuthStateData) => void;
    reject: (error: AuthError) => void; windowId?: number;
  };
  let flow = null as Flow | null;

  // Registered synchronously at worker start (the worker may be woken by the window closing).
  api.windows.onRemoved.addListener(windowId => {
    if (flow && flow.windowId === windowId) flow.reject(new AuthError('cancelled'));
  });

  async function finish(record: AuthRecord): Promise<void> {
    await store.save(record);
    flow?.resolve(toState(record));
  }

  return {
    signinUrl,
    async state() { return toState(await store.load()); },
    async token() { return (await store.load())?.token ?? null; },

    async signIn() {
      const current = await store.load();
      if (current) return toState(current);
      if (flow) {
        if (flow.windowId !== undefined) void api.windows.update(flow.windowId, { focused: true }).catch(() => {});
        return flow.promise;
      }
      let resolve!: (state: AuthStateData) => void;
      let reject!: (error: AuthError) => void;
      const promise = new Promise<AuthStateData>((res, rej) => { resolve = res; reject = rej; });
      const mine: Flow = { promise, resolve, reject };
      flow = mine;
      void api.windows.create({ url: signinUrl, type: 'popup', width: 440, height: 620, focused: true })
        .then(window => { if (window?.id !== undefined) mine.windowId = window.id; })
        .catch(() => mine.reject(new AuthError('provider_error')));
      try { return await promise; } finally { if (flow === mine) flow = null; }
    },

    async signOut() { await store.clear(); },

    async handleInternal(message, senderUrl) {
      if (senderUrl !== signinUrl) return { ok: false, error: 'forbidden' };
      try {
        if (message.type === 'AUTH_CANCEL') { flow?.reject(new AuthError('cancelled')); return { ok: true }; }
        if (!flow) return { ok: false, error: 'no_sign_in_in_progress' };
        if (message.type === 'AUTH_FALLBACK') {
          const { email, password } = message;
          if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
            return { ok: false, error: 'invalid_payload' };
          }
          await finish(await fallbackLogin({
            fetchFn: deps.fetchFn, apiBase: deps.apiBase, email: email.trim(), password, now: deps.now,
          }));
          return { ok: true };
        }
        if (message.type === 'AUTH_ENTRA') {
          if (!api.identity) return { ok: false, error: 'not_available' };
          await finish(await entraSignIn({
            identity: api.identity, fetchFn: deps.fetchFn, cryptoApi: deps.cryptoApi, now: deps.now,
          }));
          return { ok: true };
        }
        return { ok: false, error: 'unknown_message' };
      } catch (error) {
        // Only the short code goes back to the page; credentials and tokens are never logged.
        return { ok: false, error: error instanceof AuthError ? error.code : 'handler_failed' };
      }
    },
  };
}
