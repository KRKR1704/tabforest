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
  /** Centre of the branch label, nudged so labels on one tree never overlap. */
  labelAt: Point;
  path: string;
  leaves: LeafLayout[];
}

export interface TreeLayout {
  id: string;
  name: string;
  /** Trunk centre. */
  x: number;
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
  halfWidth: number;
  label: string;
  leaves: Array<LeafLayout & { stemBase: Point; reason?: string }>;
}

export interface SproutLayout extends PatchLayout {
  ref: string;
}

export interface GroveLayout {
  width: number;
  height: number;
  groundY: number;
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

const GROUND_Y = 432;
const HEIGHT = 512;
const EDGE_PADDING = 28;
const GAP = 14;
const DORMANT_AFTER_DAYS = 3;

const LEAF_LENGTH: [number, number] = [11, 30];
const TRUNK_WIDTH: [number, number] = [12, 40];
const SMALL_LEAF = 13;

// Rough text widths, enough to reserve room for a label and to keep labels apart.
const NAME_CHAR_WIDTH = 10.4;
const PATCH_CHAR_WIDTH = 7.6;
const BRANCH_CHAR_WIDTH = 6.9;
const BRANCH_LABEL_HEIGHT = 16;

const crownRadiusFor = (leafCount: number) => clamp(64 + 7 * leafCount, 80, 135);
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
  halfWidth: number,
  ground: GroundPlan,
  leafLength: (dwell: number) => number,
  width: number,
  fireflyTexts: Array<{ id: string; text: string }>
): TreeLayout {
  const tabsByRef = new Map(tree.tabs.map((tab) => [tab.tab_ref, tab]));
  const leafCount = tree.tabs.length;

  // Bigger trees get a wider crown so their leaves do not collide.
  const crownRadius = crownRadiusFor(leafCount);
  const fan = fanFor(leafCount);
  const trunkHeight = 110 + crownRadius * 0.45;
  const crown: Point = { x, y: GROUND_Y - trunkHeight };

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
        length: round(leafLength(tab.dwell_minutes)),
      };
    });

    return {
      ref: datum.branch.branch_ref,
      label: datum.branch.label,
      status: datum.branch.status,
      tip: { x: round(tip.x), y: round(tip.y) },
      labelAt: { x: round(tip.x), y: round(tip.y) },
      path: `M${round(crown.x)},${round(crown.y)}Q${round(control.x)},${round(control.y)} ${round(tip.x)},${round(tip.y)}`,
      leaves,
    };
  });

  separateLabels(branches);

  const half = width / 2;
  const neck = width * 0.3;
  const waistY = round(GROUND_Y - trunkHeight * 0.3);
  const trunkPath =
    `M${round(x - half - 4)},${GROUND_Y}` +
    `Q${round(x - neck)},${waistY} ${round(x - neck)},${round(crown.y)}` +
    `L${round(x + neck)},${round(crown.y)}` +
    `Q${round(x + neck)},${waistY} ${round(x + half + 4)},${GROUND_Y}Z`;

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
    y: GROUND_Y - 3,
    angle: -6,
    length,
  }));

  const leafAt = new Map<string, Point>();
  for (const leaf of [...branches.flatMap((branch) => branch.leaves), ...fallenLeaves]) {
    leafAt.set(leaf.tabRef, leaf);
  }

  const vines: VineLayout[] = tree.redundant_groups.flatMap((group, index) => {
    const refs = [...new Set([...group.tab_refs, group.keep_ref])];
    const points = refs
      .map((ref) => leafAt.get(ref))
      .filter((point): point is Point => point !== undefined)
      .sort((a, b) => a.x - b.x);
    if (points.length < 2) return [];
    return [
      {
        id: `${tree.cluster_ref}:v${index + 1}`,
        exact: group.is_exact_dup === true,
        reason: group.reason,
        tabRefs: refs,
        path: vinePath(points, 12),
      },
    ];
  });

  // Hypotheses and fireflies float just above the crown, clear of the leaves.
  const aboveCrown = crown.y - crownRadius * 1.04 - LEAF_LENGTH[1] - 18;
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

  const fogged = tree.fogged === true || tree.goal.confidence < LOW_CONFIDENCE;

  return {
    id: tree.cluster_ref,
    name: tree.project.name,
    x,
    halfWidth,
    mushrooms: ground.mushrooms.map(({ dx, question, capRadius }) => ({
      id: question.id,
      text: question.display_text ?? question.question,
      resolved: question.status === 'resolved',
      recurrence: question.recurrence_count ?? 1,
      capRadius,
      x: round(x + dx),
      y: GROUND_Y,
    })),
    stones: ground.stones.map(({ dx, decision }) => ({
      id: decision.id,
      text: decision.display_text ?? decision.text,
      kind:
        decision.stone_kind ??
        (decision.provenance === 'stated' || decision.provenance === 'sourced' ? 'carved' : 'mossy'),
      x: round(x + dx),
      y: GROUND_Y,
    })),
    fallenLeaves,
    vines,
    hypotheses,
    fireflies,
    fogOpacity: fogged ? fogOpacityFor(tree.goal.confidence) : 0,
    goalConfidence: tree.goal.confidence,
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

/** Moves a label down until it clears every label placed before it. */
function separateLabels(branches: BranchLayout[]): void {
  const placed: Array<{ at: Point; width: number }> = [];
  for (const branch of [...branches].sort((a, b) => a.labelAt.y - b.labelAt.y)) {
    const width = branch.label.length * BRANCH_CHAR_WIDTH;
    const collides = (at: Point) =>
      placed.some(
        (other) =>
          Math.abs(other.at.x - at.x) < (other.width + width) / 2 + 4 &&
          Math.abs(other.at.y - at.y) < BRANCH_LABEL_HEIGHT
      );
    while (collides(branch.labelAt)) {
      branch.labelAt = { x: branch.labelAt.x, y: round(branch.labelAt.y + BRANCH_LABEL_HEIGHT) };
    }
    placed.push({ at: branch.labelAt, width });
  }
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
function planGround(
  tree: TreeData,
  trunkWidth: number,
  leafLength: (dwell: number) => number
): GroundPlan {
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
      const length = round(leafLength(tab.dwell_minutes));
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

function treeHalfWidth(tree: TreeData, ground: GroundPlan): number {
  const leafCount = tree.tabs.length;
  const fanHalf = ((fanFor(leafCount) / 2) * Math.PI) / 180;
  const crownExtent = crownRadiusFor(leafCount) * 1.04 * Math.sin(fanHalf) + LEAF_LENGTH[1];
  const labelExtent = (tree.project.name.length * NAME_CHAR_WIDTH) / 2;
  return round(Math.max(crownExtent, labelExtent, ground.extent) + 6);
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
  halfWidth: number,
  label: string,
  stemHeights: [number, number]
): PatchLayout {
  const spacing = Math.min(30, (halfWidth * 2 - 30) / Math.max(1, tabs.length));
  const startX = x - (spacing * (tabs.length - 1)) / 2;
  return {
    x,
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
        y: GROUND_Y - height,
        angle: -90,
        length: SMALL_LEAF,
        stemBase: { x: baseX, y: GROUND_Y },
        reason,
      };
    }),
  };
}

