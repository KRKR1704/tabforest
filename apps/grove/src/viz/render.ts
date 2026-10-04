// D3 owns everything inside the <svg>. All text goes through .text(), never
// markup (SPEC §12): titles and labels come from web pages and the model.
import { drag, pointer, select, zoom, zoomIdentity, zoomTransform, type Selection } from 'd3';
import { resolveDrop } from './layout';
import type {
  DropTarget,
import { select, zoom, zoomIdentity, type Selection } from 'd3';
import type {
  FireflyLayout,
  GroveLayout,
  HypothesisLayout,
  LeafLayout,
  MushroomLayout,
  PatchLayout,
  RootsLayout,
  StoneLayout,
  TreeLayout,
} from './layout';
import { FONT, PALETTE } from './palette';
import type { GroveSelection, SelectionKind } from './selection';

export interface GroveZoomControls {
  zoomBy: (factor: number) => void;
  reset: () => void;
  /** Zooms in on one tree, for Tree Detail. */
  focusTree: (treeId: string) => void;
  /** Lights the roots to a claim's evidence leaves; null hides them. */
  showRoots: (roots: RootsLayout | null) => void;
  destroy: () => void;
}

export type SelectHandler = (selection: GroveSelection | null) => void;

export interface LeafDrop {
  tabRef: string;
  fromTreeId: string;
  target: DropTarget;
}

export interface GroveHandlers {
  onSelect?: SelectHandler;
  /** A leaf was dragged onto another tree or onto the new-tree zone. */
  onDropLeaf?: (drop: LeafDrop) => void;
}

/** What the leaf drag needs from the canvas it runs in. */
interface DragContext {
  layout: GroveLayout;
  root: Group;
  zone: Group;
  onDropLeaf: (drop: LeafDrop) => void;
}

/**
 * Dragging a leaf moves the tab to another goal. d3-drag stops the event at the
 * leaf, so the canvas does not pan while a leaf is being carried.
 */
function leafDrag(context: DragContext, treeId: string) {
  let ghost: Selection<SVGPathElement, unknown, null, undefined> | null = null;

  const at = (event: { sourceEvent: Event }) => {
    const [x, y] = pointer(event.sourceEvent, context.root.node());
    return { x, y };
  };
  const mark = (target: DropTarget | null) => {
    context.root.selectAll<SVGGElement, unknown>('[data-kind="tree"]').attr('data-drop-target', function () {
      return target?.kind === 'tree' && this.getAttribute('data-tree-id') === target.treeId
        ? 'true'
        : null;
    });
    context.zone.attr('data-drop-target', target?.kind === 'new' ? 'true' : null);
  };

  return drag<SVGPathElement, LeafLayout>()
    .clickDistance(4)
    .on('drag', (event, leaf) => {
      const point = at(event);
      if (!ghost) {
        ghost = context.root
          .append('path')
          .attr('data-kind', 'drag-ghost')
          .attr('d', leafPath(leaf.length))
          .attr('fill', PALETTE.leafOpenEdge)
          .attr('fill-opacity', 0.75)
          .attr('pointer-events', 'none');
        context.zone.attr('display', null);
      }
      ghost.attr('transform', `translate(${point.x},${point.y}) rotate(-45)`);
      mark(resolveDrop(context.layout, point, treeId));
    })
    .on('end', (event, leaf) => {
      if (!ghost) return; // released without moving: a click, handled elsewhere
      ghost.remove();
      ghost = null;
      context.zone.attr('display', 'none');
      mark(null);
      const target = resolveDrop(context.layout, at(event), treeId);
      if (target) context.onDropLeaf({ tabRef: leaf.tabRef, fromTreeId: treeId, target });
    });
}

type Group = Selection<SVGGElement, unknown, null, undefined>;
type AnySelection = Selection<any, any, any, any>;

const SCALE_EXTENT: [number, number] = [0.5, 4];

/** Marks an element as clickable and reports it, without also selecting what is behind it. */
function selectable(
  node: AnySelection,
  onSelect: SelectHandler,
  kind: SelectionKind,
  id: string | ((datum: any) => string),
  treeId?: string
): void {
  node
    .attr('data-select-kind', kind)
    .attr('data-select-id', id as any)
    .attr('cursor', 'pointer')
    .on('click', (event: MouseEvent, datum: unknown) => {
      event.stopPropagation();
      onSelect({ kind, id: typeof id === 'function' ? id(datum) : id, treeId });
    });
}

/** Teardrop pointing along +x from the origin; rotated into place by its angle. */
function leafPath(length: number): string {
  const w = length * 0.42;
  return (
    `M0,0C${length * 0.35},${-w} ${length * 0.85},${-w * 0.7} ${length},0` +
    `C${length * 0.85},${w * 0.7} ${length * 0.35},${w} 0,0Z`
  );
}

function leafTitle(leaf: LeafLayout): string {
  const parts = [leaf.title];
  if (leaf.domain) parts.push(leaf.domain);
  if (leaf.dwellMinutes > 0) parts.push(`${leaf.dwellMinutes} min`);
  parts.push(leaf.isOpen ? 'open' : 'closed');
  return parts.join(' · ');
}

function drawLeaves(
  parent: Group,
  leaves: LeafLayout[],
  fill: string,
  onSelect: SelectHandler,
  treeId?: string,
  dragContext?: DragContext
): void {
  const nodes = parent
    .selectAll<SVGPathElement, LeafLayout>('path.leaf')
    .data(leaves)
    .join('path')
    .attr('class', 'leaf')
    .attr('data-kind', 'leaf')
    .attr('data-tab-ref', (leaf) => leaf.tabRef)
    .attr('data-open', (leaf) => String(leaf.isOpen))
    .attr('d', (leaf) => leafPath(leaf.length))
    .attr('transform', (leaf) => `translate(${leaf.x},${leaf.y}) rotate(${leaf.angle})`)
    .attr('fill', fill)
    // A bright edge marks a tab that is open right now; closed tabs are dimmer.
    .attr('fill-opacity', (leaf) => (leaf.isOpen ? 1 : 0.55))
    .attr('stroke', (leaf) => (leaf.isOpen ? PALETTE.leafOpenEdge : 'none'))
    .attr('stroke-width', 1.25);
  nodes.append('title').text(leafTitle);
  selectable(nodes, onSelect, 'leaf', (leaf: LeafLayout) => leaf.tabRef, treeId);
  if (dragContext && treeId) nodes.call(leafDrag(dragContext, treeId));
}

type LabelKind = 'name' | 'patch' | 'meta';

const LABEL_STYLE: Record<LabelKind, { family: string; size: number; weight: number; fill: string }> = {
  name: { family: FONT.serif, size: 20, weight: 600, fill: PALETTE.text },
  patch: { family: FONT.serif, size: 15, weight: 500, fill: PALETTE.text },
  meta: { family: FONT.sans, size: 13, weight: 400, fill: PALETTE.textMuted },
};

function label(parent: Group, x: number, y: number, text: string, kind: LabelKind): void {
  const style = LABEL_STYLE[kind];
  parent
    .append('text')
    .attr('x', x)
    .attr('y', y)
    .attr('text-anchor', 'middle')
    .attr('font-family', style.family)
    .attr('font-size', style.size)
    .attr('font-weight', style.weight)
    .attr('fill', style.fill)
    .text(text);
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function treeMeta(tree: TreeLayout): string {
  if (tree.pending) return `listening… · ${plural(tree.leafCount, 'tab')}`;
  const parts = [`${Math.round(tree.attentionMinutes)} min`, plural(tree.leafCount, 'tab')];
  // Dormancy is also written out so it never depends on canopy color alone.
  if (tree.dormant) {
    parts.push(
      tree.daysSinceActive !== null ? `dormant ${plural(tree.daysSinceActive, 'day')}` : 'dormant'
    );
  }
  return parts.join(' · ');
}

/** A thin line is hard to hit, so a wide invisible stroke takes the pointer for it. */
function drawVinePath(group: Group, path: string, width: number, faint: boolean): void {
  group
    .append('path')
    .attr('d', path)
    .attr('fill', 'none')
    .attr('stroke', 'transparent')
    .attr('stroke-width', 14)
    .attr('pointer-events', 'stroke');
  group
    .append('path')
    .attr('d', path)
    .attr('fill', 'none')
    .attr('stroke', PALETTE.vine)
    .attr('stroke-width', width)
    .attr('stroke-linecap', 'round')
    .attr('stroke-opacity', faint ? 0.5 : 0.95)
    .attr('stroke-dasharray', faint ? '2 6' : null)
    .attr('pointer-events', 'none');
}

function drawMushroom(parent: Group, mushroom: MushroomLayout, onSelect: SelectHandler, treeId: string): void {
  const group = parent
    .append('g')
    .attr('data-kind', mushroom.resolved ? 'flower' : 'mushroom')
    .attr('data-recurrence', mushroom.recurrence)
    .attr('transform', `translate(${mushroom.x},${mushroom.y})`);

  if (mushroom.resolved) {
    // A resolved question blooms: five petals on a stem.
    group.append('title').text(`Resolved question · ${mushroom.text}`);
    group
      .append('line')
      .attr('y2', -20)
      .attr('stroke', PALETTE.stem)
      .attr('stroke-width', 2)
      .attr('stroke-linecap', 'round');
    for (let i = 0; i < 5; i++) {
      const angle = (-90 + i * 72) * (Math.PI / 180);
      group
        .append('circle')
        .attr('cx', Math.cos(angle) * 6)
        .attr('cy', -24 + Math.sin(angle) * 6)
        .attr('r', 4.2)
        .attr('fill', PALETTE.flowerPetal);
    }
    group.append('circle').attr('cy', -24).attr('r', 3.2).attr('fill', PALETTE.flowerCenter);
    selectable(group, onSelect, 'flower', mushroom.id, treeId);
    return;
  }

  const r = mushroom.capRadius;
  group
    .append('title')
    .text(`Open question · ${mushroom.text} · came up ${plural(mushroom.recurrence, 'time')}`);
  group
    .append('rect')
    .attr('x', -r * 0.22)
    .attr('y', -r)
    .attr('width', r * 0.44)
    .attr('height', r)
    .attr('rx', 2)
    .attr('fill', PALETTE.mushroomStem);
  group
    .append('path')
    .attr('d', `M${-r},${-r}A${r},${r * 0.85} 0 0 1 ${r},${-r}Z`)
    .attr('fill', PALETTE.mushroomCap);
  selectable(group, onSelect, 'mushroom', mushroom.id, treeId);
}

function drawStone(parent: Group, stone: StoneLayout, onSelect: SelectHandler, treeId: string): void {
  const carved = stone.kind === 'carved';
  const group = parent
    .append('g')
    .attr('data-kind', 'stone')
    .attr('data-stone-kind', stone.kind)
    .attr('transform', `translate(${stone.x},${stone.y})`);
  group
    .append('title')
    .text(`${carved ? 'Decision you stated or sourced' : 'Inferred decision'} · ${stone.text}`);

  group
    .append('path')
    .attr('d', 'M-14,0Q-15,-12 -6,-15Q4,-18 11,-13Q16,-8 14,0Z')
    .attr('fill', carved ? PALETTE.stone : PALETTE.stoneDark)
    .attr('stroke', carved ? PALETTE.stoneLight : PALETTE.moss)
    .attr('stroke-width', 1.25)
    // Solid edge for a carved stone, dashed for a mossy one, so the two differ in shape too.
    .attr('stroke-dasharray', carved ? null : '3 2.5');

  if (carved) {
    group
      .append('path')
      .attr('d', 'M-7,-8L-2,-5M0,-10L6,-6')
      .attr('fill', 'none')
      .attr('stroke', PALETTE.stoneLight)
      .attr('stroke-width', 1.25)
      .attr('stroke-linecap', 'round');
  } else {
    group
      .append('path')
      .attr('d', 'M-11,-11Q-3,-21 9,-14Q2,-11 -11,-11Z')
      .attr('fill', PALETTE.moss);
  }
  selectable(group, onSelect, 'stone', stone.id, treeId);
}

function drawHypothesis(
  parent: Group,
  hypothesis: HypothesisLayout,
  onSelect: SelectHandler,
  treeId: string
): void {
  const group = parent
    .append('g')
    .attr('data-kind', 'hypothesis')
    .attr('data-opacity', hypothesis.opacity)
    .attr('transform', `translate(${hypothesis.x},${hypothesis.y})`);
  group.append('title').text(`${hypothesis.text} · confidence ${hypothesis.confidence.toFixed(2)}`);
  const puffs = [
    { cx: -8, cy: 2, rx: 17, ry: 8 },
    { cx: 9, cy: -2, rx: 15, ry: 7 },
  ];
  for (const puff of puffs) {
    group
      .append('ellipse')
      .attr('cx', puff.cx)
      .attr('cy', puff.cy)
      .attr('rx', puff.rx)
      .attr('ry', puff.ry)
      .attr('fill', PALETTE.fog)
      .attr('fill-opacity', hypothesis.opacity);
  }
  selectable(group, onSelect, 'hypothesis', hypothesis.id, treeId);
}

function drawFirefly(parent: Group, firefly: FireflyLayout, onSelect: SelectHandler, treeId: string): void {
  const group = parent.append('g').attr('data-kind', 'firefly');
  group.append('title').text(`Past research · ${firefly.text}`);
  group
    .append('path')
    .attr('d', firefly.trail)
    .attr('fill', 'none')
    .attr('stroke', PALETTE.firefly)
    .attr('stroke-width', 1.5)
    .attr('stroke-linecap', 'round')
    .attr('stroke-dasharray', '1 5')
    .attr('stroke-opacity', 0.75);
  group
    .append('circle')
    .attr('cx', firefly.x)
    .attr('cy', firefly.y)
    .attr('r', 9)
    .attr('fill', PALETTE.fireflyGlow)
    .attr('fill-opacity', 0.22);
  group
    .append('circle')
    .attr('cx', firefly.x)
    .attr('cy', firefly.y)
    .attr('r', 3.2)
    .attr('fill', PALETTE.firefly);
  selectable(group, onSelect, 'firefly', firefly.id, treeId);
}

function drawTree(
  parent: Group,
  tree: TreeLayout,
  groundY: number,
  onSelect: SelectHandler,
  dragContext: DragContext
): void {
  const group = parent
    .append('g')
    .attr('data-kind', 'tree')
    .attr('data-tree-id', tree.id)
    .attr('data-canopy', tree.dormant ? 'amber' : 'green')
    .attr('data-pending', tree.pending ? 'true' : null);
  group.append('title').text(`${tree.name} · ${treeMeta(tree)}`);
  // Canopy, trunk and name select the tree; everything drawn below stops the click first.
  selectable(group, onSelect, 'tree', tree.id, tree.id);

  group
    .append('g')
    .attr('data-kind', 'canopy')
    .selectAll('circle')
    .data(tree.canopy)
    .join('circle')
    .attr('cx', (blob) => blob.cx)
    .attr('cy', (blob) => blob.cy)
    .attr('r', (blob) => blob.r)
    .attr('fill', tree.dormant ? PALETTE.canopyAmber : PALETTE.canopyGreen)
    .attr('fill-opacity', 0.5);

  if (tree.fogOpacity > 0) {
    // Mist over an uncertain goal: the less confident, the denser (SPEC §9.1).
    const fog = group
      .append('g')
      .attr('data-kind', 'tree-fog')
      .attr('data-opacity', tree.fogOpacity);
    fog
      .append('title')
      .text(`Low confidence · ${tree.goalConfidence.toFixed(2)} · ${tree.name}`);
    fog
      .selectAll('ellipse')
      .data(tree.canopy)
      .join('ellipse')
      .attr('cx', (blob) => blob.cx)
      .attr('cy', (blob) => blob.cy)
      .attr('rx', (blob) => blob.r * 1.08)
      .attr('ry', (blob) => blob.r * 0.6)
      .attr('fill', PALETTE.fog)
      .attr('fill-opacity', tree.fogOpacity);
  }

  group
    .append('path')
    .attr('data-kind', 'trunk')
    .attr('data-trunk-width', tree.trunkWidth)
    .attr('d', tree.trunkPath)
    .attr('fill', PALETTE.trunk);

  for (const branch of tree.branches) {
    const branchGroup = group
      .append('g')
      .attr('data-kind', 'branch')
      .attr('data-branch-ref', branch.ref)
      .attr('data-status', branch.status);
    branchGroup
      .append('title')
      .text(`${branch.label || 'Path'} · ${plural(branch.leaves.length, 'tab')}`);
    selectable(branchGroup, onSelect, 'branch', branch.ref, tree.id);

    branchGroup
      .append('path')
      .attr('d', branch.path)
      .attr('fill', 'none')
      .attr('stroke', PALETTE.branch)
      .attr('stroke-width', branch.status === 'active' ? 3.5 : 2.5)
      .attr('stroke-linecap', 'round');

    branchGroup
      .selectAll('line.twig')
      .data(branch.leaves)
      .join('line')
      .attr('class', 'twig')
      .attr('x1', branch.tip.x)
      .attr('y1', branch.tip.y)
      .attr('x2', (leaf) => leaf.x)
      .attr('y2', (leaf) => leaf.y)
      .attr('stroke', PALETTE.branch)
      .attr('stroke-width', 1.25)
      .attr('stroke-linecap', 'round');

    drawLeaves(
      branchGroup,
      branch.leaves,
      tree.dormant ? PALETTE.leafAmber : PALETTE.leafGreen,
      onSelect,
      tree.id
    );
  }

  // Vines wrap the leaves that say the same thing; thicker when they are exact duplicates.
  for (const vine of tree.vines) {
    const vineGroup = group
      .append('g')
      .attr('data-kind', 'vine')
      .attr('data-vine-kind', vine.exact ? 'exact' : 'semantic');
    vineGroup
      .append('title')
      .text(`${vine.exact ? 'Exact duplicates' : 'Overlapping sources'} · ${vine.reason}`);
    drawVinePath(vineGroup, vine.path, vine.exact ? 4.5 : 2.25, false);
    selectable(vineGroup, onSelect, 'vine', vine.id, tree.id);
  }

  // Branch labels sit over the canopy, so they are drawn after it with a dark halo.
  for (const branch of tree.branches) {
    group
      .append('text')
      .attr('data-kind', 'branch-label')
      .attr('x', branch.labelAt.x)
      .attr('y', branch.labelAt.y + 4)
      .attr('text-anchor', 'middle')
      .attr('font-family', FONT.sans)
      .attr('font-size', 12.5)
      .attr('font-weight', 500)
      .attr('fill', PALETTE.text)
      .attr('stroke', PALETTE.halo)
      .attr('stroke-width', 3)
      .attr('stroke-linejoin', 'round')
      .attr('paint-order', 'stroke')
      .attr('pointer-events', 'none')
      .text(branch.label);
  }

  const fallen = group
    .selectAll<SVGPathElement, LeafLayout>('path.fallen-leaf')
    .data(tree.fallenLeaves)
    .join('path')
    .attr('class', 'fallen-leaf')
    .attr('data-kind', 'fallen-leaf')
    .attr('data-tab-ref', (leaf) => leaf.tabRef)
    .attr('d', (leaf) => leafPath(leaf.length))
    .attr('transform', (leaf) => `translate(${leaf.x},${leaf.y}) rotate(${leaf.angle})`)
    .attr('fill', PALETTE.fallenLeaf)
    .attr('fill-opacity', 0.85);
  fallen.append('title').text((leaf) => `Stale tab · ${leafTitle(leaf)}`);
  selectable(fallen, onSelect, 'fallen-leaf', (leaf: LeafLayout) => leaf.tabRef, tree.id);
  fallen.call(leafDrag(dragContext, tree.id));

  for (const mushroom of tree.mushrooms) drawMushroom(group, mushroom, onSelect, tree.id);
  for (const stone of tree.stones) drawStone(group, stone, onSelect, tree.id);
  for (const hypothesis of tree.hypotheses) drawHypothesis(group, hypothesis, onSelect, tree.id);
  for (const firefly of tree.fireflies) drawFirefly(group, firefly, onSelect, tree.id);

  label(group, tree.x, groundY + 30, tree.name, 'name');
  label(group, tree.x, groundY + 50, treeMeta(tree), 'meta');
}

function drawStems(group: Group, patch: PatchLayout): void {
  group
    .selectAll('line.stem')
    .data(patch.leaves)
    .join('line')
    .attr('class', 'stem')
    .attr('x1', (leaf) => leaf.stemBase.x)
    .attr('y1', (leaf) => leaf.stemBase.y)
    .attr('x2', (leaf) => leaf.x)
    .attr('y2', (leaf) => leaf.y)
    .attr('stroke', PALETTE.stem)
    .attr('stroke-width', 1.5)
    .attr('stroke-linecap', 'round');
}

function drawPatch(
  parent: Group,
  patch: PatchLayout,
  groundY: number,
  kind: 'meadow' | 'fog' | 'sprout',
  id: string,
  fill: string,
  onSelect: SelectHandler
): Group {
  const group = parent.append('g').attr('data-kind', kind);
  const count = plural(patch.leaves.length, 'tab');
  group.append('title').text(`${patch.label} · ${count}`);
  selectable(group, onSelect, kind, id);
  drawStems(group, patch);
  drawLeaves(group, patch.leaves, fill, onSelect);
  label(group, patch.x, groundY + 30, patch.label, 'patch');
  return group;
}

export function renderGrove(
  svgElement: SVGSVGElement,
  layout: GroveLayout,
  handlers: GroveHandlers = {}
): GroveZoomControls {
  const onSelect: SelectHandler = (selection) => handlers.onSelect?.(selection);
  const svg = select(svgElement);
  svg.selectAll('*').remove();
  svg
    .attr('viewBox', `0 0 ${layout.width} ${layout.height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    // A click on empty ground clears the selection.
    .on('click', () => onSelect(null));

  const root = svg.append('g').attr('data-kind', 'grove-root');

  // The forest floor runs well past the grove so panning never shows an edge.
  root
    .append('rect')
    .attr('data-kind', 'ground')
    .attr('x', -layout.width * 2)
    .attr('y', layout.groundY)
    .attr('width', layout.width * 5)
    .attr('height', layout.height * 3)
    .attr('fill', PALETTE.ground)
    .attr('fill-opacity', 0.35);
  root
    .append('line')
    .attr('x1', -layout.width * 2)
    .attr('x2', layout.width * 3)
    .attr('y1', layout.groundY)
    .attr('y2', layout.groundY)
    .attr('stroke', PALETTE.groundLine)
    .attr('stroke-width', 1.5);

  for (const sprout of layout.sprouts) {
    const group = drawPatch(
      root,
      sprout,
      layout.groundY,
      'sprout',
      sprout.ref,
      PALETTE.sproutLeaf,
      onSelect
    );
    group.attr('data-sprout-ref', sprout.ref);
    label(group, sprout.x, layout.groundY + 50, `sprout · ${plural(sprout.leaves.length, 'tab')}`, 'meta');
  }

  // Shown only while a leaf is being dragged.
  const zone = root
    .append('g')
    .attr('data-kind', 'new-tree-zone')
    .attr('display', 'none')
    .attr('pointer-events', 'none');
  zone
    .append('circle')
    .attr('cx', layout.newTreeZone.x)
    .attr('cy', layout.newTreeZone.y)
    .attr('r', layout.newTreeZone.r)
    .attr('fill', PALETTE.ground)
    .attr('fill-opacity', 0.6)
    .attr('stroke', PALETTE.textMuted)
    .attr('stroke-width', 1.5)
    .attr('stroke-dasharray', '5 5');
  label(zone, layout.newTreeZone.x, layout.newTreeZone.y + 5, 'New tree', 'patch');

  const dragContext: DragContext = {
    layout,
    root,
    zone,
    onDropLeaf: (drop) => handlers.onDropLeaf?.(drop),
  };

  for (const tree of layout.trees) drawTree(root, tree, layout.groundY, onSelect, dragContext);

  // Drawn after the trees so the vine crosses over both canopies it joins.
  for (const vine of layout.sharedVines) {
    const group = root
      .append('g')
      .attr('data-kind', 'shared-vine')
      .attr('data-tab-ref', vine.tabRef);
    group.append('title').text(`Shared tab · ${vine.title} · serves two goals`);
    drawVinePath(group, vine.path, 1.5, true);
    selectable(group, onSelect, 'shared-vine', vine.tabRef);
  }

  if (layout.meadow) {
    const group = drawPatch(
      root,
      layout.meadow,
      layout.groundY,
      'meadow',
      'meadow',
      PALETTE.meadowLeaf,
      onSelect
    );
    label(group, layout.meadow.x, layout.groundY + 50, plural(layout.meadow.leaves.length, 'tab'), 'meta');
  }

  if (layout.fog) {
    const fog = layout.fog;
    const group = drawPatch(root, fog, layout.groundY, 'fog', 'fog', PALETTE.fogLeaf, onSelect);
    // Three overlapping banks of mist over the tabs the grove could not place.
    const banks = [
      { dx: -0.3, dy: -30, rx: 0.62, ry: 22 },
      { dx: 0.28, dy: -20, rx: 0.66, ry: 19 },
      { dx: 0, dy: -44, rx: 0.5, ry: 18 },
    ];
    group
      .selectAll('ellipse')
      .data(banks)
      .join('ellipse')
      .attr('data-kind', 'fog-bank')
      .attr('cx', (bank) => fog.x + bank.dx * fog.halfWidth)
      .attr('cy', (bank) => layout.groundY + bank.dy)
      .attr('rx', (bank) => bank.rx * fog.halfWidth)
      .attr('ry', (bank) => bank.ry)
      .attr('fill', PALETTE.fog)
      .attr('fill-opacity', 0.16)
      // The mist must not swallow clicks meant for the tabs inside it.
      .attr('pointer-events', 'none');
    label(group, fog.x, layout.groundY + 50, plural(fog.leaves.length, 'tab'), 'meta');
  }

  const zoomBehavior = zoom<SVGSVGElement, unknown>()
    .scaleExtent(SCALE_EXTENT)
    // Set explicitly: the default reads the element's rendered size, which is
    // not the viewBox the grove is drawn in.
    .extent([
      [0, 0],
      [layout.width, layout.height],
    ])
    .translateExtent([
      [-layout.width * 0.5, -layout.height * 0.5],
      [layout.width * 1.5, layout.height * 1.5],
    ])
    .on('zoom', (event) => {
      root.attr('transform', event.transform.toString());
    });

  svg.call(zoomBehavior);
  // d3-zoom keeps its transform on the <svg>, which outlives a redraw. Applying
  // it here means an edit to the grove does not throw away the user's view.
  const kept = zoomTransform(svgElement);
  if (kept.k !== 1 || kept.x !== 0 || kept.y !== 0) root.attr('transform', kept.toString());

  const clearRoots = () => {
    root.selectAll('[data-kind="roots"]').remove();
    root.selectAll('[data-evidence]').attr('data-evidence', null);
    root.selectAll('[data-dimmed]').attr('data-dimmed', null);
  };

  return {
    zoomBy: (factor) => svg.call(zoomBehavior.scaleBy, factor),
    reset: () => svg.call(zoomBehavior.transform, zoomIdentity),
    focusTree: (treeId) => {
      const tree = layout.trees.find((t) => t.id === treeId);
      if (!tree) return;
      const scale = Math.max(
        1,
        Math.min(SCALE_EXTENT[1], layout.width / (tree.halfWidth * 2 + 160), 2.4)
      );
      const centerY = layout.groundY - 150;
      svg.call(
        zoomBehavior.transform,
        zoomIdentity
          .translate(layout.width / 2 - scale * tree.x, layout.height / 2 - scale * centerY)
          .scale(scale)
      );
    },
    showRoots: (roots) => {
      clearRoots();
      if (!roots) return;
      const lit = new Set(roots.paths.map((path) => path.tabRef));
      // Only the evidence leaves stay bright; the rest of the tree steps back.
      root
        .selectAll<SVGGElement, unknown>('[data-kind="tree"]')
        .filter(function () {
          return this.getAttribute('data-tree-id') === roots.treeId;
        })
        .selectAll<SVGPathElement, unknown>('[data-tab-ref]')
        .each(function () {
          const isEvidence = lit.has(this.getAttribute('data-tab-ref') ?? '');
          this.setAttribute(isEvidence ? 'data-evidence' : 'data-dimmed', 'true');
        });
      root
        .append('g')
        .attr('data-kind', 'roots')
        .attr('data-tree-id', roots.treeId)
        .attr('pointer-events', 'none')
        .selectAll('path')
        .data(roots.paths)
        .join('path')
        .attr('data-root-to', (path) => path.tabRef)
        .attr('d', (path) => path.d)
        .attr('fill', 'none')
        .attr('stroke', PALETTE.roots)
        .attr('stroke-width', 1.75)
        .attr('stroke-linecap', 'round')
        .attr('stroke-opacity', 0.9);
    },
    destroy: () => {
      svg.on('.zoom', null).on('click', null);
      svg.selectAll('*').remove();
    },
  };
}
