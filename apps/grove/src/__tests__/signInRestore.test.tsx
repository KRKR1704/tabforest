import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../App';
import { fetchStoredGrove } from '../adapters/grove';
import { sendBridgeMessage } from '../adapters/bridge';
import { restoreStoredGrove, runGrow } from '../grow/controller';
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

describe('signing in on the page', () => {
  const real = async () => (await vi.importActual<typeof import('../adapters/bridge')>('../adapters/bridge')).sendBridgeMessage;

  it('a grow that returns early does not make the restore give up', async () => {
    let release: (value: typeof mockGroveResponse) => void = () => {};
    stored.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    bridge.mockImplementation(async (type: string) => {
      if (type === 'GET_SNAPSHOT') return { ok: true, data: { open_tabs: [] } } as never;
      return { ok: true, data: { count: 0, token: 't' } } as never;
    });
    const pending = restoreStoredGrove();
    expect(await runGrow({ auto: true, standInDelayMs: 0 })).toBe('last-grove');
    release(mockGroveResponse);
    expect(await pending).toBe(true);
    bridge.mockImplementation(await real());
  });

  it('shows the stored grove after sign-in even with one tab open (no grow races the restore)', async () => {
    stored.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(mockGroveResponse), 60)));
    bridge.mockImplementation(async (type: string) => {
      if (type === 'GET_AUTH_STATE') return { ok: true, data: { signed_in: false } } as never;
      if (type === 'SIGN_IN') return { ok: true, data: { signed_in: true, display_name: 'Test User' } } as never;
      if (type === 'GET_SNAPSHOT') {
        return { ok: true, data: { open_tabs: [{ tab_ref: 'a', domain: 'x.com', title: 'x', opened_at: new Date().toISOString() }] } } as never;
      }
      return { ok: true, data: { count: 0, token: 't' } } as never;
    });
    render(<App growOnOpen />);
    fireEvent.click(await screen.findByRole('button', { name: /Sign in with Microsoft/ }));
    await waitFor(() => expect(useGroveStore.getState().grove?.trees.length).toBe(mockGroveResponse.trees.length), { timeout: 3000 });
    bridge.mockImplementation(await real());
  });
});
