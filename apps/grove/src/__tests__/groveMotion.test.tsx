import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../App';
import { resetMockBridge } from '../adapters/bridge';
import { resetAccountStandIn } from '../adapters/me';
import { GUIDE_KEY, GUIDE_STEPS } from '../lib/guideGrove';
import { countGroveTabs } from '../lib/grove';
import { mockGroveResponse } from '../mocks/mockData';
import { GUIDE_PAUSE_MS, GroveGuide } from '../screens/GroveGuide';
import { useBridgeStore } from '../store/useBridgeStore';
import { useGroveStore } from '../store/useGroveStore';
import { GroveCanvas } from '../viz/GroveCanvas';
import { decorateGrove, findChanges, playChanges } from '../viz/groveMotion';
import { computeGroveLayout } from '../viz/layout';
import { groveMotionEnabled, setGroveMotion } from '../viz/motionSwitch';
import { renderGrove } from '../viz/render';
import type { GroveResponse } from '../types';

const step = (id: string) => GUIDE_STEPS.find((item) => item.id === id)!;
const layouts = (id: string) => ({
  before: computeGroveLayout(step(id).before),
  after: computeGroveLayout(step(id).after),
});
const changeOf = (id: string, treeRef: string) => {
  const { before, after } = layouts(id);
  return findChanges(before, after).trees.find((tree) => tree.id === treeRef)!;
};

const makeSvg = () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.appendChild(svg);
  return svg;
};
const drawn = (svg: SVGSVGElement) => new XMLSerializer().serializeToString(svg);
const freshDrawing = (grove: GroveResponse) => {
  const svg = makeSvg();
  renderGrove(svg, computeGroveLayout(grove));
  const markup = drawn(svg);
  svg.remove();
  return markup;
};
const setReducedMotion = (reduced: boolean) => {
  vi.mocked(window.matchMedia).mockImplementation(
    (query: string) => ({ matches: reduced, media: query }) as MediaQueryList
  );
};
const tabLeaves = (root: ParentNode) =>
  root.querySelectorAll('path[data-kind="leaf"], path[data-kind="fallen-leaf"]').length;

afterEach(() => {
  setGroveMotion(false);
  setReducedMotion(true);
  document.body.querySelectorAll('svg').forEach((svg) => svg.remove());
});

describe('the motion switch', () => {
  it('is off in tests unless a test turns it on, and can be flipped', () => {
    expect(groveMotionEnabled()).toBe(false);
    setGroveMotion(true);
    expect(groveMotionEnabled()).toBe(true);
  });

  it('off: the canvas is exactly the plain drawing, with nothing added', () => {
    const { container } = render(<GroveCanvas grove={mockGroveResponse} />);
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg.querySelector('[data-kind="decor"]')).toBeNull();
    expect(svg.querySelector('animateTransform')).toBeNull();
    const plain = makeSvg();
    renderGrove(plain, computeGroveLayout(mockGroveResponse));
    expect(svg.querySelectorAll('*').length).toBe(plain.querySelectorAll('*').length);
  });

  it('on: depth is added, and idle movement too unless the user asks for reduced motion', () => {
    setGroveMotion(true);
    const still = render(<GroveCanvas grove={mockGroveResponse} />);
    expect(still.container.querySelector('[data-decor="far"]')).not.toBeNull();
    expect(still.container.querySelector('animateTransform')).toBeNull();
    still.unmount();

    setReducedMotion(false);
    const moving = render(<GroveCanvas grove={mockGroveResponse} />);
    expect(moving.container.querySelector('animateTransform')).not.toBeNull();
  });
});

