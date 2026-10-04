// D-10: keeps the privacy settings the user changes here (pause, excluded domains) in step with
// PATCH /api/privacy, and reads them back after sign-in (contracts/privacy.example.json).
// The local copy is what the Hollow uses, so a change takes effect at once; the server copy follows when it can.
export const PENDING_KEY = 'tf_privacy_pending';
export const RESUMED_FOREVER = '9999-12-31T23:59:59Z';
const INTERVAL = 60_000;

interface Area {
  get(key: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string | string[]): Promise<void>;
}
interface Pending { add: string[]; paused?: { value: string | null } }

/** The server stores a timestamp; "until resumed" is the far-future one. */
export function pausedToIso(until: unknown): string | null | undefined {
  if (until === null) return null;
  if (until === 'until resumed') return RESUMED_FOREVER;
  const time = typeof until === 'number' ? until : typeof until === 'string' ? Date.parse(until) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

export function createPrivacySync(deps: {
  storage: { local: Area };
  token: () => Promise<string | null>;
  apiBase: string;
  fetchFn?: typeof fetch;
  now?: () => number;
}) {
  const area = deps.storage.local;
  const now = deps.now ?? Date.now;
  const call = (url: string, init: RequestInit) => (deps.fetchFn ?? fetch)(url, init);
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const result = chain.then(work);
    chain = result.catch(() => {});
    return result;
  };
  let pulled = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function loadPending(): Promise<Pending> {
    const saved = (await area.get(PENDING_KEY))[PENDING_KEY] as Partial<Pending> | undefined;
    return { add: Array.isArray(saved?.add) ? saved.add.filter(x => typeof x === 'string') : [], ...(saved?.paused ? { paused: saved.paused } : {}) };
  }
  const empty = (p: Pending) => !p.add.length && !p.paused;
  const url = () => `${deps.apiBase.replace(/\/$/, '')}/api/privacy`;
  const headers = (token: string) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });

  /** Sends what is waiting. Anything that fails stays waiting, except a request the server calls invalid. */
  async function push(): Promise<boolean> {
    const token = await deps.token();
    if (!token) return false;
    const sent = await serial(loadPending);
    if (empty(sent)) return true;
    let response: Response;
    try {
      response = await call(url(), {
        method: 'PATCH', headers: headers(token),
        body: JSON.stringify({
          ...(sent.add.length ? { excluded_domains_add: sent.add } : {}),
          ...(sent.paused ? { paused_until: sent.paused.value } : {}),
        }),
      });
    } catch { return false; }
    if (response.status === 422) {
      // The server will never take this as it is; keep the local setting and stop retrying it.
    } else if (!response.ok) return false;
    await serial(async () => {
      // Changes made while the request was out stay waiting.
      const current = await loadPending();
      const left: Pending = {
        add: current.add.filter(domain => !sent.add.includes(domain)),
        ...(current.paused && current.paused.value !== sent.paused?.value ? { paused: current.paused } : {}),
      };
      if (empty(left)) await area.remove(PENDING_KEY); else await area.set({ [PENDING_KEY]: left });
    });
    return true;
  }

  /** Reads the server settings after sign-in. Domains are only ever added here, never removed. */
  async function pull(): Promise<boolean> {
    const token = await deps.token();
    if (!token) return false;
    let body: { excluded_domains?: unknown; paused_until?: unknown };
    try {
      const response = await call(url(), { method: 'GET', headers: headers(token) });
      if (!response.ok) return false;
      body = await response.json();
    } catch { return false; }
    await serial(async () => {
      const local = await area.get(['user_excluded_domains', 'paused_until']);
      const pending = await loadPending();
      const have: string[] = Array.isArray(local.user_excluded_domains)
        ? local.user_excluded_domains.filter((x: unknown): x is string => typeof x === 'string') : [];
      const incoming = Array.isArray(body.excluded_domains)
        ? body.excluded_domains.filter((x: unknown): x is string => typeof x === 'string' && /^[a-z0-9.-]{1,253}$/.test(x)) : [];
      const merged = [...new Set([...have, ...incoming])];
      if (merged.length !== have.length) await area.set({ user_excluded_domains: merged });
      // A pause set on another device applies here too, unless this device has its own pause or an unsent change.
      const server = typeof body.paused_until === 'string' ? Date.parse(body.paused_until) : NaN;
      if (local.paused_until === undefined && !pending.paused && server > now()) {
        await area.set({ paused_until: server >= Date.parse(RESUMED_FOREVER) ? 'until resumed' : body.paused_until });
      }
    });
    pulled = true;
    return true;
  }

  async function tick(): Promise<void> {
    await push();
    if (!pulled) await pull();
  }

  return {
    /** Remember a change the user made and try to send it. Resolves once it is saved on this device. */
    async record(change: { addDomain?: string; paused?: unknown }): Promise<void> {
      await serial(async () => {
        const pending = await loadPending();
        if (change.addDomain && !pending.add.includes(change.addDomain)) pending.add.push(change.addDomain);
        if ('paused' in change) {
          const value = pausedToIso(change.paused);
          if (value !== undefined) pending.paused = { value };
        }
        await area.set({ [PENDING_KEY]: pending });
      });
      void push();
    },
    /** After a sign-in: send what is waiting, then read the server's settings. */
    async onSignedIn(): Promise<void> { pulled = false; await tick(); },
    /** After a sign-out: the next sign-in reads the settings again (maybe another account). */
    onSignedOut(): void { pulled = false; },
    tick,
    push,
    pull,
    start(): void {
      if (timer !== undefined) return;
      void tick();
      timer = setInterval(() => { void tick(); }, INTERVAL);
    },
    stop(): void { clearInterval(timer); timer = undefined; },
  };
}

export type PrivacySync = ReturnType<typeof createPrivacySync>;
