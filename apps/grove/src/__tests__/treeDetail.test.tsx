import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import claimsContract from '@contracts/claims.example.json';
import { App } from '../App';
import { GroveCanvas } from '../viz/GroveCanvas';
import { computeGroveLayout, computeRoots, resolveDrop } from '../viz/layout';
import { hypothesisId } from '../lib/groveEdits';
import { mockGroveResponse } from '../mocks/mockData';
import { useGroveStore } from '../store/useGroveStore';

const grove = mockGroveResponse;
const layout = computeGroveLayout(grove);
const [auth, prep, jobs] = grove.trees;
const [authLayout, prepLayout] = layout.trees;
const question = auth.unresolved_questions[0];
const mossy = auth.decisions.find((d) => d.stone_kind === 'mossy')!;

const click = (container: HTMLElement, selector: string) => {
  const node = container.querySelector(selector);
  if (!node) throw new Error(`nothing matches ${selector}`);
  fireEvent.click(node);
  return node;
};
// d3-drag follows the pointer on event.view, which jsdom only accepts as its own
// Window; setting it after construction gives d3 what a browser would.
const mouse = (target: EventTarget, type: string, x: number, y: number) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
  Object.defineProperty(event, 'view', { value: window });
  act(() => {
    target.dispatchEvent(event);
  });
};

/** Picks a leaf up and carries it to a point; call the result to let go. */
const dragLeaf = (container: HTMLElement, tabRef: string, to: { x: number; y: number }) => {
  const leaf = container.querySelector(`[data-kind="tree"] [data-tab-ref="${tabRef}"]`);
  if (!leaf) throw new Error('leaf not found');
  mouse(leaf, 'mousedown', 5, 5);
  mouse(window, 'mousemove', to.x - 20, to.y);
  mouse(window, 'mousemove', to.x, to.y);
  return () => mouse(window, 'mouseup', to.x, to.y);
};

// After a drag, d3 swallows the click that the mouse-up would cause and lifts
// that guard on the next tick. Let the tick pass so it cannot reach the next test.
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
});

const detail = () => screen.getByRole('complementary', { name: 'Tree detail' });
const claimRow = (id: string) => {
  const row = detail().querySelector(`[data-claim-id="${id}"]`);
  if (!row) throw new Error(`no claim row ${id}`);
  return within(row as HTMLElement);
};

describe('roots', () => {
  it('reach exactly the evidence leaves, including the tabs of a search family', () => {
    const family = auth.query_families?.[0];
    const tabRefs = question.evidence.flatMap((item) =>
      item.ref_kind === 'query' ? family?.tab_refs ?? [] : [item.ref]
    );
    const roots = computeRoots(layout, auth.cluster_ref, { kind: 'mushroom', id: question.id }, tabRefs);

    expect(new Set(roots?.paths.map((p) => p.tabRef))).toEqual(new Set(tabRefs));
    expect(roots?.paths.length).toBe(new Set(tabRefs).size);
    const mushroom = authLayout.mushrooms[0];
    expect(roots?.origin).toEqual({ x: mushroom.x, y: mushroom.y - mushroom.capRadius });
  });

  it('start at the trunk for tree-level claims and skip refs that are not leaves', () => {
    const roots = computeRoots(layout, auth.cluster_ref, { kind: 'trunk' }, [
      auth.tabs[0].tab_ref,
      'not-a-leaf',
    ]);
    expect(roots?.origin).toEqual({ x: authLayout.x, y: layout.groundY });
    expect(roots?.paths).toHaveLength(1);
    expect(computeRoots(layout, 'no-such-tree', { kind: 'trunk' }, [])).toBeNull();
  });

  it('light the evidence leaves and dim the rest of that tree only', () => {
    const lit = [auth.tabs[0].tab_ref, auth.tabs[1].tab_ref];
    const { container, rerender } = render(
      <GroveCanvas
        grove={grove}
        roots={{ treeId: auth.cluster_ref, anchor: { kind: 'trunk' }, tabRefs: lit }}
      />
    );
    expect(container.querySelectorAll('[data-kind="roots"] path')).toHaveLength(2);
    expect(container.querySelectorAll('[data-evidence="true"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-dimmed="true"]')).toHaveLength(auth.tabs.length - 2);
    for (const node of container.querySelectorAll('[data-dimmed="true"]')) {
      expect(node.closest('[data-tree-id]')?.getAttribute('data-tree-id')).toBe(auth.cluster_ref);
    }

    rerender(<GroveCanvas grove={grove} roots={null} />);
    expect(container.querySelector('[data-kind="roots"]')).toBeNull();
    expect(container.querySelector('[data-evidence], [data-dimmed]')).toBeNull();
  });
});

