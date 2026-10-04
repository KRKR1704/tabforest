// The grow animation (SPEC §9.3). It follows the real pipeline: everything up to
// the canopy needs only the clusters line, and a tree "speaks" when its own AI
// result arrives. A tree whose result is late keeps its listening shimmer;
// nothing here invents a result. Text is set with .text() only (SPEC §12).
import {
  easeBackOut,
  easeBounceOut,
  easeCubicInOut,
  easeCubicOut,
  forceCollide,
  forceSimulation,
  forceX,
  forceY,
  interpolateRgb,
  interpolateString,
  select,
  timeout,
  timer,
  type Selection,
  type SimulationNodeDatum,
} from 'd3';
import type { GroveLayout, LeafLayout, Point, TreeLayout } from './layout';
import { FONT, PALETTE } from './palette';

/** Stage boundaries in ms from the moment the clusters line is drawn. */
export const GROW_TIMELINE = {
  fall: { start: 0, end: 600 },
  swirl: { start: 600, end: 1600 },
  trunks: { start: 1600, end: 2400 },
  canopy: { start: 2400, end: 3200 },
  speak: { start: 3200, end: 4200 },
} as const;

export type GrowStage = keyof typeof GROW_TIMELINE;

/** Everything before the forest speaks. AI results are held back until then. */
export const INTRO_MS = GROW_TIMELINE.speak.start;
export const LEAF_STAGGER_MS = 15;
export const TYPE_MS_PER_CHAR = 20;
export const REDUCED_FADE_MS = 300;

const REVEAL_STAGGER_MS = 150;
const MORPH_MS = 400;
const SWIRL_TICKS = 150;
const MIN_FALL_MS = 150;
const EDGE = 28;

