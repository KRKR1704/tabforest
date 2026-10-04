// Pure geometry for the Living Grove (SPEC §9.1). No DOM access, so it is unit
// tested directly; render.ts draws whatever this returns.
import { cluster, hierarchy, scaleSqrt } from 'd3';
import type { GroveBranch, GroveResponse, GroveTab, TreeData } from '../types';

export interface Point {
  x: number;
  y: number;
}

export interface LeafLayout extends Point {
  tabRef: string;
  title: string;
  domain: string;
  dwellMinutes: number;
  isOpen: boolean;
  /** Direction the leaf points, in degrees (0 = right, -90 = up). */
  angle: number;
  /** Leaf length in px; encodes dwell time. */
  length: number;
}

export interface BranchLayout {
  ref: string;
  label: string;
  status: GroveBranch['status'];
  tip: Point;
  /** Direction the branch grows in, in degrees (-90 = straight up). */
  angle: number;
  /** Where the first line of the label is written: outside the canopy, clear of the leaves. */
  labelAt: Point;
  /** The label wrapped into lines; nothing is cut off. */
  labelLines: string[];
  /** Which way the label reads from labelAt, so it grows away from the tree. */
  labelAnchor: 'start' | 'middle' | 'end';
  path: string;
  leaves: LeafLayout[];
}

export interface TreeLayout {
  id: string;
  name: string;
  /** The name wrapped into lines, so a long name does not run into its neighbours. */
  nameLines: string[];
  /** Trunk centre. */
  x: number;
  /** The ground line of the row this tree stands in. */
  groundY: number;
  /** The highest point anything on this tree reaches. */
  top: number;
  /** How far left or right of the trunk anything on this tree reaches. */
  reach: number;
  halfWidth: number;
  crown: Point;
  attentionMinutes: number;
  daysSinceActive: number | null;
  dormant: boolean;
  trunkWidth: number;
  trunkPath: string;
  canopy: Array<{ cx: number; cy: number; r: number }>;
  branches: BranchLayout[];
  leafCount: number;
  mushrooms: MushroomLayout[];
  stones: StoneLayout[];
  fallenLeaves: LeafLayout[];
  vines: VineLayout[];
  hypotheses: HypothesisLayout[];
  fireflies: FireflyLayout[];
  /** Mist over the whole tree; 0 when the goal is confident enough to show clearly. */
  fogOpacity: number;
  goalConfidence: number;
  /** Still waiting for its AI result. */
  pending: boolean;
}

/** An unresolved question at the base of its tree; a resolved one blooms into a flower. */
export interface MushroomLayout extends Point {
  id: string;
  text: string;
  resolved: boolean;
  recurrence: number;
  /** Encodes how often the question recurred. */
  capRadius: number;
}

export interface StoneLayout extends Point {
  id: string;
  text: string;
  /** Carved for a stated or sourced decision, mossy for an inferred one. */
  kind: 'carved' | 'mossy';
}

export interface VineLayout {
  id: string;
  exact: boolean;
  reason: string;
  tabRefs: string[];
  path: string;
}

export interface HypothesisLayout extends Point {
  id: string;
  text: string;
  confidence: number;
  opacity: number;
}

export interface FireflyLayout extends Point {
  id: string;
  text: string;
  trail: string;
}

/** A faint vine joining the two leaves of a tab that serves two goals. */
export interface SharedVineLayout {
  tabRef: string;
  title: string;
  treeIds: [string, string];
  path: string;
}

export interface PatchLayout {
  x: number;
  /** The ground line of the row this patch stands in. */
  groundY: number;
  halfWidth: number;
  label: string;
  leaves: Array<LeafLayout & { stemBase: Point; reason?: string }>;
}

export interface SproutLayout extends PatchLayout {
  ref: string;
}

/** One line of the grove. A wide screen has one; a narrow one stacks several. */
export interface GroveRow {
  top: number;
  groundY: number;
  bottom: number;
}

export interface GroveLayout {
  width: number;
  height: number;
  /** The first row's ground line. Each tree and patch carries its own. */
  groundY: number;
  rows: GroveRow[];
  trees: TreeLayout[];
  sprouts: SproutLayout[];
  meadow: PatchLayout | null;
  fog: PatchLayout | null;
  sharedVines: SharedVineLayout[];
  /** Where a dragged leaf is dropped to start a tree of its own. */
  newTreeZone: DropZone;
}

export interface DropZone extends Point {
  r: number;
}

export type DropTarget =
  | { kind: 'tree'; treeId: string; branchLabel: string | null }
  | { kind: 'new' };