describe('findChanges: what differs between two drawings', () => {
  it('finds nothing when the grove is the same', () => {
    const layout = computeGroveLayout(mockGroveResponse);
    const changes = findChanges(layout, layout);
    expect(changes.any).toBe(false);
    expect(changes.trees.every((tree) => !tree.changed && tree.shift === 0)).toBe(true);
  });

  it('a new tab is a new leaf', () => {
    const change = changeOf('leaf', 'guide-login');
    expect(change.leaves.get('g-l9')).toEqual({ kind: 'new' });
    expect(change.lost).toHaveLength(0);
  });

  it('more time is a thicker trunk, and nothing else on that tree', () => {
    const change = changeOf('trunk', 'guide-prep');
    expect(change.trunk).toBe(true);
    expect([...change.leaves.values()].filter((leaf) => leaf.kind !== 'moved')).toHaveLength(0);
    expect(change.mushrooms.size + change.stones.size).toBe(0);
  });

  it('a new direction is a new branch with new leaves', () => {
    const change = changeOf('branch', 'guide-login');
    expect([...change.newBranches]).toEqual(['guide-login-b3']);
    for (const ref of ['g-l10', 'g-l11', 'g-l12']) expect(change.leaves.get(ref)?.kind).toBe('new');
  });

  it('an open question is a new mushroom; answering it is a bloom', () => {
    expect(changeOf('mushroom', 'guide-prep').mushrooms.get('g-q1')).toBe('new');
    expect(changeOf('flower', 'guide-prep').mushrooms.get('g-q1')).toBe('bloomed');
  });

  it('confirming a decision carves its stone', () => {
    expect(changeOf('stone', 'guide-login').stones.get('g-d1')).toBe('carved');
  });

  it('a closed tab is a lost leaf', () => {
    const change = changeOf('duplicate', 'guide-login');
    expect(change.lost).toHaveLength(1);
    expect(change.leaves.has('g-l8')).toBe(false);
  });

  it('a moved tab flies from its old tree to its new one, and is not counted as lost', () => {
    const { before, after } = layouts('move');
    const changes = findChanges(before, after);
    const from = changes.trees.find((tree) => tree.id === 'guide-login')!;
    const to = changes.trees.find((tree) => tree.id === 'guide-prep')!;
    expect(from.lost).toHaveLength(0);
    const flew = to.leaves.get('g-l2');
    expect(flew?.kind).toBe('flew');
    const was = before.trees[0].branches.flatMap((branch) => branch.leaves).find((leaf) => leaf.tabRef === 'g-l2')!;
    expect(flew?.kind === 'flew' && flew.from.x).toBe(was.x);
  });

  it('a goal left alone goes dormant and its stale tabs fall; coming back wakes it', () => {
    const slept = changeOf('dormant', 'guide-job');
    expect(slept.dormancy).toBe('slept');
    expect(['g-j1', 'g-j2', 'g-j4'].map((ref) => slept.leaves.get(ref)?.kind)).toEqual(['fell', 'fell', 'fell']);

    const woke = changeOf('wake', 'guide-job');
    expect(woke.dormancy).toBe('woke');
    expect(['g-j1', 'g-j2', 'g-j4'].map((ref) => woke.leaves.get(ref)?.kind)).toEqual(['regrew', 'regrew', 'regrew']);
  });

  it('a sprout that becomes a goal is a tree that grows', () => {
    const change = changeOf('sprout', 'guide-rust');
    expect(change.grown).toBe(true);
  });

  it('a tree whose neighbour changed only moves over', () => {
    const { before, after } = layouts('branch');
    const neighbour = findChanges(before, after).trees.find((tree) => tree.id === 'guide-prep')!;
    expect(neighbour.changed).toBe(false);
    expect(neighbour.leaves.size).toBe(0);
  });

  it('leaves a tree that is still listening alone', () => {
    const grove = step('leaf').after;
    const listening = { ...grove, trees: grove.trees.map((tree, i) => (i === 0 ? { ...tree, pending: true } : tree)) };
    const changes = findChanges(computeGroveLayout(step('leaf').before), computeGroveLayout(listening));
    expect(changes.trees.some((tree) => tree.id === 'guide-login')).toBe(false);
  });
});

