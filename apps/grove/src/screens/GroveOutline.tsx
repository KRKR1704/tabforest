import React from 'react';
import type { GroveResponse, GroveTab } from '../types';
import type { EvidenceClaim } from '../components/EvidenceDrawer';
import { ProvenancePill } from '../components/ProvenancePill';
import { MushroomIcon } from '../components/icons';

interface GroveOutlineProps {
  grove: GroveResponse;
  onShowEvidence: (claim: EvidenceClaim, tabs: GroveTab[]) => void;
  /** Opens a tab, so every leaf can be reached without the canvas. */
  onOpenTab?: (tabRef: string) => void;
}

type OutlineTab = Pick<GroveTab, 'tab_ref' | 'title' | 'domain' | 'is_open'> & {
  dwell_minutes?: number;
};

const sectionLabel = 'text-xs font-medium uppercase tracking-wider text-forest-400';

const TabList: React.FC<{
  tabs: Array<{ tab: OutlineTab; note?: string }>;
  onOpenTab?: (tabRef: string) => void;
}> = ({ tabs, onOpenTab }) => (
  <ul className="mt-1 space-y-1 border-l border-forest-800 pl-4">
    {tabs.map(({ tab, note }) => (
      <li key={tab.tab_ref} className="text-sm text-forest-100">
        {onOpenTab ? (
          <button
            type="button"
            className="text-left underline-offset-4 hover:underline"
            onClick={() => onOpenTab(tab.tab_ref)}
          >
            {tab.title}
          </button>
        ) : (
          tab.title
        )}
        <span className="text-forest-400">
          {tab.domain && ` · ${tab.domain}`}
          {tab.dwell_minutes ? ` · ${tab.dwell_minutes} min` : ''}
          {tab.is_open ? ' · open' : ' · closed'}
          {note && ` · ${note}`}
        </span>
      </li>
    ))}
  </ul>
);

// A plain text reading of the grove's claims, alongside the D3 canvas.
export const GroveOutline: React.FC<GroveOutlineProps> = ({ grove, onShowEvidence, onOpenTab }) => {
  return (
    <div className="mx-auto max-w-3xl px-8">
    <ul className="divide-y divide-forest-800">
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

          {tree.pending && (
            <p className="mt-3 text-sm text-forest-300">Listening… no result for this goal yet.</p>
          )}
          <dl className="mt-4 space-y-4" hidden={tree.pending}>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-forest-400">Goal</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="text-forest-100">{tree.goal.display_text ?? tree.goal.text}</span>
                <ProvenancePill
                  provenance={tree.goal.provenance}
                  confidence={tree.goal.confidence}
                  onClick={() => onShowEvidence({ kind: 'Goal', ...tree.goal }, tree.tabs)}
                />
              </dd>
            </div>

            {tree.current_direction.text && (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-forest-400">
                Direction
              </dt>
              <dd className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="text-forest-100">
                  {tree.current_direction.display_text ?? tree.current_direction.text}
                </span>
                <ProvenancePill
                  provenance={tree.current_direction.provenance}
                  confidence={tree.current_direction.confidence}
                  onClick={() =>
                    onShowEvidence({ kind: 'Direction', ...tree.current_direction }, tree.tabs)
                  }
                />
              </dd>
            </div>
            )}

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
                    <span className="text-forest-100">{decision.display_text ?? decision.text}</span>
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
                      <span>{question.display_text ?? question.question}</span>
                    </dd>
                  ))}
              </div>
            )}
          </dl>

          <h3 className={`mt-5 ${sectionLabel}`}>Paths</h3>
          <ul className="mt-1 space-y-3">
            {tree.branches.map((branch) => {
              const tabs = branch.tab_refs
                .map((ref) => tree.tabs.find((tab) => tab.tab_ref === ref))
                .filter((tab): tab is GroveTab => tab !== undefined);
              return (
                <li key={branch.branch_ref}>
                  <p className="text-sm font-medium text-forest-100">
                    {branch.label || 'Tabs'}
                    <span className="font-normal text-forest-400">
                      {' '}
                      · {tabs.length} {tabs.length === 1 ? 'tab' : 'tabs'}
                    </span>
                  </p>
                  <TabList tabs={tabs.map((tab) => ({ tab }))} onOpenTab={onOpenTab} />
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>

    {grove.sprouts.map((sprout) => (
      <section key={sprout.sprout_ref} className="border-t border-forest-800 py-6">
        <p className="text-xs text-forest-400">Sprout · not yet a goal</p>
        <h2 className="mt-1 font-serif text-xl font-semibold text-forest-50">{sprout.label}</h2>
        <TabList tabs={sprout.tabs.map((tab) => ({ tab }))} onOpenTab={onOpenTab} />
      </section>
    ))}

    {grove.meadow.tabs.length > 0 && (
      <section className="border-t border-forest-800 py-6">
        <p className="text-xs text-forest-400">Tabs that belong to no goal</p>
        <h2 className="mt-1 font-serif text-xl font-semibold text-forest-50">{grove.meadow.label}</h2>
        <TabList tabs={grove.meadow.tabs.map((tab) => ({ tab }))} onOpenTab={onOpenTab} />
      </section>
    )}

    {grove.fog && grove.fog.length > 0 && (
      <section className="border-t border-forest-800 py-6">
        <p className="text-xs text-forest-400">Tabs the grove could not place</p>
        <h2 className="mt-1 font-serif text-xl font-semibold text-forest-50">Unclear</h2>
        <TabList
          tabs={grove.fog.map((item) => ({ tab: item.tab, note: item.reason }))}
          onOpenTab={onOpenTab}
        />
      </section>
    )}
    </div>
  );
};
