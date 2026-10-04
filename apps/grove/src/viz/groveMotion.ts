// The grove's motion layer, on top of what renderGrove draws. Three parts:
//
//   decorateGrove  depth (shadows, canopy shading, bark, a far tree line) and
//                  idle life (sway, leaf flutter, drifting fog and fireflies,
//                  a stray leaf off a dormant tree)
//   findChanges    what differs between two drawings of the grove (pure)
//   playChanges    animates those differences: a new leaf unfurls, a branch
//                  grows, the trunk thickens, a mushroom pops, a question
//                  blooms, a stone is carved, a tab flies to another tree, a
//                  closed tab falls, a dormant tree turns amber and sheds
//
// Everything here is decoration over real state: it never adds, removes or
// moves a tab. Decorative leaves cannot be clicked and are not counted. The
// whole layer sits behind viz/motionSwitch.ts and can be removed without
// touching render.ts or growAnimation.ts.
import {
  easeBackOut,
  easeBounceOut,
  easeCubicInOut,
  easeCubicOut,
  interpolateRgb,
  interpolateString,
  select,
  timeout,
  type Selection,
} from 'd3';
import type { GroveLayout, LeafLayout } from './layout';
import { PALETTE } from './palette';

export interface GroveMotion {
  /** Cancels what is running and leaves the grove as it was drawn. */
  stop: () => void;
}

const NS = 'http://www.w3.org/2000/svg';
const MORPH_MS = 450;
const LEAVES = 'path[data-kind="leaf"], path[data-kind="fallen-leaf"]';

// Tones for the depth layer; darker and lighter steps of the grove's own colors.
const DEPTH = {
  far: '#0d1c12',
  hill: '#0a170e',
  shadow: '#000000',
  backGreen: '#1f3a27',
  backAmber: '#74400f',
  lightGreen: '#4c875b',
  lightAmber: '#d08a3c',
  bark: '#5a4838',
} as const;

interface Pose {
  x: number;
  y: number;
  angle: number;
}

/** Same teardrop as render.ts draws, for the leaves this layer adds on its own. */
function leafPath(length: number): string {
  const w = length * 0.42;
  return (
    `M0,0C${length * 0.35},${-w} ${length * 0.85},${-w * 0.7} ${length},0` +
    `C${length * 0.85},${w * 0.7} ${length * 0.35},${w} 0,0Z`
  );
}

const lerp = (from: number, to: number, k: number) => from + (to - from) * k;
const placed = (x: number, y: number, angle: number, scale = 1) =>
  `translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${angle.toFixed(1)})` +
  (scale === 1 ? '' : ` scale(${Math.max(0, scale).toFixed(3)})`);

