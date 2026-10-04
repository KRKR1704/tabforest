import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import type { GroveResponse } from '../types';
import {
  GROW_TIMELINE,
  hollowCountLine,
  playArrivals,
  playGrowFade,
  playGrowIntro,
  prefersReducedMotion,
  type GrowAnimation,
} from './growAnimation';
import { decorateGrove, playChanges, type GroveMotion } from './groveMotion';
import { computeGroveLayout, computeRoots, type GroveLayout, type RootsAnchor } from './layout';
import { groveMotionEnabled } from './motionSwitch';
import { renderGrove, type GroveZoomControls, type LeafDrop } from './render';
import type { GroveSelection } from './selection';

interface GroveCanvasProps {
  grove: GroveResponse;
  /** The element to show as selected. */
  selected?: GroveSelection | null;
  /** Called with the clicked element, or null when empty ground is clicked. */
  onSelect?: (selection: GroveSelection | null) => void;
  /** Called when a leaf is dragged to another tree or to the new-tree zone. */
  onDropLeaf?: (drop: LeafDrop) => void;
  /** The claim whose evidence leaves should be lit by roots. */
  roots?: GroveRoots | null;
  /** The tree to zoom in on. */
  focusTreeId?: string | null;
  /** Changes when a new grow plants its clusters; the grow animation plays once per value. */
  growKey?: number;
  /** Multiplies the animation's durations. Tests pass a small number. */
  growTimeScale?: number;
  /** A tab to point out: its leaf, its branch and its copies are lit. */
  highlight?: { tabRef: string; treeId?: string | null; copyRefs?: string[] } | null;
  /** The pointer moved onto a leaf, or off it (null). */
  onHoverLeaf?: (leaf: { tabRef: string; treeId: string | null } | null) => void;
}

export interface GroveRoots {
  treeId: string;
  anchor: RootsAnchor;
  tabRefs: string[];
}

const ZOOM_STEP = 1.3;

// The last grow that was animated. Kept outside the component so that coming
// back to this screen in the middle of a grow does not replay it.
let playedGrowKey = 0;

function describe(grove: GroveResponse): string {
  const parts = [`${grove.trees.length} ${grove.trees.length === 1 ? 'goal' : 'goals'}`];
  if (grove.sprouts.length > 0) parts.push(`${grove.sprouts.length} emerging`);
  if (grove.meadow.tabs.length > 0) parts.push(`${grove.meadow.tabs.length} in the meadow`);
  if (grove.fog && grove.fog.length > 0) parts.push(`${grove.fog.length} unclear`);
  return `Living Grove: ${parts.join(', ')}`;
}

