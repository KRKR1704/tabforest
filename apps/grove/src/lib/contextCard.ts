// Builds what is saved with a context, and what is sent to reopen its tabs.
import type {
  ContextCard,
  ContextTab,
  ExcludedReason,
  ResumeResult,
  ResumeTab,
} from '../adapters/contexts';
import type { WireClaim, WireEvidence } from '../adapters/groveContract';
import type { EvidenceRef, RestorePayload, TreeData } from '../types';

function evidence(items: EvidenceRef[] | undefined): WireEvidence[] {
  return (items ?? []).map((item) => ({
    ref_kind: item.ref_kind ?? 'tab',
    ref: item.ref,
    why: item.why,
  }));
}

function claim(source: {
  id?: string;
  text: string;
  display_text?: string;
  provenance: WireClaim['provenance'];
  confidence: number;
  evidence: EvidenceRef[];
}): WireClaim {
  return {
    id: source.id ?? '',
    text: source.text,
    provenance: source.provenance,
    confidence: source.confidence,
    display_text: source.display_text ?? source.text,
    evidence: evidence(source.evidence),
  };
}

/**
 * The resume card of a tree, in the grove's own claim shapes (the contract
 * asks for them unchanged): goal, direction, decisions, the branches already
 * explored, the questions still open, and the first next action.
 */
export function buildContextCard(tree: TreeData): ContextCard {
  const next = tree.next_actions[0];
  return {
    goal: claim(tree.goal),
    direction: tree.current_direction.text ? claim(tree.current_direction) : null,
    decisions: tree.decisions.map((decision) => ({
      ...claim(decision),
      kind:
        decision.stone_kind ??
        (decision.provenance === 'stated' || decision.provenance === 'sourced' ? 'carved' : 'mossy'),
      user_note_id: decision.user_note_id ?? null,
      quote: decision.quote ?? null,
    })),
    explored_branches: tree.branches
      .filter((branch) => branch.status === 'explored')
      .map((branch) => ({ label: branch.label, status: 'explored' as const })),
    unresolved_questions: tree.unresolved_questions
      .filter((question) => question.status === 'open')
      .map((question) => {
        const base = claim({
          id: question.id,
          text: question.question,
          display_text: question.display_text,
          provenance: question.provenance ?? 'inferred',
          confidence: question.confidence,
          evidence: question.evidence,
        });
        // Key order follows the contract so a saved card reads like the grove's own.
        return {
          id: base.id,
          text: base.text,
          provenance: base.provenance,
          confidence: base.confidence,
          display_text: base.display_text,
          kind: question.kind,
          status: question.status,
          answer: question.answer ?? null,
          resolved_at: question.resolved_at ?? null,
          recurrence: question.recurrence_count ?? 1,
          evidence: base.evidence,
        };
      }),
    next_action: next
      ? {
          id: next.id,
          text: next.action,
          provenance: next.provenance ?? 'inferred',
          confidence: next.confidence ?? 0,
          display_text: next.display_text ?? next.action,
          unblocks: next.unblocks ?? null,
          reason: next.reason ?? null,
          evidence: evidence(next.evidence),
        }
      : null,
  };
}

/** Why a tab is left out of the default restore: a duplicate, a near-duplicate, or stale. */
export function excludedReason(tree: TreeData, tabRef: string): ExcludedReason | null {
  let reason: ExcludedReason | null = null;
  for (const group of tree.redundant_groups) {
    if (!group.tab_refs.includes(tabRef) || group.keep_ref === tabRef) continue;
    if (group.is_exact_dup) return 'exact_duplicate';
    reason = 'semantic_redundant';
  }
  if (reason) return reason;
  return tree.tabs.find((tab) => tab.tab_ref === tabRef)?.fallen ? 'stale' : null;
}

/** The tree's tabs as saved: their stripped URL, whether they matter, and why not if not. */
export function buildContextTabs(tree: TreeData, urls: Record<string, string>): ContextTab[] {
  const important = new Set(tree.important_tab_refs);
  return tree.tabs.map((tab) => {
    const reason = excludedReason(tree, tab.tab_ref);
    const url = urls[tab.tab_ref];
    return {
      tab_ref: tab.tab_ref,
      ...(url ? { fallback_url: url } : {}),
      domain: tab.domain,
      title: tab.title,
      // An excluded tab is never important, whatever the tree says.
      important: important.has(tab.tab_ref) && reason === null,
      excluded_reason: reason,
    };
  });
}

/**
 * The RESTORE message for a resumed context. `fallback_urls` runs parallel to
 * `tab_refs`; the extension uses it when its own URL store has no entry, as
 * after a browser restart.
 */
export function restorePayload(resume: ResumeResult, which: 'important' | 'all'): RestorePayload {
  const tabs: ResumeTab[] =
    which === 'important' ? resume.important_tabs : [...resume.important_tabs, ...resume.other_tabs];
  return {
    tab_refs: tabs.map((tab) => tab.tab_ref),
    group_name: resume.title,
    fallback_urls: tabs.map((tab) => tab.fallback_url ?? ''),
  };
}

/** "2 h 14 m", "45 m", "<1 m". */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 1) return ms > 0 ? '<1 m' : '0 m';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} m`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} m`;
}

/** "Today, 11:31 AM", "Yesterday, 11:38 PM", "Mar 12, 9:35 PM". */
export function formatWhen(iso: string, now: Date = new Date(), timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const day = (value: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
  const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(date);
  if (day(date) === day(now)) return `Today, ${time}`;
  if (day(date) === day(new Date(now.getTime() - 24 * 60 * 60 * 1000))) return `Yesterday, ${time}`;
  const sameYear = day(date).slice(0, 4) === day(now).slice(0, 4);
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
  return `${label}, ${time}`;
}
