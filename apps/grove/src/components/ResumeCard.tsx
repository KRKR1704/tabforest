import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { ResumeResult } from '../adapters/contexts';
import { formatDuration, formatWhen } from '../lib/contextCard';
import { ProvenancePill } from './ProvenancePill';
import { MushroomIcon } from './icons';

interface ResumeCardProps {
  resume: ResumeResult;
  /** Reopen the important tabs only, or every saved tab. */
  onRestore: (which: 'important' | 'all') => void;
  onDismiss: () => void;
  /** What the last restore did, e.g. "Reopened 4 tabs." */
  notice?: string | null;
  /** Injected in tests; the reader's clock and zone otherwise. */
  now?: Date;
  timeZone?: string;
}

const buttonClass =
  'rounded-sm border border-forest-700 px-2.5 py-1 text-xs text-forest-200 hover:border-forest-500 hover:text-forest-50';

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex gap-4">
    <dt className="w-24 shrink-0 text-xs font-medium uppercase tracking-wider text-forest-400">
      {label}
    </dt>
    <dd className="min-w-0 flex-1 text-sm text-forest-100">{children}</dd>
  </div>
);

/** Where the user left off, pinned above the grove: read it, then choose what to reopen. */
export const ResumeCard: React.FC<ResumeCardProps> = ({
  resume,
  onRestore,
  onDismiss,
  notice,
  now,
  timeZone,
}) => {
  const [readingOnly, setReadingOnly] = useState(false);
  const { card } = resume;
  const importantCount = resume.important_tabs.length;
  const totalCount = importantCount + resume.other_tabs.length;
  const offers = (option: 'important' | 'all' | 'summary') =>
    resume.restore_options.includes(option);

  return (
    <section
      aria-label="Resume"
      className="shrink-0 border-b border-forest-800 bg-forest-900 px-6 py-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-forest-400">Resume</p>
          <h2 className="mt-1 font-serif text-xl font-semibold text-forest-50">{resume.title}</h2>
          <p className="mt-1 text-xs text-forest-300">
            Last active {formatWhen(resume.last_active_at, now, timeZone)} ·{' '}
            {formatDuration(resume.active_ms)} across {resume.session_count}{' '}
            {resume.session_count === 1 ? 'session' : 'sessions'}
            {resume.totals_as_of && ` · as recorded ${formatWhen(resume.totals_as_of, now, timeZone)}`}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss resume card"
          className="rounded-sm p-1 text-forest-300 hover:bg-forest-800 hover:text-forest-50"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {card ? (
        <dl className="mt-4 max-h-56 space-y-2.5 overflow-y-auto">
          <Row label="Goal">
            <span className="mr-2">{card.goal.display_text}</span>
            <ProvenancePill provenance={card.goal.provenance} confidence={card.goal.confidence} />
          </Row>
          {card.explored_branches.length > 0 && (
            <Row label="Explored">
              {card.explored_branches.map((branch) => branch.label).join(' · ')}
            </Row>
          )}
          {card.direction && (
            <Row label="Direction">
              <span className="mr-2">{card.direction.display_text}</span>
              <ProvenancePill
                provenance={card.direction.provenance}
                confidence={card.direction.confidence}
              />
            </Row>
          )}
          {card.decisions.length > 0 && (
            <Row label="Decided">
              <ul className="space-y-1">
                {card.decisions.map((decision) => (
                  <li key={decision.id}>
                    <span className="mr-2">{decision.display_text}</span>
                    <ProvenancePill
                      provenance={decision.provenance}
                      confidence={decision.confidence}
                    />
                  </li>
                ))}
              </ul>
            </Row>
          )}
          {card.unresolved_questions.length > 0 && (
            <Row label="Unresolved">
              <ul className="space-y-1">
                {card.unresolved_questions.map((question) => (
                  <li key={question.id} className="flex items-start gap-2">
                    <MushroomIcon className="mt-0.5 h-4 w-4 shrink-0 text-amberCanopy-light" />
                    <span>{question.display_text}</span>
                  </li>
                ))}
              </ul>
            </Row>
          )}
          {card.next_action && <Row label="Next">{card.next_action.display_text}</Row>}
        </dl>
      ) : (
        <p className="mt-3 text-sm text-forest-200">
          {totalCount} saved {totalCount === 1 ? 'reference' : 'references'}, kept so the tabs could be closed.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {readingOnly ? (
          <>
            <p className="text-sm text-forest-300">Reading only. No tabs were reopened.</p>
            <button type="button" className={buttonClass} onClick={() => setReadingOnly(false)}>
              Show restore options
            </button>
          </>
        ) : (
          <>
            {offers('important') && importantCount > 0 && (
              <button type="button" className={buttonClass} onClick={() => onRestore('important')}>
                Restore {importantCount} important {importantCount === 1 ? 'tab' : 'tabs'}
              </button>
            )}
            {offers('all') && totalCount > 0 && (
              <button type="button" className={buttonClass} onClick={() => onRestore('all')}>
                Restore all {totalCount}
              </button>
            )}
            {offers('summary') && (
              <button type="button" className={buttonClass} onClick={() => setReadingOnly(true)}>
                Just read summary
              </button>
            )}
          </>
        )}
        {notice && (
          <p role="status" className="text-sm text-forest-200">
            {notice}
          </p>
        )}
      </div>
    </section>
  );
};
