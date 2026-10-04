import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import degradedContract from '@contracts/grove.degraded.example.json';
import { computeGroveLayout, fogOpacityFor } from '../viz/layout';
import { describeSelection, type GroveSelection } from '../viz/selection';
import { GroveCanvas } from '../viz/GroveCanvas';
import { App } from '../App';
import { normalizeGrove, type WireGrove } from '../adapters/groveContract';
import { mockGroveResponse } from '../mocks/mockData';
import { useGroveStore } from '../store/useGroveStore';
import type { GroveResponse } from '../types';

const grove = mockGroveResponse;
const layout = computeGroveLayout(grove);
const [auth, prep, jobs] = grove.trees;
const [authLayout, prepLayout, jobsLayout] = layout.trees;

const click = (container: HTMLElement, selector: string, index = 0) => {
  const node = container.querySelectorAll(selector)[index];
  if (!node) throw new Error(`nothing matches ${selector}`);
  fireEvent.click(node);
  return node;
};

describe('forest elements: layout', () => {
  it('grows a mushroom per open question, sized by how often it recurred', () => {
    const open = auth.unresolved_questions.filter((q) => q.status === 'open');
    const mushrooms = authLayout.mushrooms.filter((m) => !m.resolved);
    expect(mushrooms.map((m) => m.id)).toEqual(open.map((q) => q.id));
    expect(mushrooms[0].recurrence).toBe(open[0].recurrence_count);

    const withMore: GroveResponse = {
      ...grove,
      trees: [
        {
          ...auth,
          unresolved_questions: [
            { ...open[0], id: 'rare', recurrence_count: 1 },
            { ...open[0], id: 'often', recurrence_count: 5 },
          ],
        },
        ...grove.trees.slice(1),
      ],
    };
    const [rare, often] = computeGroveLayout(withMore).trees[0].mushrooms;
    expect(often.capRadius).toBeGreaterThan(rare.capRadius);
  });

  it('blooms a resolved question into a flower', () => {
    expect(prep.unresolved_questions[0].status).toBe('resolved');
    expect(prepLayout.mushrooms[0].resolved).toBe(true);
  });

  it('carves stated or sourced decisions and leaves inferred ones mossy', () => {
    expect(authLayout.stones.map((stone) => stone.kind)).toEqual(['carved', 'mossy']);

    const withoutKind: GroveResponse = {
      ...grove,
      trees: [
        {
          ...auth,
          decisions: [
            { ...auth.decisions[0], stone_kind: undefined, provenance: 'sourced' },
            { ...auth.decisions[0], id: 'd2', stone_kind: undefined, provenance: 'inferred' },
          ],
        },
        ...grove.trees.slice(1),
      ],
    };
    expect(computeGroveLayout(withoutKind).trees[0].stones.map((stone) => stone.kind)).toEqual([
      'carved',
      'mossy',
    ]);
  });

  it('draws a vine per redundant group and marks exact duplicates', () => {
    expect(authLayout.vines).toHaveLength(auth.redundant_groups.length);
    expect(authLayout.vines.map((vine) => vine.exact)).toEqual(
      auth.redundant_groups.map((group) => group.is_exact_dup === true)
    );
    for (const vine of authLayout.vines) {
      expect(vine.path).toMatch(/^M[\d.,-]+Q/);
      expect(vine.tabRefs.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('lays fallen leaves on the ground, off their branch', () => {
    const fallen = jobs.tabs.filter((tab) => tab.fallen);
    expect(fallen.length).toBeGreaterThan(0);
    expect(jobsLayout.fallenLeaves).toHaveLength(fallen.length);
    for (const leaf of jobsLayout.fallenLeaves) {
      expect(leaf.y).toBeGreaterThan(layout.groundY - 10);
      expect(Math.abs(leaf.x - jobsLayout.x)).toBeLessThanOrEqual(jobsLayout.halfWidth);
    }
    const attached = jobsLayout.branches.flatMap((branch) => branch.leaves);
    expect(attached.some((leaf) => fallen.some((tab) => tab.tab_ref === leaf.tabRef))).toBe(false);
  });

  it('keeps ground elements clear of each other and of the trunk', () => {
    for (const tree of layout.trees) {
      const spans = [
        ...tree.mushrooms.map((m) => [m.x - m.capRadius, m.x + m.capRadius]),
        ...tree.stones.map((s) => [s.x - 14, s.x + 14]),
        ...tree.fallenLeaves.map((l) => [l.x, l.x + l.length]),
        [tree.x - tree.trunkWidth / 2, tree.x + tree.trunkWidth / 2],
      ].sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < spans.length; i++) {
        expect(spans[i][0]).toBeGreaterThanOrEqual(spans[i - 1][1]);
      }
    }
  });

  it('places a firefly on the tree that links to past research', () => {
    const connection = grove.past_connections?.[0];
    expect(connection).toBeDefined();
    const owner = layout.trees.find((tree) => tree.id === connection?.tree_cluster_ref);
    expect(owner?.fireflies).toHaveLength(1);
    expect(owner?.fireflies[0].text).toBe(connection?.summary);
    expect(layout.trees.filter((tree) => tree.fireflies.length > 0)).toHaveLength(1);
  });

  it('joins a tab shared by two trees with one faint vine', () => {
    expect(layout.sharedVines).toHaveLength(1);
    const [vine] = layout.sharedVines;
    expect(auth.shared_tab_refs).toContain(vine.tabRef);
    expect(vine.treeIds).toEqual([auth.cluster_ref, prep.cluster_ref]);
  });

  it('makes fog denser the lower the confidence', () => {
    expect(fogOpacityFor(0.2)).toBeGreaterThan(fogOpacityFor(0.45));
    expect(fogOpacityFor(0.45)).toBeGreaterThan(fogOpacityFor(0.59));
    expect(authLayout.hypotheses[0].opacity).toBe(fogOpacityFor(auth.hypotheses[0].confidence));
  });

  it('leaves confident trees clear and fogs every tree of a degraded grove', () => {
    expect(layout.trees.every((tree) => tree.fogOpacity === 0)).toBe(true);

    const degraded = normalizeGrove(degradedContract as WireGrove);
    const fogged = computeGroveLayout(degraded).trees;
    expect(fogged.every((tree) => tree.fogOpacity > 0)).toBe(true);
    expect(fogged[0].fogOpacity).toBe(fogOpacityFor(degraded.trees[0].goal.confidence));
  });

  it('keeps everything inside the canvas', () => {
    for (const tree of layout.trees) {
      for (const point of [...tree.hypotheses, ...tree.fireflies]) {
        expect(point.y).toBeGreaterThan(0);
        expect(point.x).toBeGreaterThan(0);
        expect(point.x).toBeLessThan(layout.width);
      }
    }
  });
});

describe('forest elements: canvas', () => {
  const kinds: Array<[string, number]> = [
    ['mushroom', 1],
    ['flower', 1],
    ['stone', 2],
    ['vine', 2],
    ['fallen-leaf', 3],
    ['hypothesis', 1],
    ['firefly', 1],
    ['shared-vine', 1],
  ];

  it.each(kinds)('draws %s elements from the contract grove', (kind, count) => {
    const { container } = render(<GroveCanvas grove={grove} />);
    expect(container.querySelectorAll(`[data-kind="${kind}"]`)).toHaveLength(count);
  });

  it('tells carved and mossy stones apart by outline, not only by color', () => {
    const { container } = render(<GroveCanvas grove={grove} />);
    const carved = container.querySelector('[data-stone-kind="carved"] path');
    const mossy = container.querySelector('[data-stone-kind="mossy"] path');
    expect(carved?.getAttribute('stroke-dasharray')).toBeNull();
    expect(mossy?.getAttribute('stroke-dasharray')).toBeTruthy();
  });

  it('draws the exact-duplicate vine thicker than the semantic one', () => {
    const { container } = render(<GroveCanvas grove={grove} />);
    const width = (kind: string) =>
      Number(
        container
          .querySelector(`[data-vine-kind="${kind}"] path:last-of-type`)
          ?.getAttribute('stroke-width')
      );
    expect(width('exact')).toBeGreaterThan(width('semantic'));
  });

  it('gives every clickable element a tooltip', () => {
    const { container } = render(<GroveCanvas grove={grove} />);
    const clickable = container.querySelectorAll('[data-select-kind]');
    expect(clickable.length).toBeGreaterThan(40);
    for (const node of clickable) {
      const title = node.querySelector(':scope > title');
      expect(title?.textContent, node.getAttribute('data-select-kind') ?? '').toBeTruthy();
    }
  });

  it('names each element kind in its tooltip, so meaning never rests on color', () => {
    const { container } = render(<GroveCanvas grove={grove} />);
    const title = (selector: string) =>
      container.querySelector(`${selector} > title`)?.textContent ?? '';
    expect(title('[data-kind="mushroom"]')).toMatch(/^Open question · .+ · came up 4 times$/);
    expect(title('[data-kind="flower"]')).toMatch(/^Resolved question · /);
    expect(title('[data-stone-kind="carved"]')).toMatch(/^Decision you stated or sourced · /);
    expect(title('[data-stone-kind="mossy"]')).toMatch(/^Inferred decision · /);
    expect(title('[data-vine-kind="exact"]')).toMatch(/^Exact duplicates · /);
    expect(title('[data-vine-kind="semantic"]')).toMatch(/^Overlapping sources · /);
    expect(title('[data-kind="fallen-leaf"]')).toMatch(/^Stale tab · /);
    expect(title('[data-kind="hypothesis"]')).toMatch(/^Maybe: .+ · confidence 0\.41$/);
    expect(title('[data-kind="firefly"]')).toMatch(/^Past research · You researched this on/);
    expect(title('[data-kind="shared-vine"]')).toMatch(/^Shared tab · .+ · serves two goals$/);
  });

  it('reports each kind of element when it is clicked', () => {
    const onSelect = vi.fn();
    const { container } = render(<GroveCanvas grove={grove} onSelect={onSelect} />);
    const expectations: Array<[string, Partial<GroveSelection>]> = [
      ['[data-kind="mushroom"]', { kind: 'mushroom', treeId: auth.cluster_ref }],
      ['[data-kind="flower"]', { kind: 'flower', treeId: prep.cluster_ref }],
      ['[data-kind="stone"]', { kind: 'stone', id: auth.decisions[0].id }],
      ['[data-kind="vine"]', { kind: 'vine', treeId: auth.cluster_ref }],
      ['[data-kind="fallen-leaf"]', { kind: 'fallen-leaf', treeId: jobs.cluster_ref }],
      ['[data-kind="hypothesis"]', { kind: 'hypothesis', treeId: auth.cluster_ref }],
      ['[data-kind="firefly"]', { kind: 'firefly', treeId: auth.cluster_ref }],
      ['[data-kind="shared-vine"]', { kind: 'shared-vine' }],
      ['[data-kind="tree"] [data-kind="leaf"]', { kind: 'leaf', treeId: auth.cluster_ref }],
      ['[data-kind="branch"] > path', { kind: 'branch', treeId: auth.cluster_ref }],
      ['[data-kind="trunk"]', { kind: 'tree', id: auth.cluster_ref }],
      ['[data-kind="meadow"] [data-kind="leaf"]', { kind: 'leaf', treeId: undefined }],
      ['[data-kind="sprout"] > text', { kind: 'sprout' }],
    ];
    for (const [selector, expected] of expectations) {
      onSelect.mockClear();
      click(container, selector);
      // One report per click: the element itself, never also the tree behind it.
      expect(onSelect, selector).toHaveBeenCalledTimes(1);
      expect(onSelect.mock.calls[0][0], selector).toMatchObject(expected);
    }
  });

  it('clears the selection when empty ground is clicked', () => {
    const onSelect = vi.fn();
    const { container } = render(<GroveCanvas grove={grove} onSelect={onSelect} />);
    click(container, 'svg');
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('marks only the selected element, on the clicked tree', () => {
    const tabRef = layout.sharedVines[0].tabRef;
    const { container } = render(
      <GroveCanvas grove={grove} selected={{ kind: 'leaf', id: tabRef, treeId: prep.cluster_ref }} />
    );
    const marked = container.querySelectorAll('[data-selected="true"]');
    expect(marked).toHaveLength(1);
    expect(marked[0].closest('[data-tree-id]')?.getAttribute('data-tree-id')).toBe(prep.cluster_ref);
  });

  it('keeps the zoom when the selection changes', () => {
    const { container, rerender } = render(<GroveCanvas grove={grove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    const before = container.querySelector('[data-kind="grove-root"]')?.getAttribute('transform');
    rerender(
      <GroveCanvas grove={grove} selected={{ kind: 'tree', id: auth.cluster_ref, treeId: auth.cluster_ref }} onSelect={() => {}} />
    );
    expect(container.querySelector('[data-kind="grove-root"]')?.getAttribute('transform')).toBe(
      before
    );
  });

  it('fogs every tree of a degraded grove', () => {
    const degraded = normalizeGrove(degradedContract as WireGrove);
    const { container } = render(<GroveCanvas grove={degraded} />);
    const fog = container.querySelectorAll('[data-kind="tree-fog"]');
    expect(fog).toHaveLength(degraded.trees.length);
    expect(Number(fog[0].getAttribute('data-opacity'))).toBe(fogOpacityFor(0.45));
  });

  it('renders hostile claim text as text', () => {
    const hostile = '<img src=x onerror="alert(1)">';
    const { container } = render(
      <GroveCanvas
        grove={{
          ...grove,
          trees: [
            {
              ...auth,
              decisions: auth.decisions.map((d) => ({ ...d, text: hostile, display_text: hostile })),
              redundant_groups: auth.redundant_groups.map((g) => ({ ...g, reason: hostile })),
            },
            ...grove.trees.slice(1),
          ],
        }}
      />
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-kind="stone"] > title')?.textContent).toContain(hostile);
  });
});

describe('describeSelection', () => {
  const describeIt = (selection: GroveSelection) => describeSelection(grove, selection);

  it('describes claims with their evidence', () => {
    const question = auth.unresolved_questions[0];
    const mushroom = describeIt({ kind: 'mushroom', id: question.id, treeId: auth.cluster_ref });
    expect(mushroom?.label).toBe('Open question');
    expect(mushroom?.text).toBe(question.display_text);
    expect(mushroom?.claim?.evidence).toEqual(question.evidence);

    const stone = describeIt({ kind: 'stone', id: auth.decisions[1].id, treeId: auth.cluster_ref });
    expect(stone?.claim?.provenance).toBe('inferred');

    const hypothesis = describeIt({
      kind: 'hypothesis',
      id: authLayout.hypotheses[0].id,
      treeId: auth.cluster_ref,
    });
    expect(hypothesis?.text).toMatch(/^Maybe: /);
    expect(hypothesis?.claim?.provenance).toBe('hypothesis');

    const goal = describeIt({ kind: 'tree', id: auth.cluster_ref, treeId: auth.cluster_ref });
    expect(goal?.claim?.kind).toBe('Goal');
  });

  it('gives the answer of a resolved question', () => {
    const question = prep.unresolved_questions[0];
    const flower = describeIt({ kind: 'flower', id: question.id, treeId: prep.cluster_ref });
    expect(flower?.label).toBe('Resolved question');
    expect(flower?.detail).toBe(question.answer);
  });

  it('describes vines, fireflies, shared tabs and leaves without a claim', () => {
    const exact = authLayout.vines.find((vine) => vine.exact);
    const vine = describeIt({ kind: 'vine', id: exact?.id ?? '', treeId: auth.cluster_ref });
    expect(vine?.label).toBe('Exact duplicates');
    expect(vine?.claim).toBeUndefined();

    const firefly = describeIt({
      kind: 'firefly',
      id: authLayout.fireflies[0].id,
      treeId: auth.cluster_ref,
    });
    expect(firefly?.text).toBe(grove.past_connections?.[0].summary);

    const shared = describeIt({ kind: 'shared-vine', id: layout.sharedVines[0].tabRef });
    expect(shared?.detail).toBe(`Serves ${auth.project.name} and ${prep.project.name}`);

    const fallen = jobs.tabs.find((tab) => tab.fallen);
    const stale = describeIt({
      kind: 'fallen-leaf',
      id: fallen?.tab_ref ?? '',
      treeId: jobs.cluster_ref,
    });
    expect(stale?.label).toBe('Stale tab');
    expect(stale?.text).toBe(fallen?.title);
  });

  it('describes loose tabs and patches', () => {
    const fogTab = grove.fog?.[0];
    const unclear = describeIt({ kind: 'leaf', id: fogTab?.tab.tab_ref ?? '' });
    expect(unclear?.label).toBe('Unclear tab');
    expect(unclear?.detail).toBe(fogTab?.reason);

    expect(describeIt({ kind: 'leaf', id: grove.meadow.tabs[0].tab_ref })?.text).toBe(
      grove.meadow.tabs[0].title
    );
    expect(describeIt({ kind: 'meadow', id: 'meadow' })?.label).toBe('Wildflower Meadow');
    expect(describeIt({ kind: 'sprout', id: grove.sprouts[0].sprout_ref })?.text).toBe(
      grove.sprouts[0].label
    );
  });

  it('returns null for something that is not in the grove', () => {
    expect(describeIt({ kind: 'stone', id: 'missing', treeId: auth.cluster_ref })).toBeNull();
    expect(describeIt({ kind: 'leaf', id: 'missing', treeId: 'no-such-tree' })).toBeNull();
    expect(describeIt({ kind: 'leaf', id: 'missing' })).toBeNull();
  });
});

describe('Current Grove: clicking the canvas', () => {
  beforeEach(() => {
    useGroveStore.setState({ grove: mockGroveResponse, activeScreen: 'grove', isStreaming: false });
  });

  it('opens the evidence drawer for a mushroom', () => {
    const { container } = render(<App />);
    click(container, '[data-kind="mushroom"]');
    const drawer = screen.getByRole('complementary', { name: 'Evidence' });
    expect(within(drawer).getByText('Open question')).toBeInTheDocument();
    expect(
      within(drawer).getByText(auth.unresolved_questions[0].display_text ?? '')
    ).toBeInTheDocument();
  });

  it('names a non-claim element in the caption and closes the drawer', () => {
    const { container } = render(<App />);
    click(container, '[data-kind="stone"]');
    expect(screen.getByRole('complementary', { name: 'Evidence' })).toBeInTheDocument();

    click(container, '[data-kind="firefly"]');
    expect(screen.queryByRole('complementary', { name: 'Evidence' })).not.toBeInTheDocument();
    const caption = screen.getByRole('status');
    expect(within(caption).getByText('Past research')).toBeInTheDocument();
    expect(within(caption).getByText(/You researched this on/)).toBeInTheDocument();
  });

  it('clears the caption when empty ground is clicked', () => {
    const { container } = render(<App />);
    click(container, '[data-kind="fallen-leaf"]');
    expect(screen.getByRole('status')).toBeInTheDocument();
    click(container, 'svg[role="img"]');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