/** Repeatable scatter, so the same change always plays the same way. */
function noise(index: number, salt: number): number {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/** A leaf's way down: it drifts sideways, turns over and settles. */
function fallPose(from: Pose, to: Pose, k: number, seed: number): Pose {
  const sway = Math.sin(k * Math.PI * 3) * 16 * (1 - k * 0.4);
  const spin = (noise(seed, 3) > 0.5 ? 1 : -1) * (200 + noise(seed, 4) * 200);
  const turn = k >= 1 ? to.angle : from.angle + spin * k;
  return { x: lerp(from.x, to.x, k) + sway, y: lerp(from.y, to.y, Math.pow(k, 1.5)), angle: turn };
}

/* ------------------------------------------------------------------ */
/* What changed                                                        */
/* ------------------------------------------------------------------ */

export type LeafChange =
  | { kind: 'new' }
  | { kind: 'regrew' }
  | { kind: 'moved'; from: Pose }
  | { kind: 'fell'; from: Pose }
  | { kind: 'flew'; from: Pose };

export interface TreeChange {
  id: string;
  /** How far the tree's place moved (old x minus new x). */
  shift: number;
  /** The tree was not in the previous drawing. */
  grown: boolean;
  trunk: boolean;
  canopy: boolean;
  dormancy: 'slept' | 'woke' | null;
  leaves: Map<string, LeafChange>;
  /** Tabs that hung here before and are now nowhere in the grove. */
  lost: Array<Pose & { length: number; wasDormant: boolean; fallen: boolean }>;
  newBranches: Set<string>;
  mushrooms: Map<string, 'new' | 'bloomed'>;
  stones: Map<string, 'new' | 'carved'>;
  /** True when anything inside the tree changed (not only its place). */
  changed: boolean;
}

export interface GroveChanges {
  trees: TreeChange[];
  /** Leaves in sprouts, the meadow or the fog patch that arrived from a tree. */
  patchLeaves: Map<string, LeafChange>;
  any: boolean;
}

interface Hung extends Pose {
  owner: string;
  tabRef: string;
  length: number;
  fallen: boolean;
}

function hungLeaves(layout: GroveLayout): Hung[] {
  const all: Hung[] = [];
  const add = (owner: string, leaves: LeafLayout[], fallen: boolean) => {
    for (const leaf of leaves) {
      all.push({ owner, tabRef: leaf.tabRef, x: leaf.x, y: leaf.y, angle: leaf.angle, length: leaf.length, fallen });
    }
  };
  for (const tree of layout.trees) {
    add(`tree:${tree.id}`, tree.branches.flatMap((branch) => branch.leaves), false);
    add(`tree:${tree.id}`, tree.fallenLeaves, true);
  }
  for (const sprout of layout.sprouts) add(`sprout:${sprout.ref}`, sprout.leaves, false);
  if (layout.meadow) add('meadow', layout.meadow.leaves, false);
  if (layout.fog) add('fog', layout.fog.leaves, false);
  return all;
}

const samePose = (a: Pose, b: Pose) => a.x === b.x && a.y === b.y && a.angle === b.angle;

/** What the next drawing shows that the previous one did not. Trees still listening are left alone. */
export function findChanges(previous: GroveLayout, next: GroveLayout): GroveChanges {
  const before = new Map(previous.trees.map((tree) => [tree.id, tree]));
  const hungBefore = hungLeaves(previous);
  const hungNow = hungLeaves(next);
  const beforeByRef = new Map<string, Hung[]>();
  for (const leaf of hungBefore) beforeByRef.set(leaf.tabRef, [...(beforeByRef.get(leaf.tabRef) ?? []), leaf]);
  const nowKeys = new Set(hungNow.map((leaf) => `${leaf.owner}|${leaf.tabRef}`));
  const nowRefs = new Set(hungNow.map((leaf) => leaf.tabRef));

  /** A leaf that was somewhere else before and is no longer there. */
  const arrivedFrom = (owner: string, tabRef: string): Hung | undefined =>
    (beforeByRef.get(tabRef) ?? []).find(
      (leaf) => leaf.owner !== owner && !nowKeys.has(`${leaf.owner}|${tabRef}`)
    );

  const trees: TreeChange[] = [];
  for (const tree of next.trees) {
    if (tree.pending) continue;
    const old = before.get(tree.id);
    if (old?.pending) continue;
    const owner = `tree:${tree.id}`;
    const change: TreeChange = {
      id: tree.id,
      shift: old ? old.x - tree.x : 0,
      grown: !old,
      trunk: false,
      canopy: false,
      dormancy: null,
      leaves: new Map(),
      lost: [],
      newBranches: new Set(),
      mushrooms: new Map(),
      stones: new Map(),
      changed: !old,
    };

    if (old) {
      // Compared without the tree's own shift, so a tree that only moved over is not "changed".
      const shift = change.shift;
      change.trunk = old.trunkWidth !== tree.trunkWidth;
      change.canopy =
        old.canopy.length !== tree.canopy.length ||
        old.canopy.some((blob, i) => blob.r !== tree.canopy[i].r || blob.cy !== tree.canopy[i].cy);
      if (old.dormant !== tree.dormant) change.dormancy = tree.dormant ? 'slept' : 'woke';

      const oldLeaves = new Map(
        hungBefore.filter((leaf) => leaf.owner === owner).map((leaf) => [leaf.tabRef, leaf])
      );
      const visit = (leaf: LeafLayout, fallen: boolean) => {
        const was = oldLeaves.get(leaf.tabRef);
        if (was) {
          if (!was.fallen && fallen) change.leaves.set(leaf.tabRef, { kind: 'fell', from: was });
          else if (was.fallen && !fallen) change.leaves.set(leaf.tabRef, { kind: 'regrew' });
          else if (!samePose({ ...was, x: was.x - shift }, leaf)) {
            change.leaves.set(leaf.tabRef, { kind: 'moved', from: was });
          }
          return;
        }
        const from = arrivedFrom(owner, leaf.tabRef);
        change.leaves.set(leaf.tabRef, from ? { kind: 'flew', from } : { kind: 'new' });
      };
      tree.branches.forEach((branch) => branch.leaves.forEach((leaf) => visit(leaf, false)));
      tree.fallenLeaves.forEach((leaf) => visit(leaf, true));

      for (const [tabRef, was] of oldLeaves) {
        if (!nowRefs.has(tabRef)) {
          change.lost.push({ x: was.x, y: was.y, angle: was.angle, length: was.length, wasDormant: old.dormant, fallen: was.fallen });
        }
      }

      const oldBranches = new Set(old.branches.map((branch) => branch.ref));
      for (const branch of tree.branches) if (!oldBranches.has(branch.ref)) change.newBranches.add(branch.ref);

      const oldMushrooms = new Map(old.mushrooms.map((m) => [m.id, m]));
      for (const mushroom of tree.mushrooms) {
        const was = oldMushrooms.get(mushroom.id);
        if (!was) change.mushrooms.set(mushroom.id, 'new');
        else if (!was.resolved && mushroom.resolved) change.mushrooms.set(mushroom.id, 'bloomed');
      }
      const oldStones = new Map(old.stones.map((s) => [s.id, s]));
      for (const stone of tree.stones) {
        const was = oldStones.get(stone.id);
        if (!was) change.stones.set(stone.id, 'new');
        else if (was.kind === 'mossy' && stone.kind === 'carved') change.stones.set(stone.id, 'carved');
      }

      // A leaf that only moved because leaves around it changed is not a change by itself.
      const realLeafChange = [...change.leaves.values()].some((leaf) => leaf.kind !== 'moved');
      change.changed =
        change.trunk ||
        change.canopy ||
        change.dormancy !== null ||
        realLeafChange ||
        change.lost.length > 0 ||
        change.newBranches.size > 0 ||
        change.mushrooms.size > 0 ||
        change.stones.size > 0;
      if (!change.changed) change.leaves.clear();
    }
    trees.push(change);
  }

  const patchLeaves = new Map<string, LeafChange>();
  for (const leaf of hungNow) {
    if (leaf.owner.startsWith('tree:')) continue;
    const key = `${leaf.owner}|${leaf.tabRef}`;
    if ((beforeByRef.get(leaf.tabRef) ?? []).some((was) => was.owner === leaf.owner)) continue;
    const from = arrivedFrom(leaf.owner, leaf.tabRef);
    patchLeaves.set(key, from ? { kind: 'flew', from } : { kind: 'new' });
  }

  return {
    trees,
    patchLeaves,
    any: trees.some((tree) => tree.changed || tree.shift !== 0) || patchLeaves.size > 0,
  };
}

/* ------------------------------------------------------------------ */
/* Playing the changes                                                 */
/* ------------------------------------------------------------------ */

type Any = Selection<any, any, any, any>;

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

export interface ChangeOptions {
  /** Multiplies every duration. Tests pass a small number; the tutorial slows things down. */
  timeScale?: number;
}

/**
 * Run after renderGrove has redrawn the grove: animates from the previous
 * drawing to this one and ends exactly on what is drawn. Returns null when the
 * two drawings show the same thing.
 */
export function playChanges(
  svgElement: SVGSVGElement,
  previous: GroveLayout,
  next: GroveLayout,
  options: ChangeOptions = {}
): GroveMotion | null {
  const changes = findChanges(previous, next);
  if (!changes.any) return null;

  const scale = Math.max(options.timeScale ?? 1, 0.001);
  const at = (ms: number) => ms * scale;
  const svg = select(svgElement);
  const root = svg.select<SVGGElement>('[data-kind="grove-root"]');
  const keeper = createKeeper();
  const temporary: Any[] = [];
  const before = new Map(previous.trees.map((tree) => [tree.id, tree]));
  const now = new Map(next.trees.map((tree) => [tree.id, tree]));
  let longest = 0;
  const took = (ms: number) => {
    longest = Math.max(longest, ms);
  };

  const fade = (nodes: Any, delay: number, duration = 300) => {
    nodes
      .each(function (this: Element) {
        keeper.hold(this, 'opacity');
      })
      .attr('opacity', 0)
      .transition()
      .delay(at(delay))
      .duration(at(duration))
      .attr('opacity', 1);
    took(delay + duration);
  };

  /** Tweens a leaf's transform with a pose that depends on 0 → 1. */
  const moveLeaf = (
    element: SVGPathElement,
    pose: (k: number) => Pose & { scale?: number },
    delay: number,
    duration: number,
    ease: (k: number) => number
  ) => {
    keeper.hold(element, 'transform');
    const start = pose(0);
    select(element)
      .attr('transform', placed(start.x, start.y, start.angle, start.scale ?? 1))
      .transition()
      .delay(at(delay))
      .duration(at(duration))
      .ease(ease)
      // A hand-written tween: jsdom cannot parse SVG transforms for d3's own.
      .attrTween('transform', () => (k: number) => {
        const p = pose(k);
        return placed(p.x, p.y, p.angle, p.scale ?? 1);
      });
    took(delay + duration);
  };

  const unfurl = (element: SVGPathElement, leaf: LeafLayout, delay: number) =>
    moveLeaf(element, (k) => ({ x: leaf.x, y: leaf.y, angle: leaf.angle - 40 * (1 - k), scale: k }), delay, 650, easeBackOut);

  /** Grows a path from its start, like a branch reaching out. */
  const draw = (nodes: Any, delay: number, duration: number, length: number) => {
    nodes
      .each(function (this: SVGPathElement) {
        keeper.hold(this, 'stroke-dasharray', 'stroke-dashoffset');
        const total = typeof this.getTotalLength === 'function' ? this.getTotalLength() : length;
        select(this)
          .attr('stroke-dasharray', total)
          .attr('stroke-dashoffset', total)
          .transition()
          .delay(at(delay))
          .duration(at(duration))
          .ease(easeCubicOut)
          .attr('stroke-dashoffset', 0);
      });
    took(delay + duration);
  };

  /** Scales a ground item up from where it stands, on top of its own transform. */
  const pop = (nodes: Any, delay: number, duration: number, ease: (k: number) => number, frame: (k: number) => string) => {
    nodes
      .each(function (this: Element) {
        keeper.hold(this, 'transform', 'opacity');
      })
      .attr('opacity', 0)
      .transition()
      .delay(at(delay))
      .duration(at(duration))
      .ease(ease)
      .attr('opacity', 1)
      .attrTween('transform', function (this: Element) {
        const base = this.getAttribute('transform') ?? '';
        return (k: number) => `${base} ${frame(k)}`.trim();
      });
    took(delay + duration);
  };

  /** A leaf that exists only for the length of an animation: it is not a tab and cannot be clicked. */
  const ghostLeaf = (length: number, fill: string, kind: 'motion-ghost' | 'motion-decor') => {
    const ghost = root
      .append('path')
      .attr('data-kind', kind)
      .attr('aria-hidden', 'true')
      .attr('pointer-events', 'none')
      .attr('d', leafPath(length))
      .attr('fill', fill);
    temporary.push(ghost);
    return ghost;
  };

  const fallGhost = (ghost: Any, from: Pose, to: Pose, delay: number, duration: number, seed: number) => {
    ghost
      .attr('transform', placed(from.x, from.y, from.angle))
      .attr('opacity', delay > 0 ? 0 : 1)
      .transition()
      .delay(at(delay))
      .duration(at(duration))
      .ease((k: number) => k)
      .attrTween('transform', () => (k: number) => {
        const p = fallPose(from, to, k, seed);
        return placed(p.x, p.y, p.angle);
      })
      .attrTween('opacity', () => (k: number) => String(k < 0.7 ? 1 : Math.max(0, (1 - k) / 0.3)));
    took(delay + duration);
  };

  const groups = new Map<string, Any>();
  root.selectAll<SVGGElement, unknown>('[data-kind="tree"]').each(function () {
    groups.set(this.getAttribute('data-tree-id') ?? '', select(this));
  });

  for (const change of changes.trees) {
    const group = groups.get(change.id);
    const tree = now.get(change.id);
    if (!group || !tree) continue;
    const old = before.get(change.id);

    if (change.grown || !old) {
      growTree(group);
      continue;
    }

    if (!change.changed) {
      // Only its place changed, because a neighbour got wider or narrower.
      if (change.shift !== 0) {
        keeper.hold(group.node() as Element, 'transform');
        group
          .attr('transform', `translate(${change.shift.toFixed(1)},0)`)
          .transition()
          .duration(at(MORPH_MS))
          .ease(easeCubicInOut)
          .attrTween('transform', () => (k: number) => `translate(${(change.shift * (1 - k)).toFixed(1)},0)`);
        took(MORPH_MS);
      }
      continue;
    }

    const leafGreen = PALETTE.leafGreen;
    const leafAmber = PALETTE.leafAmber;
    const oldLeafFill = old.dormant ? leafAmber : leafGreen;
    const newLeafFill = tree.dormant ? leafAmber : leafGreen;
    const tintDelay = change.dormancy ? 200 : 0;

    // Leaves.
    let fresh = 0;
    group.selectAll<SVGPathElement, LeafLayout>(LEAVES).each(function (leaf, index) {
      const leafChange = change.leaves.get(leaf.tabRef);
      const onBranch = this.getAttribute('data-kind') === 'leaf';
      if (!leafChange) {
        if (change.shift !== 0) {
          moveLeaf(this, (k) => ({ x: leaf.x + change.shift * (1 - k), y: leaf.y, angle: leaf.angle }), 0, MORPH_MS, easeCubicInOut);
        }
      } else if (leafChange.kind === 'new' || leafChange.kind === 'regrew') {
        const wait = (change.newBranches.size > 0 ? 700 : 150) + (change.dormancy === 'woke' ? 700 : 0) + fresh * 160;
        fresh += 1;
        unfurl(this, leaf, wait);
      } else if (leafChange.kind === 'moved') {
        const from = leafChange.from;
        moveLeaf(this, (k) => ({ x: lerp(from.x, leaf.x, k), y: lerp(from.y, leaf.y, k), angle: lerp(from.angle, leaf.angle, k) }), 0, MORPH_MS, easeCubicInOut);
      } else if (leafChange.kind === 'fell') {
        const from = leafChange.from;
        const wait = 900 + index * 320;
        moveLeaf(this, (k) => fallPose(from, leaf, k, index), wait, 1900, (k) => k);
        keeper.hold(this, 'fill', 'fill-opacity');
        select(this)
          .attr('fill', oldLeafFill)
          .attr('fill-opacity', 1)
          .transition('tint')
          .delay(at(wait + 900))
          .duration(at(900))
          .attr('fill', PALETTE.fallenLeaf)
          .attr('fill-opacity', 0.85);
      } else {
        // The tab was moved here from another tree: the leaf flies over in an arc.
        const from = leafChange.from;
        const turn = ((((leaf.angle - from.angle) % 360) + 540) % 360) - 180;
        moveLeaf(
          this,
          (k) => ({
            x: lerp(from.x, leaf.x, k),
            y: lerp(from.y, leaf.y, k) - Math.sin(k * Math.PI) * 60,
            angle: from.angle + turn * k,
          }),
          150,
          1300,
          easeCubicInOut
        );
      }

      if (change.dormancy && onBranch && leafChange?.kind !== 'fell') {
        keeper.hold(this, 'fill');
        select(this)
          .attr('fill', oldLeafFill)
          .transition('tint')
          .delay(at(tintDelay))
          .duration(at(1400))
          .attr('fill', newLeafFill);
        took(tintDelay + 1400);
      }
    });

    // A closed tab's leaf lets go and falls out of the grove.
    change.lost.forEach((was, index) => {
      const fill = was.fallen ? PALETTE.fallenLeaf : was.wasDormant ? leafAmber : leafGreen;
      const ghost = ghostLeaf(was.length, fill, 'motion-ghost');
      fallGhost(ghost, was, { x: was.x + (noise(index, 6) - 0.5) * 70, y: next.groundY - 3, angle: -6 }, 250 + index * 200, 1900, index + 11);
      ghost.attr('opacity', 1);
    });

    // Twigs and vines are redrawn for the new leaf places; they come in once the leaves have moved.
    if (change.leaves.size > 0 || change.lost.length > 0 || change.shift !== 0) {
      fade(group.selectAll('line.twig, [data-kind="vine"]'), MORPH_MS, 300);
    }

    // A new branch reaches out from the crown.
    if (change.newBranches.size > 0) {
      const added = group.selectAll<SVGGElement, unknown>('[data-kind="branch"]').filter(function () {
        return change.newBranches.has(this.getAttribute('data-branch-ref') ?? '');
      });
      draw(added.selectAll(':scope > path:not(.leaf)'), 150, 800, 120);
    }

    // Trunk and canopy move from their old shape to the new one.
    if (change.trunk || change.shift !== 0) {
      group.selectAll<SVGPathElement, unknown>('[data-kind="trunk"]').each(function () {
        keeper.hold(this, 'd');
        select(this)
          .attr('d', old.trunkPath)
          .transition()
          .duration(at(change.trunk ? 1300 : MORPH_MS))
          .ease(easeCubicInOut)
          .attrTween('d', () => interpolateString(old.trunkPath, tree.trunkPath));
      });
      took(change.trunk ? 1300 : MORPH_MS);
    }
    if (change.canopy || change.dormancy || change.shift !== 0) {
      const length = change.dormancy ? 1600 : change.canopy ? 1100 : MORPH_MS;
      const tint = interpolateRgb(
        old.dormant ? PALETTE.canopyAmber : PALETTE.canopyGreen,
        tree.dormant ? PALETTE.canopyAmber : PALETTE.canopyGreen
      );
      group
        .selectAll<SVGCircleElement, { cx: number; cy: number; r: number }>('[data-kind="canopy"] circle')
        .each(function (blob, index) {
          const from = old.canopy[index];
          if (!from) return;
          keeper.hold(this, 'cx', 'cy', 'r', 'fill');
          // A tree that has gone quiet thins out before it settles at its drawn size.
          const thin = change.dormancy === 'slept' ? 0.86 : 1;
          select(this)
            .attr('cx', from.cx)
            .attr('cy', from.cy)
            .attr('r', from.r)
            .transition()
            .delay(at(tintDelay))
            .duration(at(length))
            .ease(easeCubicInOut)
            .attr('cx', blob.cx)
            .attr('cy', blob.cy)
            .attrTween('r', () => (k: number) => String(lerp(from.r, blob.r, k) * lerp(1, thin, Math.sin(k * Math.PI))))
            .attrTween('fill', () => tint);
        });
      took(tintDelay + length);
    }

    // Going dormant: loose leaves drift down out of the canopy. They are decoration, not tabs.
    if (change.dormancy === 'slept') {
      const top = tree.canopy[0];
      const count = Math.min(10, tree.leafCount + 4);
      for (let i = 0; i < count; i++) {
        const from = {
          x: top.cx + (noise(i, 21) - 0.5) * top.r * 1.6,
          y: top.cy + (noise(i, 22) - 0.5) * top.r,
          angle: noise(i, 23) * 360,
        };
        const ghost = ghostLeaf(11, leafAmber, 'motion-decor');
        fallGhost(ghost, from, { x: from.x + (noise(i, 24) - 0.5) * 80, y: next.groundY - 3, angle: 0 }, 600 + i * 260, 2200, i + 31);
      }
    }

    // Ground items, found by the id each one carries.
    const byId = (kinds: string, id: string) =>
      group.selectAll<SVGGElement, unknown>(kinds).filter(function () {
        return this.getAttribute('data-select-id') === id;
      });

    for (const [id, what] of change.mushrooms) {
      const node = byId('[data-kind="mushroom"], [data-kind="flower"]', id);
      if (node.empty()) continue;
      if (what === 'new') {
        pop(node, 150, 620, easeBackOut, (k) => `scale(${Math.max(0, k).toFixed(3)})`);
        continue;
      }
      // The question was answered: the cap closes and a flower opens in its place.
      const cap = node
        .append('path')
        .attr('data-kind', 'motion-ghost')
        .attr('pointer-events', 'none')
        .attr('d', 'M-11,-11A11,9.35 0 0 1 11,-11Z')
        .attr('fill', PALETTE.mushroomCap);
      temporary.push(cap);
      cap
        .transition()
        .delay(at(150))
        .duration(at(420))
        .attrTween('transform', () => (k: number) => `translate(0,-11) scale(${(1 - k).toFixed(3)}) translate(0,11)`);
      node.selectAll<SVGLineElement, unknown>('line').each(function () {
        keeper.hold(this, 'y2');
        const full = this.getAttribute('y2') ?? '-20';
        select(this).attr('y2', -11).transition().delay(at(400)).duration(at(480)).attr('y2', full);
      });
      node.selectAll<SVGCircleElement, unknown>('circle').each(function (_, index) {
        keeper.hold(this, 'r');
        const full = this.getAttribute('r') ?? '4';
        select(this)
          .attr('r', 0)
          .transition()
          .delay(at(850 + index * 130))
          .duration(at(420))
          .ease(easeBackOut)
          .attr('r', full);
      });
      took(850 + 5 * 130 + 420);
    }

    for (const [id, what] of change.stones) {
      const node = byId('[data-kind="stone"]', id);
      if (node.empty()) continue;
      if (what === 'new') {
        pop(node, 150, 520, easeBounceOut, (k) => `translate(0,${(-18 * (1 - k)).toFixed(1)})`);
        continue;
      }
      // The decision was confirmed: the moss slides off and the marks are cut in.
      const moss = node
        .append('path')
        .attr('data-kind', 'motion-ghost')
        .attr('pointer-events', 'none')
        .attr('d', 'M-11,-11Q-3,-21 9,-14Q2,-11 -11,-11Z')
        .attr('fill', PALETTE.moss);
      temporary.push(moss);
      moss
        .transition()
        .delay(at(150))
        .duration(at(700))
        .attrTween('transform', () => (k: number) => `translate(0,${(-8 * k).toFixed(1)})`)
        .attrTween('opacity', () => (k: number) => String(1 - k));
      const paths = node.selectAll<SVGPathElement, unknown>(':scope > path:not([data-kind])');
      paths.each(function (_, index) {
        if (index === 0) {
          keeper.hold(this, 'fill', 'stroke');
          select(this)
            .attr('fill', PALETTE.stoneDark)
            .attr('stroke', PALETTE.moss)
            .transition()
            .delay(at(150))
            .duration(at(800))
            .attr('fill', PALETTE.stone)
            .attr('stroke', PALETTE.stoneLight);
        } else {
          draw(select(this), 700, 600, 24);
        }
      });
      took(1300);
    }
  }

  // Leaves that came to a sprout, the meadow or the fog patch.
  if (changes.patchLeaves.size > 0) {
    root.selectAll<SVGPathElement, LeafLayout>(LEAVES).each(function (leaf) {
      const owner = ownerKeyOf(this);
      if (owner.startsWith('tree:')) return;
      const leafChange = changes.patchLeaves.get(`${owner}|${leaf.tabRef}`);
      if (!leafChange) return;
      if (leafChange.kind === 'flew') {
        const from = leafChange.from;
        moveLeaf(this, (k) => ({ x: lerp(from.x, leaf.x, k), y: lerp(from.y, leaf.y, k) - Math.sin(k * Math.PI) * 60, angle: lerp(from.angle, leaf.angle, k) }), 150, 1300, easeCubicInOut);
      } else {
        unfurl(this, leaf, 150);
      }
    });
  }

  /** A tree that was not there before: the trunk rises, the canopy opens, the leaves come out. */
  function growTree(group: Any) {
    const ground = next.groundY;
    group.selectAll<SVGPathElement, unknown>('[data-kind="trunk"]').each(function () {
      keeper.hold(this, 'transform');
      select(this)
        .attr('transform', `translate(0,${ground}) scale(1,0) translate(0,${-ground})`)
        .transition()
        .delay(at(200))
        .duration(at(900))
        .ease(easeCubicOut)
        .attrTween('transform', () => (k: number) => `translate(0,${ground}) scale(1,${k.toFixed(3)}) translate(0,${-ground})`);
    });
    group
      .selectAll<SVGCircleElement, { r: number }>('[data-kind="canopy"] circle')
      .each(function () {
        keeper.hold(this, 'r');
      })
      .attr('r', 0)
      .transition()
      .delay((_, index) => at(1000 + index * 110))
      .duration(at(600))
      .ease(easeBackOut)
      .attr('r', (blob) => blob.r);
    fade(
      group.selectAll(
        ':scope > text, [data-kind="branch"] > path:not(.leaf), line.twig, [data-kind="vine"], [data-kind="mushroom"], [data-kind="flower"], [data-kind="stone"], [data-kind="hypothesis"], [data-kind="firefly"], [data-kind="tree-fog"], [data-kind="decor"]'
      ),
      1400,
      400
    );
    group.selectAll<SVGPathElement, LeafLayout>(LEAVES).each(function (leaf, index) {
      unfurl(this, leaf, 1600 + index * 150);
    });
  }

  const finish = () => {
    svg.selectAll('*').interrupt().interrupt('tint');
    for (const node of temporary) node.remove();
    keeper.restore();
  };
  const done = timeout(finish, at(longest) + 80);
  return {
    stop: () => {
      done.stop();
      finish();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Depth and idle life                                                 */
/* ------------------------------------------------------------------ */

export interface DecorateOptions {
  /** No idle movement: only the still depth layer. For reduced-motion users. */
  still?: boolean;
}

function svgNode(tag: string, attributes: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

/** A looping, additive transform: it rides on top of whatever transform the element has. */
function loop(type: 'rotate' | 'translate', values: string, seconds: number, offset: number): SVGElement {
  return svgNode('animateTransform', {
    attributeName: 'transform',
    type,
    additive: 'sum',
    values,
    dur: `${seconds.toFixed(2)}s`,
    begin: `${(-offset).toFixed(2)}s`,
    repeatCount: 'indefinite',
    calcMode: 'spline',
    keyTimes: values.split(';').map((_, index, all) => (index / (all.length - 1)).toFixed(3)).join(';'),
    keySplines: values.split(';').slice(1).map(() => '0.45 0 0.55 1').join(';'),
  });
}

/**
 * Adds depth and idle life to a grove renderGrove has just drawn. Everything it
 * adds is marked data-kind="decor", ignores the pointer and is redrawn away on
 * the next render.
 */
export function decorateGrove(
  svgElement: SVGSVGElement,
  layout: GroveLayout,
  options: DecorateOptions = {}
): GroveMotion {
  const svg = select(svgElement);
  const root = svg.select<SVGGElement>('[data-kind="grove-root"]');
  if (root.empty()) return { stop: () => undefined };
  const ground = layout.groundY;

  // A far line of trees and a low hill behind the grove.
  const far = root
    .insert('g', ':first-child')
    .attr('data-kind', 'decor')
    .attr('data-decor', 'far')
    .attr('aria-hidden', 'true')
    .attr('pointer-events', 'none');
  const w = layout.width;
  far
    .append('path')
    .attr('fill', DEPTH.hill)
    .attr('d', `M${-w},${ground}C${w * 0.1},${ground - 70} ${w * 0.3},${ground - 28} ${w * 0.45},${ground - 60}S${w * 0.8},${ground - 20} ${w * 2},${ground - 72}V${ground}Z`);
  const count = Math.max(4, Math.round(w / 260));
  for (let i = 0; i < count; i++) {
    const x = ((i + 0.5) / count) * w + (noise(i, 41) - 0.5) * 90;
    const s = 0.7 + noise(i, 42) * 0.4;
    far.append('rect').attr('fill', DEPTH.far).attr('x', x - 3 * s).attr('y', ground - 110 * s).attr('width', 6 * s).attr('height', 110 * s);
    far.append('circle').attr('fill', DEPTH.far).attr('cx', x).attr('cy', ground - 128 * s).attr('r', 44 * s);
    far.append('circle').attr('fill', DEPTH.far).attr('cx', x - 26 * s).attr('cy', ground - 108 * s).attr('r', 30 * s);
    far.append('circle').attr('fill', DEPTH.far).attr('cx', x + 26 * s).attr('cy', ground - 108 * s).attr('r', 30 * s);
  }

  const byId = new Map(layout.trees.map((tree) => [tree.id, tree]));
  root.selectAll<SVGGElement, unknown>('[data-kind="tree"]').each(function (_, treeIndex) {
    const tree = byId.get(this.getAttribute('data-tree-id') ?? '');
    if (!tree) return;
    const group = select(this);
    const top = tree.canopy[0];

    // Under the canopy: a soft shadow on the ground and a darker mass behind the leaves.
    const under = group
      .insert('g', '[data-kind="canopy"]')
      .attr('data-kind', 'decor')
      .attr('aria-hidden', 'true')
      .attr('pointer-events', 'none');
    under.append('ellipse').attr('cx', tree.x).attr('cy', ground + 5).attr('rx', top.r * 1.05).attr('ry', 7).attr('fill', DEPTH.shadow).attr('fill-opacity', 0.28);
    under
      .append('circle')
      .attr('cx', top.cx + top.r * 0.16)
      .attr('cy', top.cy + top.r * 0.12)
      .attr('r', top.r * 1.08)
      .attr('fill', tree.dormant ? DEPTH.backAmber : DEPTH.backGreen)
      .attr('fill-opacity', 0.75);

    // Over the canopy: a lighter patch where the light falls, and bark lines on the trunk.
    const over = group
      .insert('g', '[data-kind="trunk"]')
      .attr('data-kind', 'decor')
      .attr('aria-hidden', 'true')
      .attr('pointer-events', 'none');
    over
      .append('circle')
      .attr('cx', top.cx - top.r * 0.35)
      .attr('cy', top.cy - top.r * 0.38)
      .attr('r', top.r * 0.42)
      .attr('fill', tree.dormant ? DEPTH.lightAmber : DEPTH.lightGreen)
      .attr('fill-opacity', 0.3);
    const height = ground - tree.crown.y;
    const bark = svgNode('g', { 'data-kind': 'decor', 'aria-hidden': 'true', 'pointer-events': 'none' });
    bark.appendChild(
      svgNode('path', {
        d: `M${tree.x - tree.trunkWidth * 0.08},${ground - height * 0.2}v${-height * 0.22}M${tree.x + tree.trunkWidth * 0.1},${ground - height * 0.52}v${-height * 0.18}`,
        fill: 'none',
        stroke: DEPTH.bark,
        'stroke-width': 1.4,
        'stroke-linecap': 'round',
      })
    );
    const trunk = this.querySelector('[data-kind="trunk"]');
    if (trunk) trunk.after(bark);

    if (options.still) return;

    // Idle life. Each loop is offset so no two trees or leaves move together.
    const canopy = this.querySelector('[data-kind="canopy"]');
    if (canopy) {
      const pivot = `${tree.crown.x} ${tree.crown.y}`;
      canopy.appendChild(loop('rotate', `-0.6 ${pivot};0.6 ${pivot};-0.6 ${pivot}`, 12 + noise(treeIndex, 51) * 5, noise(treeIndex, 52) * 10));
    }
    group.selectAll<SVGPathElement, unknown>('path[data-kind="leaf"]').each(function (_, index) {
      this.appendChild(loop('rotate', '-4;5;-4', 6 + noise(index + treeIndex * 37, 53) * 5, noise(index + treeIndex * 37, 54) * 9));
    });
    group.selectAll<SVGGElement, unknown>('[data-kind="firefly"]').each(function (_, index) {
      this.appendChild(loop('translate', '0 0;12 -8;-5 -13;8 4;0 0', 16 + index * 3, index * 4));
    });
    group.selectAll<SVGGElement, unknown>('[data-kind="tree-fog"]').each(function () {
      this.appendChild(loop('translate', '-10 0;12 0;-10 0', 22, treeIndex * 3));
    });
  });

  if (options.still) return { stop: () => undefined };

  root.selectAll<SVGEllipseElement, unknown>('[data-kind="fog-bank"]').each(function (_, index) {
    this.appendChild(loop('translate', '-8 0;10 0;-8 0', 20 + index * 4, index * 5));
  });

  // Now and then a loose leaf drifts down from a dormant tree. Decoration only.
  const dormant = layout.trees.filter((tree) => tree.dormant && !tree.pending);
  let tick = 0;
  const stray = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    for (const tree of dormant) {
      tick += 1;
      const top = tree.canopy[0];
      const from = {
        x: top.cx + (noise(tick, 61) - 0.5) * top.r * 1.5,
        y: top.cy + (noise(tick, 62) - 0.5) * top.r,
        angle: noise(tick, 63) * 360,
      };
      const to = { x: from.x + (noise(tick, 64) - 0.5) * 70, y: ground - 3, angle: 0 };
      const seed = tick;
      root
        .append('path')
        .attr('data-kind', 'motion-decor')
        .attr('aria-hidden', 'true')
        .attr('pointer-events', 'none')
        .attr('d', leafPath(11))
        .attr('fill', PALETTE.leafAmber)
        .attr('transform', placed(from.x, from.y, from.angle))
        .transition('stray')
        .duration(3800)
        .ease((k: number) => k)
        .attrTween('transform', () => (k: number) => {
          const p = fallPose(from, to, k, seed);
          return placed(p.x, p.y, p.angle);
        })
        .attrTween('opacity', () => (k: number) => String(k < 0.75 ? 0.9 : Math.max(0, (1 - k) / 0.25) * 0.9))
        .remove();
    }
  };
  const timer = dormant.length > 0 ? setInterval(stray, 2800) : null;

  return {
    stop: () => {
      if (timer) clearInterval(timer);
      root.selectAll('[data-kind="motion-decor"]').interrupt('stray').remove();
    },
  };
}
