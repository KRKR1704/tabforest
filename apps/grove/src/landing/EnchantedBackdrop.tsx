import React from 'react';

// A quiet atmosphere behind the landing page: far foliage along the bottom edge,
// a few leaves drifting down and a few fireflies. Smaller screens get fewer. It is decoration only: hidden from assistive technology, never
// in the way of the pointer, and still for anyone who asks for reduced motion
// (see .enchanted-* in index.css).

/**
 * Leaves: where each starts across the page, how long it takes to fall, when it
 * sets off, how clear it is, whether it drifts the wide way, and the narrowest
 * screen it is shown on ('wide' desktop only, 'mid' tablet and up, '' everywhere).
 */
const LEAVES = [
  { left: 6, seconds: 24, delay: -3, size: 20, tone: 'green', opacity: 0.62, drift: false, show: '' },
  { left: 19, seconds: 31, delay: -17, size: 16, tone: 'green', opacity: 0.45, drift: true, show: 'wide' },
  { left: 33, seconds: 27, delay: -9, size: 22, tone: 'amber', opacity: 0.6, drift: false, show: 'mid' },
  { left: 52, seconds: 34, delay: -24, size: 16, tone: 'green', opacity: 0.4, drift: true, show: 'wide' },
  { left: 68, seconds: 29, delay: -13, size: 20, tone: 'green', opacity: 0.62, drift: true, show: '' },
  { left: 81, seconds: 25, delay: -20, size: 18, tone: 'amber', opacity: 0.5, drift: false, show: 'wide' },
  { left: 93, seconds: 32, delay: -6, size: 16, tone: 'green', opacity: 0.55, drift: false, show: 'mid' },
] as const;

/** Fireflies: where each hovers, how slowly it wanders, when it glows, its color, and where it is shown. */
const FIREFLIES = [
  { left: 9, top: 22, seconds: 13, delay: -2, tone: 'gold', show: '' },
  { left: 24, top: 64, seconds: 17, delay: -8, tone: 'gold', show: 'mid' },
  { left: 38, top: 12, seconds: 15, delay: -5, tone: 'violet', show: 'wide' },
  { left: 47, top: 78, seconds: 19, delay: -11, tone: 'gold', show: '' },
  { left: 61, top: 34, seconds: 14, delay: -3, tone: 'gold', show: 'wide' },
  { left: 73, top: 58, seconds: 18, delay: -14, tone: 'gold', show: 'mid' },
  { left: 84, top: 18, seconds: 16, delay: -7, tone: 'gold', show: '' },
  { left: 92, top: 72, seconds: 20, delay: -10, tone: 'gold', show: 'wide' },
  { left: 16, top: 88, seconds: 21, delay: -6, tone: 'violet', show: 'wide' },
  { left: 56, top: 92, seconds: 16, delay: -12, tone: 'gold', show: 'mid' },
] as const;

const shown = (show: string) => (show ? ` enchanted-${show}` : '');

export const EnchantedBackdrop: React.FC = () => (
  <div aria-hidden="true" data-kind="enchanted-backdrop" className="enchanted pointer-events-none fixed inset-0 z-0 overflow-hidden">
    <div className="enchanted-haze" />
    <svg className="enchanted-foliage" viewBox="0 0 1200 200" preserveAspectRatio="none">
      <path
        className="enchanted-foliage-far"
        d="M0,200V120Q40,70 90,104Q130,50 190,92Q240,40 300,96Q350,66 400,110Q460,52 520,100Q570,70 620,112Q680,44 740,98Q800,64 850,108Q910,48 970,100Q1020,72 1070,110Q1130,58 1200,104V200Z"
      />
      <path
        className="enchanted-foliage-near"
        d="M0,200V160Q60,118 120,150Q170,112 240,152Q300,126 360,158Q430,116 500,154Q560,132 620,160Q690,120 760,154Q830,128 890,160Q960,118 1030,152Q1100,130 1200,158V200Z"
      />
    </svg>
    {LEAVES.map((leaf, index) => (
      <span
        key={`leaf-${index}`}
        className={`enchanted-leaf enchanted-leaf-${leaf.tone}${leaf.drift ? ' enchanted-leaf-drift' : ''}${shown(leaf.show)}`}
        style={{
          left: `${leaf.left}%`,
          width: leaf.size,
          height: leaf.size,
          opacity: leaf.opacity,
          animationDuration: `${leaf.seconds}s`,
          animationDelay: `${leaf.delay}s`,
        }}
      />
    ))}
    {FIREFLIES.map((fly, index) => (
      <span
        key={`fly-${index}`}
        className={`enchanted-fly${fly.tone === 'violet' ? ' enchanted-fly-violet' : ''}${shown(fly.show)}`}
        style={{
          left: `${fly.left}%`,
          top: `${fly.top}%`,
          animationDuration: `${fly.seconds}s, ${(fly.seconds / 3).toFixed(1)}s`,
          animationDelay: `${fly.delay}s, ${fly.delay}s`,
        }}
      />
    ))}
  </div>
);
