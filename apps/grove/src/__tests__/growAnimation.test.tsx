import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { streamStandIn } from '../adapters/grove';
import { indexTabs } from '../adapters/groveContract';
import { mockGroveResponse, mockSnapshot } from '../mocks/mockData';
import { useGroveStore } from '../store/useGroveStore';
import { GroveCanvas } from '../viz/GroveCanvas';
import {
  GROW_TIMELINE,
  INTRO_MS,
  LEAF_STAGGER_MS,
  REDUCED_FADE_MS,
  TYPE_MS_PER_CHAR,
  collectLeaves,
  createLeafChoreography,
  findArrivals,
  hollowCountLine,
  playArrivals,
  playGrowFade,
  playGrowIntro,
  prefersReducedMotion,
  stageAt,
  type GrowStage,
} from '../viz/growAnimation';
import { computeGroveLayout } from '../viz/layout';
import { renderGrove } from '../viz/render';
import type { GroveResponse } from '../types';

// The grove after each line of the contract stream: [clusters, tree × 4, done].
const steps: GroveResponse[] = [];
let listening: GroveResponse;
let finished: GroveResponse;

beforeAll(async () => {
  useGroveStore.setState({ grove: null });
  const unsubscribe = useGroveStore.subscribe((state, previous) => {
    if (state.grove && state.grove !== previous.grove) steps.push(state.grove);
  });
  await streamStandIn(
    indexTabs(mockSnapshot.open_tabs),
    useGroveStore.getState().handleStreamMessage,
    0
  );
  unsubscribe();
  listening = steps[0];
  finished = steps[steps.length - 1];
});