describe('playChanges', () => {
  it('does nothing when nothing changed', () => {
    const svg = makeSvg();
    const layout = computeGroveLayout(mockGroveResponse);
    renderGrove(svg, layout);
    expect(playChanges(svg, layout, layout)).toBeNull();
    expect(drawn(svg)).toBe(freshDrawing(mockGroveResponse));
  });

  it.each(GUIDE_STEPS.map((item) => [item.id, item] as const))(
    '%s: plays, and ends exactly on the drawn grove',
    async (_, item) => {
      const svg = makeSvg();
      const before = computeGroveLayout(item.before);
      const after = computeGroveLayout(item.after);
      renderGrove(svg, after);
      const settled = drawn(svg);
      const leavesDrawn = tabLeaves(svg);

      const motion = playChanges(svg, before, after, { timeScale: 0.02 });
      expect(motion).not.toBeNull();
      // While it plays, something is different from the still picture.
      expect(drawn(svg)).not.toBe(settled);
      // No tab leaf is added or removed by the animation itself.
      expect(tabLeaves(svg)).toBe(leavesDrawn);

      await waitFor(() => expect(drawn(svg)).toBe(settled), { timeout: 4000 });
    }
  );

  it('can be stopped midway, leaving the drawn grove', () => {
    const svg = makeSvg();
    const { before, after } = layouts('dormant');
    renderGrove(svg, after);
    const settled = drawn(svg);
    const motion = playChanges(svg, before, after);
    motion?.stop();
    expect(drawn(svg)).toBe(settled);
  });

  it('starts a new leaf closed, at its own place', () => {
    const svg = makeSvg();
    const { before, after } = layouts('leaf');
    renderGrove(svg, after);
    const motion = playChanges(svg, before, after);
    const leaf = svg.querySelector('[data-tab-ref="g-l9"]');
    expect(leaf?.getAttribute('transform')).toMatch(/scale\(0\.000\)$/);
    motion?.stop();
  });

  it('shows a closed tab falling as a leaf that is not a tab and cannot be clicked', () => {
    const svg = makeSvg();
    const { before, after } = layouts('duplicate');
    renderGrove(svg, after);
    const motion = playChanges(svg, before, after);
    const ghosts = svg.querySelectorAll('[data-kind="motion-ghost"]');
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0].getAttribute('pointer-events')).toBe('none');
    expect(ghosts[0].hasAttribute('data-select-kind')).toBe(false);
    expect(ghosts[0].hasAttribute('data-tab-ref')).toBe(false);
    motion?.stop();
    expect(svg.querySelector('[data-kind="motion-ghost"]')).toBeNull();
  });

  it('sheds loose leaves when a tree goes dormant; they are decoration, not tabs', () => {
    const svg = makeSvg();
    const { before, after } = layouts('dormant');
    renderGrove(svg, after);
    const leavesDrawn = tabLeaves(svg);
    const motion = playChanges(svg, before, after);
    const loose = svg.querySelectorAll('[data-kind="motion-decor"]');
    expect(loose.length).toBeGreaterThan(3);
    loose.forEach((leaf) => {
      expect(leaf.getAttribute('pointer-events')).toBe('none');
      expect(leaf.getAttribute('aria-hidden')).toBe('true');
    });
    expect(tabLeaves(svg)).toBe(leavesDrawn);
    expect(countGroveTabs(step('dormant').after)).toBe(countGroveTabs(step('dormant').before));
    motion?.stop();
  });
});

