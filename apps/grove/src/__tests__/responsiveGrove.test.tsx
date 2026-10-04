import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EnchantedBackdrop } from '../landing/EnchantedBackdrop';
import { Landing } from '../landing/Landing';
import { GUIDE_STEPS } from '../lib/guideGrove';
import { mockGroveResponse } from '../mocks/mockData';
import { GroveGuide } from '../screens/GroveGuide';
import { computeGroveLayout, wrapText, type GroveLayout, type TreeLayout } from '../viz/layout';
import { renderGrove } from '../viz/render';
import type { GroveResponse, GroveTab, TreeData } from '../types';

const grove = mockGroveResponse;

/** A tree like the first one, with the given number of tabs spread over the given paths. */
function treeWith(ref: string, name: string, tabCount: number, labels: string[]): TreeData {
  const [template] = grove.trees;
  const tabs: GroveTab[] = Array.from({ length: tabCount }, (_, i) => ({
    ...template.tabs[0],
    tab_ref: `${ref}-t${i}`,
    title: `Tab ${i}`,
    dwell_minutes: i % 5,
  }));
  return {
    ...template,
    cluster_ref: ref,
    project: { ...template.project, id: ref, name },
    tabs,
    branches: labels.map((label, b) => ({
      branch_ref: `${ref}-b${b}`,
      label,
      status: 'active' as const,
      tab_refs: tabs.filter((_, i) => i % labels.length === b).map((tab) => tab.tab_ref),
    })),
    redundant_groups: [],
    shared_tab_refs: [],
    unresolved_questions: [],
    decisions: [],
    hypotheses: [],
  };
}

// The grove from the screenshot that showed the problems: long names, many paths, many tabs.
const crowded: GroveResponse = {
  ...grove,
  past_connections: [],
  trees: [
    treeWith('c1', 'Tabforest Cloud Deployment', 17, [
      'Tiger Cloud account setup and management',
      'Azure cloud services usage',
      'Tabforest project development',
      'Related informational and motivational tabs',
    ]),
    treeWith('c2', 'GirlHacks Event Participation and Preparation', 21, [
      'GirlHacks Event Info and Logistics',
      'MLH Partner and Developer Resources',
      'NJIT Fitness and Imleagues',
      'Student Verification',
      'Learning Platforms and Multiplayer Game Creation',
      'Azure for Students',
    ]),
    treeWith('c3', 'Student Verification and Offers', 8, ['Student Offers and FAQs', 'Student Verification']),
  ],
};

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
const touch = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

function labelBoxes(tree: TreeLayout): Box[] {
  return tree.branches
    .filter((branch) => branch.labelLines.length > 0)
    .map((branch) => {
      const width = Math.max(...branch.labelLines.map((line) => line.length)) * 6.9;
      const left =
        branch.labelAnchor === 'start'
          ? branch.labelAt.x
          : branch.labelAnchor === 'end'
            ? branch.labelAt.x - width
            : branch.labelAt.x - width / 2;
      const top = branch.labelAt.y - 11;
      return { left, right: left + width, top, bottom: top + branch.labelLines.length * 15 };
    });
}
const leafBoxes = (tree: TreeLayout): Box[] =>
  tree.branches.flatMap((branch) =>
    branch.leaves.map((leaf) => ({ left: leaf.x - 6, right: leaf.x + 6, top: leaf.y - 6, bottom: leaf.y + 6 }))
  );
const allTrees = (layout: GroveLayout) => layout.trees;

describe('wrapText', () => {
  it('breaks at spaces and keeps every word', () => {
    const text = 'Learning Platforms and Multiplayer Game Creation';
    const lines = wrapText(text, 22);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe(text);
    lines.forEach((line) => expect(line.length).toBeLessThanOrEqual(22));
    expect(wrapText('Short', 22)).toEqual(['Short']);
    expect(wrapText('', 22)).toEqual([]);
  });
});