export function computeGroveLayout(grove: GroveResponse): GroveLayout {
  const maxDwell = Math.max(1, ...grove.trees.flatMap((t) => t.tabs.map((tab) => tab.dwell_minutes)));
  const maxAttention = Math.max(1, ...grove.trees.map((t) => t.attention_minutes));
  const leafLength = scaleSqrt().domain([0, maxDwell]).range(LEAF_LENGTH).clamp(true);
  const trunkWidth = scaleSqrt().domain([0, maxAttention]).range(TRUNK_WIDTH).clamp(true);

  let cursor = EDGE_PADDING;
  const place = (halfWidth: number): number => {
    const x = cursor + halfWidth;
    cursor = x + halfWidth + GAP;
    return round(x);
  };

  // Sprouts stand at the forest edge, ahead of the trees.
  const sprouts: SproutLayout[] = grove.sprouts.map((sprout) => {
    const halfWidth = patchHalfWidth(sprout.label, 1);
    const x = place(halfWidth);
    const shown = sprout.tabs.slice(0, 3);
    const angles = shown.length === 1 ? [-90] : shown.length === 2 ? [-135, -45] : [-145, -90, -35];
    const top: Point = { x, y: GROUND_Y - 28 };
    return {
      ref: sprout.sprout_ref,
      x,
      halfWidth,
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
        length: SMALL_LEAF,
        stemBase: { x, y: GROUND_Y },
      })),
    };
  });

  const trees = grove.trees.map((tree) => {
    const width = trunkWidth(tree.attention_minutes);
    const ground = planGround(tree, width, leafLength);
    const halfWidth = treeHalfWidth(tree, ground);
    const fireflies = (grove.past_connections ?? [])
      .filter((connection) => connection.tree_cluster_ref === tree.cluster_ref)
      .map((connection) => ({ id: connection.past_project_id, text: connection.summary }));
    return layoutTree(tree, place(halfWidth), halfWidth, ground, leafLength, width, fireflies);
  });

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

  let meadow: PatchLayout | null = null;
  if (grove.meadow.tabs.length > 0) {
    const halfWidth = patchHalfWidth(grove.meadow.label, grove.meadow.tabs.length);
    meadow = layoutPatch(
      grove.meadow.tabs.map((tab) => ({ tab })),
      place(halfWidth),
      halfWidth,
      grove.meadow.label,
      [36, 24]
    );
  }

  let fog: PatchLayout | null = null;
  const fogTabs = grove.fog ?? [];
  if (fogTabs.length > 0) {
    const halfWidth = Math.max(60, patchHalfWidth('Unclear', fogTabs.length));
    fog = layoutPatch(fogTabs, place(halfWidth), halfWidth, 'Unclear', [30, 22]);
  }

  // The drop zone floats in the open sky above the meadow and fog; a grove
  // without either gets a slot of its own at the far edge.
  const patches = [meadow, fog].filter((patch): patch is PatchLayout => patch !== null);
  const zoneX =
    patches.length > 0
      ? patches.reduce((sum, patch) => sum + patch.x, 0) / patches.length
      : place(NEW_TREE_RADIUS + 8);
  const newTreeZone: DropZone = { x: round(zoneX), y: GROUND_Y - 180, r: NEW_TREE_RADIUS };

  return {
    width: round(cursor - GAP + EDGE_PADDING),
    height: HEIGHT,
    groundY: GROUND_Y,
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
    if (point.y < 0 || point.y > layout.groundY + 60) continue;
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

  let origin: Point = { x: tree.x, y: layout.groundY };
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
