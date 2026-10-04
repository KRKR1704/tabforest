import React, { useEffect, useMemo, useRef } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import type { GroveResponse } from '../types';
import { computeGroveLayout } from './layout';
import { renderGrove, type GroveZoomControls } from './render';

interface GroveCanvasProps {
  grove: GroveResponse;
}

const ZOOM_STEP = 1.3;

function describe(grove: GroveResponse): string {
  const parts = [`${grove.trees.length} ${grove.trees.length === 1 ? 'goal' : 'goals'}`];
  if (grove.sprouts.length > 0) parts.push(`${grove.sprouts.length} emerging`);
  if (grove.meadow.tabs.length > 0) parts.push(`${grove.meadow.tabs.length} in the meadow`);
  if (grove.fog && grove.fog.length > 0) parts.push(`${grove.fog.length} unclear`);
  return `Living Grove: ${parts.join(', ')}`;
}

/** React owns this panel and its controls; D3 owns everything inside the <svg>. */
export const GroveCanvas: React.FC<GroveCanvasProps> = ({ grove }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const controlsRef = useRef<GroveZoomControls | null>(null);
  const layout = useMemo(() => computeGroveLayout(grove), [grove]);

  useEffect(() => {
    if (!svgRef.current) return;
    const controls = renderGrove(svgRef.current, layout);
    controlsRef.current = controls;
    return () => {
      controls.destroy();
      controlsRef.current = null;
    };
  }, [layout]);

  const buttonClass =
    'flex h-8 w-8 items-center justify-center text-forest-200 hover:bg-forest-800 hover:text-forest-50';

  return (
    <div className="relative h-full w-full">
      <svg
        ref={svgRef}
        role="img"
        aria-label={describe(grove)}
        className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
      />
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
