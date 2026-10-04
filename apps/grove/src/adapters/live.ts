// Which endpoints talk to the real API (BUILD_TASKS.md S-14).
//
//   VITE_MOCK            anything but "0": every adapter uses its stand-in.
//   VITE_MOCK=0          the real API is on.
//   VITE_LIVE_ENDPOINTS  with VITE_MOCK=0, a comma-separated list of the endpoints
//                        the server really serves, e.g. "me,grove". Every other
//                        adapter stays on its stand-in. Left out, all are live.
//   VITE_API_BASE_URL    where the API is.
//   VITE_DEV_USER        a user UUID sent as X-Dev-User when there is no token.
//                        Only for a local API started with AUTH_MODE=dev.
//
// The values are read on every call, so one adapter can be switched at a time
// by rebuilding with a longer list.

export const ENDPOINTS = [
  'me',
  'grove',
  'claims',
  'contexts',
  'timeline',
  'sessions',
  'privacy',
  'memory',
  'prune',
  'work-context',
] as const;

export type Endpoint = (typeof ENDPOINTS)[number];

/** True when the build is meant to talk to the real API at all. */
export function isLiveBuild(): boolean {
  return import.meta.env.VITE_MOCK === '0';
}

function liveList(): string[] | null {
  const raw = import.meta.env.VITE_LIVE_ENDPOINTS as string | undefined;
  if (raw === undefined || raw.trim() === '') return null;
  return raw
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

/**
 * Whether an adapter should use its stand-in. Without an endpoint it answers
 * for the build as a whole.
 */
export function isMockMode(endpoint?: Endpoint): boolean {
  if (!isLiveBuild()) return true;
  if (!endpoint) return false;
  const live = liveList();
  return live !== null && !live.includes(endpoint);
}

/**
 * True when a live build is showing stand-in data for this endpoint because
 * the server does not serve it yet. Screens say so rather than pass sample
 * data off as the user's own.
 */
export function isHeldOnStandIn(endpoint: Endpoint): boolean {
  return isLiveBuild() && isMockMode(endpoint);
}

export function apiBaseUrl(): string {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined) || 'http://localhost:8000';
  return base.replace(/\/+$/, '');
}

/**
 * The header that says who is asking. With no token nothing is sent and the
 * API answers 401; the deployed API does not accept X-Dev-User at all.
 */
export function authHeaderFor(token: string | null | undefined): Record<string, string> {
  if (token) return { Authorization: `Bearer ${token}` };
  const devUser = import.meta.env.VITE_DEV_USER as string | undefined;
  return devUser ? { 'X-Dev-User': devUser } : {};
}
