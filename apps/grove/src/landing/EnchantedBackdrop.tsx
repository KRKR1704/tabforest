import React from 'react';

// A quiet atmosphere behind the landing page: a few leaves drifting down and a
// few fireflies. It is decoration only: hidden from assistive technology, never
// in the way of the pointer, and still for anyone who asks for reduced motion
// (see .enchanted-* in index.css).

/** Leaves: where each starts across the page, how long it takes to fall, and when it sets off. */
const LEAVES = [
  { left: 6, seconds: 26, delay: -3, size: 12, tone: 'green' },
  { left: 19, seconds: 34, delay: -17, size: 10, tone: 'green' },
  { left: 33, seconds: 29, delay: -9, size: 13, tone: 'amber' },
  { left: 52, seconds: 37, delay: -24, size: 10, tone: 'green' },
  { left: 68, seconds: 31, delay: -13, size: 12, tone: 'green' },
  { left: 81, seconds: 27, delay: -20, size: 11, tone: 'amber' },
  { left: 93, seconds: 35, delay: -6, size: 10, tone: 'green' },
] as const;

/** Fireflies: where each hovers, how slowly it wanders, and when it glows. */
const FIREFLIES = [
  { left: 9, top: 22, seconds: 13, delay: -2 },
  { left: 24, top: 64, seconds: 17, delay: -8 },
  { left: 38, top: 12, seconds: 15, delay: -5 },
  { left: 47, top: 78, seconds: 19, delay: -11 },
  { left: 61, top: 34, seconds: 14, delay: -3 },
  { left: 73, top: 58, seconds: 18, delay: -14 },
  { left: 84, top: 18, seconds: 16, delay: -7 },
  { left: 92, top: 72, seconds: 20, delay: -10 },
] as const;

export const EnchantedBackdrop: React.FC = () => (
  <div aria-hidden="true" data-kind="enchanted-backdrop" className="enchanted pointer-events-none fixed inset-0 z-0 overflow-hidden">
    <div className="enchanted-haze" />
    {LEAVES.map((leaf, index) => (
      <span
        key={`leaf-${index}`}
        className={`enchanted-leaf enchanted-leaf-${leaf.tone}`}
        style={{
          left: `${leaf.left}%`,
          width: leaf.size,
          height: leaf.size,
          animationDuration: `${leaf.seconds}s`,
          animationDelay: `${leaf.delay}s`,
        }}
      />
    ))}
    {FIREFLIES.map((fly, index) => (
      <span
        key={`fly-${index}`}
        className="enchanted-fly"
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