export interface RootsLayout {
  treeId: string;
  origin: Point;
  paths: Array<{ tabRef: string; d: string }>;
}

/** The claim the roots grow from: a stone, a mushroom, or the trunk for tree-level claims. */
export interface RootsAnchor {
  kind: 'stone' | 'mushroom' | 'trunk';
  id?: string;
}

// A row is at least this tall above its ground line and this deep below it, so a
// grove of small trees still has sky above it and room for names under it. Rows
// that are stacked need less sky each than a grove standing in a single row.
const MIN_ABOVE = 432;
const MIN_ABOVE_STACKED = 130;
const MIN_BELOW = 80;
const EDGE_PADDING = 28;
const GAP = 14;
const DORMANT_AFTER_DAYS = 3;

// Every leaf is one size: the tree grows with its tabs, the leaves do not.
const LEAF_SIZE = 20;
const TRUNK_WIDTH: [number, number] = [12, 40];

// Rough text widths, enough to reserve room for a label and to keep labels apart.
const NAME_CHAR_WIDTH = 10.4;
const PATCH_CHAR_WIDTH = 7.6;
const BRANCH_CHAR_WIDTH = 6.9;
const BRANCH_LINE_HEIGHT = 15;
const BRANCH_LINE_CHARS = 22;
const META_CHAR_WIDTH = 6.8;
const NAME_LINE_CHARS = 24;
export const NAME_LINE_HEIGHT = 26;

// A tree is bigger the more tabs it holds, between a smallest and a largest size.
const crownRadiusFor = (leafCount: number) => clamp(60 + 6 * leafCount, 84, 180);
const fanFor = (leafCount: number) => clamp(50 + 13 * leafCount, 70, 165);

const LOW_CONFIDENCE = 0.6;
const STONE_WIDTH = 28;
const GROUND_ITEM_GAP = 9;
const NEW_TREE_RADIUS = 46;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Fog density is proportional to (1 - confidence) (SPEC §9.1). */
export const fogOpacityFor = (confidence: number) =>
  Math.round(clamp((1 - confidence) * 0.6, 0.08, 0.55) * 100) / 100;

const mushroomRadius = (recurrence: number) => 7 + 2 * clamp(recurrence, 1, 6);
const round = (value: number) => Math.round(value * 10) / 10;

/** Breaks text into lines of about `max` characters, at spaces. No word is dropped or cut. */
export function wrapText(text: string, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && (line + ' ' + word).length > max) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function polar(origin: Point, angleDeg: number, radius: number): Point {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: origin.x + Math.cos(rad) * radius, y: origin.y + Math.sin(rad) * radius };
}

function isDormant(tree: TreeData): boolean {
  if (tree.canopy) return tree.canopy === 'amber';
  if (tree.days_since_active !== undefined) return tree.days_since_active >= DORMANT_AFTER_DAYS;
  return tree.status === 'dormant';
}

type HierarchyDatum =
  | { kind: 'tree'; children: HierarchyDatum[] }
  | { kind: 'branch'; branch: GroveBranch; children: HierarchyDatum[] }
  | { kind: 'leaf'; tab: GroveTab };

