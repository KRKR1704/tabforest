import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { App } from '../App';
import { fetchStoredGrove } from '../adapters/grove';
import { sendBridgeMessage } from '../adapters/bridge';
import { restoreStoredGrove, runGrow } from '../grow/controller';
import { clearLastGrove, loadLastGrove } from '../lib/lastGrove';
import { mockGroveResponse } from '../mocks/mockData';
import { useBridgeStore } from '../store/useBridgeStore';
import { useGroveStore } from '../store/useGroveStore';

vi.mock('../adapters/bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../adapters/bridge')>();
  return { ...actual, sendBridgeMessage: vi.fn(actual.sendBridgeMessage) };
});
vi.mock('../adapters/grove', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../adapters/grove')>();
  return { ...actual, fetchStoredGrove: vi.fn(actual.fetchStoredGrove) };
});

const stored = vi.mocked(fetchStoredGrove);
const bridge = vi.mocked(sendBridgeMessage);

beforeEach(() => {
  clearLastGrove();
  stored.mockReset();
  useGroveStore.setState({ grove: null, activeScreen: 'grove', isStreaming: false, groveNotice: null });
  useBridgeStore.setState({ hollowCount: 0, authChecked: false });
});
afterEach(() => vi.unstubAllEnvs());

describe('the last stored grove on open', () => {
  it('fills an empty page with the grove the server stored, and keeps a copy on the device', async () => {
    stored.mockResolvedValue(mockGroveResponse);
    expect(await restoreStoredGrove()).toBe(true);
    expect(useGroveStore.getState().grove?.trees).toHaveLength(mockGroveResponse.trees.length);
    expect(loadLastGrove()).not.toBeNull();
  });

  it('leaves the page alone when the server has nothing', async () => {
    stored.mockResolvedValue(null);
    expect(await restoreStoredGrove()).toBe(false);
    expect(useGroveStore.getState().grove).toBeNull();
  });

  it('never replaces a grove that was grown while the request was in flight', async () => {
    let release: (value: typeof mockGroveResponse) => void = () => {};
    stored.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const pending = restoreStoredGrove();
    await runGrow({ standInDelayMs: 0 });
    const grown = useGroveStore.getState().grove;
    release(mockGroveResponse);
    expect(await pending).toBe(false);
    expect(useGroveStore.getState().grove).toBe(grown);
  });

  it('keeps the shown grove when no tab is open to grow from', async () => {
    useGroveStore.setState({ grove: mockGroveResponse });
    bridge.mockImplementation(async (type: string) => {
      if (type === 'GET_SNAPSHOT') return { ok: true, data: { open_tabs: [], taken_at: new Date().toISOString() } } as never;
      return { ok: true, data: { count: 0, token: 't' } } as never;
    });
    expect(await runGrow({ standInDelayMs: 0 })).toBe('last-grove');
    expect(useGroveStore.getState().grove).toBe(mockGroveResponse);
    bridge.mockImplementation((await vi.importActual<typeof import('../adapters/bridge')>('../adapters/bridge')).sendBridgeMessage);
  });

  it('opens the page with the stored grove before the new grow arrives', async () => {
    stored.mockResolvedValue(mockGroveResponse);
    render(<App growOnOpen />);
    await waitFor(() => expect(stored).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/No grove yet/)).toBeNull();
  });

  it('does not ask for anything before the extension says the user is signed in', async () => {
    stored.mockResolvedValue(mockGroveResponse);
    bridge.mockImplementation(async (type: string) =>
      type === 'GET_AUTH_STATE' ? ({ ok: true, data: { signed_in: false } } as never) : ({ ok: true, data: { count: 0, token: null } } as never));
    render(<App growOnOpen />);
    await screen.findByText(/Sign in with Microsoft/);
    expect(stored).not.toHaveBeenCalled();
    bridge.mockImplementation((await vi.importActual<typeof import('../adapters/bridge')>('../adapters/bridge')).sendBridgeMessage);
  });
});

describe('fetchStoredGrove', () => {
  const live = () => { vi.stubEnv('VITE_MOCK', '0'); vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test/'); };
  const real = async () => (await vi.importActual<typeof import('../adapters/grove')>('../adapters/grove')).fetchStoredGrove;

  it('is null for the sample build, 404 and network errors, never the sample grove', async () => {
    const fn = await real();
    expect(await fn()).toBeNull();
    live();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    expect(await fn()).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(await fn()).toBeNull();
    vi.unstubAllGlobals();
  });
});
