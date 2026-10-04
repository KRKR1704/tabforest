import React, { useEffect, useMemo, useState } from 'react';
import { sendBridgeMessage } from '../adapters/bridge';
import { saveContext } from '../adapters/contexts';
import { getPruneSuggestions } from '../adapters/memory';
import {
  KIND_LABELS,
  branchesToPrune,
  markClosed,
  placeTabs,
  referenceSets,
  tabsToClose,
} from '../lib/prune';
import { useGroveStore } from '../store/useGroveStore';
import type {
  CloseTabsPayload,
  GetUrlsData,
  GetUrlsPayload,
  GroveResponse,
  PruneActionId,
  PruneSuggestionsResponse,
  SnapshotPayload,
} from '../types';

interface PruneDialogProps {
  grove: GroveResponse;
  /** Closed without closing any tab. */
  onClose: () => void;
  /** An action finished; the message says what happened. */
  onDone: (message: string) => void;
}

const buttonClass =
  'rounded-sm border border-forest-700 px-2.5 py-1 text-xs text-forest-200 hover:border-forest-500 hover:text-forest-50 disabled:opacity-50';
const dangerClass =
  'rounded-sm border border-amberCanopy-dark px-2.5 py-1 text-xs text-amberCanopy-light hover:border-amberCanopy hover:text-forest-50 disabled:opacity-50';

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: PruneSuggestionsResponse };

/**
 * Pruning suggestions. TabForest only suggests: no tab is closed until the
 * user clicks an action here (SPEC §3.5).
 */
