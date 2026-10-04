import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import streamContract from '@contracts/grove.stream.example.ndjson?raw';
import snapshotContract from '@contracts/snapshot.example.json';
import { App } from '../App';
import { readNdjson, streamGrowGrove } from '../adapters/grove';
import { sendBridgeMessage } from '../adapters/bridge';
import { NOTICES, runGrow } from '../grow/controller';
import { clearLastGrove, loadLastGrove, saveLastGrove } from '../lib/lastGrove';
import { GroveCanvas } from '../viz/GroveCanvas';
import { mockGroveResponse, mockSnapshot } from '../mocks/mockData';
import { useBridgeStore } from '../store/useBridgeStore';
import { useGroveStore } from '../store/useGroveStore';
import type { GroveResponse } from '../types';

// The real bridge, wrapped so tests can see which messages were sent and in what order.
vi.mock('../adapters/bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../adapters/bridge')>();
  return { ...actual, sendBridgeMessage: vi.fn(actual.sendBridgeMessage) };
});

const bridge = vi.mocked(sendBridgeMessage);
const sentTypes = () => bridge.mock.calls.map(([type]) => type);

const clusterNames = streamContract
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line))
  .find((line) => line.type === 'clusters')
  .clusters.map((cluster: { name: string }) => cluster.name);

const finalNames = mockGroveResponse.trees.map((tree) => tree.project.name);

/** A response body that hands the text over in awkward pieces, as a network would. */
const streamOf = (text: string, sizes: number[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      const bytes = new TextEncoder().encode(text);
      let at = 0;
      for (const size of sizes) {
        controller.enqueue(bytes.slice(at, at + size));
        at += size;
      }
      controller.enqueue(bytes.slice(at));
      controller.close();
    },
  });

const resetStores = () => {
  clearLastGrove();
  bridge.mockClear();
  useGroveStore.setState({
    grove: null,
    activeScreen: 'grove',
    isStreaming: false,
    groveNotice: null,
  });
  useBridgeStore.setState({ hollowCount: 0 });
};

describe('last grove (kept on this device)', () => {
  beforeEach(resetStores);

  it('saves, loads and clears a grove', () => {
    expect(loadLastGrove()).toBeNull();
    saveLastGrove(mockGroveResponse);
    expect(loadLastGrove()).toEqual(mockGroveResponse);
    clearLastGrove();
    expect(loadLastGrove()).toBeNull();
  });

  it('ignores anything that is not a grove', () => {
    localStorage.setItem('tabforest:last-grove', '{not json');
    expect(loadLastGrove()).toBeNull();
    localStorage.setItem('tabforest:last-grove', JSON.stringify({ trees: 'nope' }));
    expect(loadLastGrove()).toBeNull();
  });

  it('never stores the API token', async () => {
    await runGrow({ standInDelayMs: 0 });
    const token = (await sendBridgeMessage<void, { token: string }>('GET_TOKEN')).data?.token ?? '';
    expect(token).not.toBe('');
    const stored = Object.keys(localStorage)
      .map((key) => `${key}=${localStorage.getItem(key)}`)
      .join(' | ');
    expect(stored).toContain('tabforest:last-grove');
    expect(stored).not.toContain(token);
    expect(sessionStorage.length).toBe(0);
  });
});

describe('readNdjson', () => {
  it('reassembles lines split across chunks, including multi-byte characters', async () => {
    const text = '{"a":"jwt · refresh"}\n{"b":2}\n\n{"c":"last line without newline"}';
    const lines: string[] = [];
    await readNdjson(streamOf(text, [3, 8, 1, 1, 6, 2]), (line) => lines.push(line));
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { a: 'jwt · refresh' },
      { b: 2 },
      { c: 'last line without newline' },
    ]);
  });
});

