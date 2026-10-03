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