describe('text never collides', () => {
  it('keeps every word of long path labels and tree names', () => {
    const layout = computeGroveLayout(crowded);
    layout.trees.forEach((tree, i) => {
      expect(tree.nameLines.join(' ')).toBe(crowded.trees[i].project.name);
      tree.branches.forEach((branch, b) => {
        expect(branch.labelLines.join(' ')).toBe(crowded.trees[i].branches[b].label);
      });
    });
    expect(layout.trees[1].nameLines.length).toBeGreaterThan(1);
  });

  it.each([
    ['the crowded grove', crowded],
    ['the sample grove', grove],
  ])('no path label touches another label or a leaf in %s', (_, source) => {
    for (const tree of allTrees(computeGroveLayout(source))) {
      const labels = labelBoxes(tree);
      labels.forEach((box, i) => {
        labels.slice(i + 1).forEach((other) => expect(touch(box, other)).toBe(false));
        leafBoxes(tree).forEach((leaf) => expect(touch(box, leaf)).toBe(false));
      });
    }
  });

  it('gives each tree room for its name, the line under it and its labels, so neighbours never overlap', () => {
    for (const maxWidth of [undefined, 1100, 700, 390]) {
      const layout = computeGroveLayout(crowded, { maxWidth });
      for (const row of layout.rows) {
        const inRow = layout.trees.filter((tree) => tree.groundY === row.groundY).sort((a, b) => a.x - b.x);
        inRow.slice(1).forEach((tree, i) => {
          const before = inRow[i];
          expect(before.x + before.halfWidth).toBeLessThanOrEqual(tree.x - tree.halfWidth);
        });
        inRow.forEach((tree) => {
          expect(tree.halfWidth).toBeGreaterThanOrEqual(tree.reach);
          labelBoxes(tree).forEach((box) => {
            expect(box.left).toBeGreaterThanOrEqual(tree.x - tree.halfWidth);
            expect(box.right).toBeLessThanOrEqual(tree.x + tree.halfWidth);
          });
        });
      }
    }
  });

  it('never runs a vine from the canopy down to a leaf on the ground', () => {
    const [first, ...rest] = grove.trees;
    const group = first.redundant_groups[0];
    const fallenRef = group.tab_refs.find((ref) => ref !== group.keep_ref)!;
    const withFallen: GroveResponse = {
      ...grove,
      trees: [{ ...first, tabs: first.tabs.map((tab) => (tab.tab_ref === fallenRef ? { ...tab, fallen: true } : tab)) }, ...rest],
    };
    const tree = computeGroveLayout(withFallen).trees[0];
    const fallen = tree.fallenLeaves.find((leaf) => leaf.tabRef === fallenRef)!;
    for (const vine of tree.vines) {
      expect(vine.path).not.toContain(`${fallen.x},${fallen.y}`);
    }
  });
});

describe('tree and leaf size', () => {
  const sized = (count: number) =>
    computeGroveLayout({ ...crowded, trees: [treeWith('s', 'Sized', count, ['One', 'Two'])] }).trees[0];
  const canopy = (count: number) => sized(count).canopy[0].r;

  it('grows the tree with its tabs, between a smallest and a largest size', () => {
    expect(canopy(2)).toBe(canopy(3));
    expect(canopy(8)).toBeGreaterThan(canopy(3));
    expect(canopy(17)).toBeGreaterThan(canopy(8));
    expect(canopy(60)).toBe(canopy(25));
    expect(canopy(60) / canopy(2)).toBeLessThan(2.4);
  });

  it('keeps every leaf the same size whatever the size of its tree', () => {
    const sizes = new Set(
      [3, 8, 17, 40].flatMap((count) => sized(count).branches.flatMap((branch) => branch.leaves.map((leaf) => leaf.length)))
    );
    expect(sizes.size).toBe(1);
    const everywhere = computeGroveLayout(grove);
    const patchLeaves = [...everywhere.sprouts.flatMap((s) => s.leaves), ...(everywhere.meadow?.leaves ?? []), ...(everywhere.fog?.leaves ?? [])];
    patchLeaves.forEach((leaf) => expect(sizes.has(leaf.length)).toBe(true));
  });
});