export const PruneDialog: React.FC<PruneDialogProps> = ({ grove, onClose, onDone }) => {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBranches, setConfirmBranches] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const places = useMemo(() => placeTabs(grove), [grove]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Suggestions are for the tabs open right now, as the extension sees them.
      const snapshot = await sendBridgeMessage<void, SnapshotPayload>('GET_SNAPSHOT');
      const refs = snapshot.ok && snapshot.data ? snapshot.data.open_tabs.map((tab) => tab.tab_ref) : [];
      const outcome = await getPruneSuggestions(refs);
      if (cancelled) return;
      if (!outcome.ok) {
        setState({ status: 'error', message: outcome.message });
        return;
      }
      setState({ status: 'ready', data: outcome.result });
      setSelected(
        new Set(outcome.result.suggestions.filter((s) => s.default_selected).map((s) => s.id))
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const suggestions = state.status === 'ready' ? state.data.suggestions : [];
  const closing = tabsToClose(suggestions, selected);
  const cuts = branchesToPrune(grove, suggestions, selected);
  const cutCount = new Set(cuts.flatMap((cut) => cut.tabRefs)).size;

  const closeTabs = async (refs: string[]): Promise<boolean> => {
    if (refs.length === 0) return true;
    const reply = await sendBridgeMessage<CloseTabsPayload, null>('CLOSE_TABS', { tab_refs: refs });
    if (!reply.ok) return false;
    const current = useGroveStore.getState().grove;
    if (current) useGroveStore.getState().setGrove(markClosed(current, refs));
    return true;
  };

  const run = async (work: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    const message = await work();
    setBusy(false);
    if (message) onDone(message);
  };

  const closeSelected = () =>
    run(async () => {
      if (!(await closeTabs(closing))) {
        setError('The extension could not close the tabs. Nothing was closed.');
        return null;
      }
      return `Closed ${plural(closing.length, 'tab')}.`;
    });

  const saveAsReferences = () =>
    run(async () => {
      const reply = await sendBridgeMessage<GetUrlsPayload, GetUrlsData>('GET_URLS', {
        tab_refs: closing,
      });
      const urls = reply.ok && reply.data?.urls ? reply.data.urls : {};
      const { sets, unsaved } = referenceSets(grove, suggestions, selected, urls);
      try {
        // Save first; a tab is closed only once it is safely kept as a reference.
        for (const set of sets) {
          await saveContext(set.tree.cluster_ref, {
            kind: 'references',
            title: `${set.tree.project.name}: references`,
            card: null,
            tabs: set.tabs,
          });
        }
      } catch (err) {
        console.warn('[Prune] saving references failed:', err);
        setError('Could not save the references. Nothing was closed.');
        return null;
      }
      const saved = sets.flatMap((set) => set.tabs.map((tab) => tab.tab_ref));
      if (!(await closeTabs(saved))) {
        setError('The references were saved, but the extension could not close the tabs.');
        return null;
      }
      const left =
        unsaved.length > 0
          ? ` ${plural(unsaved.length, 'tab')} with no goal ${unsaved.length === 1 ? 'was' : 'were'} left open.`
          : '';
      return `Saved ${plural(saved.length, 'tab')} as references and closed ${saved.length === 1 ? 'it' : 'them'}.${left}`;
    });

  const pruneBranches = () =>
    run(async () => {
      const refs = [...new Set(cuts.flatMap((cut) => cut.tabRefs))];
      if (!(await closeTabs(refs))) {
        setError('The extension could not close the tabs. Nothing was closed.');
        return null;
      }
      const branches = cuts.length === 1 ? '1 branch' : `${cuts.length} branches`;
      return `Pruned ${branches}: closed ${plural(refs.length, 'tab')}.`;
    });

  const handlers: Record<PruneActionId, () => void> = {
    keep_all: onClose,
    close_selected: () => void closeSelected(),
    save_as_references: () => void saveAsReferences(),
    prune_branch: () => setConfirmBranches(true),
  };

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-forest-950/80 px-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="prune-title"
        className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-md border border-forest-700 bg-forest-900"
      >
        <header className="border-b border-forest-800 px-6 py-4">
          <h2 id="prune-title" className="font-serif text-xl font-semibold text-forest-50">
            Tabs you could prune
          </h2>
          {state.status === 'ready' && (
            <p className="mt-1 text-xs text-forest-300">{state.data.note}</p>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6">
          {state.status === 'loading' && (
            <p className="py-6 text-sm text-forest-300">Looking for tabs you no longer need…</p>
          )}
          {state.status === 'error' && (
            <p role="alert" className="py-6 text-sm text-amberCanopy-light">
              {state.message}
            </p>
          )}
          {state.status === 'ready' && suggestions.length === 0 && (
            <p className="py-6 text-sm text-forest-300">Nothing to prune. Every tab is pulling its weight.</p>
          )}
          {state.status === 'ready' && suggestions.length > 0 && (
            <ul className="divide-y divide-forest-800">
              {suggestions.map((suggestion) => (
                <li key={suggestion.id} data-suggestion-id={suggestion.id} className="py-4">
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selected.has(suggestion.id)}
                      onChange={() => toggle(suggestion.id)}
                      className="mt-1 accent-forest-400"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-forest-50">
                        {KIND_LABELS[suggestion.kind] ?? suggestion.kind}
                      </span>
                      <span className="block text-sm text-forest-200">{suggestion.reason}</span>
                    </span>
                  </label>
                  <ul className="ml-7 mt-2 space-y-1">
                    {suggestion.tab_refs.map((ref) => {
                      const place = places.get(ref);
                      const kept = ref === suggestion.keep_ref;
                      return (
                        <li key={ref} className="text-sm text-forest-100">
                          {place?.tab.title ?? 'A tab that is no longer in the grove'}
                          {place?.tab.domain && <span className="text-forest-400"> · {place.tab.domain}</span>}
                          {kept && <span className="text-forest-300"> · kept</span>}
                        </li>
                      );
                    })}
                    {suggestion.keep_ref && !suggestion.tab_refs.includes(suggestion.keep_ref) && (
                      <li className="text-sm text-forest-300">
                        Keeping: {places.get(suggestion.keep_ref)?.tab.title ?? 'the stronger source'}
                      </li>
                    )}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="border-t border-forest-800 px-6 py-4">
          {error && (
            <p role="alert" className="mb-3 text-sm text-amberCanopy-light">
              {error}
            </p>
          )}
          {confirmBranches ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-forest-50">
                Close all {plural(cutCount, 'tab')} on{' '}
                {cuts.map((cut) => `${cut.branchLabel} (${cut.tree.project.name})`).join(', ')}?
              </p>
              <span className="flex gap-2">
                <button type="button" className={dangerClass} disabled={busy} onClick={() => void pruneBranches()}>
                  Prune
                </button>
                <button type="button" className={buttonClass} onClick={() => setConfirmBranches(false)}>
                  Cancel
                </button>
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-forest-300">
                {state.status === 'ready' ? `${plural(closing.length, 'tab')} selected` : ''}
              </p>
              <span className="flex flex-wrap gap-2">
                {(state.status === 'ready'
                  ? state.data.actions
                  : [{ id: 'keep_all' as const, label: 'Keep all' }]
                ).map((action) => {
                  const needsSelection = action.id !== 'keep_all';
                  const disabled =
                    busy ||
                    (needsSelection && closing.length === 0) ||
                    (action.id === 'prune_branch' && cuts.length === 0);
                  return (
                    <button
                      key={action.id}
                      type="button"
                      className={buttonClass}
                      disabled={disabled}
                      onClick={handlers[action.id]}
                    >
                      {action.label}
                    </button>
                  );
                })}
              </span>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
};
