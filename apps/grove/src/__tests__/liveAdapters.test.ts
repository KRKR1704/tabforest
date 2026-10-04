import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import meContract from '@contracts/me.example.json';
import snapshotContract from '@contracts/snapshot.example.json';
import streamContract from '@contracts/grove.stream.example.ndjson?raw';
import { resetMockBridge, sendBridgeMessage } from '../adapters/bridge';
import { listContexts } from '../adapters/contexts';
import { authHeaders, growRequestBody } from '../adapters/grove';
import {
  ENDPOINTS,
  apiBaseUrl,
  authHeaderFor,
  isHeldOnStandIn,
  isLiveBuild,
  isMockMode,
} from '../adapters/live';
import { getAccount, resetAccountStandIn } from '../adapters/me';
import { searchMemory, getPruneSuggestions } from '../adapters/memory';
import { getMe, getTimeline, normalizeMe } from '../adapters/platform';
import { getPrivacy } from '../adapters/privacy';
import { analyzeWorkContext } from '../adapters/workContext';
import { NOTICES, runGrow } from '../grow/controller';
import { clearLastGrove, loadLastGrove } from '../lib/lastGrove';
import { useGroveStore } from '../store/useGroveStore';
import type { SnapshotPayload } from '../types';

const meBody = (name: string) =>
  meContract.examples.find((item) => item.name === name)!.response.body;

const fetchMock = vi.fn();
const calledPaths = () => fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname);

/** A live build that points at a server serving only the named endpoints. */
const liveWith = (endpoints?: string) => {
  vi.stubEnv('VITE_MOCK', '0');
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test/');
  if (endpoints !== undefined) vi.stubEnv('VITE_LIVE_ENDPOINTS', endpoints);
};

const ndjson = (text: string) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });

beforeEach(() => {
  resetMockBridge();
  resetAccountStandIn();
  clearLastGrove();
  useGroveStore.setState({ grove: null, isStreaming: false, groveNotice: null });
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('which endpoints are live', () => {
  it('uses every stand-in by default', () => {
    expect(isLiveBuild()).toBe(false);
    expect(isMockMode()).toBe(true);
    for (const endpoint of ENDPOINTS) {
      expect(isMockMode(endpoint)).toBe(true);
      // A mock build is not "held back": it is all sample data and says nothing about it.
      expect(isHeldOnStandIn(endpoint)).toBe(false);
    }
  });

  it('VITE_MOCK=0 alone makes every endpoint live', () => {
    liveWith();
    expect(isLiveBuild()).toBe(true);
    expect(isMockMode()).toBe(false);
    for (const endpoint of ENDPOINTS) expect(isMockMode(endpoint)).toBe(false);
  });

  it('VITE_LIVE_ENDPOINTS switches them on one by one; the rest stay on the stand-in', () => {
    liveWith(' me , grove ');
    expect(isMockMode()).toBe(false);
    expect(ENDPOINTS.filter((endpoint) => !isMockMode(endpoint))).toEqual(['me', 'grove']);
    expect(isHeldOnStandIn('claims')).toBe(true);
    expect(isHeldOnStandIn('me')).toBe(false);
  });

  it('an empty list means no list', () => {
    liveWith('');
    for (const endpoint of ENDPOINTS) expect(isMockMode(endpoint)).toBe(false);
  });

  it('reads the API address without a trailing slash, and has a local default', () => {
    expect(apiBaseUrl()).toBe('http://localhost:8000');
    liveWith();
    expect(apiBaseUrl()).toBe('https://api.example.test');
  });
});

describe('who is asking', () => {
  it('sends the bridge token as a bearer token', async () => {
    expect(authHeaderFor('abc')).toEqual({ Authorization: 'Bearer abc' });
    expect((await authHeaders()).Authorization).toMatch(/^Bearer .+/);
  });

  it('sends nothing when there is no token: no dev header reaches the deployed API', async () => {
    expect(authHeaderFor(null)).toEqual({});
    await sendBridgeMessage('SIGN_OUT');
    expect(await authHeaders()).toEqual({});
  });

  it('sends X-Dev-User only when a dev user is configured, and never over a token', () => {
    vi.stubEnv('VITE_DEV_USER', '452b6018-022d-5e0b-bd7c-101d3c412b79');
    expect(authHeaderFor(null)).toEqual({ 'X-Dev-User': '452b6018-022d-5e0b-bd7c-101d3c412b79' });
    expect(authHeaderFor('abc')).toEqual({ Authorization: 'Bearer abc' });
  });
});

describe('grow request body', () => {
  const snapshot = snapshotContract as SnapshotPayload;

  it('is the contract snapshot, with the Hollow count when it is known', () => {
    expect(growRequestBody(snapshot)).toEqual({ open_tabs: snapshotContract.open_tabs });
    expect(growRequestBody(snapshot, 3)).toEqual({
      open_tabs: snapshotContract.open_tabs,
      hollow_count: 3,
    });
    expect(growRequestBody(snapshot, 0)).toHaveProperty('hollow_count', 0);
  });

  it('passes on only the nine fields the route accepts', () => {
    const extra = {
      open_tabs: [
        {
          ...snapshot.open_tabs[0],
          url: 'https://example.com/private?token=1',
          chrome_tab_id: 42,
          dup_key: undefined,
        },
      ],
    } as unknown as SnapshotPayload;
    const [tab] = growRequestBody(extra).open_tabs;
    expect(Object.keys(tab).sort()).toEqual(
      [
        'active',
        'domain',
        'dup_key',
        'opened_at',
        'opener_tab_ref',
        'pinned',
        'search_query',
        'tab_ref',
        'title',
      ].sort()
    );
    expect(tab.dup_key).toBeNull();
    expect(JSON.stringify(tab)).not.toContain('example.com/private');
  });
});

describe('GET /api/me, as the server sends it', () => {
  it('turns the contract body into the profile the UI uses', () => {
    const profile = normalizeMe(meBody('later_call') as Parameters<typeof normalizeMe>[0]);
    expect(profile.display_name).toBe('Demo User');
    expect(profile.email).toBe('demo.user@example.com');
    expect(profile.privacy.retention_days).toBe(90);
    // 20,160,000 ms of attention is 5.6 hours.
    expect(profile.stats).toEqual({
      total_forests: 5,
      active_goals: 3,
      total_attention_hours: 5.6,
      total_resolved_questions: 1,
    });
  });

  it('accepts a user with no name or email in the token', () => {
    const body = meBody('later_call') as Parameters<typeof normalizeMe>[0];
    const profile = normalizeMe({ ...body, user: { ...body.user, display_name: null, email: null } });
    expect(profile.display_name).toBe('');
    expect(profile.email).toBe('');
  });

  it('getMe reads the live answer', async () => {
    liveWith('me');
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => meBody('later_call') });
    expect((await getMe()).email).toBe('demo.user@example.com');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.example.test/api/me');
    expect(init.headers.Authorization).toMatch(/^Bearer /);
  });
});

