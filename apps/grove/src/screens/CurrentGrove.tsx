import React, { useState } from 'react';
import type { GroveResponse, GroveTab } from '../types';
import type { EvidenceClaim } from '../components/EvidenceDrawer';
import { GroveCanvas } from '../viz/GroveCanvas';
import { GroveOutline } from './GroveOutline';

interface CurrentGroveProps {
  grove: GroveResponse | null;
  onShowEvidence: (claim: EvidenceClaim, tabs: GroveTab[]) => void;
}

type GroveView = 'grove' | 'outline';

const VIEWS: Array<{ id: GroveView; label: string }> = [
  { id: 'grove', label: 'Grove' },
  { id: 'outline', label: 'Outline' },
];

export const CurrentGrove: React.FC<CurrentGroveProps> = ({ grove, onShowEvidence }) => {
  const [view, setView] = useState<GroveView>('grove');

  if (!grove || grove.trees.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-8 py-12">
        <p className="font-serif text-lg text-forest-100">No grove yet.</p>
        <p className="mt-2 text-sm text-forest-400">Grow one from the tabs you have open.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div
        role="group"
        aria-label="Grove view"
        className="flex shrink-0 gap-5 border-b border-forest-800 px-6"
      >
        {VIEWS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={view === option.id}
            onClick={() => setView(option.id)}
            className={`-mb-px border-b-2 py-2 text-sm ${
              view === option.id
                ? 'border-forest-400 font-medium text-forest-50'
                : 'border-transparent text-forest-300 hover:text-forest-100'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {view === 'grove' ? (
          <GroveCanvas grove={grove} />
        ) : (
          <div className="h-full overflow-y-auto">
            <GroveOutline grove={grove} onShowEvidence={onShowEvidence} />
          </div>
        )}
      </div>
    </div>
  );
};