function layoutTree(
  tree: TreeData,
  x: number,
  groundY: number,
  halfWidth: number,
  ground: GroundPlan,
  width: number,
  fireflyTexts: Array<{ id: string; text: string }>
): TreeLayout {
  const tabsByRef = new Map(tree.tabs.map((tab) => [tab.tab_ref, tab]));
  const leafCount = tree.tabs.length;

  // Bigger trees get a wider crown so their leaves do not collide.
  const crownRadius = crownRadiusFor(leafCount);
  const fan = fanFor(leafCount);
  const trunkHeight = 110 + crownRadius * 0.45;
  const crown: Point = { x, y: groundY - trunkHeight };

  const root = hierarchy<HierarchyDatum>(
    {
      kind: 'tree',
      children: tree.branches.map((branch) => ({
        kind: 'branch' as const,
        branch,
        children: branch.tab_refs
          .map((ref) => tabsByRef.get(ref))
          // A fallen tab lies on the ground instead of hanging on its branch.
          .filter((tab): tab is GroveTab => tab !== undefined && !tab.fallen)
          .map((tab) => ({ kind: 'leaf' as const, tab })),
      })),
    },
    (datum) => ('children' in datum ? datum.children : undefined)
  );

  // d3-hierarchy assigns each leaf an angle across the fan; a branch sits at the
  // mean angle of its own leaves.
  cluster<HierarchyDatum>()
    .size([fan, 1])
    .separation((a, b) => (a.parent === b.parent ? 1 : 1.6))(root);
  const toAngle = (clusterX: number) => -90 - fan / 2 + clusterX;

  const branches: BranchLayout[] = (root.children ?? []).map((node) => {
    const datum = node.data as Extract<HierarchyDatum, { kind: 'branch' }>;
    const angle = toAngle(node.x ?? fan / 2);
    // SPEC §9.1 maps branch length to recency, which the contract does not send;
    // the branch status is the closest signal it does carry.
    const reach = crownRadius * (datum.branch.status === 'active' ? 0.58 : 0.48);
    const tip = polar(crown, angle, reach);
    const bend = polar(crown, -90, reach * 0.45);
    const control = { x: (bend.x + tip.x) / 2, y: (bend.y + tip.y) / 2 };

    const leaves: LeafLayout[] = (node.children ?? []).map((leafNode, index) => {
      const tab = (leafNode.data as Extract<HierarchyDatum, { kind: 'leaf' }>).tab;
      const leafAngle = toAngle(leafNode.x ?? fan / 2);
      // Alternate two rings so neighbouring leaves on a crowded branch do not overlap.
      const ring = leafCount > 4 && index % 2 === 1 ? 0.84 : 1.04;
      const position = polar(crown, leafAngle, crownRadius * ring);
      return {
        tabRef: tab.tab_ref,
        title: tab.title,
        domain: tab.domain,
        dwellMinutes: tab.dwell_minutes,
        isOpen: tab.is_open,
        x: round(position.x),
        y: round(position.y),
        angle: round(leafAngle),
        length: LEAF_SIZE,
      };
    });

    return {
      ref: datum.branch.branch_ref,
      label: datum.branch.label,
      status: datum.branch.status,
      angle,
      tip: { x: round(tip.x), y: round(tip.y) },
      labelAt: { x: round(tip.x), y: round(tip.y) },
      labelLines: [],
      labelAnchor: 'middle' as const,
      path: `M${round(crown.x)},${round(crown.y)}Q${round(control.x)},${round(control.y)} ${round(tip.x)},${round(tip.y)}`,
      leaves,
    };
  });

  const labelBox = placeBranchLabels(branches, crown, crownRadius);

  const half = width / 2;
  const neck = width * 0.3;
  const waistY = round(groundY - trunkHeight * 0.3);
  const trunkPath =
    `M${round(x - half - 4)},${groundY}` +
    `Q${round(x - neck)},${waistY} ${round(x - neck)},${round(crown.y)}` +
    `L${round(x + neck)},${round(crown.y)}` +
    `Q${round(x + neck)},${waistY} ${round(x + half + 4)},${groundY}Z`;

  const canopy = [
    { ...polar(crown, -90, crownRadius * 0.6), r: crownRadius * 0.74 },
    { ...polar(crown, -90 - fan / 3.2, crownRadius * 0.62), r: crownRadius * 0.56 },
    { ...polar(crown, -90 + fan / 3.2, crownRadius * 0.62), r: crownRadius * 0.56 },
  ].map((blob) => ({ cx: round(blob.x), cy: round(blob.y), r: round(blob.r) }));

  const fallenLeaves: LeafLayout[] = ground.fallen.map(({ dx, tab, length }) => ({
    tabRef: tab.tab_ref,
    title: tab.title,
    domain: tab.domain,
    dwellMinutes: tab.dwell_minutes,
    isOpen: tab.is_open,
    x: round(x + dx),
    y: groundY - 3,
    angle: -6,
    length,
  }));

  const leafAt = new Map<string, Point>();
  for (const leaf of [...branches.flatMap((branch) => branch.leaves), ...fallenLeaves]) {
    leafAt.set(leaf.tabRef, leaf);
  }

  // A vine ties copies that hang together. It never runs from the canopy down to a
  // leaf lying on the ground: the copies up in the tree get one vine, the ones on
  // the ground another.
  const onGround = new Set(fallenLeaves.map((leaf) => leaf.tabRef));
  const vines: VineLayout[] = tree.redundant_groups.flatMap((group, index) => {
    const refs = [...new Set([...group.tab_refs, group.keep_ref])];
    const pointsOf = (fallen: boolean) =>
      refs
        .filter((ref) => onGround.has(ref) === fallen)
        .map((ref) => leafAt.get(ref))
        .filter((point): point is Point => point !== undefined)
        .sort((a, b) => a.x - b.x);
    const hanging = pointsOf(false);
    const lying = pointsOf(true);
    const points = hanging.length >= 2 ? hanging : lying.length >= 2 ? lying : [];
    if (points.length < 2) return [];
    return [
      {
        id: `${tree.cluster_ref}:v${index + 1}`,
        exact: group.is_exact_dup === true,
        reason: group.reason,
        tabRefs: refs,
        path: vinePath(points, points === hanging ? 12 : 4),
      },
    ];
  });

  // Hypotheses and fireflies float just above the crown, clear of the leaves.
  const aboveCrown = Math.min(crown.y - crownRadius * 1.04 - LEAF_SIZE - 18, labelBox.top - 18);
  const hypotheses: HypothesisLayout[] = tree.hypotheses.map((hypothesis, index) => ({
    id: hypothesis.id ?? `${tree.cluster_ref}:h${index + 1}`,
    text: hypothesis.display_text ?? `Maybe: ${hypothesis.text}`,
    confidence: hypothesis.confidence,
    opacity: fogOpacityFor(hypothesis.confidence),
    x: round(x - crownRadius * 0.45 - index * 46),
    y: round(aboveCrown),
  }));

  const fireflies: FireflyLayout[] = fireflyTexts.map((firefly, index) => {
    const at = { x: round(x + crownRadius * 0.5 + index * 30), y: round(aboveCrown - 4) };
    return {
      ...firefly,
      ...at,
      // The trail drifts up and away, towards an older grove off the canvas.
      trail: `M${at.x},${at.y}Q${at.x + 18},${at.y - 2} ${at.x + 34},${at.y - 14}`,
    };
  });

  // A tree that is still listening has no goal yet, which is not the same as an unsure one.
  const fogged = !tree.pending && (tree.fogged === true || tree.goal.confidence < LOW_CONFIDENCE);

  // How far the tree reaches, for giving it room in its row.
  const nameLines = wrapText(tree.project.name, NAME_LINE_CHARS);
  const textReach = Math.max(
    ...nameLines.map((line) => (line.length * NAME_CHAR_WIDTH) / 2),
    (metaLength(tree) * META_CHAR_WIDTH) / 2
  );
  const floating = [
    ...hypotheses.map((item) => ({ left: item.x - 26, right: item.x + 26 })),
    ...fireflies.map((item) => ({ left: item.x - 10, right: item.x + 36 })),
  ];
  const leafReach = Math.max(
    0,
    ...branches.flatMap((branch) => branch.leaves.map((leaf) => Math.abs(leaf.x - x) + LEAF_SIZE))
  );
  const reach = Math.max(
    textReach,
    leafReach,
    ground.extent,
    x - labelBox.left,
    labelBox.right - x,
    ...canopy.map((blob) => Math.abs(blob.cx - x) + blob.r),
    ...floating.map((item) => Math.max(x - item.left, item.right - x))
  );
  const floats = hypotheses.length + fireflies.length > 0;
  const top = Math.min(
    labelBox.top - 6,
    ...canopy.map((blob) => blob.cy - blob.r),
    floats ? aboveCrown - 22 : Infinity
  );

  return {
    id: tree.cluster_ref,
    name: tree.project.name,
    nameLines,
    x,
    groundY,
    top: round(top),
    reach: round(reach),
    halfWidth,
    mushrooms: ground.mushrooms.map(({ dx, question, capRadius }) => ({
      id: question.id,
      text: question.display_text ?? question.question,
      resolved: question.status === 'resolved',
      recurrence: question.recurrence_count ?? 1,
      capRadius,
      x: round(x + dx),
      y: groundY,
    })),
    stones: ground.stones.map(({ dx, decision }) => ({
      id: decision.id,
      text: decision.display_text ?? decision.text,
      kind:
        decision.stone_kind ??
        (decision.provenance === 'stated' || decision.provenance === 'sourced' ? 'carved' : 'mossy'),
      x: round(x + dx),
      y: groundY,
    })),
    fallenLeaves,
    vines,
    hypotheses,
    fireflies,
    fogOpacity: fogged ? fogOpacityFor(tree.goal.confidence) : 0,
    goalConfidence: tree.goal.confidence,
    pending: tree.pending === true,
    crown: { x: round(crown.x), y: round(crown.y) },
    attentionMinutes: tree.attention_minutes,
    daysSinceActive: tree.days_since_active ?? null,
    dormant: isDormant(tree),
    trunkWidth: round(width),
    trunkPath,
    canopy,
    branches,
    leafCount,
  };
}