describe('grow orchestration: mock flow', () => {
  beforeEach(resetStores);

  it('asks the bridge for the snapshot, the Hollow count and the token, in that order', async () => {
    await runGrow({ standInDelayMs: 0 });
    expect(sentTypes().slice(0, 3)).toEqual(['GET_SNAPSHOT', 'GET_HOLLOW_COUNT', 'GET_TOKEN']);
    expect(sentTypes().filter((type) => type === 'GET_TOKEN')).toHaveLength(1);
    expect(useBridgeStore.getState().hollowCount).toBe(3);
  });

  it('plants every cluster at once as a listening tree, then fills them one by one', async () => {
    const pendingCounts: number[] = [];
    const names: string[][] = [];
    const unsubscribe = useGroveStore.subscribe((state, previous) => {
      if (state.grove && state.grove !== previous.grove) {
        pendingCounts.push(state.grove.trees.filter((tree) => tree.pending).length);
        names.push(state.grove.trees.map((tree) => tree.project.name));
      }
    });

    const outcome = await runGrow({ standInDelayMs: 0 });
    unsubscribe();

    expect(outcome).toBe('grown');
    // clusters line, four tree lines, done.
    expect(pendingCounts).toEqual([4, 3, 2, 1, 0, 0]);
    expect(names[0]).toEqual(clusterNames);
    // Trees arrive out of order in the contract stream but keep their cluster's place.
    expect(names[names.length - 1]).toEqual(finalNames);
  });

  it('ends with the full contract grove and is no longer growing', async () => {
    await runGrow({ standInDelayMs: 0 });
    const { grove, isStreaming, groveNotice } = useGroveStore.getState();

    expect(isStreaming).toBe(false);
    expect(groveNotice).toBeNull();
    expect(grove?.trees.map((tree) => tree.tabs.length)).toEqual(
      mockGroveResponse.trees.map((tree) => tree.tabs.length)
    );
    expect(grove?.meadow.tabs.map((tab) => tab.title)).toEqual(
      mockGroveResponse.meadow.tabs.map((tab) => tab.title)
    );
    expect(grove?.fog).toEqual(mockGroveResponse.fog);
    expect(grove?.sprouts[0].tabs).toHaveLength(2);
    expect(grove?.past_connections).toEqual(mockGroveResponse.past_connections);
    expect(grove?.degraded).toBe(false);
  });

  it('keeps the finished grove on this device', async () => {
    await runGrow({ standInDelayMs: 0 });
    expect(loadLastGrove()).toEqual(useGroveStore.getState().grove);
  });

  it('ignores a second grow while one is running', async () => {
    const first = runGrow({ standInDelayMs: 0 });
    expect(await runGrow({ standInDelayMs: 0 })).toBe('busy');
    expect(await first).toBe('grown');
  });

  it('says so and stops when the extension cannot give a snapshot', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    bridge.mockImplementationOnce(async () => ({ ok: false, error: 'no extension' }));

    expect(await runGrow({ standInDelayMs: 0 })).toBe('no-snapshot');

    expect(useGroveStore.getState().groveNotice).toBe(NOTICES.noSnapshot);
    expect(useGroveStore.getState().isStreaming).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('names stand-in clusters from the snapshot through the legacy stream helper', async () => {
    const types: string[] = [];
    await streamGrowGrove(mockSnapshot, (message) => types.push(message.type));
    expect(types).toEqual(['clusters', 'tree', 'tree', 'tree', 'tree', 'done']);
  });
});

describe('grow orchestration: live API', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    resetStores();
    vi.stubEnv('VITE_MOCK', '0');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('posts the snapshot to the streaming endpoint with the bridge token', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: streamOf(streamContract, [17, 400, 5, 9000, 3]),
    });

    expect(await runGrow()).toBe('grown');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/grove\/grow\?stream=1$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ open_tabs: snapshotContract.open_tabs });
    expect(init.headers.Authorization).toMatch(/^Bearer .+/);
    expect(init.body).not.toContain('user_id');

    const grove = useGroveStore.getState().grove;
    expect(grove?.trees.map((tree) => tree.project.name)).toEqual(finalNames);
    expect(grove?.trees.some((tree) => tree.pending)).toBe(false);
    expect(grove?.run_id).toMatch(/^r_/);
  });

  it('shows the last grove, with a notice, when the API is down', async () => {
    const last: GroveResponse = { ...mockGroveResponse, run_id: 'last-run' };
    saveLastGrove(last);
    fetchMock.mockRejectedValue(new Error('network down'));

    expect(await runGrow()).toBe('last-grove');

    // One attempt only: a dead API is not retried in a loop.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useGroveStore.getState().grove?.run_id).toBe('last-run');
    expect(useGroveStore.getState().groveNotice).toBe(NOTICES.offlineLastGrove);
    expect(useGroveStore.getState().isStreaming).toBe(false);
    // The stale grove is not written back as if it were new.
    expect(loadLastGrove()?.run_id).toBe('last-run');
  });

  it('shows clearly labelled sample data when the API is down and nothing was saved', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, body: null });

    expect(await runGrow({ standInDelayMs: 0 })).toBe('stand-in');

    expect(useGroveStore.getState().grove?.trees).toHaveLength(4);
    expect(useGroveStore.getState().groveNotice).toBe(NOTICES.offlineStandIn);
    expect(loadLastGrove()).toBeNull();
  });

  it('marks the grove degraded when the stream says so', async () => {
    const degraded = streamContract.replace('"degraded": false', '"degraded": true');
    expect(degraded).not.toBe(streamContract);
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, body: streamOf(degraded, [50]) });

    await runGrow();
    expect(useGroveStore.getState().grove?.degraded).toBe(true);
  });
});