/** Tests run as a reduced-motion user (test/setup.ts); this switches one test to full motion. */
const setReducedMotion = (reduced: boolean) => {
  vi.mocked(window.matchMedia).mockImplementation(
    (query: string) => ({ matches: reduced, media: query }) as MediaQueryList
  );
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
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

const tabCount = (grove: GroveResponse) =>
  grove.trees.reduce((sum, tree) => sum + tree.tabs.length, 0) +
  grove.sprouts.reduce((sum, sprout) => sum + sprout.tabs.length, 0) +
  grove.meadow.tabs.length +
  (grove.fog?.length ?? 0);

afterEach(() => {
  document.body.querySelectorAll('svg').forEach((svg) => svg.remove());
});

describe('grow timeline (SPEC §9.3)', () => {
  it('uses the stage times from the spec', () => {
    expect(GROW_TIMELINE).toEqual({
      fall: { start: 0, end: 600 },
      swirl: { start: 600, end: 1600 },
      trunks: { start: 1600, end: 2400 },
      canopy: { start: 2400, end: 3200 },
      speak: { start: 3200, end: 4200 },
    });
    expect(INTRO_MS).toBe(3200);
    expect(LEAF_STAGGER_MS).toBe(15);
    expect(TYPE_MS_PER_CHAR).toBe(20);
    expect(REDUCED_FADE_MS).toBe(300);
  });

  it.each<[number, GrowStage]>([
    [0, 'fall'],
    [599, 'fall'],
    [600, 'swirl'],
    [1600, 'trunks'],
    [2400, 'canopy'],
    [3199, 'canopy'],
    [3200, 'speak'],
  ])('at %i ms the stage is %s', (ms, stage) => {
    expect(stageAt(ms)).toBe(stage);
  });

  it('words the Hollow count like the left rail', () => {
    expect(hollowCountLine(0)).toBe('No tabs are resting in the Hollow');
    expect(hollowCountLine(1)).toBe('1 tab is resting in the Hollow');
    expect(hollowCountLine(3)).toBe('3 tabs are resting in the Hollow');
  });
});

describe('the clusters line', () => {
  it('counts a new grow and carries trunk thickness and dormancy before any AI result', () => {
    const before = useGroveStore.getState().growSeq;
    useGroveStore.getState().handleStreamMessage({
      type: 'clusters',
      clusters: [
        {
          cluster_ref: 'c1',
          project_name: 'one',
          tab_refs: ['t1'],
          attention_minutes: 52,
          days_since_active: 4,
          canopy: 'amber',
        },
        { cluster_ref: 'c2', project_name: 'two', tab_refs: ['t2'] },
      ],
    });
    const state = useGroveStore.getState();
    expect(state.growSeq).toBe(before + 1);
    expect(state.grove?.trees.map((tree) => tree.attention_minutes)).toEqual([52, 0]);
    expect(state.grove?.trees.every((tree) => tree.pending)).toBe(true);

    const layout = computeGroveLayout(state.grove as GroveResponse);
    expect(layout.trees.map((tree) => tree.dormant)).toEqual([true, false]);
    expect(layout.trees[0].trunkWidth).toBeGreaterThan(layout.trees[1].trunkWidth);
  });

  it('gives the contract stream one dormant listening tree, known from clustering', () => {
    const layout = computeGroveLayout(listening);
    expect(layout.trees.every((tree) => tree.pending)).toBe(true);
    expect(layout.trees.filter((tree) => tree.dormant)).toHaveLength(1);
  });
});

describe('leaf choreography', () => {
  it('has one leaf per tab, labelled with its domain initial', () => {
    const layout = computeGroveLayout(listening);
    const leaves = collectLeaves(layout);
    expect(leaves).toHaveLength(tabCount(listening));
    expect(new Set(leaves.map((leaf) => leaf.key)).size).toBe(leaves.length);

    const tree = layout.trees[0];
    const first = tree.branches[0].leaves[0];
    const leaf = leaves.find((entry) => entry.key === `tree:${tree.id}|${first.tabRef}`);
    expect(leaf?.initial).toBe(first.domain.replace(/^www\./, '').charAt(0).toUpperCase());
    expect(leaf?.home).toEqual(tree.crown);
  });

  it('drops leaves 15 ms apart, from above the canvas, and lands them all by 0.6 s', () => {
    const layout = computeGroveLayout(listening);
    const choreography = createLeafChoreography(layout);
    const delays = [...choreography.fallDelays].sort((a, b) => a - b);
    delays.slice(1).forEach((delay, index) => {
      expect(delay - delays[index]).toBeCloseTo(LEAF_STAGGER_MS, 5);
    });

    const start = choreography.poseAt(0);
    expect(start.every((pose) => pose.y < 0)).toBe(true);
    expect(start.filter((pose) => pose.opacity === 1)).toHaveLength(1);

    const landed = choreography.poseAt(GROW_TIMELINE.fall.end);
    for (const pose of landed) {
      expect(pose.opacity).toBe(1);
      expect(pose.initialOpacity).toBe(1);
      expect(pose.y).toBeGreaterThan(0);
      expect(pose.y).toBeLessThan(layout.groundY);
    }
  });

  it('still lands every leaf by 0.6 s when there are very many tabs', () => {
    const tab = listening.trees[0].tabs[0];
    const crowded: GroveResponse = {
      ...listening,
      trees: listening.trees.map((tree, index) =>
        index === 0
          ? {
              ...tree,
              tabs: Array.from({ length: 120 }, (_, i) => ({ ...tab, tab_ref: `many-${i}` })),
              branches: [
                { ...tree.branches[0], tab_refs: Array.from({ length: 120 }, (_, i) => `many-${i}`) },
              ],
            }
          : tree
      ),
    };
    const choreography = createLeafChoreography(computeGroveLayout(crowded));
    expect(Math.max(...choreography.fallDelays)).toBeLessThanOrEqual(450);
    expect(choreography.poseAt(GROW_TIMELINE.fall.end).every((pose) => pose.y > 0)).toBe(true);
  });

  it('swirls each leaf towards its own cluster', () => {
    const choreography = createLeafChoreography(computeGroveLayout(listening));
    const homes = choreography.leaves.map((leaf) => leaf.home);
    const spread = (ms: number) =>
      mean(choreography.poseAt(ms).map((pose, index) => distance(pose, homes[index])));

    const landed = spread(GROW_TIMELINE.swirl.start);
    const layout = computeGroveLayout(listening);
    for (const ms of [700, 800, 900, 1000]) {
      // No leaf swings under the forest floor.
      expect(choreography.poseAt(ms).every((pose) => pose.y < layout.groundY)).toBe(true);
    }
    const midway = spread(1100);
    const gathered = spread(GROW_TIMELINE.swirl.end);
    expect(midway).toBeLessThan(landed);
    expect(gathered).toBeLessThan(landed * 0.4);
  });

  it('ends with every leaf exactly where the grove draws it', () => {
    const choreography = createLeafChoreography(computeGroveLayout(listening));
    choreography.poseAt(GROW_TIMELINE.canopy.start);
    const end = choreography.poseAt(GROW_TIMELINE.canopy.end);
    end.forEach((pose, index) => {
      expect(pose).toEqual({ ...choreography.leaves[index].final, opacity: 1, initialOpacity: 0 });
    });
  });

  it('falls the same way every time', () => {
    const layout = computeGroveLayout(listening);
    expect(createLeafChoreography(layout).poseAt(1000)).toEqual(
      createLeafChoreography(layout).poseAt(1000)
    );
  });
});

describe('playGrowIntro', () => {
  it('starts with the leaves in the air and the trees not yet grown', () => {
    const svg = makeSvg();
    const layout = computeGroveLayout(listening);
    renderGrove(svg, layout);
    const animation = playGrowIntro(svg, layout);

    expect(svg.getAttribute('data-growing')).toBe('true');
    const letters = svg.querySelectorAll('[data-kind="grow-initials"] text');
    expect(letters).toHaveLength(tabCount(listening));
    for (const trunk of svg.querySelectorAll('[data-kind="trunk"]')) {
      expect(trunk.getAttribute('opacity')).toBe('0');
    }
    for (const blob of svg.querySelectorAll('[data-kind="canopy"] circle')) {
      expect(blob.getAttribute('r')).toBe('0');
    }
    expect(svg.querySelectorAll('[data-kind="grow-trunk"]')).toHaveLength(layout.trees.length);
    // A dormant tree starts green and fades to amber.
    for (const blob of svg.querySelectorAll('[data-canopy="amber"] [data-kind="canopy"] circle')) {
      expect(blob.getAttribute('fill')).toBe('#2f5539');
    }
    animation.stop();
  });

  it('writes the domain initial as text, never as markup', () => {
    const hostile: GroveResponse = {
      ...listening,
      trees: listening.trees.map((tree) => ({
        ...tree,
        tabs: tree.tabs.map((tab) => ({ ...tab, domain: '<img src=x onerror=alert(1)>' })),
      })),
    };
    const svg = makeSvg();
    const layout = computeGroveLayout(hostile);
    renderGrove(svg, layout);
    const animation = playGrowIntro(svg, layout);
    expect(svg.querySelector('img')).toBeNull();
    expect(svg.querySelector('[data-kind="grow-initials"] text')?.textContent).toHaveLength(1);
    animation.stop();
  });

  it('runs the stages in order and leaves the grove exactly as it is drawn', async () => {
    const svg = makeSvg();
    const layout = computeGroveLayout(listening);
    renderGrove(svg, layout);
    const stages: GrowStage[] = [];
    const onDone = vi.fn();
    playGrowIntro(svg, layout, {
      timeScale: 0.03,
      onStage: (stage) => stages.push(stage),
      onDone,
    });

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(stages[0]).toBe('fall');
    expect(stages[stages.length - 1]).toBe('speak');
    const order: GrowStage[] = ['fall', 'swirl', 'trunks', 'canopy', 'speak'];
    expect(stages).toEqual(order.filter((stage) => stages.includes(stage)));
    expect(drawn(svg)).toBe(freshDrawing(listening));
  });

  it('can be stopped midway without calling onDone, leaving the drawn grove', async () => {
    const svg = makeSvg();
    const layout = computeGroveLayout(listening);
    renderGrove(svg, layout);
    const onDone = vi.fn();
    const animation = playGrowIntro(svg, layout, { timeScale: 0.2, onDone });
    await wait(120);
    animation.stop();
    expect(drawn(svg)).toBe(freshDrawing(listening));
    await wait(700);
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('playArrivals: the forest speaks', () => {
  it('finds the trees whose result just arrived and the new fireflies', () => {
    const before = computeGroveLayout(listening);
    const oneIn = computeGroveLayout(steps[1]);
    const after = computeGroveLayout(finished);

    const first = findArrivals(before, oneIn);
    expect(first.revealed).toHaveLength(1);
    expect(first.fireflies.size).toBe(0);

    const all = findArrivals(before, after);
    expect(all.revealed.map((tree) => tree.name)).toEqual(
      mockGroveResponse.trees.map((tree) => tree.project.name)
    );
    expect(all.fireflies.size).toBe((finished.past_connections ?? []).length);
    expect(all.fireflies.size).toBeGreaterThan(0);

    expect(findArrivals(after, after)).toEqual({ revealed: [], fireflies: new Set() });
  });

  it('does nothing when no result arrived', () => {
    const svg = makeSvg();
    const layout = computeGroveLayout(finished);
    renderGrove(svg, layout);
    expect(playArrivals(svg, layout, layout)).toBeNull();
    expect(drawn(svg)).toBe(freshDrawing(finished));
  });

  it('types the goal name in and brings in what the result found', async () => {
    const svg = makeSvg();
    const before = computeGroveLayout(listening);
    const after = computeGroveLayout(finished);
    renderGrove(svg, after);
    const animation = playArrivals(svg, before, after, { timeScale: 0.05 });
    expect(animation).not.toBeNull();

    // Before anything is said: no name yet, and the findings are still hidden.
    const visibleNames = [...svg.querySelectorAll('[data-kind="tree"] > text:not([data-kind])')].map(
      (node) => node.textContent
    );
    for (const tree of after.trees) expect(visibleNames).not.toContain(tree.name);
    for (const kind of ['mushroom', 'stone', 'firefly']) {
      const nodes = svg.querySelectorAll(`[data-kind="${kind}"]`);
      expect(nodes.length).toBeGreaterThan(0);
      nodes.forEach((node) => expect(node.getAttribute('opacity')).toBe('0'));
    }

    const settled = freshDrawing(finished);
    await waitFor(() => expect(drawn(svg)).toBe(settled), { timeout: 3000 });
  });

  it('leaves a tree that has no result yet untouched', () => {
    const svg = makeSvg();
    const before = computeGroveLayout(listening);
    const after = computeGroveLayout(steps[1]);
    renderGrove(svg, after);
    const animation = playArrivals(svg, before, after, { timeScale: 0.05 });

    const waiting = svg.querySelectorAll('[data-kind="tree"][data-pending="true"]');
    expect(waiting).toHaveLength(3);
    for (const tree of waiting) {
      expect(tree.textContent).toMatch(/listening…/);
      expect(tree.querySelector('[data-kind="mushroom"], [data-kind="stone"]')).toBeNull();
    }
    animation?.stop();
    expect(drawn(svg)).toBe(freshDrawing(steps[1]));
  });

  it('only fades the tree in for a reduced-motion user', async () => {
    const svg = makeSvg();
    const before = computeGroveLayout(listening);
    const after = computeGroveLayout(finished);
    renderGrove(svg, after);
    playArrivals(svg, before, after, { timeScale: 0.1, reducedMotion: true });

    const trees = svg.querySelectorAll('[data-kind="tree"]');
    trees.forEach((tree) => expect(tree.getAttribute('opacity')).toBe('0'));
    // Nothing moves: no leaf, canopy or trunk is displaced.
    const settled = freshDrawing(finished);
    expect(drawn(svg).replace(/ opacity="0"/g, '')).toBe(settled);
    await waitFor(() => expect(drawn(svg)).toBe(settled), { timeout: 3000 });
  });
});

describe('playGrowFade (reduced motion)', () => {
  it('fades the whole grove in and moves nothing', async () => {
    const svg = makeSvg();
    renderGrove(svg, computeGroveLayout(finished));
    playGrowFade(svg, 0.1);
    const root = svg.querySelector('[data-kind="grove-root"]');
    expect(root?.getAttribute('opacity')).toBe('0');
    expect(svg.querySelector('[data-kind="grow-initials"]')).toBeNull();
    await waitFor(() => expect(root?.hasAttribute('opacity')).toBe(false), { timeout: 3000 });
  });
});

describe('GroveCanvas during a grow', () => {
  let growKey = 1000;
  beforeEach(() => {
    growKey += 1;
    setReducedMotion(false);
  });
  afterEach(() => setReducedMotion(true));

  const pendingTrees = (container: HTMLElement) =>
    container.querySelectorAll('[data-kind="tree"][data-pending="true"]');

  it('reads the reduced-motion setting from the browser', () => {
    expect(prefersReducedMotion()).toBe(false);
    setReducedMotion(true);
    expect(prefersReducedMotion()).toBe(true);
  });

  it('holds results that arrive during the intro, then lets the forest speak', async () => {
    const { container, rerender } = render(
      <GroveCanvas grove={listening} growKey={growKey} growTimeScale={0.05} />
    );
    expect(container.querySelector('svg')?.getAttribute('data-growing')).toBe('true');
    // The Hollow count shows in the corner while the forest grows.
    expect(container.querySelector('[data-kind="hollow-count"]')?.textContent).toBe(
      hollowCountLine(listening.hollow_count)
    );
    expect(listening.hollow_count).toBe(3);

    // Every result arrives while the leaves are still falling.
    rerender(<GroveCanvas grove={finished} growKey={growKey} growTimeScale={0.05} />);
    expect(pendingTrees(container)).toHaveLength(4);
    expect(container.querySelector('[data-kind="mushroom"]')).toBeNull();

    await waitFor(() => expect(pendingTrees(container)).toHaveLength(0), { timeout: 3000 });
    expect(container.querySelector('svg')?.hasAttribute('data-growing')).toBe(false);
    expect(container.querySelector('[data-kind="hollow-count"]')).toBeNull();
    await waitFor(
      () => expect(drawn(container.querySelector('svg') as SVGSVGElement)).toContain('Job Search'),
      { timeout: 3000 }
    );
  });

  it('keeps a late tree listening instead of faking its result', async () => {
    const late = steps[3]; // three results in, one still to come
    const { container, rerender } = render(
      <GroveCanvas grove={listening} growKey={growKey} growTimeScale={0.05} />
    );
    rerender(<GroveCanvas grove={late} growKey={growKey} growTimeScale={0.05} />);

    await waitFor(() => expect(pendingTrees(container)).toHaveLength(1), { timeout: 3000 });
    const waiting = pendingTrees(container)[0];
    expect(waiting.textContent).toMatch(/listening…/);
    expect(waiting.querySelector('[data-kind="mushroom"], [data-kind="stone"]')).toBeNull();

    // Its result arrives later and is shown then.
    rerender(<GroveCanvas grove={finished} growKey={growKey} growTimeScale={0.05} />);
    expect(pendingTrees(container)).toHaveLength(0);
  });

  it('does not replay the grow when the screen is opened again', () => {
    const first = render(<GroveCanvas grove={listening} growKey={growKey} growTimeScale={0.05} />);
    expect(first.container.querySelector('svg')?.getAttribute('data-growing')).toBe('true');
    first.unmount();

    const again = render(<GroveCanvas grove={finished} growKey={growKey} growTimeScale={0.05} />);
    expect(again.container.querySelector('svg')?.hasAttribute('data-growing')).toBe(false);
    expect(pendingTrees(again.container)).toHaveLength(0);
  });

  it('shows results at once and only fades for a reduced-motion user', () => {
    setReducedMotion(true);
    const { container, rerender } = render(
      <GroveCanvas grove={listening} growKey={growKey} growTimeScale={0.05} />
    );
    expect(container.querySelector('svg')?.hasAttribute('data-growing')).toBe(false);
    expect(container.querySelector('[data-kind="grove-root"]')?.getAttribute('opacity')).toBe('0');
    expect(container.querySelector('[data-kind="grow-initials"]')).toBeNull();

    rerender(<GroveCanvas grove={finished} growKey={growKey} growTimeScale={0.05} />);
    expect(pendingTrees(container)).toHaveLength(0);
  });
});

describe('listening shimmer styles', () => {
  it('shimmers a late tree, waits for the intro, and stays still for reduced motion', () => {
    const styles = readFileSync(resolve(__dirname, '../index.css'), 'utf-8');
    expect(styles).toMatch(/\[data-pending='true'\]\s*\{\s*animation: grove-listening/);
    expect(styles).toMatch(/\.grove-canvas\[data-growing='true'\] \[data-pending='true'\]/);
    expect(styles).toMatch(/prefers-reduced-motion: reduce/);
  });
});
