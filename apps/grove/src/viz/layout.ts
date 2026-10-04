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
}

const GROUND_Y = 372;
const HEIGHT = 452;
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

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
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
  leafLength: (dwell: number) => number,
  trunkWidth: (minutes: number) => number
): TreeLayout {
  const tabsByRef = new Map(tree.tabs.map((tab) => [tab.tab_ref, tab]));
  const leafCount = tree.tabs.length;

  // Bigger trees get a wider crown so their leaves do not collide.
  const crownRadius = crownRadiusFor(leafCount);
  const fan = fanFor(leafCount);
  const width = trunkWidth(tree.attention_minutes);
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
          .filter((tab): tab is GroveTab => tab !== undefined)
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

  return {
    id: tree.cluster_ref,
    name: tree.project.name,
    x,
    halfWidth: treeHalfWidth(tree),
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

function treeHalfWidth(tree: TreeData): number {
  const leafCount = tree.tabs.length;
  const fanHalf = ((fanFor(leafCount) / 2) * Math.PI) / 180;
  const crownExtent = crownRadiusFor(leafCount) * 1.04 * Math.sin(fanHalf) + LEAF_LENGTH[1];
  const labelExtent = (tree.project.name.length * NAME_CHAR_WIDTH) / 2;
  return round(Math.max(crownExtent, labelExtent) + 6);
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

  const trees = grove.trees.map((tree) =>
    layoutTree(tree, place(treeHalfWidth(tree)), leafLength, trunkWidth)
  );

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

  return {
    width: round(cursor - GAP + EDGE_PADDING),
    height: HEIGHT,
    groundY: GROUND_Y,
    trees,
    sprouts,
    meadow,
    fog,
  };
}