describe('listening trees on the canvas', () => {
  const listening: GroveResponse = {
    ...mockGroveResponse,
    trees: mockGroveResponse.trees.map((tree, index) =>
      index < 2 ? { ...tree, pending: true, goal: { ...tree.goal, confidence: 0 } } : tree
    ),
  };

  it('marks pending trees, says "listening" in words, and does not fog them', () => {
    const { container } = render(<GroveCanvas grove={listening} />);
    const pending = container.querySelectorAll('[data-kind="tree"][data-pending="true"]');
    expect(pending).toHaveLength(2);
    expect(pending[0].textContent).toMatch(/listening…/);
    expect(pending[0].querySelector('[data-kind="tree-fog"]')).toBeNull();
    expect(container.querySelectorAll('[data-kind="tree"]:not([data-pending])')).toHaveLength(2);
  });
});

describe('Grow in the app', () => {
  beforeEach(resetStores);

  it('grows on first open', async () => {
    const { container } = render(<App growOnOpen />);
    expect(screen.getByText('Reading your open tabs…')).toBeInTheDocument();

    await waitFor(
      () => {
        expect(container.querySelectorAll('[data-kind="tree"]')).toHaveLength(4);
        expect(container.querySelector('[data-pending="true"]')).toBeNull();
      },
      { timeout: 4000 }
    );
    expect(sentTypes()).toContain('GET_SNAPSHOT');
    // The done line follows the last tree; only then is Grow offered again.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Grow grove' })).toBeEnabled(), {
      timeout: 2000,
    });
  });

  it('does not grow by itself unless asked to', async () => {
    render(<App />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sentTypes()).not.toContain('GET_SNAPSHOT');
    expect(screen.getByText('No grove yet.')).toBeInTheDocument();
  });

  it('grows from the Grow grove button and disables it meanwhile', async () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Grow grove' }));

    expect(await screen.findByRole('button', { name: 'Growing…' })).toBeDisabled();
    await waitFor(
      () => expect(container.querySelector('[data-pending="true"]')).not.toBeNull(),
      { timeout: 2000 }
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Grow grove' })).toBeEnabled(), {
      timeout: 4000,
    });
    expect(container.querySelectorAll('[data-kind="tree"]')).toHaveLength(4);
  });

  it('does not open Tree Detail for a tree that is still listening', () => {
    useGroveStore.getState().handleStreamMessage({
      type: 'clusters',
      clusters: [{ cluster_ref: 'c1', project_name: 'jwt · refresh', tab_refs: ['t1', 't2'] }],
    });
    const { container } = render(<App />);
    const trunk = container.querySelector('[data-pending="true"] [data-kind="trunk"]');
    expect(trunk).not.toBeNull();
    fireEvent.click(trunk!);
    expect(screen.queryByRole('complementary', { name: 'Tree detail' })).not.toBeInTheDocument();
  });

  it('shows the degraded banner in words', () => {
    useGroveStore.setState({ grove: { ...mockGroveResponse, degraded: true, banner_text: null } });
    render(<App />);
    expect(screen.getByRole('alert')).toHaveTextContent(NOTICES.degraded);
  });

  it('prefers the server banner text, and a notice over both', () => {
    useGroveStore.setState({
      grove: { ...mockGroveResponse, degraded: true, banner_text: 'Seedling mode' },
    });
    const { rerender } = render(<App />);
    expect(screen.getByRole('alert')).toHaveTextContent('Seedling mode');

    useGroveStore.setState({ groveNotice: NOTICES.offlineLastGrove });
    rerender(<App />);
    expect(screen.getByRole('alert')).toHaveTextContent(NOTICES.offlineLastGrove);
  });

  it('shows no banner for a fresh, full grove', () => {
    useGroveStore.setState({ grove: mockGroveResponse });
    render(<App />);
    expect(within(document.body).queryByRole('alert')).not.toBeInTheDocument();
  });
});
