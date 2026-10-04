// Work Context (connection C6, contracts/work-context.example.json).
import type { Provenance } from './grove';

/** One thing the user handed over: a captured page (with its domain) or pasted text. */
export interface WorkItemInput {
  kind: 'page' | 'paste';
  title: string;
  /** Required for a page, not allowed for a paste. */
  domain?: string;
  text: string;
}

export interface WorkDocument {
  id: string;
  kind: 'page' | 'paste' | 'file';
  title: string;
  source_type: 'ticket' | 'pull_request' | 'account_note' | 'transcript' | 'document';
}

export interface WorkEvidence {
  ref_kind: string;
  ref: string;
  why: string;
}

/**
 * A Work Context claim. A sourced claim carries a verbatim quote, the title of
 * its source and, for a transcript, the cue time; an inferred claim has none.
 */
export interface WorkClaim {
  id: string;
  text: string;
  provenance: Provenance;
  confidence: number;
  display_text: string;
  quote: string | null;
  source: string | null;
  timestamp: string | null;
  evidence: WorkEvidence[];
}

export interface WorkDecision extends WorkClaim {
  speaker: string;
}

export interface WorkOwner extends WorkClaim {
  person: string;
  task: string;
}

export interface WorkQuestion extends WorkClaim {
  status: 'open' | 'resolved';
  answer: string | null;
  resolved_at: string | null;
  recurrence: number;
}

export interface WorkAction extends WorkClaim {
  rank: number;
  /** Id of the blocker or question this action unblocks. */
  unblocks: string | null;
}

export interface WorkContextResponse {
  run_id: string;
  project: string;
  documents: WorkDocument[];
  goal: WorkClaim;
  decisions: WorkDecision[];
  blockers: WorkClaim[];
  owners: WorkOwner[];
  open_questions: WorkQuestion[];
  next_actions: WorkAction[];
  handoff_brief: string;
}

export type WorkContextOutcome =
  | {
      ok: true;
      result: WorkContextResponse;
      /** True when this is the contract's sample, shown because the API could not be reached. */
      sample: boolean;
    }
  | { ok: false; message: string };
