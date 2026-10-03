import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { EvidenceRef, GroveTab, Provenance } from '../types';
import { ProvenancePill } from './ProvenancePill';

export interface EvidenceClaim {
  /** What kind of claim this is, e.g. "Goal" or "Decision". */
  kind: string;
  text: string;
  provenance: Provenance;
  confidence?: number;
  quote?: string | null;
  evidence: EvidenceRef[];
}

interface EvidenceDrawerProps {
  claim: EvidenceClaim | null;
  /** Tabs of the claim's tree, used to name tab evidence. */
  tabs?: GroveTab[];
  onClose: () => void;
}

// Short-ref prefixes from SPEC §2.5.
const SOURCE_LABELS: Record<string, string> = {
  t: 'Tab',
  q: 'Search',
  n: 'Your note',
  d: 'Document',
};

function sourceLabel(ref: string): string {
  return SOURCE_LABELS[ref.charAt(0)] ?? 'Evidence';
}

export const EvidenceDrawer: React.FC<EvidenceDrawerProps> = ({ claim, tabs = [], onClose }) => {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!claim) return;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [claim, onClose]);

  if (!claim) return null;

  return (
    <aside
      aria-label="Evidence"
      className="flex w-96 shrink-0 flex-col border-l border-forest-800 bg-forest-900"
    >
      <header className="flex items-start justify-between gap-4 border-b border-forest-800 px-5 py-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-forest-400">
            {claim.kind}
          </p>
          <h2 className="mt-1 font-serif text-lg leading-snug text-forest-50">{claim.text}</h2>
          <div className="mt-3">
            <ProvenancePill provenance={claim.provenance} confidence={claim.confidence} />
          </div>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label="Close evidence"
          className="rounded-sm p-1 text-forest-300 hover:bg-forest-800 hover:text-forest-50"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {claim.quote && (
          <blockquote className="mb-5 border-l-2 border-stoneGray pl-3 font-serif italic text-forest-100">
            {claim.quote}
          </blockquote>
        )}

        <h3 className="text-xs font-medium uppercase tracking-wider text-forest-400">
          Roots · {claim.evidence.length}
        </h3>

        {claim.evidence.length === 0 ? (
          <p className="mt-3 text-sm text-forest-300">No evidence is recorded for this claim.</p>
        ) : (
          <ul className="mt-3 divide-y divide-forest-800">
            {claim.evidence.map((item) => {
              const tab = tabs.find((t) => t.tab_ref === item.ref);
              return (
                <li key={item.ref} className="py-3">
                  <p className="text-xs text-forest-400">
                    {sourceLabel(item.ref)}
                    {tab && <span> · {tab.domain}</span>}
                  </p>
                  {tab && <p className="mt-0.5 text-sm font-medium text-forest-50">{tab.title}</p>}
                  <p className="mt-0.5 text-sm text-forest-200">{item.why}</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
};
