import React from 'react';

// lucide has no mushroom, and the mushroom is the grove's mark for an open question.
export const MushroomIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...props}
  >
    <path d="M3 12a9 8 0 0 1 18 0Z" />
    <path d="M10 12v6a2 2 0 0 0 4 0v-6" />
  </svg>
);

/** A firefly: the grove's mark for a link to research done before. */
export const FireflyIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
    <circle cx="12" cy="13" r="8" fill="currentColor" opacity="0.2" />
    <circle cx="12" cy="13" r="3.2" fill="currentColor" />
    <path
      d="M9.5 9.5C8 7 5.5 6.5 4 7.5M14.5 9.5C16 7 18.5 6.5 20 7.5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);
