import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type {
  ClaimAction,
  ClaimPatchBody,
  EvidenceRef,
  GroveTab,
  NoteKind,
  Provenance,
  TreeData,
} from '../types';
import { hypothesisId } from '../lib/groveEdits';
import { sourceLabel } from './EvidenceDrawer';
import { ProvenancePill } from './ProvenancePill';
import { MushroomIcon } from './icons';

/** Which kind of thing on the canvas a claim's roots grow from. */
export type ClaimAnchor = 'trunk' | 'stone' | 'mushroom';

export interface ActiveClaim {
  id: string;
  anchor: ClaimAnchor;
}

interface TreeDetailDrawerProps {
  tree: TreeData;
  /** The claim whose evidence is expanded and whose roots are lit. */
  activeClaimId: string | null;
  onActivateClaim: (claim: ActiveClaim | null) => void;
  onPatchClaim: (claimId: string, body: ClaimPatchBody) => void;
  onAddNote: (kind: NoteKind, text: string) => void;
  onOpenTab: (tabRef: string) => void;
  onExcludeDomain: (domain: string) => void;
  onClose: () => void;
}

interface ClaimRowProps {
  id: string;
  anchor: ClaimAnchor;
  text: string;
  /** Raw text, offered when editing; the displayed text may carry "appears to". */
  editText: string;
  provenance: Provenance;
  confidence?: number;
  evidence: EvidenceRef[];
  quote?: string | null;
  actions: ClaimAction[];
  tabs: GroveTab[];
  icon?: React.ReactNode;
  footnote?: string | null;
  active: boolean;
  onActivate: (claim: ActiveClaim | null) => void;
  onPatch: (claimId: string, body: ClaimPatchBody) => void;
}

const ACTION_LABELS: Record<ClaimAction, string> = {
  confirm: 'Confirm',
  edit: 'Edit',
  dismiss: 'Dismiss',
  resolve: 'Mark resolved',
};

const actionClass =
  'rounded-sm border border-forest-700 px-2 py-0.5 text-xs text-forest-200 hover:border-forest-500 hover:text-forest-50';
const inputClass =
  'w-full rounded-sm border border-forest-700 bg-forest-950 px-2 py-1.5 text-sm text-forest-50 placeholder:text-forest-500';