/** The line under a tree's name, as render.ts writes it; only its length matters here. */
function metaLength(tree: TreeData): number {
  const tabs = `${tree.tabs.length} tabs`;
  if (tree.pending) return `listening… · ${tabs}`.length;
  const base = `${Math.round(tree.attention_minutes)} min · ${tabs}`;
  return isDormant(tree) ? `${base} · dormant ${tree.days_since_active ?? 0} days`.length : base.length;
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function labelBoxOf(branch: BranchLayout): Box {
  const width = Math.max(0, ...branch.labelLines.map((line) => line.length)) * BRANCH_CHAR_WIDTH;
  const left =
    branch.labelAnchor === 'start'
      ? branch.labelAt.x
      : branch.labelAnchor === 'end'
        ? branch.labelAt.x - width
        : branch.labelAt.x - width / 2;
  const top = branch.labelAt.y - 11;
  return { left, right: left + width, top, bottom: top + branch.labelLines.length * BRANCH_LINE_HEIGHT };
}

const overlaps = (a: Box, b: Box) =>
  a.left < b.right + 6 && b.left < a.right + 6 && a.top < b.bottom + 2 && b.top < a.bottom + 2;

/**
 * Writes each path's label outside the canopy, in the direction its branch
 * grows, so no label sits on a leaf. A label on the left reads leftwards, one on
 * the right reads rightwards, one on top is centred. Long labels wrap; labels
 * that would touch are moved apart. Returns the box around all of them.
 */
function placeBranchLabels(branches: BranchLayout[], crown: Point, crownRadius: number): Box {
  const out = crownRadius * 1.04 + LEAF_SIZE + 12;
  for (const branch of branches) {
    branch.labelLines = wrapText(branch.label, BRANCH_LINE_CHARS);
    const lean = Math.cos((branch.angle * Math.PI) / 180);
    branch.labelAnchor = lean < -0.3 ? 'end' : lean > 0.3 ? 'start' : 'middle';
    const at = polar(crown, branch.angle, out);
    const extra = (branch.labelLines.length - 1) * BRANCH_LINE_HEIGHT;
    // A label on top grows upwards from its point; one at the side is centred on it.
    branch.labelAt = {
      x: round(at.x),
      y: round(branch.labelAnchor === 'middle' ? at.y - extra : at.y - extra / 2 + 4),
    };
  }

  const placed: Box[] = [];
  const labelled = branches.filter((branch) => branch.labelLines.length > 0);
  // Side labels settle downwards from the top; top labels then stack upwards.
  const sides = labelled.filter((b) => b.labelAnchor !== 'middle').sort((a, b) => a.labelAt.y - b.labelAt.y);
  const tops = labelled.filter((b) => b.labelAnchor === 'middle').sort((a, b) => b.labelAt.y - a.labelAt.y);
  for (const branch of [...sides, ...tops]) {
    const step = branch.labelAnchor === 'middle' ? -BRANCH_LINE_HEIGHT : BRANCH_LINE_HEIGHT;
    for (let tries = 0; tries < 40 && placed.some((box) => overlaps(box, labelBoxOf(branch))); tries++) {
      branch.labelAt = { x: branch.labelAt.x, y: round(branch.labelAt.y + step) };
    }
    placed.push(labelBoxOf(branch));
  }

  if (placed.length === 0) {
    return { left: crown.x, right: crown.x, top: crown.y - crownRadius * 1.34, bottom: crown.y };
  }
  return {
    left: Math.min(...placed.map((box) => box.left)),
    right: Math.max(...placed.map((box) => box.right)),
    top: Math.min(...placed.map((box) => box.top)),
    bottom: Math.max(...placed.map((box) => box.bottom)),
  };
}

interface GroundPlan {
  /** Offsets from the trunk centre. */
  mushrooms: Array<{ dx: number; question: TreeData['unresolved_questions'][number]; capRadius: number }>;
  stones: Array<{ dx: number; decision: TreeData['decisions'][number] }>;
  fallen: Array<{ dx: number; tab: GroveTab; length: number }>;
  extent: number;
}

/**
 * Everything standing or lying at the base of a tree: questions to the left of
 * the trunk, decisions to the right, stale tabs beyond them under their branch.
 */
function planGround(tree: TreeData, trunkWidth: number): GroundPlan {
  let left = trunkWidth / 2 + 14;
  let right = trunkWidth / 2 + 14;

  const mushrooms = tree.unresolved_questions.map((question) => {
    const capRadius = mushroomRadius(question.recurrence_count ?? 1);
    const dx = -(left + capRadius);
    left += capRadius * 2 + GROUND_ITEM_GAP;
    return { dx: round(dx), question, capRadius };
  });

  const stones = tree.decisions.map((decision) => {
    const dx = right + STONE_WIDTH / 2;
    right += STONE_WIDTH + GROUND_ITEM_GAP;
    return { dx: round(dx), decision };
  });

  const tabsByRef = new Map(tree.tabs.map((tab) => [tab.tab_ref, tab]));
  const fallen: GroundPlan['fallen'] = [];
  tree.branches.forEach((branch, index) => {
    const onLeft = index < tree.branches.length / 2;
    for (const ref of branch.tab_refs) {
      const tab = tabsByRef.get(ref);
      if (!tab?.fallen) continue;
      const length = LEAF_SIZE;
      if (onLeft) {
        fallen.push({ dx: round(-(left + length)), tab, length });
        left += length + GROUND_ITEM_GAP;
      } else {
        fallen.push({ dx: round(right), tab, length });
        right += length + GROUND_ITEM_GAP;
      }
    }
  });

  return { mushrooms, stones, fallen, extent: Math.max(left, right) };
}

/** A loose curve through the given points, sagging between each pair. */
function vinePath(points: Point[], sag: number): string {
  const [first, ...rest] = points;
  let path = `M${round(first.x)},${round(first.y)}`;
  let previous = first;
  for (const point of rest) {
    const midX = (previous.x + point.x) / 2;
    const midY = (previous.y + point.y) / 2 + sag;
    path += `Q${round(midX)},${round(midY)} ${round(point.x)},${round(point.y)}`;
    previous = point;
  }
  return path;
}

function patchHalfWidth(label: string, tabCount: number): number {
  return round(Math.max((label.length * PATCH_CHAR_WIDTH) / 2 + 6, 24 + tabCount * 15));
}

/** A row of short stems, one small upright leaf per tab. */
function layoutPatch(
  tabs: Array<{ tab: Pick<GroveTab, 'tab_ref' | 'title' | 'domain' | 'is_open'>; reason?: string }>,
  x: number,
  groundY: number,
  halfWidth: number,
  label: string,
  stemHeights: [number, number]
): PatchLayout {
  const spacing = Math.min(30, (halfWidth * 2 - 30) / Math.max(1, tabs.length));
  const startX = x - (spacing * (tabs.length - 1)) / 2;
  return {
    x,
    groundY,
    halfWidth,
    label,
    leaves: tabs.map(({ tab, reason }, index) => {
      const baseX = round(startX + index * spacing);
      const height = stemHeights[index % 2];
      return {
        tabRef: tab.tab_ref,
        title: tab.title,
        domain: tab.domain,
        dwellMinutes: 0,
        isOpen: tab.is_open,
        x: baseX,
        y: groundY - height,
        angle: -90,
        length: LEAF_SIZE,
        stemBase: { x: baseX, y: groundY },
        reason,
      };
    }),
  };
}

export interface GroveLayoutOptions {
  /**
   * The width there is to draw in. A grove wider than this wraps onto further
   * rows instead of being shrunk. Left out, everything stands in one row.
   */
  maxWidth?: number;
}

export function computeGroveLayout(grove: GroveResponse, options: GroveLayoutOptions = {}): GroveLayout {
  const maxAttention = Math.max(1, ...grove.trees.map((t) => t.attention_minutes));
  const trunkWidth = scaleSqrt().domain([0, maxAttention]).range(TRUNK_WIDTH).clamp(true);
  const maxWidth = options.maxWidth && options.maxWidth > 0 ? options.maxWidth : Infinity;

  const firefliesOf = (tree: TreeData) =>
    (grove.past_connections ?? [])
      .filter((connection) => connection.tree_cluster_ref === tree.cluster_ref)
      .map((connection) => ({ id: connection.past_project_id, text: connection.summary }));

  // 1. Measure everything that stands in the grove, in the order it is read.
  type Item =
    | { kind: 'sprout'; index: number; halfWidth: number; above: number; below: number }
    | { kind: 'tree'; index: number; halfWidth: number; above: number; below: number; width: number; ground: GroundPlan }
    | { kind: 'meadow' | 'fog' | 'zone'; halfWidth: number; above: number; below: number };
  const items: Item[] = [];

  grove.sprouts.forEach((sprout, index) => {
    items.push({ kind: 'sprout', index, halfWidth: patchHalfWidth(sprout.label, 1), above: 90, below: MIN_BELOW });
  });
  grove.trees.forEach((tree, index) => {
    const width = trunkWidth(tree.attention_minutes);
    const ground = planGround(tree, width);
    const measured = layoutTree(tree, 0, 0, 0, ground, width, firefliesOf(tree));
    items.push({
      kind: 'tree',
      index,
      width,
      ground,
      halfWidth: round(measured.reach + 6),
      above: round(-measured.top + 14),
      below: 34 + measured.nameLines.length * NAME_LINE_HEIGHT + 22,
    });
  });
  const fogTabs = grove.fog ?? [];
  if (grove.meadow.tabs.length > 0) {
    items.push({ kind: 'meadow', halfWidth: patchHalfWidth(grove.meadow.label, grove.meadow.tabs.length), above: 90, below: MIN_BELOW });
  }
  if (fogTabs.length > 0) {
    items.push({ kind: 'fog', halfWidth: Math.max(60, patchHalfWidth('Unclear', fogTabs.length)), above: 90, below: MIN_BELOW });
  }
  // The drop zone floats above the meadow and fog; a grove without either gets a slot of its own.
  const hasPatch = items.some((item) => item.kind === 'meadow' || item.kind === 'fog');
  if (!hasPatch) items.push({ kind: 'zone', halfWidth: NEW_TREE_RADIUS + 8, above: 240, below: MIN_BELOW });

  // 2. Fill rows from left to right; start a new row when the next thing would not fit.
  const filled: Array<{ items: Item[]; width: number }> = [];
  let current: Item[] = [];
  let cursor = EDGE_PADDING;
  for (const item of items) {
    const span = item.halfWidth * 2;
    const fits = cursor + span + EDGE_PADDING <= maxWidth;
    // The drop zone never takes a row to itself: it floats in a corner instead.
    if (item.kind === 'zone' && current.length > 0 && !fits) continue;
    if (current.length > 0 && !fits) {
      filled.push({ items: current, width: cursor - GAP + EDGE_PADDING });
      current = [];
      cursor = EDGE_PADDING;
    }
    current.push(item);
    cursor += span + GAP;
  }
  filled.push({ items: current, width: cursor - GAP + EDGE_PADDING });

  const width = round(Number.isFinite(maxWidth) ? Math.max(maxWidth, ...filled.map((row) => row.width)) : filled[0].width);

  // 3. Place everything: each row is centred, and stands on its own ground line.
  const sprouts: SproutLayout[] = [];
  const trees: TreeLayout[] = [];
  let meadow: PatchLayout | null = null;
  let fog: PatchLayout | null = null;
  let zoneSlot: Point | null = null;
  const rows: GroveRow[] = [];
  let rowTop = 0;

  for (const row of filled) {
    const above = Math.max(
      filled.length === 1 ? MIN_ABOVE : MIN_ABOVE_STACKED,
      ...row.items.map((item) => item.above)
    );
    const below = Math.max(MIN_BELOW, ...row.items.map((item) => item.below));
    const groundY = round(rowTop + above);
    rows.push({ top: rowTop, groundY, bottom: round(groundY + below) });

    let x = EDGE_PADDING + (width - row.width) / 2;
    for (const item of row.items) {
      const centre = round(x + item.halfWidth);
      x += item.halfWidth * 2 + GAP;

      if (item.kind === 'sprout') {
        const sprout = grove.sprouts[item.index];
        const shown = sprout.tabs.slice(0, 3);
        const angles = shown.length === 1 ? [-90] : shown.length === 2 ? [-135, -45] : [-145, -90, -35];
        const top: Point = { x: centre, y: groundY - 28 };
        sprouts.push({
          ref: sprout.sprout_ref,
          x: centre,
          groundY,
          halfWidth: item.halfWidth,
          label: sprout.label,
          leaves: shown.map((tab, index) => ({
            tabRef: tab.tab_ref,
            title: tab.title,
            domain: tab.domain,
            dwellMinutes: tab.dwell_minutes,
            isOpen: tab.is_open,
            x: top.x,
            y: top.y,
            angle: angles[index],
            length: LEAF_SIZE,
            stemBase: { x: centre, y: groundY },
          })),
        });
      } else if (item.kind === 'tree') {
        const tree = grove.trees[item.index];
        trees.push(layoutTree(tree, centre, groundY, item.halfWidth, item.ground, item.width, firefliesOf(tree)));
      } else if (item.kind === 'meadow') {
        meadow = layoutPatch(grove.meadow.tabs.map((tab) => ({ tab })), centre, groundY, item.halfWidth, grove.meadow.label, [36, 24]);
      } else if (item.kind === 'fog') {
        fog = layoutPatch(fogTabs, centre, groundY, item.halfWidth, 'Unclear', [30, 22]);
      } else {
        zoneSlot = { x: centre, y: groundY - 180 };
      }
    }
    rowTop = round(groundY + below);
  }

  // A tab that serves two goals has a leaf on each tree; a faint vine joins them.
  const sharedVines: SharedVineLayout[] = [];
  const seen = new Map<string, { treeId: string; leaf: LeafLayout }>();
  for (const tree of trees) {
    for (const leaf of [...tree.branches.flatMap((branch) => branch.leaves), ...tree.fallenLeaves]) {
      const other = seen.get(leaf.tabRef);
      if (other && other.treeId !== tree.id) {
        const peak = Math.min(other.leaf.y, leaf.y) - 46;
        sharedVines.push({
          tabRef: leaf.tabRef,
          title: leaf.title,
          treeIds: [other.treeId, tree.id],
          path:
            `M${other.leaf.x},${other.leaf.y}` +
            `Q${round((other.leaf.x + leaf.x) / 2)},${round(peak)} ${leaf.x},${leaf.y}`,
        });
      }
      seen.set(leaf.tabRef, { treeId: tree.id, leaf });
    }
  }

  const patches = [meadow, fog].filter((patch): patch is PatchLayout => patch !== null);
  const slot: Point =
    zoneSlot ??
    (patches.length > 0
      ? { x: patches.reduce((sum, patch) => sum + patch.x, 0) / patches.length, y: patches[0].groundY - 180 }
      : { x: width - NEW_TREE_RADIUS - 12, y: rows[0].top + NEW_TREE_RADIUS + 12 });
  const newTreeZone: DropZone = { x: round(slot.x), y: round(slot.y), r: NEW_TREE_RADIUS };

  return {
    width,
    height: rows[rows.length - 1].bottom,
    groundY: rows[0].groundY,
    rows,
    trees,
    sprouts,
    meadow,
    fog,
    sharedVines,
    newTreeZone,
  };
}

/** What lies under a dropped leaf: another tree (and its nearest branch), or the new-tree zone. */
export function resolveDrop(layout: GroveLayout, point: Point, fromTreeId: string): DropTarget | null {
  const zone = layout.newTreeZone;
  if (Math.hypot(point.x - zone.x, point.y - zone.y) <= zone.r + 8) return { kind: 'new' };

  for (const tree of layout.trees) {
    if (tree.id === fromTreeId) continue;
    if (Math.abs(point.x - tree.x) > tree.halfWidth) continue;
    if (point.y < tree.top - 30 || point.y > tree.groundY + 60) continue;
    let nearest: BranchLayout | null = null;
    let best = Infinity;
    for (const branch of tree.branches) {
      const distance = Math.hypot(point.x - branch.tip.x, point.y - branch.tip.y);
      if (distance < best) {
        best = distance;
        nearest = branch;
      }
    }
    return { kind: 'tree', treeId: tree.id, branchLabel: nearest?.label ?? null };
  }
  return null;
}

/** Roots from a claim to exactly the leaves that are its evidence (SPEC §9.1). */
export function computeRoots(
  layout: GroveLayout,
  treeId: string,
  anchor: RootsAnchor,
  tabRefs: string[]
): RootsLayout | null {
  const tree = layout.trees.find((t) => t.id === treeId);
  if (!tree) return null;

  let origin: Point = { x: tree.x, y: tree.groundY };
  if (anchor.kind === 'stone') {
    const stone = tree.stones.find((s) => s.id === anchor.id);
    if (stone) origin = { x: stone.x, y: stone.y - 8 };
  } else if (anchor.kind === 'mushroom') {
    const mushroom = tree.mushrooms.find((m) => m.id === anchor.id);
    if (mushroom) origin = { x: mushroom.x, y: mushroom.y - mushroom.capRadius };
  }

  const leaves = [...tree.branches.flatMap((branch) => branch.leaves), ...tree.fallenLeaves];
  const paths = [...new Set(tabRefs)].flatMap((tabRef) => {
    const leaf = leaves.find((l) => l.tabRef === tabRef);
    if (!leaf) return [];
    return [
      {
        tabRef,
        d:
          `M${round(origin.x)},${round(origin.y)}` +
          `C${round(origin.x)},${round(origin.y - 60)} ${leaf.x},${round(leaf.y + 70)} ${leaf.x},${leaf.y}`,
      },
    ];
  });
  return { treeId, origin, paths };
}
