// Requests and normalized results for claims, assign and notes (connection C4,
// contracts/claims.example.json).
import type { EvidenceRef, Provenance } from './grove';

export type ClaimAction = 'confirm' | 'edit' | 'dismiss' | 'resolve';

/** Body of PATCH /api/claims/{id}. `text` only with edit, `answer` only with resolve. */
export interface ClaimPatchBody {
  action: ClaimAction;
  text?: string;
  answer?: string;
}

/** What changed on a claim. Only the fields the server sent back are set. */
export interface ClaimUpdate {
  id: string;
  dismissed: boolean;
  text?: string;
  display_text?: string;
  provenance?: Provenance;
  confidence?: number;
  evidence?: EvidenceRef[];
  stone_kind?: 'carved' | 'mossy';
  user_note_id?: string | null;
  quote?: string | null;
  status?: 'open' | 'resolved';
  answer?: string | null;
  resolved_at?: string | null;
}

/** Body of POST /api/tabs/{tab_ref}/assign: exactly one of the two targets. */
export type AssignTarget =
  | { project_id: string; branch_label?: string }
  | { new_project_name: string };

export interface AssignResult {
  tab_ref: string;
  from_project_id: string;
  project_id: string;
  project_name: string;
  branch_label: string | null;
  pinned: boolean;
  reanalyze_project_ids: string[];
}

export type NoteKind = 'goal' | 'decision' | 'note';

/** Body of POST /api/notes: a tab_ref or a project_id says what the note is about. */
export interface NoteBody {
  kind: NoteKind;
  text: string;
  tab_ref?: string;
  project_id?: string;
}

export interface StatedClaim {
  id: string;
  text: string;
  display_text: string;
  provenance: Provenance;
  confidence: number;
  user_note_id?: string | null;
  evidence: EvidenceRef[];
}

export interface NoteResult {
  note: { id: string; kind: NoteKind; tab_ref: string | null; text: string; created_at: string };
  project_id: string;
  claim: StatedClaim;
}