describe('a live build where the server serves only /api/me', () => {
  beforeEach(() => liveWith('me'));

  it('asks the real API for the account', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => meBody('first_call_provisions') });
    expect((await getAccount())?.first_sign_in).toBe(true);
    expect(calledPaths()).toEqual(['/api/me']);
  });

  it('keeps every other adapter on its stand-in and sends them nowhere', async () => {
    expect((await searchMemory('session storage')).ok).toBe(true);
    expect((await getPruneSuggestions([])).ok).toBe(true);
    expect((await getPrivacy()).ok).toBe(true);
    expect((await getTimeline('p_10000000-0000-4000-8000-000000000001')).status).toBe('ok');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marks stand-in rows as sample data, not the user’s own', async () => {
    expect((await listContexts()).sample).toBe(true);
    const outcome = await analyzeWorkContext([{ kind: 'paste', title: 'n', text: 'migration notes' }]);
    expect(outcome.ok && outcome.sample).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('grows the sample grove, says so, and does not keep it as the user’s last grove', async () => {
    expect(await runGrow({ standInDelayMs: 0 })).toBe('stand-in');
    expect(useGroveStore.getState().groveNotice).toBe(NOTICES.notConnected);
    expect(useGroveStore.getState().grove?.trees).toHaveLength(4);
    expect(loadLastGrove()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('a mock build', () => {
  it('does not label its stand-in data as sample', async () => {
    expect((await listContexts()).sample).toBe(false);
    expect(await runGrow({ standInDelayMs: 0 })).toBe('grown');
    expect(useGroveStore.getState().groveNotice).toBeNull();
  });
});

describe('a live build where the server also serves the grove', () => {
  it('posts the grow request to the API and keeps the result', async () => {
    liveWith('me,grove');
    fetchMock.mockResolvedValue({ ok: true, status: 200, body: ndjson(streamContract) });

    expect(await runGrow()).toBe('grown');
    expect(calledPaths()).toEqual(['/api/grove/grow']);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.example.test/api/grove/grow?stream=1');
    expect(JSON.parse(init.body).hollow_count).toBe(3);
    expect(useGroveStore.getState().groveNotice).toBeNull();
    expect(loadLastGrove()).not.toBeNull();
  });
});
