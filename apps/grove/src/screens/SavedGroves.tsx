import React, { useEffect, useState } from 'react';
import { listContexts, type ContextList, type SavedContextRow } from '../adapters/contexts';
import { MushroomIcon } from '../components/icons';
import { formatDuration, formatWhen } from '../lib/contextCard';

interface SavedGrovesProps {
  /** Resume a context: fetch its card and pin it at the top of the grove. */
  onResume: (contextId: string) => Promise<boolean>;
  /** Injected in tests; the reader's clock and zone otherwise. */
  now?: Date;
  timeZone?: string;
}

type ListState = { status: 'loading' } | ({ status: 'ready' } & ContextList);

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

const ContextCard: React.FC<{
  context: SavedContextRow;
  busy: boolean;
  onResume: () => void;
  now?: Date;
  timeZone?: string;
}> = ({ context, busy, onResume, now, timeZone }) => {
  const isReferences = context.kind === 'references';
  return (
    <li data-context-id={context.id} className="py-6">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="text-xs text-forest-400">
            {isReferences ? 'References' : 'Resume point'} · saved{' '}
            {formatWhen(context.saved_at, now, timeZone)}
          </p>
          <h2 className="mt-1 font-serif text-xl font-semibold text-forest-50">{context.title}</h2>
          {context.goal_summary && (
            <p className="mt-1 text-sm text-forest-100">{context.goal_summary}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onResume}
          disabled={busy}
          className="shrink-0 rounded-md bg-forest-600 px-4 py-1.5 text-sm font-medium text-forest-50 hover:bg-forest-500 disabled:opacity-60"
        >
          {busy ? 'Opening…' : isReferences ? 'Open' : 'Resume'}
        </button>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs uppercase tracking-wider text-forest-400">Last active</dt>
          <dd className="mt-0.5 text-forest-100">{formatWhen(context.last_active_at, now, timeZone)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-forest-400">Time invested</dt>
          <dd className="mt-0.5 text-forest-100">
            {formatDuration(context.active_ms)} · {plural(context.session_count, 'session')}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-forest-400">Open questions</dt>
          <dd className="mt-0.5 flex items-center gap-1.5 text-forest-100">
            {context.open_question_count > 0 && (
              <MushroomIcon className="h-4 w-4 text-amberCanopy-light" />
            )}
            {context.open_question_count === 0 ? 'None' : context.open_question_count}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-forest-400">Tabs</dt>
          <dd className="mt-0.5 text-forest-100">
            {isReferences
              ? plural(context.total_tab_count, 'tab')
              : `${context.important_tab_count} important of ${context.total_tab_count}`}
          </dd>
        </div>
      </dl>

      {context.next_action && (
        <p className="mt-3 text-sm text-forest-200">
          <span className="text-forest-400">Next: </span>
          {context.next_action}
        </p>
      )}
      {context.totals_as_of && (
        <p className="mt-2 text-xs text-forest-400">
          Time as recorded {formatWhen(context.totals_as_of, now, timeZone)}.
        </p>
      )}
    </li>
  );
};

export const SavedGroves: React.FC<SavedGrovesProps> = ({ onResume, now, timeZone }) => {
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listContexts().then((list) => {
      if (!cancelled) setState({ status: 'ready', ...list });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === 'loading') {
    return (
      <div className="mx-auto max-w-4xl px-8 py-10">
        <p className="font-serif text-lg text-forest-100">Reading your saved groves…</p>
      </div>
    );
  }

  const resume = async (id: string) => {
    setBusyId(id);
    setFailedId(null);
    try {
      if (!(await onResume(id))) setFailedId(id);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-8">
      {state.sample && (
        <p role="alert" className="border-b border-forest-800 py-3 text-sm text-amberCanopy-light">
          Your saved groves could not be loaded. Showing sample data, not your own.
        </p>
      )}
      {failedId && (
        <p role="alert" className="border-b border-forest-800 py-3 text-sm text-amberCanopy-light">
          That context could not be opened.
        </p>
      )}
      {state.contexts.length === 0 ? (
        <div className="py-10">
          <p className="font-serif text-lg text-forest-100">Nothing saved yet.</p>
          <p className="mt-2 text-sm text-forest-400">
            Open a tree and choose Save context to keep where you left off.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-forest-800">
          {state.contexts.map((context) => (
            <ContextCard
              key={context.id}
              context={context}
              busy={busyId === context.id}
              onResume={() => void resume(context.id)}
              now={now}
              timeZone={timeZone}
            />
          ))}
        </ul>
      )}
    </div>
  );
};