describe('dropping a leaf', () => {
  it('lands on another tree, on the branch nearest the drop', () => {
    const branch = prepLayout.branches[1];
    expect(resolveDrop(layout, branch.tip, auth.cluster_ref)).toEqual({
      kind: 'tree',
      treeId: prep.cluster_ref,
      branchLabel: branch.label,
    });
  });

  it('does nothing on its own tree or on empty ground', () => {
    expect(resolveDrop(layout, authLayout.crown, auth.cluster_ref)).toBeNull();
    expect(resolveDrop(layout, { x: layout.sprouts[0].x, y: 100 }, auth.cluster_ref)).toBeNull();
  });

  it('starts a new tree in the new-tree zone, which sits inside the canvas', () => {
    const zone = layout.newTreeZone;
    expect(resolveDrop(layout, zone, auth.cluster_ref)).toEqual({ kind: 'new' });
    expect(zone.x - zone.r).toBeGreaterThan(0);
    expect(zone.x + zone.r).toBeLessThan(layout.width);
    expect(zone.y - zone.r).toBeGreaterThan(0);
    for (const tree of layout.trees) {
      expect(Math.abs(zone.x - tree.x)).toBeGreaterThan(tree.halfWidth);
    }
  });

  it('reports a drag onto another tree and shows where it would land', () => {
    const onDropLeaf = vi.fn();
    const { container } = render(<GroveCanvas grove={grove} onDropLeaf={onDropLeaf} />);
    const tabRef = auth.tabs[0].tab_ref;

    const release = dragLeaf(container, tabRef, prepLayout.branches[0].tip);
    expect(container.querySelector('[data-kind="drag-ghost"]')).not.toBeNull();
    expect(container.querySelector('[data-kind="new-tree-zone"]')?.getAttribute('display')).toBeNull();
    expect(
      container.querySelector('[data-kind="tree"][data-drop-target="true"]')?.getAttribute('data-tree-id')
    ).toBe(prep.cluster_ref);

    release();
    expect(onDropLeaf).toHaveBeenCalledWith({
      tabRef,
      fromTreeId: auth.cluster_ref,
      target: { kind: 'tree', treeId: prep.cluster_ref, branchLabel: prepLayout.branches[0].label },
    });
    expect(container.querySelector('[data-kind="drag-ghost"]')).toBeNull();
    expect(container.querySelector('[data-kind="new-tree-zone"]')?.getAttribute('display')).toBe('none');
  });

  it('does not report a drag that ends on empty ground', () => {
    const onDropLeaf = vi.fn();
    const { container } = render(<GroveCanvas grove={grove} onDropLeaf={onDropLeaf} />);
    dragLeaf(container, auth.tabs[0].tab_ref, { x: layout.sprouts[0].x, y: 100 })();
    expect(onDropLeaf).not.toHaveBeenCalled();
  });
});