/** React owns this panel and its controls; D3 owns everything inside the <svg>. */
export const GroveCanvas: React.FC<GroveCanvasProps> = ({
  grove,
  selected = null,
  onSelect,
  onDropLeaf,
  roots = null,
  focusTreeId = null,
  growKey = 0,
  growTimeScale = 1,
  highlight = null,
  onHoverLeaf,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const controlsRef = useRef<GroveZoomControls | null>(null);
  const lastLayoutRef = useRef<GroveLayout | null>(null);

  // While the intro plays, the canvas keeps showing the grove as the clusters
  // line planted it. Results that arrive meanwhile wait in `grove` and are
  // drawn together when the intro ends, which is when the forest speaks.
  const [intro, setIntro] = useState<{ key: number; grove: GroveResponse } | null>(() =>
    growKey > playedGrowKey && !prefersReducedMotion() ? { key: growKey, grove } : null
  );
  const [seenGrowKey, setSeenGrowKey] = useState(growKey);
  if (growKey !== seenGrowKey) {
    setSeenGrowKey(growKey);
    setIntro(prefersReducedMotion() || growKey <= playedGrowKey ? null : { key: growKey, grove });
  }
  const shown = intro ? intro.grove : grove;
  const layout = useMemo(() => computeGroveLayout(shown), [shown]);

  // Kept in a ref so a new callback never forces D3 to redraw and lose the zoom.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onDropLeafRef = useRef(onDropLeaf);
  onDropLeafRef.current = onDropLeaf;
  const onHoverLeafRef = useRef(onHoverLeaf);
  onHoverLeafRef.current = onHoverLeaf;

  // Leaves report the pointer through the <svg>, so redraws need no rewiring.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const leafOf = (target: EventTarget | null) =>
      target instanceof Element ? target.closest('[data-tab-ref][data-kind$="leaf"]') : null;
    const over = (event: Event) => {
      const leaf = leafOf(event.target);
      if (!leaf) return;
      onHoverLeafRef.current?.({
        tabRef: leaf.getAttribute('data-tab-ref') ?? '',
        treeId: leaf.closest('[data-tree-id]')?.getAttribute('data-tree-id') ?? null,
      });
    };
    const out = (event: Event) => {
      if (leafOf(event.target)) onHoverLeafRef.current?.(null);
    };
    svg.addEventListener('mouseover', over);
    svg.addEventListener('mouseout', out);
    return () => {
      svg.removeEventListener('mouseover', over);
      svg.removeEventListener('mouseout', out);
    };
  }, []);

  useEffect(() => {
    if (!svgRef.current) return;
    const controls = renderGrove(svgRef.current, layout, {
      onSelect: (selection) => onSelectRef.current?.(selection),
      onDropLeaf: (drop) => onDropLeafRef.current?.(drop),
    });
    controlsRef.current = controls;

    // The motion layer (depth and idle life) sits on top of the drawing; off, nothing is added.
    const reduced = prefersReducedMotion();
    const decor: GroveMotion | null = groveMotionEnabled()
      ? decorateGrove(svgRef.current, layout, { still: reduced })
      : null;

    const previous = lastLayoutRef.current;
    lastLayoutRef.current = layout;
    let animation: GrowAnimation | null = null;
    if (intro) {
      playedGrowKey = intro.key;
      animation = playGrowIntro(svgRef.current, layout, {
        timeScale: growTimeScale,
        onDone: () => setIntro(null),
      });
    } else if (growKey > playedGrowKey) {
      // Reduced motion: the new grove fades in and nothing moves.
      playedGrowKey = growKey;
      animation = playGrowFade(svgRef.current, growTimeScale);
    } else if (previous) {
      animation = playArrivals(svgRef.current, previous, layout, {
        timeScale: growTimeScale,
        reducedMotion: reduced,
      });
      // Nothing arrived from a grow, so any difference is an edit: animate it.
      if (!animation && groveMotionEnabled() && !reduced) {
        animation = playChanges(svgRef.current, previous, layout, { timeScale: growTimeScale });
      }
    }

    return () => {
      decor?.stop();
      animation?.stop();
      controls.destroy();
      controlsRef.current = null;
    };
    // The grow state is read as it was when this layout was drawn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.querySelectorAll('[data-selected]').forEach((node) => node.removeAttribute('data-selected'));
    if (!selected) return;
    svg.querySelectorAll<SVGElement>(`[data-select-kind="${selected.kind}"]`).forEach((node) => {
      if (node.getAttribute('data-select-id') !== selected.id) return;
      // A shared tab has a leaf on two trees; only the clicked tree's leaf is selected.
      const tree = node.closest('[data-tree-id]')?.getAttribute('data-tree-id') ?? undefined;
      if (selected.treeId === tree) node.setAttribute('data-selected', 'true');
    });
  }, [selected, layout]);

  // Point out one tab: its leaf, the branch it hangs on, and its copies on the same tree.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    for (const name of ['data-hover', 'data-hover-branch', 'data-hover-copy']) {
      svg.querySelectorAll(`[${name}]`).forEach((node) => node.removeAttribute(name));
    }
    if (!highlight) return;
    const copies = new Set(highlight.copyRefs ?? []);
    svg.querySelectorAll<SVGElement>('[data-tab-ref][data-kind$="leaf"]').forEach((leaf) => {
      const ref = leaf.getAttribute('data-tab-ref') ?? '';
      const tree = leaf.closest('[data-tree-id]')?.getAttribute('data-tree-id') ?? null;
      const sameTree = !highlight.treeId || tree === highlight.treeId;
      if (ref === highlight.tabRef && sameTree) {
        leaf.setAttribute('data-hover', 'true');
        leaf.closest('[data-kind="branch"]')?.setAttribute('data-hover-branch', 'true');
      } else if (copies.has(ref) && sameTree) {
        leaf.setAttribute('data-hover-copy', 'true');
      }
    });
  }, [highlight, layout]);

  useEffect(() => {
    controlsRef.current?.showRoots(
      roots ? computeRoots(layout, roots.treeId, roots.anchor, roots.tabRefs) : null
    );
  }, [roots, layout]);

  useEffect(() => {
    if (focusTreeId) controlsRef.current?.focusTree(focusTreeId);
    // The layout is left out on purpose: an edit to the grove must not re-zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTreeId]);

  const buttonClass =
    'flex h-8 w-8 items-center justify-center text-forest-200 hover:bg-forest-800 hover:text-forest-50';

  return (
    <div className="relative h-full w-full">
      <svg
        ref={svgRef}
        role="img"
        aria-label={describe(grove)}
        className="grove-canvas h-full w-full cursor-grab touch-none active:cursor-grabbing"
      />
      {intro && (
        // The Hollow count appears in the corner as the leaves start to gather (SPEC §9.3).
        <p
          data-kind="hollow-count"
          className="grove-hollow-count pointer-events-none absolute left-6 top-4 text-sm text-forest-300"
          style={{
            animationDelay: `${GROW_TIMELINE.swirl.start * growTimeScale}ms`,
            animationDuration: `${300 * growTimeScale}ms`,
          }}
        >
          {hollowCountLine(shown.hollow_count)}
        </p>
      )}
      <div className="absolute bottom-4 right-4 flex divide-x divide-forest-800 overflow-hidden rounded-md border border-forest-800 bg-forest-900">
        <button
          type="button"
          aria-label="Zoom in"
          className={buttonClass}
          onClick={() => controlsRef.current?.zoomBy(ZOOM_STEP)}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          className={buttonClass}
          onClick={() => controlsRef.current?.zoomBy(1 / ZOOM_STEP)}
        >
          <Minus className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Reset view"
          className={buttonClass}
          onClick={() => controlsRef.current?.reset()}
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};
