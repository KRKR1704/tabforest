import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import memoryContract from '@contracts/memory-search.example.json';
import pruneContract from '@contracts/prune.example.json';
import snapshotContract from '@contracts/snapshot.example.json';
import contextContract from '@contracts/saved-context.example.json';
import { App } from '../App';
import { resetMockBridge, sendBridgeMessage } from '../adapters/bridge';
import { listContexts, resetContextStandIn } from '../adapters/contexts';
import { getPruneSuggestions, searchMemory } from '../adapters/memory';
import { PruneDialog } from '../components/PruneDialog';
import {
  KIND_LABELS,
  branchesToPrune,
  markClosed,
  placeTabs,
  referenceSets,
  tabsToClose,
} from '../lib/prune';
import { AskMemory, formatDay } from '../screens/AskMemory';
import { mockGroveResponse } from '../mocks/mockData';
import { useGroveStore } from '../store/useGroveStore';
import { useResumeStore } from '../store/useResumeStore';
import type { MemorySearchResponse, PruneSuggestionsResponse } from '../types';

// The real bridge, wrapped so tests can see which messages were sent.
vi.mock('../adapters/bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../adapters/bridge')>();
  return { ...actual, sendBridgeMessage: vi.fn(actual.sendBridgeMessage) };
});
const bridge = vi.mocked(sendBridgeMessage);
const sent = (type: string) => bridge.mock.calls.filter(([t]) => t === type).map(([, payload]) => payload);

const found = memoryContract.examples[0];
const notFound = memoryContract.examples[1];
const foundBody = found.response.body as unknown as MemorySearchResponse;
const pruneExample = pruneContract.examples[0];
const prune = pruneExample.response.body as unknown as PruneSuggestionsResponse;
const [exact, semantic, stale, distraction] = prune.suggestions;
const grove = mockGroveResponse;
const [auth, , jobs] = grove.trees;
const NOW = new Date(2026, 9, 4, 12, 0);
const ids = (...items: Array<{ id: string }>) => new Set(items.map((item) => item.id));
const short = (refs: string[]) => refs.map((ref) => ref.slice(-3));

beforeEach(() => {
  resetMockBridge();
  resetContextStandIn();
  bridge.mockClear();
  useResumeStore.setState({ resume: null });
  useGroveStore.setState({ grove: mockGroveResponse, activeScreen: 'grove', isStreaming: false });
});

describe('memory and prune adapter (C5)', () => {
  it('stand-in: finds the remembered research, and honestly finds nothing otherwise', async () => {
    const hit = await searchMemory('session storage');
    expect(hit).toEqual({ ok: true, result: foundBody });

    const miss = await searchMemory('recipe');
    expect(miss).toEqual({ ok: true, result: notFound.response.body });

    expect(await getPruneSuggestions([])).toEqual({ ok: true, result: prune });
  });

  describe('live', () => {
    const fetchMock = vi.fn();
    beforeEach(() => {
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

    it('sends the contract memory search', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => found.response.body });
      const outcome = await searchMemory('session storage');
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url).endsWith(found.request.path)).toBe(true);
      expect(init.method).toBe('GET');
      expect(init.headers.Authorization).toMatch(/^Bearer /);
      expect(outcome).toEqual({ ok: true, result: found.response.body });
    });

    it('sends the open tabs to the contract prune request', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => prune });
      const refs = snapshotContract.open_tabs.map((tab) => tab.tab_ref);
      await getPruneSuggestions(refs);
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url).endsWith(pruneExample.request.path)).toBe(true);
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual(pruneExample.request.body);
    });

    it('reports a failure instead of inventing a match or a suggestion', async () => {
      fetchMock.mockRejectedValue(new Error('offline'));
      expect(await searchMemory('session storage')).toEqual({
        ok: false,
        message: 'Your memory could not be searched right now.',
      });
      expect(await getPruneSuggestions(['x'])).toEqual({
        ok: false,
        message: 'Prune suggestions are unavailable right now.',
      });
    });
  });
});

