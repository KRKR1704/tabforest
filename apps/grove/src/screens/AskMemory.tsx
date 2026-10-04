import React, { useEffect, useState } from 'react';
import { searchMemory, type MemoryOutcome } from '../adapters/memory';
import { ProvenancePill } from '../components/ProvenancePill';
import { FireflyIcon } from '../components/icons';
import { formatDuration } from '../lib/contextCard';
import type { MemoryMatch } from '../types';

interface AskMemoryProps {
  /** The question, as typed in the top bar or on this screen. */
  query: string;
  onAsk: (query: string) => void;
  /** Open the saved grove behind a match: resumes its context. */
  onOpenGrove: (contextId: string) => Promise<boolean>;
  /** Injected in tests; today otherwise. */
  now?: Date;
}

const buttonClass =
  'rounded-sm border border-forest-700 px-2.5 py-1 text-xs text-forest-200 hover:border-forest-500 hover:text-forest-50 disabled:opacity-50';

/** "March 12", or "March 12, 2025" when it was another year. */
export function formatDay(date: string, now: Date = new Date()): string {
  const [year, month, day] = date.split('-').map(Number);
  // Built from its parts so the day never shifts with the reader's time zone.
  const value = new Date(year, (month || 1) - 1, day || 1);
  if (Number.isNaN(value.getTime())) return date;
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    ...(year === now.getFullYear() ? {} : { year: 'numeric' }),
  }).format(value);
}

const MatchCard: React.FC<{
  match: MemoryMatch;
  onOpenGrove: (contextId: string) => Promise<boolean>;
  now?: Date;
}> = ({ match, onOpenGrove, now }) => {
  const [failed, setFailed] = useState(false);
  return (
    <li data-project-id={match.project_id} className="py-6">
      <div className="flex items-start gap-3">
        <FireflyIcon className="mt-1 h-5 w-5 shrink-0 text-firefly" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wider text-forest-400">
            Yes, you researched this before
          </p>
          <h2 className="mt-1 font-serif text-xl font-semibold text-forest-50">{match.project}</h2>
          <p className="mt-1 text-sm text-forest-200">
            {formatDay(match.date, now)} · {formatDuration(match.attention_min * 60_000)}
          </p>

          <dl className="mt-4 space-y-2.5 text-sm">
            {match.compared.length > 0 && (
              <div className="flex gap-4">
                <dt className="w-24 shrink-0 text-xs font-medium uppercase tracking-wider text-forest-400">
                  Compared
                </dt>
                <dd className="text-forest-100">{match.compared.join(' vs ')}</dd>
              </div>
            )}
            {match.conclusion && (
              <div className="flex gap-4">
                <dt className="w-24 shrink-0 text-xs font-medium uppercase tracking-wider text-forest-400">
                  Conclusion
                </dt>
                <dd className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-forest-100">
                  <span>{match.conclusion.display_text}</span>
                  <ProvenancePill
                    provenance={match.conclusion.provenance}
                    confidence={match.conclusion.confidence}
                  />
                </dd>
              </div>
            )}
          </dl>

          {match.saved_context_id && (
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                className={buttonClass}
                onClick={() =>
                  void onOpenGrove(match.saved_context_id as string).then((ok) => setFailed(!ok))
                }
              >
                Open grove
              </button>
              {failed && (
                <span role="alert" className="text-sm text-amberCanopy-light">
                  That grove could not be opened.
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
};

export const AskMemory: React.FC<AskMemoryProps> = ({ query, onAsk, onOpenGrove, now }) => {
  const [draft, setDraft] = useState(query);
  const [outcome, setOutcome] = useState<MemoryOutcome | null>(null);

  useEffect(() => setDraft(query), [query]);

  useEffect(() => {
    if (!query) {
      setOutcome(null);
      return;
    }
    let cancelled = false;
    setOutcome(null);
    void searchMemory(query).then((result) => {
      if (!cancelled) setOutcome(result);
    });
    return () => {
      cancelled = true;
    };
  }, [query]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const value = draft.trim();
    if (value) onAsk(value);
  };

  return (
    <div className="mx-auto max-w-3xl px-8 py-6">
      <form role="search" aria-label="Ask memory" onSubmit={submit} className="flex gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">What have you researched before?</span>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="e.g. session storage"
            className="w-full rounded-sm border border-forest-700 bg-forest-950 px-2 py-1.5 text-sm text-forest-50 placeholder:text-forest-500"
          />
        </label>
        <button type="submit" className={buttonClass}>
          Ask
        </button>
      </form>

      {!query && (
        <p className="mt-8 font-serif text-lg text-forest-100">
          Ask whether you have researched something before.
        </p>
      )}

      {query && !outcome && <p className="mt-8 text-sm text-forest-300">Searching your memory…</p>}

      {outcome && !outcome.ok && (
        <p role="alert" className="mt-8 text-sm text-amberCanopy-light">
          {outcome.message}
        </p>
      )}

      {outcome?.ok && !outcome.result.found && (
        <div role="status" className="mt-8">
          <p className="font-serif text-lg text-forest-100">
            {outcome.result.message ?? 'No related research found'}
          </p>
          <p className="mt-2 text-sm text-forest-400">
            Nothing in your memory is close enough to “{outcome.result.query}”.
          </p>
        </div>
      )}

      {outcome?.ok && outcome.result.found && (
        <ul className="mt-2 divide-y divide-forest-800">
          {outcome.result.matches.map((match) => (
            <MatchCard key={match.project_id} match={match} onOpenGrove={onOpenGrove} now={now} />
          ))}
        </ul>
      )}
    </div>
  );
};
