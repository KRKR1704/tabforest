import React from 'react';
import type { GroveResponse, GroveTab } from '../types';
import type { EvidenceClaim } from '../components/EvidenceDrawer';
import { ProvenancePill } from '../components/ProvenancePill';
import { MushroomIcon } from '../components/icons';

interface CurrentGroveProps {
  grove: GroveResponse | null;
  onShowEvidence: (claim: EvidenceClaim, tabs: GroveTab[]) => void;
}

// A plain reading of the grove's claims. The D3 canvas (S-3) takes over this screen.
export const CurrentGrove: React.FC<CurrentGroveProps> = ({ grove, onShowEvidence }) => {
  if (!grove || grove.trees.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-8 py-12">
        <p className="font-serif text-lg text-forest-100">No grove yet.</p>
        <p className="mt-2 text-sm text-forest-400">Grow one from the tabs you have open.</p>
      </div>
    );
  }

  return (
    <ul className="mx-auto max-w-3xl divide-y divide-forest-800 px-8">
      {grove.trees.map((tree) => (
        <li key={tree.cluster_ref} className="py-8">
          <p className="text-xs text-forest-400">
            {tree.status === 'dormant' ? 'Dormant' : tree.status === 'done' ? 'Done' : 'Active'} ·{' '}
            {tree.branches.length} {tree.branches.length === 1 ? 'path' : 'paths'} ·{' '}
            {tree.tabs.length} {tree.tabs.length === 1 ? 'tab' : 'tabs'} ·{' '}
            {Math.round(tree.attention_minutes)} min
          </p>
          <h2 className="mt-1 font-serif text-2xl font-semibold text-forest-50">
            {tree.project.name}
          </h2>

          <dl className="mt-4 space-y-4">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-forest-400">Goal</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="text-forest-100">{tree.goal.text}</span>
                <ProvenancePill
                  provenance={tree.goal.provenance}
                  confidence={tree.goal.confidence}
                  onClick={() => onShowEvidence({ kind: 'Goal', ...tree.goal }, tree.tabs)}
                />
              </dd>
            </div>

            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-forest-400">
                Direction
              </dt>
              <dd className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="text-forest-100">{tree.current_direction.text}</span>
                <ProvenancePill
                  provenance={tree.current_direction.provenance}
                  confidence={tree.current_direction.confidence}
                  onClick={() =>
                    onShowEvidence({ kind: 'Direction', ...tree.current_direction }, tree.tabs)
                  }
                />
              </dd>
            </div>

            {tree.decisions.length > 0 && (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-forest-400">
                  Decisions
                </dt>
                {tree.decisions.map((decision) => (
                  <dd
                    key={decision.id}
                    className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5"
                  >
                    <span className="text-forest-100">{decision.text}</span>
                    <ProvenancePill
                      provenance={decision.provenance}
                      confidence={decision.confidence}
                      onClick={() => onShowEvidence({ kind: 'Decision', ...decision }, tree.tabs)}
                    />
                  </dd>
                ))}
              </div>
            )}

            {tree.unresolved_questions.some((q) => q.status === 'open') && (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-forest-400">
                  Open questions
                </dt>
                {tree.unresolved_questions
                  .filter((q) => q.status === 'open')
                  .map((question) => (
                    <dd key={question.id} className="mt-1 flex items-start gap-2 text-forest-100">
                      <MushroomIcon className="mt-1 h-4 w-4 shrink-0 text-amberCanopy-light" />
                      <span>{question.question}</span>
                    </dd>
                  ))}
              </div>
            )}
          </dl>
        </li>
      ))}
    </ul>
  );
};