describe('Ask Memory', () => {
  it('formats the day of past research', () => {
    expect(formatDay('2026-03-12', NOW)).toBe('March 12');
    expect(formatDay('2025-03-12', NOW)).toBe('March 12, 2025');
    expect(formatDay('nonsense', NOW)).toBe('nonsense');
  });

  it('answers yes with a firefly card: project, day, time, what was compared and the conclusion', async () => {
    const { container } = render(
      <AskMemory query="session storage" onAsk={() => {}} onOpenGrove={async () => true} now={NOW} />
    );
    expect(screen.getByText('Searching your memory…')).toBeInTheDocument();

    const card = within(await screen.findByRole('listitem'));
    expect(card.getByText('Yes, you researched this before')).toBeInTheDocument();
    expect(card.getByRole('heading', { name: 'Backend Scaling' })).toBeInTheDocument();
    expect(card.getByText('March 12 · 1 h 40 m')).toBeInTheDocument();
    expect(card.getByText('Redis vs Postgres sessions')).toBeInTheDocument();
    expect(card.getByText('Redis not needed at expected scale')).toBeInTheDocument();
    expect(card.getByText('Stated')).toBeInTheDocument();
    expect(container.querySelector('li svg')).not.toBeNull();
  });

  it('opens the grove behind a match, and says so if it cannot', async () => {
    const onOpenGrove = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    render(<AskMemory query="redis" onAsk={() => {}} onOpenGrove={onOpenGrove} now={NOW} />);
    const open = await screen.findByRole('button', { name: 'Open grove' });

    fireEvent.click(open);
    await waitFor(() => expect(onOpenGrove).toHaveBeenCalledWith(foundBody.matches[0].saved_context_id));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    fireEvent.click(open);
    expect(await screen.findByRole('alert')).toHaveTextContent('That grove could not be opened.');
  });

  it('says honestly when nothing related was found', async () => {
    render(<AskMemory query="recipe" onAsk={() => {}} onOpenGrove={async () => true} />);
    const answer = within(await screen.findByRole('status'));
    expect(answer.getByText('No related research found')).toBeInTheDocument();
    expect(answer.getByText(/close enough to “recipe”/)).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('asks from its own field, and prompts when there is no question yet', () => {
    const onAsk = vi.fn();
    render(<AskMemory query="" onAsk={onAsk} onOpenGrove={async () => true} />);
    expect(screen.getByText('Ask whether you have researched something before.')).toBeInTheDocument();

    const form = screen.getByRole('search', { name: 'Ask memory' });
    fireEvent.submit(form);
    expect(onAsk).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByRole('textbox'), { target: { value: '  redis ' } });
    fireEvent.submit(form);
    expect(onAsk).toHaveBeenCalledWith('redis');
  });

  it('opens from the top bar and resumes the saved grove', async () => {
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Have I researched…?'), {
      target: { value: 'session storage' },
    });
    fireEvent.submit(screen.getAllByRole('search')[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Open grove' }));

    const card = await screen.findByRole('region', { name: 'Resume' });
    expect(screen.getByRole('heading', { level: 1, name: 'Current Grove' })).toBeInTheDocument();
    expect(within(card).getByRole('heading', { name: 'Backend Scaling' })).toBeInTheDocument();
    expect(within(card).getByText(/1 h 40 m across 2 sessions/)).toBeInTheDocument();
  });
});

describe('prune helpers', () => {
  it('finds every tab in the grove, with its tree and branch when it has one', () => {
    const places = placeTabs(grove);
    expect(places.size).toBe(28);
    const first = places.get(exact.tab_refs[0]);
    expect(first?.tree?.cluster_ref).toBe(auth.cluster_ref);
    expect(first?.branchLabel).toBe('JWT');
    expect(places.get(distraction.tab_refs[0])?.tree).toBeUndefined();
  });

  it('closes the selected suggestions but never the source worth keeping', () => {
    expect(short(tabsToClose(prune.suggestions, ids(exact)))).toEqual(['002']);
    expect(short(tabsToClose(prune.suggestions, ids(exact, semantic)))).toEqual(['002', '009', '010']);
    expect(short(tabsToClose(prune.suggestions, ids(stale)))).toEqual(['020', '019', '018']);
    expect(tabsToClose(prune.suggestions, new Set())).toEqual([]);
  });

  it('prunes the whole branches the selected tabs sit on', () => {
    const cuts = branchesToPrune(grove, prune.suggestions, ids(stale));
    expect(cuts.map((cut) => cut.branchLabel)).toEqual(['Applications', 'Interview prep']);
    expect(cuts.every((cut) => cut.tree.cluster_ref === jobs.cluster_ref)).toBe(true);
    expect(short(cuts.flatMap((cut) => cut.tabRefs)).sort()).toEqual(['016', '017', '018', '019', '020']);
    // A distraction in the meadow sits on no branch.
    expect(branchesToPrune(grove, prune.suggestions, ids(distraction))).toEqual([]);
  });

  it('builds references per project, exactly as the contract shows them', () => {
    const contractSave = contextContract.examples.find((e) => e.name === 'save_references')!;
    const body = contractSave.request.body as { tabs: Array<{ tab_ref: string; fallback_url: string }> };
    const urls = Object.fromEntries(body.tabs.map((tab) => [tab.tab_ref, tab.fallback_url]));

    const { sets, unsaved } = referenceSets(grove, prune.suggestions, ids(semantic), urls);
    expect(unsaved).toEqual([]);
    expect(sets).toHaveLength(1);
    expect(sets[0].tree.cluster_ref).toBe(auth.cluster_ref);
    expect(sets[0].tabs).toEqual(body.tabs);
  });

  it('leaves a tab with no project out of the references', () => {
    const { sets, unsaved } = referenceSets(grove, prune.suggestions, ids(distraction), {});
    expect(sets).toEqual([]);
    expect(unsaved).toEqual(distraction.tab_refs);
  });

  it('marks closed tabs as no longer open, without removing their leaves', () => {
    const next = markClosed(grove, ['00000000-0000-4000-8000-000000000002', distraction.tab_refs[0]]);
    expect(next.trees[0].tabs).toHaveLength(auth.tabs.length);
    expect(next.trees[0].tabs.find((tab) => tab.tab_ref.endsWith('002'))?.is_open).toBe(false);
    expect(next.trees[0].tabs.find((tab) => tab.tab_ref.endsWith('001'))?.is_open).toBe(true);
    expect(next.meadow.tabs.find((tab) => tab.tab_ref === distraction.tab_refs[0])?.is_open).toBe(false);
    expect(grove.trees[0].tabs.every((tab) => tab.is_open)).toBe(true);
  });
});

describe('PruneDialog', () => {
  const open = async (onClose = vi.fn(), onDone = vi.fn()) => {
    render(<PruneDialog grove={grove} onClose={onClose} onDone={onDone} />);
    const dialog = within(await screen.findByRole('dialog', { name: 'Tabs you could prune' }));
    await dialog.findByText(KIND_LABELS.exact_duplicate);
    return { dialog, onClose, onDone };
  };
  const row = (id: string) => {
    const node = document.querySelector(`[data-suggestion-id="${id}"]`);
    if (!node) throw new Error(`no suggestion ${id}`);
    return within(node as HTMLElement);
  };

  it('lists each suggestion with its kind in words, its reason and its tabs', async () => {
    const { dialog } = await open();
    expect(dialog.getByText(prune.note)).toBeInTheDocument();
    for (const suggestion of prune.suggestions) {
      expect(row(suggestion.id).getByText(KIND_LABELS[suggestion.kind])).toBeInTheDocument();
      expect(row(suggestion.id).getByText(suggestion.reason)).toBeInTheDocument();
    }
    expect(row(exact.id).getByText(/· kept$/)).toBeInTheDocument();
    expect(row(semantic.id).getByText(/^Keeping: OAuth2 with Password/)).toBeInTheDocument();
    expect(row(stale.id).getAllByRole('listitem')).toHaveLength(3);
  });

  it('asks for suggestions about the tabs that are open now', async () => {
    await open();
    expect(sent('GET_SNAPSHOT')).toHaveLength(1);
  });

  it('pre-selects only what the server marks, and counts the tabs that would close', async () => {
    const { dialog } = await open();
    expect(row(exact.id).getByRole('checkbox')).toBeChecked();
    expect(row(semantic.id).getByRole('checkbox')).toBeChecked();
    expect(row(stale.id).getByRole('checkbox')).not.toBeChecked();
    expect(row(distraction.id).getByRole('checkbox')).not.toBeChecked();
    expect(dialog.getByText('3 tabs selected')).toBeInTheDocument();

    fireEvent.click(row(stale.id).getByRole('checkbox'));
    expect(dialog.getByText('6 tabs selected')).toBeInTheDocument();
  });

  it('closes nothing by itself: opening, selecting and Keep all send no CLOSE_TABS', async () => {
    const { dialog, onClose, onDone } = await open();
    fireEvent.click(row(stale.id).getByRole('checkbox'));
    fireEvent.click(row(distraction.id).getByRole('checkbox'));
    fireEvent.click(dialog.getByRole('button', { name: 'Keep all' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
    expect(sent('CLOSE_TABS')).toEqual([]);
    expect(useGroveStore.getState().grove).toBe(mockGroveResponse);
  });

  it('closes nothing on Escape', async () => {
    const { onClose } = await open();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sent('CLOSE_TABS')).toEqual([]);
  });

  it('Close selected closes exactly the selected tabs, keeping the stronger source', async () => {
    const { dialog, onDone } = await open();
    fireEvent.click(dialog.getByRole('button', { name: 'Close selected' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Closed 3 tabs.'));
    expect(sent('CLOSE_TABS')).toHaveLength(1);
    expect(short((sent('CLOSE_TABS')[0] as { tab_refs: string[] }).tab_refs)).toEqual(['002', '009', '010']);
    const tabs = useGroveStore.getState().grove!.trees[0].tabs;
    expect(short(tabs.filter((tab) => !tab.is_open).map((tab) => tab.tab_ref))).toEqual(['009', '010', '002']);
  });

  it('cannot close, save or prune with nothing selected', async () => {
    const { dialog } = await open();
    fireEvent.click(row(exact.id).getByRole('checkbox'));
    fireEvent.click(row(semantic.id).getByRole('checkbox'));
    for (const name of ['Close selected', 'Save as references', 'Prune branch']) {
      expect(dialog.getByRole('button', { name })).toBeDisabled();
    }
    expect(dialog.getByRole('button', { name: 'Keep all' })).toBeEnabled();
  });

  it('Save as references saves first (kind=references), then closes those tabs', async () => {
    const { dialog, onDone } = await open();
    fireEvent.click(dialog.getByRole('button', { name: 'Save as references' }));

    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith('Saved 3 tabs as references and closed them.')
    );
    expect(short((sent('GET_URLS')[0] as { tab_refs: string[] }).tab_refs)).toEqual(['002', '009', '010']);
    expect(short((sent('CLOSE_TABS')[0] as { tab_refs: string[] }).tab_refs)).toEqual(['002', '009', '010']);

    const [saved] = (await listContexts()).contexts;
    expect(saved).toMatchObject({
      kind: 'references',
      title: 'Backend Authentication: references',
      project_id: auth.cluster_ref,
      total_tab_count: 3,
      important_tab_count: 0,
    });
    // GET_URLS was asked before anything was closed.
    const order = bridge.mock.calls.map(([type]) => type);
    expect(order.indexOf('GET_URLS')).toBeLessThan(order.indexOf('CLOSE_TABS'));
  });

  it('leaves a tab with no goal open when saving references', async () => {
    const { dialog, onDone } = await open();
    fireEvent.click(row(exact.id).getByRole('checkbox'));
    fireEvent.click(row(semantic.id).getByRole('checkbox'));
    fireEvent.click(row(distraction.id).getByRole('checkbox'));
    fireEvent.click(dialog.getByRole('button', { name: 'Save as references' }));

    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith(
        'Saved 0 tabs as references and closed them. 1 tab with no goal was left open.'
      )
    );
    expect(sent('CLOSE_TABS')).toEqual([]);
  });

  it('Prune branch asks first, naming the branches and the number of tabs', async () => {
    const { dialog, onDone } = await open();
    fireEvent.click(row(exact.id).getByRole('checkbox'));
    fireEvent.click(row(semantic.id).getByRole('checkbox'));
    fireEvent.click(row(stale.id).getByRole('checkbox'));
    fireEvent.click(dialog.getByRole('button', { name: 'Prune branch' }));

    expect(
      dialog.getByText('Close all 5 tabs on Applications (Job Search), Interview prep (Job Search)?')
    ).toBeInTheDocument();
    expect(sent('CLOSE_TABS')).toEqual([]);

    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(sent('CLOSE_TABS')).toEqual([]);
    expect(dialog.getByRole('button', { name: 'Prune branch' })).toBeInTheDocument();

    fireEvent.click(dialog.getByRole('button', { name: 'Prune branch' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Prune' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Pruned 2 branches: closed 5 tabs.'));
    expect(short((sent('CLOSE_TABS')[0] as { tab_refs: string[] }).tab_refs).sort()).toEqual([
      '016',
      '017',
      '018',
      '019',
      '020',
    ]);
  });

  it('says so and changes nothing when the extension cannot close the tabs', async () => {
    const { dialog, onDone } = await open();
    bridge.mockImplementationOnce(async () => ({ ok: false, error: 'no extension' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Close selected' }));

    expect(await dialog.findByRole('alert')).toHaveTextContent(
      'The extension could not close the tabs. Nothing was closed.'
    );
    expect(onDone).not.toHaveBeenCalled();
    expect(useGroveStore.getState().grove).toBe(mockGroveResponse);
  });

  it('renders tab titles and reasons as text', async () => {
    const hostile = '<img src=x onerror="alert(1)">';
    useGroveStore.setState({ grove: mockGroveResponse });
    render(
      <PruneDialog
        grove={{
          ...grove,
          trees: [
            { ...auth, tabs: auth.tabs.map((tab) => ({ ...tab, title: hostile })) },
            ...grove.trees.slice(1),
          ],
        }}
        onClose={() => {}}
        onDone={() => {}}
      />
    );
    await screen.findByText(KIND_LABELS.exact_duplicate);
    expect(document.querySelector('[role="dialog"] img')).toBeNull();
    expect(screen.getAllByText(hostile, { exact: false }).length).toBeGreaterThan(0);
  });

  describe('live', () => {
    const fetchMock = vi.fn();
    beforeEach(() => {
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

    it('sends the open tabs, then the contract save for references, before closing', async () => {
      const contractSave = contextContract.examples.find((e) => e.name === 'save_references')!;
      fetchMock.mockImplementation(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () =>
          String(url).endsWith('/prune-suggestions') ? prune : contractSave.response.body,
      }));
      const onDone = vi.fn();
      render(<PruneDialog grove={grove} onClose={() => {}} onDone={onDone} />);
      const dialog = within(await screen.findByRole('dialog'));
      await dialog.findByText(KIND_LABELS.exact_duplicate);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(pruneExample.request.body);

      fireEvent.click(row(exact.id).getByRole('checkbox'));
      fireEvent.click(dialog.getByRole('button', { name: 'Save as references' }));
      await waitFor(() => expect(onDone).toHaveBeenCalled());

      const [url, init] = fetchMock.mock.calls[1];
      expect(String(url).endsWith(contractSave.request.path)).toBe(true);
      const body = JSON.parse(init.body);
      expect(body).toMatchObject({ kind: 'references', title: 'Backend Authentication: references', card: null });
      expect(body.tabs.map((tab: { tab_ref: string; excluded_reason: string }) => [
        tab.tab_ref.slice(-3),
        tab.excluded_reason,
      ])).toEqual([
        ['009', 'semantic_redundant'],
        ['010', 'semantic_redundant'],
      ]);
      expect(short((sent('CLOSE_TABS')[0] as { tab_refs: string[] }).tab_refs)).toEqual(['009', '010']);
    });

    it('closes nothing when the references cannot be saved', async () => {
      fetchMock.mockImplementation(async (url: string) =>
        String(url).endsWith('/prune-suggestions')
          ? { ok: true, status: 200, json: async () => prune }
          : { ok: false, status: 503, json: async () => ({}) }
      );
      render(<PruneDialog grove={grove} onClose={() => {}} onDone={() => {}} />);
      const dialog = within(await screen.findByRole('dialog'));
      await dialog.findByText(KIND_LABELS.exact_duplicate);
      fireEvent.click(dialog.getByRole('button', { name: 'Save as references' }));

      expect(await dialog.findByRole('alert')).toHaveTextContent(
        'Could not save the references. Nothing was closed.'
      );
      expect(sent('CLOSE_TABS')).toEqual([]);
    });

    it('says suggestions are unavailable, and still closes nothing', async () => {
      fetchMock.mockRejectedValue(new Error('offline'));
      render(<PruneDialog grove={grove} onClose={() => {}} onDone={() => {}} />);
      const dialog = within(await screen.findByRole('dialog'));
      expect(await dialog.findByRole('alert')).toHaveTextContent(
        'Prune suggestions are unavailable right now.'
      );
      expect(dialog.getByRole('button', { name: 'Keep all' })).toBeEnabled();
      expect(dialog.queryByRole('button', { name: 'Close selected' })).not.toBeInTheDocument();
    });
  });
});

describe('pruning and fireflies in the grove', () => {
  it('opens the prune dialog from the grove bar and reports what was closed', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Review tabs to prune' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Tabs you could prune' }));
    fireEvent.click(await dialog.findByRole('button', { name: 'Close selected' }));

    expect(await screen.findByText('Closed 3 tabs.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the prune dialog from a vine, and closes no tab by doing so', async () => {
    const { container } = render(<App />);
    fireEvent.click(container.querySelector('[data-kind="vine"]')!);
    expect(await screen.findByRole('dialog', { name: 'Tabs you could prune' })).toBeInTheDocument();
    expect(sent('CLOSE_TABS')).toEqual([]);
  });

  it('offers to open the grove a firefly leads to', async () => {
    const { container } = render(<App />);
    fireEvent.click(container.querySelector('[data-kind="firefly"]')!);
    const caption = within(screen.getByRole('status'));
    expect(caption.getByText(/You researched this on/)).toBeInTheDocument();
    expect(caption.getByRole('button', { name: 'Open that grove' })).toBeInTheDocument();
  });
});
