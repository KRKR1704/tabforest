import React, { useState } from 'react';
import type { GroveResponse, GroveTab } from '../types';
import type { EvidenceClaim } from '../components/EvidenceDrawer';
import { GroveCanvas } from '../viz/GroveCanvas';
import { describeSelection, type GroveSelection } from '../viz/selection';
import { GroveOutline } from './GroveOutline';

interface CurrentGroveProps {
  grove: GroveResponse | null;
  onShowEvidence: (claim: EvidenceClaim, tabs: GroveTab[]) => void;
  onHideEvidence?: () => void;
}

type GroveView = 'grove' | 'outline';

const VIEWS: Array<{ id: GroveView; label: string }> = [
  { id: 'grove', label: 'Grove' },
  { id: 'outline', label: 'Outline' },
];

export const CurrentGrove: React.FC<CurrentGroveProps> = ({
  grove,
  onShowEvidence,
  onHideEvidence,
}) => {
  const [view, setView] = useState<GroveView>('grove');
  const [selection, setSelection] = useState<GroveSelection | null>(null);

  if (!grove || grove.trees.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-8 py-12">
        <p className="font-serif text-lg text-forest-100">No grove yet.</p>
        <p className="mt-2 text-sm text-forest-400">Grow one from the tabs you have open.</p>
      </div>
    );
  }

  const selected = selection ? describeSelection(grove, selection) : null;

  // A claim opens its evidence in the drawer; anything else is named in the caption.
  const handleSelect = (next: GroveSelection | null) => {
    setSelection(next);
    const described = next ? describeSelection(grove, next) : null;
    if (described?.claim) onShowEvidence(described.claim, described.tabs ?? []);
    else onHideEvidence?.();
  };

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
          <div className="relative h-full">
            <GroveCanvas grove={grove} selected={selection} onSelect={handleSelect} />
            {selected && !selected.claim && (
              <div
                role="status"
                className="absolute bottom-4 left-4 max-w-md rounded-md border border-forest-800 bg-forest-900 px-4 py-3"
              >
                <p className="text-xs font-medium uppercase tracking-wider text-forest-400">
                  {selected.label}
                </p>
                <p className="mt-1 font-serif text-forest-50">{selected.text}</p>
                {selected.detail && (
                  <p className="mt-1 text-xs text-forest-300">{selected.detail}</p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="h-full overflow-y-auto">
            <GroveOutline grove={grove} onShowEvidence={onShowEvidence} />
          </div>
        )}
      </div>
    </div>
  );
};
