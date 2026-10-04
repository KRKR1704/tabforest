import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { computeGroveLayout } from '../viz/layout';
import { GroveCanvas } from '../viz/GroveCanvas';
import { mockGroveResponse } from '../mocks/mockData';
import type { GroveResponse } from '../types';

const grove = mockGroveResponse;
const layout = computeGroveLayout(grove);

describe('computeGroveLayout', () => {
  it('lays out one tree per goal, plus meadow, fog and sprouts', () => {
    expect(layout.trees).toHaveLength(4);
    expect(layout.trees.map((tree) => tree.name)).toEqual(grove.trees.map((t) => t.project.name));
    expect(layout.meadow?.leaves).toHaveLength(grove.meadow.tabs.length);
    expect(layout.fog?.leaves).toHaveLength(grove.fog?.length ?? 0);
    expect(layout.fog?.label).toBe('Unclear');
    expect(layout.sprouts).toHaveLength(grove.sprouts.length);
  });

  it('gives every tab exactly one leaf: on its own branch, or on the ground if it has fallen', () => {
    layout.trees.forEach((tree, i) => {
      const source = grove.trees[i];
      const fallen = new Set(source.tabs.filter((tab) => tab.fallen).map((tab) => tab.tab_ref));
      expect(tree.leafCount).toBe(source.tabs.length);
      tree.branches.forEach((branch, b) => {
        expect(branch.label).toBe(source.branches[b].label);
        expect(branch.leaves.map((leaf) => leaf.tabRef)).toEqual(
          source.branches[b].tab_refs.filter((ref) => !fallen.has(ref))
        );
      });
      expect(new Set(tree.fallenLeaves.map((leaf) => leaf.tabRef))).toEqual(fallen);
    });
  });

  it('makes the trunk thicker the more attention a goal received', () => {
    const byAttention = [...layout.trees].sort((a, b) => a.attentionMinutes - b.attentionMinutes);
    for (let i = 1; i < byAttention.length; i++) {
      expect(byAttention[i].trunkWidth).toBeGreaterThan(byAttention[i - 1].trunkWidth);
    }
  });

  it('draws every leaf the same size, however long its tab was read', () => {
    const leaves = [
      ...layout.trees.flatMap((tree) => [...tree.branches.flatMap((branch) => branch.leaves), ...tree.fallenLeaves]),
      ...layout.sprouts.flatMap((sprout) => sprout.leaves),
      ...(layout.meadow?.leaves ?? []),
      ...(layout.fog?.leaves ?? []),
    ];
    expect(new Set(leaves.map((leaf) => leaf.dwellMinutes)).size).toBeGreaterThan(1);
    expect(new Set(leaves.map((leaf) => leaf.length))).toEqual(new Set([leaves[0].length]));
  });

  it('turns the canopy amber only for trees dormant 3+ days', () => {
    layout.trees.forEach((tree, i) => {
      expect(tree.dormant).toBe((grove.trees[i].days_since_active ?? 0) >= 3);
    });
    expect(layout.trees.filter((tree) => tree.dormant)).toHaveLength(1);
  });

  it('falls back to days since active, then status, when no canopy is sent', () => {
    const [first, second, ...rest] = grove.trees;
    const older: GroveResponse = {
      ...grove,
      trees: [
        { ...first, canopy: undefined, days_since_active: 5 },
        { ...second, canopy: undefined, days_since_active: undefined, status: 'dormant' },
        ...rest,
      ],
    };
    const result = computeGroveLayout(older);
    expect(result.trees[0].dormant).toBe(true);
    expect(result.trees[1].dormant).toBe(true);
  });

  it('keeps every piece of the grove inside the canvas without overlapping', () => {
    const spans = [
      ...layout.sprouts,
      ...layout.trees,
      ...(layout.meadow ? [layout.meadow] : []),
      ...(layout.fog ? [layout.fog] : []),
    ].map((item) => [item.x - item.halfWidth, item.x + item.halfWidth]);

    expect(spans[0][0]).toBeGreaterThanOrEqual(0);
    expect(spans[spans.length - 1][1]).toBeLessThanOrEqual(layout.width);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i][0]).toBeGreaterThanOrEqual(spans[i - 1][1]);
    }
  });

  it('puts sprouts at the edge, before the first tree', () => {
    expect(layout.sprouts[0].x).toBeLessThan(layout.trees[0].x);
  });

  it('keeps leaves above the ground and inside their tree', () => {
    for (const tree of layout.trees) {
      for (const leaf of tree.branches.flatMap((branch) => branch.leaves)) {
        expect(Number.isFinite(leaf.x) && Number.isFinite(leaf.y)).toBe(true);
        expect(leaf.y).toBeLessThan(layout.groundY);
        expect(leaf.y).toBeGreaterThan(0);
        expect(Math.abs(leaf.x - tree.x)).toBeLessThanOrEqual(tree.halfWidth);
      }
    }
  });

  it('handles a grove with no meadow, fog or sprouts', () => {
    const bare = computeGroveLayout({
      ...grove,
      meadow: { label: 'Wildflower Meadow', tabs: [] },
      fog: [],
      sprouts: [],
    });
    expect(bare.meadow).toBeNull();
    expect(bare.fog).toBeNull();
    expect(bare.sprouts).toEqual([]);
    expect(bare.trees).toHaveLength(4);
  });
});