const ClaimRow: React.FC<ClaimRowProps> = ({
  id,
  anchor,
  text,
  editText,
  provenance,
  confidence,
  evidence,
  quote,
  actions,
  tabs,
  icon,
  footnote,
  active,
  onActivate,
  onPatch,
}) => {
  const [mode, setMode] = useState<'view' | 'edit' | 'resolve'>('view');
  const [draft, setDraft] = useState('');

  const begin = (action: ClaimAction) => {
    if (action === 'edit') {
      setDraft(editText);
      setMode('edit');
    } else if (action === 'resolve') {
      setDraft('');
      setMode('resolve');
    } else {
      onPatch(id, { action });
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const value = draft.trim();
    if (!value) return;
    onPatch(id, mode === 'edit' ? { action: 'edit', text: value } : { action: 'resolve', answer: value });
    setMode('view');
  };

  return (
    <li data-claim-id={id} className="py-3">
      <div className="flex items-start gap-2">
        {icon}
        <p className="min-w-0 flex-1 text-sm text-forest-50">{text}</p>
      </div>
      {footnote && <p className="mt-1 text-sm text-forest-200">{footnote}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <ProvenancePill
          provenance={provenance}
          confidence={confidence}
          onClick={() => onActivate(active ? null : { id, anchor })}
        />
        {mode === 'view' &&
          actions.map((action) => (
            <button key={action} type="button" className={actionClass} onClick={() => begin(action)}>
              {ACTION_LABELS[action]}
            </button>
          ))}
      </div>

      {mode !== 'view' && (
        <form onSubmit={submit} className="mt-2 space-y-2">
          <label className="block">
            <span className="sr-only">{mode === 'edit' ? 'Edit claim' : 'Answer'}</span>
            <input
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={mode === 'edit' ? 'Say it in your own words' : 'What did you find out?'}
              className={inputClass}
            />
          </label>
          <div className="flex gap-2">
            <button type="submit" className={actionClass}>
              {mode === 'edit' ? 'Save' : 'Resolve'}
            </button>
            <button type="button" className={actionClass} onClick={() => setMode('view')}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {active && (
        <div className="mt-3 border-l border-forest-700 pl-3">
          {quote && (
            <blockquote className="mb-2 font-serif text-sm italic text-forest-100">{quote}</blockquote>
          )}
          {evidence.length === 0 ? (
            <p className="text-xs text-forest-300">No evidence is recorded for this claim.</p>
          ) : (
            <ul aria-label="Evidence" className="space-y-2">
              {evidence.map((item, index) => {
                const tab = tabs.find((t) => t.tab_ref === item.ref);
                return (
                  <li key={`${item.ref}-${index}`} className="text-xs">
                    <span className="text-forest-400">
                      {sourceLabel(item)}
                      {tab && <span> · {tab.title}</span>}
                    </span>
                    <span className="block text-forest-200">{item.why}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </li>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="border-b border-forest-800 px-5 py-4">
    <h3 className="text-xs font-medium uppercase tracking-wider text-forest-400">{title}</h3>
    {children}
  </section>
);

/** What can be done to a claim depends on how sure it already is. */
function actionsFor(provenance: Provenance, extra: ClaimAction[]): ClaimAction[] {
  const confirm: ClaimAction[] =
    provenance === 'inferred' || provenance === 'hypothesis' ? ['confirm'] : [];
  return [...confirm, ...extra];
}

export const TreeDetailDrawer: React.FC<TreeDetailDrawerProps> = ({
  tree,
  activeClaimId,
  onActivateClaim,
  onPatchClaim,
  onAddNote,
  onOpenTab,
  onExcludeDomain,
  onClose,
}) => {
  const [noteKind, setNoteKind] = useState<NoteKind>('decision');
  const [noteText, setNoteText] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // A claim picked on the canvas is brought into view here.
  useEffect(() => {
    if (!activeClaimId) return;
    const row = Array.from(bodyRef.current?.querySelectorAll('[data-claim-id]') ?? []).find(
      (node) => node.getAttribute('data-claim-id') === activeClaimId
    );
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [activeClaimId, tree.cluster_ref]);

  const row = (props: Omit<ClaimRowProps, 'tabs' | 'active' | 'onActivate' | 'onPatch'>) => (
    <ClaimRow
      key={props.id}
      {...props}
      tabs={tree.tabs}
      active={activeClaimId === props.id}
      onActivate={onActivateClaim}
      onPatch={onPatchClaim}
    />
  );

  const submitNote = (event: React.FormEvent) => {
    event.preventDefault();
    const text = noteText.trim();
    if (!text) return;
    onAddNote(noteKind, text);
    setNoteText('');
  };

  const important = new Set(tree.important_tab_refs);
  const sources = [...tree.tabs].sort(
    (a, b) =>
      Number(important.has(b.tab_ref)) - Number(important.has(a.tab_ref)) ||
      b.dwell_minutes - a.dwell_minutes
  );

  const dormant = tree.status === 'dormant';
  const meta = [
    `${Math.round(tree.attention_minutes)} min`,
    `${tree.tabs.length} ${tree.tabs.length === 1 ? 'tab' : 'tabs'}`,
    ...(dormant
      ? [tree.days_since_active !== undefined ? `dormant ${tree.days_since_active} days` : 'dormant']
      : []),
  ].join(' · ');

  return (
    <aside
      aria-label="Tree detail"
      className="flex w-96 shrink-0 flex-col border-l border-forest-800 bg-forest-900"
    >
      <header className="flex items-start justify-between gap-4 border-b border-forest-800 px-5 py-4">
        <div className="min-w-0">
          <h2 className="font-serif text-xl font-semibold leading-snug text-forest-50">
            {tree.project.name}
          </h2>
          <p className="mt-1 text-xs text-forest-400">{meta}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close tree detail"
          className="rounded-sm p-1 text-forest-300 hover:bg-forest-800 hover:text-forest-50"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      <div ref={bodyRef} className="flex-1 overflow-y-auto">
        <Section title="Goal">
          <ul>
            {row({
              // Without a server id the goal can be read but not changed.
              id: tree.goal.id ?? `${tree.cluster_ref}:goal`,
              anchor: 'trunk',
              text: tree.goal.display_text ?? tree.goal.text,
              editText: tree.goal.text,
              provenance: tree.goal.provenance,
              confidence: tree.goal.confidence,
              evidence: tree.goal.evidence,
              actions: tree.goal.id ? actionsFor(tree.goal.provenance, ['edit']) : [],
            })}
          </ul>
        </Section>

        {tree.current_direction.text && (
          <Section title="Direction">
            <ul>
              {row({
                id: tree.current_direction.id ?? `${tree.cluster_ref}:direction`,
                anchor: 'trunk',
                text: tree.current_direction.display_text ?? tree.current_direction.text,
                editText: tree.current_direction.text,
                provenance: tree.current_direction.provenance,
                confidence: tree.current_direction.confidence,
                evidence: tree.current_direction.evidence,
                actions: tree.current_direction.id
                  ? actionsFor(tree.current_direction.provenance, ['edit'])
                  : [],
              })}
            </ul>
          </Section>
        )}

        <Section title="Decisions">
          {tree.decisions.length === 0 ? (
            <p className="mt-2 text-sm text-forest-300">No decisions yet.</p>
          ) : (
            <ul className="divide-y divide-forest-800">
              {tree.decisions.map((decision) =>
                row({
                  id: decision.id,
                  anchor: 'stone',
                  text: decision.display_text ?? decision.text,
                  editText: decision.text,
                  provenance: decision.provenance,
                  confidence: decision.confidence,
                  evidence: decision.evidence,
                  quote: decision.quote,
                  actions: actionsFor(decision.provenance, ['edit', 'dismiss']),
                })
              )}
            </ul>
          )}
        </Section>

        <Section title="Open questions">
          {tree.unresolved_questions.length === 0 ? (
            <p className="mt-2 text-sm text-forest-300">Nothing left open.</p>
          ) : (
            <ul className="divide-y divide-forest-800">
              {tree.unresolved_questions.map((question) => {
                const resolved = question.status === 'resolved';
                return row({
                  id: question.id,
                  anchor: 'mushroom',
                  text: question.display_text ?? question.question,
                  editText: question.question,
                  provenance: question.provenance ?? 'inferred',
                  confidence: question.confidence,
                  evidence: question.evidence,
                  actions: resolved ? [] : ['resolve', 'edit', 'dismiss'],
                  footnote: resolved ? `Resolved: ${question.answer ?? 'no answer recorded'}` : null,
                  icon: resolved ? undefined : (
                    <MushroomIcon className="mt-0.5 h-4 w-4 shrink-0 text-amberCanopy-light" />
                  ),
                });
              })}
            </ul>
          )}
        </Section>

        <Section title="Next actions">
          {tree.next_actions.length === 0 ? (
            <p className="mt-2 text-sm text-forest-300">No next action suggested.</p>
          ) : (
            <ul className="divide-y divide-forest-800">
              {tree.next_actions.map((action) =>
                row({
                  id: action.id,
                  anchor: 'trunk',
                  text: action.display_text ?? action.action,
                  editText: action.action,
                  provenance: action.provenance ?? 'inferred',
                  confidence: action.confidence,
                  evidence: action.evidence ?? [],
                  footnote: action.reason ?? null,
                  actions: ['edit', 'dismiss'],
                })
              )}
            </ul>
          )}
        </Section>

        {tree.hypotheses.length > 0 && (
          <Section title="In the fog">
            <ul className="divide-y divide-forest-800">
              {tree.hypotheses.map((hypothesis, index) =>
                row({
                  id: hypothesisId(tree, hypothesis, index),
                  anchor: 'trunk',
                  text: hypothesis.display_text ?? `Maybe: ${hypothesis.text}`,
                  editText: hypothesis.text,
                  provenance: 'hypothesis',
                  confidence: hypothesis.confidence,
                  evidence: hypothesis.evidence,
                  actions: ['confirm', 'dismiss'],
                })
              )}
            </ul>
          </Section>
        )}

        <Section title="Add a note">
          <form onSubmit={submitNote} className="mt-2 space-y-2">
            <div className="flex gap-4 text-sm text-forest-200">
              {(['decision', 'note'] as const).map((kind) => (
                <label key={kind} className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="note-kind"
                    checked={noteKind === kind}
                    onChange={() => setNoteKind(kind)}
                    className="accent-forest-400"
                  />
                  {kind === 'decision' ? 'A decision' : 'A note'}
                </label>
              ))}
            </div>
            <label className="block">
              <span className="sr-only">Note text</span>
              <textarea
                value={noteText}
                onChange={(event) => setNoteText(event.target.value)}
                rows={2}
                placeholder="What you decided, in your own words"
                className={inputClass}
              />
            </label>
            <button type="submit" className={actionClass}>
              Add note
            </button>
          </form>
        </Section>

        <Section title={`Sources · ${sources.length}`}>
          <ul className="divide-y divide-forest-800">
            {sources.map((tab) => (
              <li key={tab.tab_ref} className="py-2.5">
                <button
                  type="button"
                  onClick={() => onOpenTab(tab.tab_ref)}
                  title="Open this tab"
                  className="text-left text-sm text-forest-50 hover:underline"
                >
                  {tab.title}
                </button>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-forest-400">
                  <span>
                    {tab.domain}
                    {tab.dwell_minutes > 0 && ` · ${tab.dwell_minutes} min`}
                    {important.has(tab.tab_ref) && ' · important'}
                    {tab.fallen && ' · stale'}
                  </span>
                  {tab.domain && (
                    <button
                      type="button"
                      className={actionClass}
                      onClick={() => onExcludeDomain(tab.domain)}
                      aria-label={`Exclude ${tab.domain}`}
                    >
                      Exclude domain
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </aside>
  );
};
