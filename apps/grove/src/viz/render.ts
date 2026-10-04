// D3 owns everything inside the <svg>. All text goes through .text(), never
// markup (SPEC §12): titles and labels come from web pages and the model.
import { select, zoom, zoomIdentity, type Selection } from 'd3';
import type { GroveLayout, LeafLayout, PatchLayout, TreeLayout } from './layout';
import { FONT, PALETTE } from './palette';

export interface GroveZoomControls {
  zoomBy: (factor: number) => void;
  reset: () => void;
  destroy: () => void;
}

type Group = Selection<SVGGElement, unknown, null, undefined>;

const SCALE_EXTENT: [number, number] = [0.5, 4];

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

function drawLeaves(parent: Group, leaves: LeafLayout[], fill: string): void {
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
  const parts = [`${Math.round(tree.attentionMinutes)} min`, plural(tree.leafCount, 'tab')];
  // Dormancy is also written out so it never depends on canopy color alone.
  if (tree.dormant) {
    parts.push(
      tree.daysSinceActive !== null ? `dormant ${plural(tree.daysSinceActive, 'day')}` : 'dormant'
    );
  }
  return parts.join(' · ');
}

function drawTree(parent: Group, tree: TreeLayout, groundY: number): void {
  const group = parent
    .append('g')
    .attr('data-kind', 'tree')
    .attr('data-tree-id', tree.id)
    .attr('data-canopy', tree.dormant ? 'amber' : 'green');
  group.append('title').text(`${tree.name} · ${treeMeta(tree)}`);

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
    branchGroup.append('title').text(`${branch.label} · ${plural(branch.leaves.length, 'tab')}`);

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

    drawLeaves(branchGroup, branch.leaves, tree.dormant ? PALETTE.leafAmber : PALETTE.leafGreen);
  }

  // Branch labels sit over the canopy, so they are drawn last with a dark halo.
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
      .text(branch.label);
  }

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
  fill: string
): Group {
  const group = parent.append('g').attr('data-kind', kind);
  const count = plural(patch.leaves.length, 'tab');
  group.append('title').text(`${patch.label} · ${count}`);
  drawStems(group, patch);
  drawLeaves(group, patch.leaves, fill);
  label(group, patch.x, groundY + 30, patch.label, 'patch');
  return group;
}

export function renderGrove(svgElement: SVGSVGElement, layout: GroveLayout): GroveZoomControls {
  const svg = select(svgElement);
  svg.selectAll('*').remove();
  svg
    .attr('viewBox', `0 0 ${layout.width} ${layout.height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

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
    const group = drawPatch(root, sprout, layout.groundY, 'sprout', PALETTE.sproutLeaf);
    group.attr('data-sprout-ref', sprout.ref);
    label(group, sprout.x, layout.groundY + 50, `sprout · ${plural(sprout.leaves.length, 'tab')}`, 'meta');
  }

  for (const tree of layout.trees) drawTree(root, tree, layout.groundY);

  if (layout.meadow) {
    const group = drawPatch(root, layout.meadow, layout.groundY, 'meadow', PALETTE.meadowLeaf);
    label(group, layout.meadow.x, layout.groundY + 50, plural(layout.meadow.leaves.length, 'tab'), 'meta');
  }

  if (layout.fog) {
    const fog = layout.fog;
    const group = drawPatch(root, fog, layout.groundY, 'fog', PALETTE.fogLeaf);
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
      .attr('fill-opacity', 0.16);
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

  return {
    zoomBy: (factor) => svg.call(zoomBehavior.scaleBy, factor),
    reset: () => svg.call(zoomBehavior.transform, zoomIdentity),
    destroy: () => {
      svg.on('.zoom', null);
      svg.selectAll('*').remove();
    },
  };
}