export interface GrowAnimation {
  /** Cancels what is still running and leaves the grove as it was drawn. */
  stop: () => void;
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function stageAt(elapsedMs: number): GrowStage {
  if (elapsedMs < GROW_TIMELINE.fall.end) return 'fall';
  if (elapsedMs < GROW_TIMELINE.swirl.end) return 'swirl';
  if (elapsedMs < GROW_TIMELINE.trunks.end) return 'trunks';
  if (elapsedMs < GROW_TIMELINE.canopy.end) return 'canopy';
  return 'speak';
}

export function hollowCountLine(count: number): string {
  if (count === 0) return 'No tabs are resting in the Hollow';
  if (count === 1) return '1 tab is resting in the Hollow';
  return `${count} tabs are resting in the Hollow`;
}

interface Pose extends Point {
  angle: number;
}

export interface GrowLeaf {
  /** Owner and tab, e.g. `tree:p_1|tab-ref`; matches the drawn leaf. */
  key: string;
  /** First letter of the tab's domain, shown while the leaf is in the air. */
  initial: string;
  length: number;
  /** Centre of the leaf's cluster, where it gathers. */
  home: Point;
  /** The ground line of the row the leaf belongs to. */
  ground: number;
  /** Where the leaf sits once the grove is drawn. */
  final: Pose;
}

export interface LeafPose extends Pose {
  opacity: number;
  initialOpacity: number;
}

function domainInitial(leaf: LeafLayout): string {
  const source = leaf.domain.replace(/^www\./, '') || leaf.title;
  return source.trim().charAt(0).toUpperCase() || '·';
}

/** One entry per leaf on the canvas: one per tab, in drawing order. */
export function collectLeaves(layout: GroveLayout): GrowLeaf[] {
  const leaves: GrowLeaf[] = [];
  const add = (owner: string, home: Point, ground: number, group: LeafLayout[]) => {
    for (const leaf of group) {
      leaves.push({
        key: `${owner}|${leaf.tabRef}`,
        initial: domainInitial(leaf),
        length: leaf.length,
        home,
        ground,
        final: { x: leaf.x, y: leaf.y, angle: leaf.angle },
      });
    }
  };
  const patchHome = (patch: { x: number; groundY: number }): Point => ({ x: patch.x, y: patch.groundY - 60 });

  for (const sprout of layout.sprouts) {
    add(`sprout:${sprout.ref}`, patchHome(sprout), sprout.groundY, sprout.leaves);
  }
  for (const tree of layout.trees) {
    add(`tree:${tree.id}`, tree.crown, tree.groundY, [
      ...tree.branches.flatMap((branch) => branch.leaves),
      ...tree.fallenLeaves,
    ]);
  }
  if (layout.meadow) add('meadow', patchHome(layout.meadow), layout.meadow.groundY, layout.meadow.leaves);
  if (layout.fog) add('fog', patchHome(layout.fog), layout.fog.groundY, layout.fog.leaves);
  return leaves;
}

/** Repeatable scatter, so the same grove always falls the same way. */
function noise(index: number, salt: number): number {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

const lerp = (from: number, to: number, k: number) => from + (to - from) * k;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

interface SwirlNode extends SimulationNodeDatum {
  x: number;
  y: number;
  vx: number;
  vy: number;
  home: Point;
  /** Leaves stay above the ground of their own row. */
  floor: number;
}

export interface LeafChoreography {
  leaves: GrowLeaf[];
  /** Per-leaf fall delay; at most LEAF_STAGGER_MS apart. */
  fallDelays: number[];
  /** Where every leaf is at this moment. Call with a time that never goes back. */
  poseAt: (elapsedMs: number) => LeafPose[];
}

/**
 * Where each leaf is from the first drop until it hangs on its branch: fall,
 * swirl towards its cluster (d3-force), wait while the trunk grows, attach.
 */
export function createLeafChoreography(layout: GroveLayout): LeafChoreography {
  const { fall, swirl, canopy } = GROW_TIMELINE;
  const leaves = collectLeaves(layout);
  const count = leaves.length;

  // Leaves drop in a shuffled order so no cluster arrives as a block.
  const rank: number[] = new Array(count);
  leaves
    .map((_, index) => index)
    .sort((a, b) => noise(a, 1) - noise(b, 1))
    .forEach((leafIndex, position) => {
      rank[leafIndex] = position;
    });

  // 15 ms apart, squeezed only when there are too many tabs to land by 0.6 s.
  const stagger =
    count > 1 ? Math.min(LEAF_STAGGER_MS, (fall.end - MIN_FALL_MS) / (count - 1)) : 0;
  const fallMs = fall.end - stagger * Math.max(0, count - 1);
  const attachStagger = count > 1 ? Math.min(8, 200 / (count - 1)) : 0;
  const attachMs = canopy.end - canopy.start - attachStagger * Math.max(0, count - 1);

  const plans = leaves.map((leaf, index) => {
    const startX = EDGE + noise(index, 2) * (layout.width - EDGE * 2);
    const startAngle = noise(index, 4) * 360;
    return {
      leaf,
      start: { x: startX, y: -30 - noise(index, 3) * 50, angle: startAngle },
      landing: {
        x: startX + (noise(index, 5) - 0.5) * 70,
        // Within the leaf's own row: a grove stacked in rows gathers each row above its ground.
        y: leaf.ground - layout.groundY * (0.7 - noise(index, 6) * 0.5),
        angle: startAngle + (noise(index, 7) - 0.5) * 140,
      },
      fallAt: rank[index] * stagger,
      attachAt: canopy.start + rank[index] * attachStagger,
      spin: noise(index, 8) > 0.5 ? 60 : -60,
    };
  });

  const nodes: SwirlNode[] = plans.map((plan) => ({
    x: plan.landing.x,
    y: plan.landing.y,
    vx: 0,
    vy: 0,
    home: plan.leaf.home,
    floor: plan.leaf.ground - 10,
  }));
  // Stepped by hand so the swirl depends on elapsed time, not on the frame rate.
  const simulation = forceSimulation(nodes)
    .alphaDecay(0.01)
    .velocityDecay(0.3)
    .force('x', forceX<SwirlNode>((node) => node.home.x).strength(0.07))
    .force('y', forceY<SwirlNode>((node) => node.home.y).strength(0.07))
    .force('collide', forceCollide<SwirlNode>(8))
    .force('swirl', (alpha: number) => {
      // A push at right angles to the pull, so leaves circle in rather than slide.
      for (const node of nodes) {
        node.vx -= (node.y - node.home.y) * 0.025 * alpha;
        node.vy += (node.x - node.home.x) * 0.025 * alpha;
        // Leaves stay in the air; none dips under the forest floor.
        if (node.y > node.floor) {
          node.y = node.floor;
          node.vy = -Math.abs(node.vy) * 0.3;
        }
      }
    })
    .stop();

  let ticks = 0;
  const advance = (elapsedMs: number) => {
    const share = clamp01((elapsedMs - swirl.start) / (canopy.start - swirl.start));
    const wanted = Math.round(share * SWIRL_TICKS);
    while (ticks < wanted) {
      simulation.tick();
      ticks += 1;
    }
  };

  let gathered: Pose[] | null = null;
  const swirlPose = (index: number): Pose => ({
    x: nodes[index].x,
    y: nodes[index].y,
    angle: plans[index].landing.angle + plans[index].spin * (ticks / SWIRL_TICKS),
  });

  const poseAt = (elapsedMs: number): LeafPose[] => {
    advance(elapsedMs);
    if (elapsedMs >= canopy.start && !gathered) gathered = plans.map((_, index) => swirlPose(index));

    return plans.map((plan, index) => {
      const initialOpacity = 1 - clamp01((elapsedMs - canopy.start) / 300);
      if (elapsedMs >= canopy.end) return { ...plan.leaf.final, opacity: 1, initialOpacity: 0 };

      if (gathered) {
        const from = gathered[index];
        const to = plan.leaf.final;
        const k = easeCubicInOut(clamp01((elapsedMs - plan.attachAt) / attachMs));
        // Turn the short way round to the angle the leaf hangs at.
        const turn = ((((to.angle - from.angle) % 360) + 540) % 360) - 180;
        return {
          x: lerp(from.x, to.x, k),
          y: lerp(from.y, to.y, k),
          angle: from.angle + turn * k,
          opacity: 1,
          initialOpacity,
        };
      }

      if (elapsedMs >= fall.end) return { ...swirlPose(index), opacity: 1, initialOpacity };

      if (elapsedMs < plan.fallAt) return { ...plan.start, opacity: 0, initialOpacity };
      const k = clamp01((elapsedMs - plan.fallAt) / fallMs);
      const drop = easeCubicOut(k);
      return {
        // A small side-to-side flutter on the way down.
        x: lerp(plan.start.x, plan.landing.x, drop) + Math.sin(k * Math.PI * 2) * 8 * (1 - k),
        y: lerp(plan.start.y, plan.landing.y, drop),
        angle: lerp(plan.start.angle, plan.landing.angle, drop),
        opacity: 1,
        initialOpacity,
      };
    });
  };

  return { leaves, fallDelays: plans.map((plan) => plan.fallAt), poseAt };
}

type AnyGroup = Selection<SVGGElement, unknown, null, undefined>;

/** Remembers the attributes an animation touches, to put them back exactly. */
function createKeeper() {
  const saved = new Map<Element, Map<string, string | null>>();
  return {
    hold(element: Element, ...names: string[]) {
      const attributes = saved.get(element) ?? new Map<string, string | null>();
      for (const name of names) {
        if (!attributes.has(name)) attributes.set(name, element.getAttribute(name));
      }
      saved.set(element, attributes);
    },
    restore() {
      for (const [element, attributes] of saved) {
        for (const [name, value] of attributes) {
          if (value === null) element.removeAttribute(name);
          else element.setAttribute(name, value);
        }
      }
      saved.clear();
    },
  };
}

function ownerKeyOf(element: Element): string {
  const tree = element.closest('[data-kind="tree"]');
  if (tree) return `tree:${tree.getAttribute('data-tree-id')}`;
  const sprout = element.closest('[data-kind="sprout"]');
  if (sprout) return `sprout:${sprout.getAttribute('data-sprout-ref')}`;
  return element.closest('[data-kind="meadow"]') ? 'meadow' : 'fog';
}

const LEAVES = 'path[data-kind="leaf"], path[data-kind="fallen-leaf"]';
/** Drawn late in the intro: everything that is neither leaf, trunk, branch nor canopy. */
const LATE = [
  '[data-kind="tree"] > text',
  '[data-kind="tree"] > g:not([data-kind="canopy"]):not([data-kind="branch"])',
  'line.twig',
  'line.stem',
  '[data-kind="sprout"] > text',
  '[data-kind="meadow"] > text',
  '[data-kind="fog"] > text',
  '[data-kind="fog-bank"]',
  '[data-kind="shared-vine"]',
].join(', ');

function pathLength(path: SVGPathElement, fallback: number): number {
  // jsdom has no SVG geometry; the fallback is only a rough length.
  return typeof path.getTotalLength === 'function' ? path.getTotalLength() : fallback;
}

export interface GrowIntroOptions {
  /** Multiplies every duration. Tests pass a small number. */
  timeScale?: number;
  onStage?: (stage: GrowStage) => void;
  /** The intro ran to its end (not called when it is stopped). */
  onDone?: () => void;
}

/**
 * Stages 1–4 on a grove that renderGrove has just drawn from the clusters line:
 * leaves fall, swirl to their clusters, trunks grow, leaves attach and the
 * canopy fills. It animates the drawn elements themselves and ends with the
 * canvas exactly as renderGrove left it.
 */
export function playGrowIntro(
  svgElement: SVGSVGElement,
  layout: GroveLayout,
  options: GrowIntroOptions = {}
): GrowAnimation {
  const { trunks, canopy } = GROW_TIMELINE;
  const scale = Math.max(options.timeScale ?? 1, 0.001);
  const at = (ms: number) => ms * scale;
  const svg = select(svgElement);
  const root = svg.select<SVGGElement>('[data-kind="grove-root"]');
  const keeper = createKeeper();
  const temporary: Array<Selection<any, any, any, any>> = [];
  const treeById = new Map(layout.trees.map((tree) => [tree.id, tree]));

  keeper.hold(svgElement, 'data-growing');
  svg.attr('data-growing', 'true');
  if (!root.empty()) {
    keeper.hold(root.node() as Element, 'pointer-events');
    root.attr('pointer-events', 'none');
  }

  // Leaves: the drawn leaves are the ones that fall, so nothing is swapped at the end.
  const choreography = createLeafChoreography(layout);
  const waiting = new Map<string, number[]>();
  choreography.leaves.forEach((leaf, index) => {
    waiting.set(leaf.key, [...(waiting.get(leaf.key) ?? []), index]);
  });
  const initials = root.append('g').attr('data-kind', 'grow-initials').attr('pointer-events', 'none');
  temporary.push(initials);
  const flying: Array<{ element: SVGPathElement; index: number; letter: SVGTextElement }> = [];
  root.selectAll<SVGPathElement, LeafLayout>(LEAVES).each(function (leaf) {
    const index = waiting.get(`${ownerKeyOf(this)}|${leaf.tabRef}`)?.shift();
    if (index === undefined) return;
    keeper.hold(this, 'transform', 'opacity');
    const letter = initials
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-family', FONT.sans)
      .attr('font-size', 8.5)
      .attr('font-weight', 700)
      .attr('fill', PALETTE.halo)
      .text(choreography.leaves[index].initial);
    flying.push({ element: this, index, letter: letter.node() as SVGTextElement });
  });

  const place = (elapsedMs: number) => {
    const poses = choreography.poseAt(elapsedMs);
    for (const { element, index, letter } of flying) {
      const pose = poses[index];
      const radians = (pose.angle * Math.PI) / 180;
      const half = choreography.leaves[index].length / 2;
      element.setAttribute(
        'transform',
        `translate(${pose.x.toFixed(1)},${pose.y.toFixed(1)}) rotate(${pose.angle.toFixed(1)})`
      );
      element.setAttribute('opacity', String(pose.opacity));
      letter.setAttribute('x', (pose.x + Math.cos(radians) * half).toFixed(1));
      letter.setAttribute('y', (pose.y + Math.sin(radians) * half).toFixed(1));
      letter.setAttribute('opacity', (pose.opacity * pose.initialOpacity).toFixed(2));
    }
  };

  // Trunks rise from the ground and thicken; branches follow.
  const trunkMs = (trunks.end - trunks.start) * 0.75;
  root.selectAll<SVGGElement, unknown>('[data-kind="tree"]').each(function () {
    const tree = treeById.get(this.getAttribute('data-tree-id') ?? '');
    if (!tree) return;
    const group = select(this);
    const height = tree.groundY - tree.crown.y;

    const sapling = group
      .append('line')
      .attr('data-kind', 'grow-trunk')
      .attr('x1', tree.x)
      .attr('y1', tree.groundY)
      .attr('x2', tree.crown.x)
      .attr('y2', tree.crown.y)
      .attr('stroke', PALETTE.trunk)
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', height)
      .attr('stroke-dashoffset', height)
      .attr('pointer-events', 'none');
    temporary.push(sapling);
    sapling
      .transition()
      .delay(at(trunks.start))
      .duration(at(trunkMs))
      .ease(easeCubicOut)
      .attr('stroke-dashoffset', 0)
      .attr('stroke-width', tree.trunkWidth * 0.6)
      // The real trunk fades in over it, then the stand-in line goes.
      .transition()
      .duration(at(trunks.end - trunks.start - trunkMs))
      .remove();

    group.selectAll<SVGPathElement, unknown>('[data-kind="trunk"]').each(function () {
      keeper.hold(this, 'opacity');
      select(this)
        .attr('opacity', 0)
        .transition()
        .delay(at(trunks.start + trunkMs))
        .duration(at(trunks.end - trunks.start - trunkMs))
        .attr('opacity', 1);
    });

    group.selectAll<SVGPathElement, unknown>('[data-kind="branch"] > path:not(.leaf)').each(function () {
      keeper.hold(this, 'stroke-dasharray', 'stroke-dashoffset');
      const length = pathLength(this, height);
      select(this)
        .attr('stroke-dasharray', length)
        .attr('stroke-dashoffset', length)
        .transition()
        .delay(at(lerp(trunks.start, trunks.end, 0.5)))
        .duration(at((trunks.end - trunks.start) * 0.5))
        .attr('stroke-dashoffset', 0);
    });

    // Canopy blobs swell from nothing, with a little overshoot.
    group
      .selectAll<SVGCircleElement, { r: number }>('[data-kind="canopy"] circle')
      .each(function () {
        keeper.hold(this, 'r', 'fill');
      })
      .attr('r', 0)
      .transition()
      .delay((_, index) => at(canopy.start + index * 80))
      .duration(at(520))
      .ease(easeBackOut)
      .attr('r', (blob) => blob.r);

    if (tree.dormant) {
      // A dormant tree starts green like the rest and fades to amber.
      group
        .selectAll('[data-kind="canopy"] circle')
        .attr('fill', PALETTE.canopyGreen)
        .transition('tint')
        .delay(at(canopy.start))
        .duration(at(canopy.end - canopy.start))
        .attr('fill', PALETTE.canopyAmber);
      group
        .selectAll<SVGPathElement, unknown>('path[data-kind="leaf"]')
        .each(function () {
          keeper.hold(this, 'fill');
        })
        .attr('fill', PALETTE.leafGreen)
        .transition('tint')
        .delay(at(canopy.start))
        .duration(at(canopy.end - canopy.start))
        .attr('fill', PALETTE.leafAmber);
    }
  });

  root
    .selectAll<SVGElement, unknown>(LATE)
    .each(function () {
      keeper.hold(this, 'opacity');
    })
    .attr('opacity', 0)
    .transition()
    .delay(at(canopy.end - 250))
    .duration(at(250))
    .attr('opacity', 1);

  let finished = false;
  const settle = () => {
    finished = true;
    clock.stop();
    svg.selectAll('*').interrupt().interrupt('tint');
    for (const node of temporary) node.remove();
    keeper.restore();
  };

  let stage: GrowStage = 'fall';
  options.onStage?.(stage);
  place(0);
  const clock = timer((elapsed) => {
    const elapsedMs = elapsed / scale;
    const now = stageAt(elapsedMs);
    if (now !== stage) {
      stage = now;
      options.onStage?.(now);
    }
    if (elapsedMs >= INTRO_MS) {
      settle();
      options.onDone?.();
      return;
    }
    place(elapsedMs);
  });

  return {
    stop: () => {
      if (!finished) settle();
    },
  };
}

/** The reduced-motion grow: the new grove fades in over 300 ms and nothing moves. */
export function playGrowFade(svgElement: SVGSVGElement, timeScale = 1): GrowAnimation {
  const root = select(svgElement).select<SVGGElement>('[data-kind="grove-root"]');
  if (root.empty()) return { stop: () => undefined };
  root
    .attr('opacity', 0)
    .transition('grow-fade')
    .duration(REDUCED_FADE_MS * timeScale)
    .attr('opacity', 1)
    .on('end', () => root.attr('opacity', null));
  return {
    stop: () => {
      root.interrupt('grow-fade').attr('opacity', null);
    },
  };
}

export interface Arrivals {
  /** Trees whose AI result arrived between the two layouts, in forest order. */
  revealed: TreeLayout[];
  /** Ids of fireflies that were not on the canvas before. */
  fireflies: Set<string>;
}

/** What the forest has to say now that it could not say in the previous drawing. */
export function findArrivals(previous: GroveLayout, next: GroveLayout): Arrivals {
  const before = new Map(previous.trees.map((tree) => [tree.id, tree]));
  const knownFireflies = new Set(previous.trees.flatMap((tree) => tree.fireflies.map((f) => f.id)));
  return {
    revealed: next.trees.filter((tree) => !tree.pending && before.get(tree.id)?.pending === true),
    fireflies: new Set(
      next.trees
        .flatMap((tree) => tree.fireflies.map((firefly) => firefly.id))
        .filter((id) => !knownFireflies.has(id))
    ),
  };
}

export interface ArrivalOptions {
  timeScale?: number;
  reducedMotion?: boolean;
}

/**
 * Stage 5, "the forest speaks": run after renderGrove has redrawn the grove with
 * newly arrived results. Each tree that just got its result settles into its
 * real shape, its name types in, mushrooms pop, stones settle, fog rolls in and
 * a firefly drifts. Returns null when nothing arrived.
 */
export function playArrivals(
  svgElement: SVGSVGElement,
  previous: GroveLayout,
  next: GroveLayout,
  options: ArrivalOptions = {}
): GrowAnimation | null {
  const { revealed, fireflies } = findArrivals(previous, next);
  if (revealed.length === 0 && fireflies.size === 0) return null;

  const scale = Math.max(options.timeScale ?? 1, 0.001);
  const at = (ms: number) => ms * scale;
  const svg = select(svgElement);
  const root = svg.select<SVGGElement>('[data-kind="grove-root"]');
  const keeper = createKeeper();
  const before = new Map(previous.trees.map((tree) => [tree.id, tree]));
  const revealOrder = new Map(revealed.map((tree, index) => [tree.id, index]));
  const stagger = Math.min(REVEAL_STAGGER_MS, 600 / Math.max(1, revealed.length));

  const groups = new Map<string, AnyGroup>();
  root.selectAll<SVGGElement, unknown>('[data-kind="tree"]').each(function () {
    groups.set(this.getAttribute('data-tree-id') ?? '', select(this) as AnyGroup);
  });

  let longest = 0;
  const typed: Array<{ label: SVGTextElement; text: string }> = [];
  const finish = () => {
    svg.selectAll('*').interrupt();
    keeper.restore();
    for (const { label, text } of typed) label.textContent = text;
  };

  if (options.reducedMotion) {
    for (const tree of revealed) {
      const group = groups.get(tree.id);
      if (!group) continue;
      keeper.hold(group.node() as Element, 'opacity');
      group.attr('opacity', 0).transition().duration(at(REDUCED_FADE_MS)).attr('opacity', 1);
    }
    const done = timeout(finish, at(REDUCED_FADE_MS) + 40);
    return {
      stop: () => {
        done.stop();
        finish();
      },
    };
  }

  /** Fades in from nothing. */
  const appear = (nodes: Selection<any, any, any, any>, delay: number, duration: number) => {
    nodes
      .each(function (this: Element) {
        keeper.hold(this, 'opacity');
      })
      .attr('opacity', 0)
      .transition()
      .delay(at(delay))
      .duration(at(duration))
      .attr('opacity', 1);
    longest = Math.max(longest, delay + duration);
  };

  /** Runs `frame` with 0 → 1 on the element's transform, on top of where it is drawn. */
  const move = (
    nodes: Selection<any, any, any, any>,
    delay: number | ((index: number) => number),
    duration: number,
    ease: (k: number) => number,
    frame: (k: number) => string
  ) => {
    nodes
      .each(function (this: Element) {
        keeper.hold(this, 'transform', 'opacity');
      })
      .attr('opacity', 0)
      .transition()
      .delay((_, index) => at(typeof delay === 'function' ? delay(index) : delay))
      .duration(at(duration))
      .ease(ease)
      .attr('opacity', 1)
      // A hand-written tween: jsdom cannot parse SVG transforms for d3's own.
      .attrTween('transform', function (this: Element) {
        const base = keeper_base(this);
        return (k: number) => `${base}${frame(k)}`;
      });
    const last = typeof delay === 'function' ? delay(Math.max(0, nodes.size() - 1)) : delay;
    longest = Math.max(longest, last + duration);
  };
  const bases = new Map<Element, string>();
  const keeper_base = (element: Element): string => {
    if (!bases.has(element)) {
      const transform = element.getAttribute('transform');
      bases.set(element, transform ? `${transform} ` : '');
    }
    return bases.get(element) as string;
  };

  for (const tree of next.trees) {
    const group = groups.get(tree.id);
    const old = before.get(tree.id);
    if (!group || !old) continue;
    const order = revealOrder.get(tree.id);

    if (order === undefined) {
      // Its neighbours changed width, so this tree slides to its new place.
      const shift = old.x - tree.x;
      if (shift !== 0) {
        keeper.hold(group.node() as Element, 'transform');
        group
          .transition()
          .duration(at(MORPH_MS))
          .ease(easeCubicInOut)
          .attrTween('transform', () => (k: number) => `translate(${(shift * (1 - k)).toFixed(1)},0)`);
        longest = Math.max(longest, MORPH_MS);
      }
    } else {
      // Leaves move from where they hung on the listening tree to their real branch.
      const oldLeaves = new Map(
        [...old.branches.flatMap((branch) => branch.leaves), ...old.fallenLeaves].map((leaf) => [
          leaf.tabRef,
          leaf,
        ])
      );
      group.selectAll<SVGPathElement, LeafLayout>(LEAVES).each(function (leaf) {
        const from = oldLeaves.get(leaf.tabRef);
        if (!from) return;
        keeper.hold(this, 'transform');
        select(this)
          .transition()
          .duration(at(MORPH_MS))
          .ease(easeCubicInOut)
          .attrTween('transform', () => (k: number) =>
            `translate(${lerp(from.x, leaf.x, k).toFixed(1)},${lerp(from.y, leaf.y, k).toFixed(1)}) ` +
            `rotate(${lerp(from.angle, leaf.angle, k).toFixed(1)})`
          );
      });

      group
        .selectAll<SVGCircleElement, { cx: number; cy: number; r: number }>('[data-kind="canopy"] circle')
        .each(function (blob, index) {
          const from = old.canopy[index];
          if (!from) return;
          keeper.hold(this, 'cx', 'cy', 'r', 'fill');
          const tint = interpolateRgb(
            old.dormant ? PALETTE.canopyAmber : PALETTE.canopyGreen,
            tree.dormant ? PALETTE.canopyAmber : PALETTE.canopyGreen
          );
          select(this)
            .attr('cx', from.cx)
            .attr('cy', from.cy)
            .attr('r', from.r)
            .transition()
            .duration(at(MORPH_MS))
            .ease(easeCubicInOut)
            .attr('cx', blob.cx)
            .attr('cy', blob.cy)
            .attr('r', blob.r)
            .attrTween('fill', () => tint);
        });

      // The trunk thickens to the attention this goal really got.
      group.selectAll<SVGPathElement, unknown>('[data-kind="trunk"]').each(function () {
        keeper.hold(this, 'd');
        select(this)
          .transition()
          .duration(at(MORPH_MS))
          .ease(easeCubicInOut)
          .attrTween('d', () => interpolateString(old.trunkPath, tree.trunkPath));
      });
      longest = Math.max(longest, MORPH_MS);

      appear(
        group.selectAll(
          '[data-kind="branch"] > path:not(.leaf), line.twig, [data-kind="branch-label"], [data-kind="vine"]'
        ),
        MORPH_MS * 0.6,
        300
      );

      // The forest speaks: the goal's name types in, letter by letter.
      const speakAt = order * stagger;
      const labels = group.selectAll<SVGTextElement, unknown>(':scope > text:not([data-kind])');
      const name = labels.filter(function () {
        return this.textContent === tree.name;
      });
      const typingMs = tree.name.length * TYPE_MS_PER_CHAR;
      name
        .each(function () {
          typed.push({ label: this, text: tree.name });
        })
        .text('')
        .transition()
        .delay(at(speakAt))
        .duration(at(typingMs))
        .ease((k) => k)
        .tween('text', function () {
          return (k: number) => {
            this.textContent = tree.name.slice(0, Math.round(k * tree.name.length));
          };
        });
      appear(
        labels.filter(function () {
          return this.textContent !== tree.name && this.textContent !== '';
        }),
        speakAt + typingMs,
        200
      );
      longest = Math.max(longest, speakAt + typingMs);

      move(
        group.selectAll('[data-kind="mushroom"], [data-kind="flower"]'),
        (index) => speakAt + 80 + index * 60,
        350,
        easeBackOut,
        (k) => `scale(${Math.max(0, k).toFixed(3)})`
      );
      move(
        group.selectAll('[data-kind="stone"]'),
        (index) => speakAt + 140 + index * 60,
        450,
        easeBounceOut,
        (k) => `translate(0,${(-18 * (1 - k)).toFixed(1)})`
      );
      move(
        group.selectAll('[data-kind="tree-fog"]'),
        speakAt + 100,
        600,
        easeCubicOut,
        (k) => `translate(${(-36 * (1 - k)).toFixed(1)},0)`
      );
      appear(group.selectAll('[data-kind="hypothesis"]'), speakAt + 200, 400);
    }

    // One firefly drifts in for research that connects to an older grove.
    const newcomers = group.selectAll<SVGGElement, unknown>('[data-kind="firefly"]').filter(function (_, index) {
      return fireflies.has(tree.fireflies[index]?.id ?? '');
    });
    move(
      newcomers,
      (order ?? 0) * stagger + 200,
      700,
      easeCubicOut,
      (k) =>
        `translate(${(-40 * (1 - k)).toFixed(1)},${(26 * (1 - k) - Math.sin(k * Math.PI) * 10).toFixed(1)})`
    );
  }

  appear(root.selectAll('[data-kind="shared-vine"]'), MORPH_MS, 300);

  // Sprouts, the meadow and the fog patch also slide when the trees change width.
  const slide = (selector: string, shift: number) => {
    if (shift === 0) return;
    const group = root.select<SVGGElement>(selector);
    if (group.empty()) return;
    keeper.hold(group.node() as Element, 'transform');
    group
      .transition()
      .duration(at(MORPH_MS))
      .ease(easeCubicInOut)
      .attrTween('transform', () => (k: number) => `translate(${(shift * (1 - k)).toFixed(1)},0)`);
  };
  if (previous.meadow && next.meadow) slide('[data-kind="meadow"]', previous.meadow.x - next.meadow.x);
  if (previous.fog && next.fog) slide('[data-kind="fog"]', previous.fog.x - next.fog.x);

  // Clears the leftover opacity and transform attributes once everything has landed.
  const done = timeout(finish, at(longest) + 60);
  return {
    stop: () => {
      done.stop();
      finish();
    },
  };
}
