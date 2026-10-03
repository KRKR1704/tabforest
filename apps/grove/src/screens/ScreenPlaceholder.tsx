import React from 'react';

interface ScreenPlaceholderProps {
  description: string;
  children?: React.ReactNode;
}

/** Empty state for a screen whose content has not been built yet. */
export const ScreenPlaceholder: React.FC<ScreenPlaceholderProps> = ({ description, children }) => (
  <div className="mx-auto max-w-2xl px-8 py-12">
    <p className="font-serif text-lg text-forest-100">{description}</p>
    <p className="mt-2 text-sm text-forest-400">Nothing to show here yet.</p>
    {children}
  </div>
);