describe('responsive rows', () => {
  it('stands in one row when there is room', () => {
    const layout = computeGroveLayout(crowded);
    expect(layout.rows).toHaveLength(1);
    expect(new Set(layout.trees.map((tree) => tree.groundY)).size).toBe(1);
    expect(computeGroveLayout(crowded, { maxWidth: layout.width + 200 }).rows).toHaveLength(1);
  });

  it('wraps onto more rows as the space narrows, at the same size, never wider than the space', () => {
    const natural = computeGroveLayout(crowded);
    const tablet = computeGroveLayout(crowded, { maxWidth: 768 });
    const phone = computeGroveLayout(crowded, { maxWidth: 520 });

    expect(tablet.rows.length).toBeGreaterThan(1);
    expect(phone.rows.length).toBeGreaterThanOrEqual(tablet.rows.length);
    expect(tablet.height).toBeGreaterThan(natural.height);

    // Trees are re-placed, not shrunk: same canopy, same leaves.
    tablet.trees.forEach((tree, i) => {
      expect(tree.canopy[0].r).toBe(natural.trees[i].canopy[0].r);
      expect(tree.leafCount).toBe(natural.trees[i].leafCount);
    });
    for (const layout of [tablet, phone]) {
      layout.trees.forEach((tree) => {
        const widest = Math.max(...layout.trees.map((t) => t.halfWidth * 2 + 56));
        expect(layout.width).toBeLessThanOrEqual(Math.max(widest, layout === tablet ? 768 : 520));
        expect(tree.x - tree.halfWidth).toBeGreaterThanOrEqual(0);
        expect(tree.x + tree.halfWidth).toBeLessThanOrEqual(layout.width);
      });
    }
  });

  it('stacks rows without overlap, each tree standing inside its own row', () => {
    const layout = computeGroveLayout(crowded, { maxWidth: 600 });
    layout.rows.slice(1).forEach((row, i) => expect(row.top).toBe(layout.rows[i].bottom));
    expect(layout.height).toBe(layout.rows[layout.rows.length - 1].bottom);
    for (const tree of layout.trees) {
      const row = layout.rows.find((item) => item.groundY === tree.groundY)!;
      expect(tree.top).toBeGreaterThanOrEqual(row.top);
      expect(tree.crown.y).toBeLessThan(tree.groundY);
      tree.fallenLeaves.forEach((leaf) => expect(leaf.y).toBeLessThan(row.bottom));
    }
  });

  it('keeps every tab and every relationship when it wraps', () => {
    const natural = computeGroveLayout(grove);
    const wrapped = computeGroveLayout(grove, { maxWidth: 600 });
    const refs = (layout: GroveLayout) =>
      layout.trees.map((tree) => tree.branches.map((branch) => branch.leaves.map((leaf) => leaf.tabRef)));
    expect(refs(wrapped)).toEqual(refs(natural));
    expect(wrapped.sharedVines.map((vine) => vine.tabRef)).toEqual(natural.sharedVines.map((vine) => vine.tabRef));
    expect(wrapped.meadow?.leaves.length).toBe(natural.meadow?.leaves.length);
    expect(wrapped.fog?.leaves.length).toBe(natural.fog?.leaves.length);
    expect(wrapped.sprouts.length).toBe(natural.sprouts.length);
  });

  it('draws a ground line for every row and writes wrapped names line by line', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const layout = computeGroveLayout(crowded, { maxWidth: 600 });
    renderGrove(svg, layout);
    expect(svg.querySelectorAll('[data-kind="ground"]')).toHaveLength(layout.rows.length);
    expect(svg.querySelectorAll('[data-kind="tree"]')).toHaveLength(3);
    const second = svg.querySelectorAll('[data-kind="tree"]')[1];
    const lines = [...second.querySelectorAll(':scope > text:not([data-kind])')].map((node) => node.textContent);
    expect(lines.slice(0, layout.trees[1].nameLines.length)).toEqual(layout.trees[1].nameLines);
    const label = second.querySelector('[data-kind="branch-label"]') as SVGTextElement;
    expect(['start', 'middle', 'end']).toContain(label.getAttribute('text-anchor'));
  });
});

describe('the tour is a centred dialog', () => {
  it('is a modal dialog with its steps, a progress indicator and a close control', () => {
    const onDone = vi.fn();
    const { container } = render(<GroveGuide onDone={onDone} />);
    const dialog = screen.getByRole('dialog', { name: 'How to read your grove' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(container.querySelector('[data-kind="guide-backdrop"]')?.className).toContain('fixed');
    // About 58% of a desktop screen, nearly all of a phone's, with a largest width.
    expect(dialog.className).toContain('lg:w-[58vw]');
    expect(dialog.className).toContain('w-[94vw]');
    expect(dialog.className).toContain('max-w-[1040px]');
    expect(container.querySelectorAll('[data-kind="guide-progress"] li')).toHaveLength(GUIDE_STEPS.length);

    // Same content as before.
    expect(screen.getByText(GUIDE_STEPS[0].browser)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip the tour' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close the tour' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    const onDone = vi.fn();
    render(<GroveGuide onDone={onDone} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe('the enchanted backdrop', () => {
  it('is a few quiet leaves and fireflies, hidden from assistive technology and from the pointer', () => {
    const { container } = render(<EnchantedBackdrop />);
    const backdrop = container.querySelector('[data-kind="enchanted-backdrop"]') as HTMLElement;
    expect(backdrop).toHaveAttribute('aria-hidden', 'true');
    expect(backdrop.className).toContain('pointer-events-none');
    expect(container.querySelectorAll('.enchanted-leaf').length).toBeLessThanOrEqual(8);
    expect(container.querySelectorAll('.enchanted-fly').length).toBeLessThanOrEqual(10);
    // Slow: no leaf takes less than 20 seconds to fall.
    container.querySelectorAll<HTMLElement>('.enchanted-leaf').forEach((leaf) => {
      expect(parseFloat(leaf.style.animationDuration)).toBeGreaterThanOrEqual(20);
    });
  });

  it('sits behind the landing page and holds still for reduced motion', () => {
    const { container } = render(<Landing />);
    expect(container.querySelector('[data-kind="enchanted-backdrop"]')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('You opened those tabs for a reason.');
    const styles = readFileSync(resolve(__dirname, '../index.css'), 'utf-8');
    const reduced = styles.slice(styles.lastIndexOf('.enchanted-leaf {\n    display: none;') - 60);
    expect(reduced).toContain('prefers-reduced-motion: reduce');
    expect(reduced).toMatch(/\.enchanted-fly \{\s*animation: none;/);
  });
});