describe('decorateGrove: depth and idle life', () => {
  const decorated = (grove: GroveResponse, still: boolean) => {
    const svg = makeSvg();
    const layout = computeGroveLayout(grove);
    renderGrove(svg, layout);
    const motion = decorateGrove(svg, layout, { still });
    return { svg, layout, motion };
  };

  it('adds a far tree line, and a shadow and shading for every tree', () => {
    const { svg, layout } = decorated(mockGroveResponse, true);
    expect(svg.querySelectorAll('[data-decor="far"]')).toHaveLength(1);
    for (const tree of svg.querySelectorAll('[data-kind="tree"]')) {
      expect(tree.querySelectorAll(':scope > [data-kind="decor"]')).toHaveLength(3);
    }
    expect(svg.querySelectorAll('[data-kind="tree"]')).toHaveLength(layout.trees.length);
  });

  it('never gets in the way: nothing it adds can be clicked, focused or counted as a tab', () => {
    const svg = makeSvg();
    const layout = computeGroveLayout(mockGroveResponse);
    renderGrove(svg, layout);
    const leaves = tabLeaves(svg);
    const stops = svg.querySelectorAll('[tabindex]').length;
    decorateGrove(svg, layout, { still: false });

    for (const node of svg.querySelectorAll('[data-kind="decor"]')) {
      expect(node.getAttribute('pointer-events')).toBe('none');
      expect(node.getAttribute('aria-hidden')).toBe('true');
      expect(node.querySelector('[data-select-kind], [tabindex], title')).toBeNull();
    }
    expect(tabLeaves(svg)).toBe(leaves);
    expect(svg.querySelectorAll('[tabindex]').length).toBe(stops);
    // The canopy keeps its three drawn blobs; shading sits beside it, not inside.
    for (const canopy of svg.querySelectorAll('[data-kind="canopy"]')) {
      expect(canopy.querySelectorAll('circle')).toHaveLength(3);
    }
  });

  it('moves the canopy, the leaves and the firefly when idle life is on', () => {
    const { svg } = decorated(mockGroveResponse, false);
    expect(svg.querySelectorAll('[data-kind="canopy"] > animateTransform').length).toBe(
      svg.querySelectorAll('[data-kind="canopy"]').length
    );
    expect(svg.querySelectorAll('path[data-kind="leaf"] > animateTransform').length).toBeGreaterThan(0);
    expect(svg.querySelectorAll('[data-kind="firefly"] > animateTransform').length).toBeGreaterThan(0);
    // Every loop rides on top of the element's own transform.
    for (const node of svg.querySelectorAll('animateTransform')) {
      expect(node.getAttribute('additive')).toBe('sum');
      expect(node.getAttribute('repeatCount')).toBe('indefinite');
    }
  });

  it('holds still for a reduced-motion user: depth only', () => {
    const { svg } = decorated(mockGroveResponse, true);
    expect(svg.querySelector('animateTransform')).toBeNull();
    expect(svg.querySelector('[data-kind="decor"]')).not.toBeNull();
  });

  it('drops a loose leaf from a dormant tree now and then, and stops when asked', () => {
    vi.useFakeTimers();
    try {
      const { svg, layout, motion } = decorated(mockGroveResponse, false);
      expect(layout.trees.some((tree) => tree.dormant)).toBe(true);
      expect(svg.querySelector('[data-kind="motion-decor"]')).toBeNull();
      vi.advanceTimersByTime(3000);
      expect(svg.querySelectorAll('[data-kind="motion-decor"]').length).toBe(1);
      motion.stop();
      expect(svg.querySelector('[data-kind="motion-decor"]')).toBeNull();
      vi.advanceTimersByTime(9000);
      expect(svg.querySelector('[data-kind="motion-decor"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the canvas plays an edit', () => {
  it('animates a change to the grove and ends on the plain drawing plus its decoration', async () => {
    setGroveMotion(true);
    setReducedMotion(false);
    const item = step('stone');
    const { container, rerender } = render(<GroveCanvas grove={item.before} growTimeScale={0.02} />);
    rerender(<GroveCanvas grove={item.after} growTimeScale={0.02} />);

    const stone = container.querySelector('[data-kind="stone"]') as Element;
    expect(stone.getAttribute('data-stone-kind')).toBe('carved');
    expect(stone.querySelector('[data-kind="motion-ghost"]')).not.toBeNull();
    await waitFor(() => expect(container.querySelector('[data-kind="motion-ghost"]')).toBeNull(), {
      timeout: 4000,
    });
  });

  it('does not animate edits for a reduced-motion user', () => {
    setGroveMotion(true);
    const item = step('stone');
    const { container, rerender } = render(<GroveCanvas grove={item.before} />);
    rerender(<GroveCanvas grove={item.after} />);
    expect(container.querySelector('[data-kind="motion-ghost"]')).toBeNull();
  });
});

describe('How to read your grove', () => {
  const advance = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, GUIDE_PAUSE_MS + 60));
    });
  };

  it('has a step for each thing the grove shows, in plain words', () => {
    expect(GUIDE_STEPS.map((item) => item.id)).toEqual([
      'leaf', 'trunk', 'branch', 'mushroom', 'flower', 'stone', 'duplicate', 'move', 'dormant', 'wake', 'sprout',
    ]);
    for (const item of GUIDE_STEPS) {
      expect(item.title.length).toBeGreaterThan(8);
      expect(item.browser).toMatch(/^(You|A|TabForest)/);
      // Each step really changes the picture.
      expect(findChanges(computeGroveLayout(item.before), computeGroveLayout(item.after)).any).toBe(true);
    }
  });

  it('shows one step at a time: the grove before, then after the change', async () => {
    const { container } = render(<GroveGuide onDone={() => {}} />);
    expect(screen.getByText('Step 1 of 11')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Every tab is a leaf' })).toHaveFocus();
    expect(screen.getByText(GUIDE_STEPS[0].browser)).toBeInTheDocument();
    expect(screen.getByText(GUIDE_STEPS[0].grove)).toBeInTheDocument();
    expect(screen.getByText('This is an example grove, not your own tabs.')).toBeInTheDocument();

    expect(container.querySelector('[data-tab-ref="g-l9"]')).toBeNull();
    await advance();
    expect(container.querySelector('[data-tab-ref="g-l9"]')).not.toBeNull();
  });

  it('dims the trees the step is not about', () => {
    const { container } = render(<GroveGuide onDone={() => {}} />);
    const away = [...container.querySelectorAll('[data-kind="tree"][data-guide-away="true"]')].map((node) =>
      node.getAttribute('data-tree-id')
    );
    expect(away).toEqual(['guide-prep', 'guide-job']);
    expect(container.querySelector('[data-tree-id="guide-login"]')?.hasAttribute('data-guide-away')).toBe(false);
  });

  it('walks forward and back, replays a step, and ends with the grove', async () => {
    const onDone = vi.fn();
    const { container } = render(<GroveGuide onDone={onDone} />);
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Time spent makes the trunk thicker' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Step 1 of 11')).toBeInTheDocument();

    await advance();
    expect(container.querySelector('[data-tab-ref="g-l9"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Play again' }));
    expect(container.querySelector('[data-tab-ref="g-l9"]')).toBeNull();

    for (let i = 1; i < GUIDE_STEPS.length; i++) fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Step 11 of 11')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open my grove' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('lists what each thing means, and can be skipped', () => {
    const onDone = vi.fn();
    render(<GroveGuide onDone={onDone} />);
    const key = within(screen.getByRole('region', { name: 'What each thing means' }));
    expect(key.getAllByRole('listitem')).toHaveLength(GUIDE_KEY.length);
    expect(key.getByText('A mushroom')).toBeInTheDocument();
    expect(key.getByText('An amber tree')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Skip the tour' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  describe('in the app', () => {
    beforeEach(() => {
      resetMockBridge();
      resetAccountStandIn();
      useGroveStore.setState({ grove: mockGroveResponse, activeScreen: 'grove', isStreaming: false });
      useBridgeStore.setState({ authState: { signed_in: true }, authChecked: false });
    });

    it('opens from the left rail at any time and returns to the grove', () => {
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: 'How to read your grove' }));
      expect(screen.getByText('Step 1 of 11')).toBeInTheDocument();
      // It opens over the app as a dialog; the app stays where it was underneath.
      expect(screen.getByRole('dialog', { name: 'How to read your grove' })).toHaveAttribute('aria-modal', 'true');
      expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Skip the tour' }));
      expect(screen.getByRole('heading', { level: 1, name: 'Current Grove' })).toBeInTheDocument();
    });

    it('does not show by itself to a returning user', async () => {
      render(<App />);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(screen.queryByText('Step 1 of 11')).not.toBeInTheDocument();
    });
  });
});