describe('Tree Detail', () => {
  beforeEach(() => {
    useGroveStore.setState({ grove: mockGroveResponse, activeScreen: 'grove', isStreaming: false });
    vi.mocked(window.open).mockClear();
  });

  it('opens on a tree click with every section and a provenance pill per claim', () => {
    const { container } = render(<App />);
    click(container, '[data-kind="trunk"]');

    const drawer = within(detail());
    expect(drawer.getByRole('heading', { name: auth.project.name })).toBeInTheDocument();
    for (const title of ['Goal', 'Direction', 'Decisions', 'Open questions', 'Next actions', 'In the fog', 'Add a note']) {
      expect(drawer.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(drawer.getByRole('heading', { name: `Sources · ${auth.tabs.length}` })).toBeInTheDocument();
    expect(drawer.getByText(auth.goal.display_text ?? '')).toBeInTheDocument();

    const claims = detail().querySelectorAll('[data-claim-id]');
    expect(claims.length).toBe(
      2 + auth.decisions.length + auth.unresolved_questions.length + auth.next_actions.length + auth.hypotheses.length
    );
    for (const row of claims) {
      expect(row.querySelector('[data-provenance]')).not.toBeNull();
    }
  });

  it('zooms in on the tree and leaves the zoom alone when the grove is edited', async () => {
    const { container } = render(<App />);
    const transform = () =>
      container.querySelector('[data-kind="grove-root"]')?.getAttribute('transform');
    expect(transform()).toBeNull();

    click(container, '[data-kind="trunk"]');
    const zoomed = transform();
    expect(zoomed).toMatch(/scale\((1\.\d+|2(\.\d+)?)\)/);

    fireEvent.click(claimRow(mossy.id).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(claimRow(mossy.id).getByText('Stated')).toBeInTheDocument());
    expect(transform()).toBe(zoomed);
  });

  it('lights roots from a clicked mushroom and shows its evidence', () => {
    const { container } = render(<App />);
    click(container, '[data-kind="mushroom"]');

    const row = claimRow(question.id);
    expect(row.getByRole('list', { name: 'Evidence' }).children).toHaveLength(question.evidence.length);
    const roots = container.querySelectorAll('[data-kind="roots"] path');
    expect(roots.length).toBeGreaterThan(0);
    expect(container.querySelectorAll('[data-evidence="true"]')).toHaveLength(roots.length);

    // Clicking the pill again puts the roots away.
    fireEvent.click(row.getByRole('button', { name: /Inferred/ }));
    expect(container.querySelector('[data-kind="roots"]')).toBeNull();
  });

  it('lights roots from a pill in the drawer', () => {
    const { container } = render(<App />);
    click(container, '[data-kind="trunk"]');
    expect(container.querySelector('[data-kind="roots"]')).toBeNull();

    fireEvent.click(claimRow(auth.goal.id!).getByRole('button', { name: /Inferred/ }));
    const tabEvidence = auth.goal.evidence.filter((e) => e.ref_kind === 'tab');
    expect(container.querySelectorAll('[data-kind="roots"] path')).toHaveLength(tabEvidence.length);
  });

  it('confirms an inferred decision: the pill turns Stated and the stone is carved', async () => {
    const { container } = render(<App />);
    click(container, '[data-stone-kind="mossy"]');
    expect(container.querySelectorAll('[data-stone-kind="mossy"]')).toHaveLength(1);

    fireEvent.click(claimRow(mossy.id).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(container.querySelectorAll('[data-stone-kind="mossy"]')).toHaveLength(0));
    expect(container.querySelectorAll('[data-stone-kind="carved"]')).toHaveLength(2);
    expect(claimRow(mossy.id).getByText('Stated')).toBeInTheDocument();
    expect(claimRow(mossy.id).getByText(mossy.text)).toBeInTheDocument();
    expect(claimRow(mossy.id).queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
    expect(screen.getByText('Confirmed. This is now stated by you.')).toBeInTheDocument();
  });

  it('marks a question resolved: the mushroom becomes a flower and the count drops', async () => {
    const { container } = render(<App />);
    const banner = within(screen.getByRole('banner'));
    expect(banner.getByText('1')).toBeInTheDocument();
    click(container, '[data-kind="mushroom"]');

    const row = claimRow(question.id);
    fireEvent.click(row.getByRole('button', { name: 'Mark resolved' }));
    fireEvent.change(row.getByPlaceholderText('What did you find out?'), {
      target: { value: 'In an HttpOnly cookie' },
    });
    fireEvent.click(row.getByRole('button', { name: 'Resolve' }));

    await waitFor(() => expect(container.querySelector('[data-kind="mushroom"]')).toBeNull());
    expect(container.querySelectorAll('[data-kind="flower"]')).toHaveLength(2);
    expect(claimRow(question.id).getByText('Resolved: In an HttpOnly cookie')).toBeInTheDocument();
    expect(banner.getByText('0')).toBeInTheDocument();
  });

  it('does not resolve with an empty answer', () => {
    const { container } = render(<App />);
    click(container, '[data-kind="mushroom"]');
    const row = claimRow(question.id);
    fireEvent.click(row.getByRole('button', { name: 'Mark resolved' }));
    fireEvent.click(row.getByRole('button', { name: 'Resolve' }));
    expect(container.querySelector('[data-kind="mushroom"]')).not.toBeNull();
  });

  it('edits a next action in the user’s words', async () => {
    const { container } = render(<App />);
    click(container, '[data-kind="trunk"]');
    const action = auth.next_actions[0];

    const row = claimRow(action.id);
    fireEvent.click(row.getByRole('button', { name: 'Edit' }));
    const input = row.getByRole('textbox', { name: 'Edit claim' });
    expect(input).toHaveValue(action.action);
    fireEvent.change(input, { target: { value: 'Try cookies first' } });
    fireEvent.click(row.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(claimRow(action.id).getByText('Try cookies first')).toBeInTheDocument());
    expect(claimRow(action.id).getByText('Stated')).toBeInTheDocument();
  });

  it('dismisses a hypothesis: its fog leaves the canvas', async () => {
    const { container } = render(<App />);
    click(container, '[data-kind="hypothesis"]');
    const id = hypothesisId(auth, auth.hypotheses[0], 0);

    fireEvent.click(claimRow(id).getByRole('button', { name: 'Dismiss' }));

    await waitFor(() => expect(container.querySelector('[data-kind="hypothesis"]')).toBeNull());
    expect(detail().querySelector(`[data-claim-id="${id}"]`)).toBeNull();
    expect(container.querySelector('[data-kind="roots"]')).toBeNull();
  });

  it('adds a decision note as a new carved stone', async () => {
    const { container } = render(<App />);
    click(container, '[data-kind="trunk"]');
    const drawer = within(detail());

    fireEvent.change(drawer.getByRole('textbox', { name: 'Note text' }), {
      target: { value: 'Ship with cookies' },
    });
    fireEvent.click(drawer.getByRole('button', { name: 'Add note' }));

    await waitFor(() => expect(container.querySelectorAll('[data-kind="stone"]')).toHaveLength(3));
    expect(drawer.getByText('Ship with cookies')).toBeInTheDocument();
    expect(drawer.getByRole('textbox', { name: 'Note text' })).toHaveValue('');
  });

  it('opens a source tab and excludes its domain through the bridge', async () => {
    const { container } = render(<App />);
    click(container, '[data-kind="trunk"]');
    const drawer = within(detail());
    const tab = auth.tabs[0];

    // Exact duplicates share a title, so there can be more than one such button.
    fireEvent.click(drawer.getAllByRole('button', { name: tab.title })[0]);
    await waitFor(() => expect(window.open).toHaveBeenCalledWith(`https://${tab.domain}`, '_blank'));

    fireEvent.click(drawer.getAllByRole('button', { name: `Exclude ${tab.domain}` })[0]);
    expect(await screen.findByText(`${tab.domain} will no longer be analyzed.`)).toBeInTheDocument();
  });

  it('closes on the close button and on Escape', () => {
    const { container } = render(<App />);
    click(container, '[data-kind="trunk"]');
    fireEvent.click(within(detail()).getByRole('button', { name: 'Close tree detail' }));
    expect(screen.queryByRole('complementary', { name: 'Tree detail' })).not.toBeInTheDocument();

    click(container, '[data-kind="mushroom"]');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('complementary', { name: 'Tree detail' })).not.toBeInTheDocument();
    expect(container.querySelector('[data-kind="roots"]')).toBeNull();
  });

  it('renders hostile claim and tab text as text', () => {
    const hostile = '<img src=x onerror="alert(1)">';
    useGroveStore.setState({
      grove: {
        ...grove,
        trees: [
          {
            ...auth,
            goal: { ...auth.goal, text: hostile, display_text: hostile },
            tabs: auth.tabs.map((tab) => ({ ...tab, title: hostile })),
          },
          ...grove.trees.slice(1),
        ],
      },
    });
    const { container } = render(<App />);
    click(container, '[data-kind="trunk"]');
    expect(detail().querySelector('img')).toBeNull();
    expect(within(detail()).getAllByText(hostile).length).toBeGreaterThan(1);
  });
});

describe('leaves on the canvas', () => {
  beforeEach(() => {
    useGroveStore.setState({ grove: mockGroveResponse, activeScreen: 'grove', isStreaming: false });
    vi.mocked(window.open).mockClear();
  });

  it('opens the tab when a leaf is clicked, and offers to exclude its domain', async () => {
    const { container } = render(<App />);
    const tab = auth.tabs[0];
    click(container, `[data-kind="tree"] [data-tab-ref="${tab.tab_ref}"]`);

    await waitFor(() => expect(window.open).toHaveBeenCalledWith(`https://${tab.domain}`, '_blank'));
    const caption = within(screen.getByRole('status'));
    expect(caption.getByText(tab.title)).toBeInTheDocument();

    fireEvent.click(caption.getByRole('button', { name: `Exclude ${tab.domain}` }));
    expect(await caption.findByText(`${tab.domain} will no longer be analyzed.`)).toBeInTheDocument();
  });

  it('clears the fog: naming an unclear tab grows it a tree', async () => {
    const { container } = render(<App />);
    const fogTab = grove.fog![0].tab;
    click(container, `[data-kind="fog"] [data-tab-ref="${fogTab.tab_ref}"]`);

    const caption = within(screen.getByRole('status'));
    expect(caption.getByText('Unclear tab')).toBeInTheDocument();
    fireEvent.change(caption.getByRole('textbox', { name: 'Goal of this tab' }), {
      target: { value: 'Use a Pomodoro timer' },
    });
    fireEvent.click(caption.getByRole('button', { name: 'Clear the fog' }));

    await waitFor(() => expect(container.querySelectorAll('[data-kind="tree"]')).toHaveLength(5));
    expect(container.querySelector('[data-kind="fog"]')).toBeNull();
    expect(screen.getByText('Use a Pomodoro timer')).toBeInTheDocument();
  });

  it('moves a dragged leaf to another tree', async () => {
    const { container } = render(<App />);
    const tab = jobs.tabs.find((t) => !t.fallen)!;
    const leavesOn = (treeId: string) =>
      container.querySelectorAll(`[data-tree-id="${treeId}"] [data-tab-ref]`).length;
    const before = leavesOn(auth.cluster_ref);

    dragLeaf(container, tab.tab_ref, authLayout.branches[2].tip)();

    await waitFor(() => expect(leavesOn(auth.cluster_ref)).toBe(before + 1));
    expect(
      container.querySelector(`[data-tree-id="${jobs.cluster_ref}"] [data-tab-ref="${tab.tab_ref}"]`)
    ).toBeNull();
    expect(screen.getByText('Moved. The tab is pinned to that goal.')).toBeInTheDocument();
  });

  it('plants a new tree from a leaf dropped in the new-tree zone', async () => {
    const { container } = render(<App />);
    const tab = jobs.tabs.find((t) => !t.fallen)!;

    dragLeaf(container, tab.tab_ref, layout.newTreeZone)();
    // Wait out d3's one-tick click guard before pressing a button.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const caption = within(screen.getByRole('status'));
    fireEvent.change(caption.getByRole('textbox', { name: 'Name the new tree' }), {
      target: { value: 'Interview Practice' },
    });
    fireEvent.click(caption.getByRole('button', { name: 'Plant tree' }));

    await waitFor(() => expect(container.querySelectorAll('[data-kind="tree"]')).toHaveLength(5));
    expect(screen.getByText('Interview Practice')).toBeInTheDocument();
  });
});

describe('Tree Detail: requests in live mode', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    useGroveStore.setState({ grove: mockGroveResponse, activeScreen: 'grove', isStreaming: false });
    vi.stubEnv('VITE_MOCK', '0');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('sends the contract PATCH when Confirm is clicked and applies the server’s answer', async () => {
    const contract = claimsContract.examples.find((e) => e.name.startsWith('confirm'))!;
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => contract.response.body });

    const { container } = render(<App />);
    click(container, '[data-stone-kind="mossy"]');
    fireEvent.click(claimRow(mossy.id).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url).endsWith(contract.request.path)).toBe(true);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ action: 'confirm' });

    await waitFor(() => expect(claimRow(mossy.id).getByText('Stated')).toBeInTheDocument());
    // The server's evidence replaces the old list: the confirming note comes first.
    expect(claimRow(mossy.id).getByText('user confirmed this decision')).toBeInTheDocument();
  });
});