describe('GroveCanvas', () => {
  const rootTransform = (container: HTMLElement) =>
    container.querySelector('[data-kind="grove-root"]')?.getAttribute('transform') ?? null;

  it('draws 4 trees, the meadow, the fog patch and the sprouts', () => {
    const { container } = render(<GroveCanvas grove={grove} />);
    expect(container.querySelectorAll('[data-kind="tree"]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-kind="meadow"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-kind="fog"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-kind="sprout"]')).toHaveLength(grove.sprouts.length);
    expect(screen.getByRole('img', { name: /Living Grove: 4 goals/ })).toBeInTheDocument();
  });

  it('draws one leaf per tab on the trees', () => {
    const { container } = render(<GroveCanvas grove={grove} />);
    const tabCount = grove.trees.reduce((total, tree) => total + tree.tabs.length, 0);
    expect(
      container.querySelectorAll(
        '[data-kind="tree"] [data-kind="leaf"], [data-kind="tree"] [data-kind="fallen-leaf"]'
      )
    ).toHaveLength(tabCount);
  });

  it('names every tree and writes dormancy in words, not color alone', () => {
    const { container } = render(<GroveCanvas grove={grove} />);
    for (const tree of grove.trees) {
      expect(screen.getByText(tree.project.name)).toBeInTheDocument();
    }
    const amber = container.querySelectorAll('[data-kind="tree"][data-canopy="amber"]');
    expect(amber).toHaveLength(1);
    expect(amber[0].textContent).toMatch(/dormant 4 days/);
  });

  it('marks open tabs differently from closed ones', () => {
    // Every tab in the contract example is open, so close one here.
    const [first, ...rest] = grove.trees;
    const [closedTab, ...openTabs] = first.tabs;
    const { container } = render(
      <GroveCanvas
        grove={{
          ...grove,
          trees: [{ ...first, tabs: [{ ...closedTab, is_open: false }, ...openTabs] }, ...rest],
        }}
      />
    );
    const open = container.querySelector('[data-kind="leaf"][data-open="true"]');
    const closed = container.querySelector('[data-kind="leaf"][data-open="false"]');
    expect(open?.getAttribute('stroke')).not.toBe('none');
    expect(closed?.getAttribute('stroke')).toBe('none');
  });

  it('zooms in, out and back with the controls', () => {
    const { container } = render(<GroveCanvas grove={grove} />);
    expect(rootTransform(container)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    const zoomedIn = rootTransform(container);
    expect(zoomedIn).toMatch(/scale\(1\.3\)/);

    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(rootTransform(container)).toMatch(/scale\(1\)/);

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(rootTransform(container)).toBe('translate(0,0) scale(1)');
  });

  it('does not zoom past its limits', () => {
    const { container } = render(<GroveCanvas grove={grove} />);
    for (let i = 0; i < 20; i++) fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(rootTransform(container)).toMatch(/scale\(4\)/);
  });

  it('renders page titles as text, never as markup', () => {
    const hostile = '<img src=x onerror="alert(1)">';
    const [first, ...rest] = grove.trees;
    const { container } = render(
      <GroveCanvas
        grove={{
          ...grove,
          trees: [
            {
              ...first,
              project: { ...first.project, name: hostile },
              tabs: first.tabs.map((tab) => ({ ...tab, title: hostile })),
            },
            ...rest,
          ],
        }}
      />
    );
    expect(container.querySelector('img')).toBeNull();
    // A name this long is written on two lines; read together they are still the text itself.
    const written = [...container.querySelectorAll('[data-kind="tree"] > text:not([data-kind])')]
      .map((node) => node.textContent)
      .join(' ');
    expect(written).toContain(hostile);
  });

  it('redraws when the grove changes', () => {
    const { container, rerender } = render(<GroveCanvas grove={grove} />);
    rerender(<GroveCanvas grove={{ ...grove, trees: grove.trees.slice(0, 2) }} />);
    expect(container.querySelectorAll('[data-kind="tree"]')).toHaveLength(2);
  });
});
