import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { App } from '../App';
import { fetchStoredGrove } from '../adapters/grove';
import { sendBridgeMessage } from '../adapters/bridge';
import { clearLastGrove } from '../lib/lastGrove';
import { mockGroveResponse } from '../mocks/mockData';
import { useBridgeStore } from '../store/useBridgeStore';
import { useGroveStore } from '../store/useGroveStore';

// Its own file: the grow controller keeps module state (a grow in flight), so these must not share it with tests
// that render the whole app and leave a sample grow running.
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

describe('opening the page after sign-in', () => {
  it('keeps the restored grove on open and does not grow over it, even with several tabs open', async () => {
    stored.mockResolvedValue(mockGroveResponse);
    const calls: string[] = [];
    bridge.mockImplementation(async (type: string) => {
      calls.push(type);
      if (type === 'GET_AUTH_STATE') return { ok: true, data: { signed_in: true, display_name: 'Test User' } } as never;
      if (type === 'GET_SNAPSHOT') {
        const tab = (n: string) => ({ tab_ref: n, domain: `${n}.com`, title: n, opened_at: new Date().toISOString() });
        return { ok: true, data: { open_tabs: [tab('a'), tab('b'), tab('c')] } } as never;
      }
      return { ok: true, data: { count: 0, token: 't' } } as never;
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(<App growOnOpen />);
    await waitFor(() => expect(useGroveStore.getState().grove?.trees).toHaveLength(mockGroveResponse.trees.length));
    await new Promise((r) => setTimeout(r, 300));
    expect(calls).not.toContain('GET_SNAPSHOT');
    expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringContaining('/grow'), expect.anything());
    expect(useGroveStore.getState().grove?.trees).toHaveLength(mockGroveResponse.trees.length);
    vi.unstubAllGlobals();
    bridge.mockImplementation((await vi.importActual<typeof import('../adapters/bridge')>('../adapters/bridge')).sendBridgeMessage);
  });

  it('grows on open when the server has no stored grove', async () => {
    stored.mockResolvedValue(null);
    const calls: string[] = [];
    bridge.mockImplementation(async (type: string) => {
      calls.push(type);
      if (type === 'GET_AUTH_STATE') return { ok: true, data: { signed_in: true, display_name: 'Test User' } } as never;
      if (type === 'GET_SNAPSHOT') return { ok: true, data: { open_tabs: [] } } as never;
      return { ok: true, data: { count: 0, token: 't' } } as never;
    });
    render(<App growOnOpen />);
    await waitFor(() => expect(calls).toContain('GET_SNAPSHOT'));
    bridge.mockImplementation((await vi.importActual<typeof import('../adapters/bridge')>('../adapters/bridge')).sendBridgeMessage);
  });
});
