// Memory search and prune suggestions (connection C5):
// contracts/memory-search.example.json and contracts/prune.example.json.
import type { EvidenceKind, Provenance } from './grove';

export interface MemoryConclusion {
  id: string;
  text: string;
  display_text: string;
  provenance: Provenance;
  confidence: number;
  user_note_id?: string | null;
  evidence: Array<{ ref_kind: EvidenceKind; ref: string; why: string }>;
}

/** One piece of past research that answers "Have I researched this before?". */
export interface MemoryMatch {
  project_id: string;
  project: string;
  /** The day of that research, as YYYY-MM-DD. */
  date: string;
  similarity: number;
  attention_min: number;
  compared: string[];
  conclusion: MemoryConclusion | null;
  saved_context_id: string | null;
}

export interface MemorySearchResponse {
  found: boolean;
  query: string;
  /** Set when nothing matched, e.g. "No related research found". */
  message: string | null;
  matches: MemoryMatch[];
}

export type PruneKind = 'exact_duplicate' | 'semantic_redundant' | 'stale' | 'distraction';
export type PruneActionId = 'keep_all' | 'close_selected' | 'save_as_references' | 'prune_branch';

export interface PruneSuggestion {
  id: string;
  kind: PruneKind;
  tab_refs: string[];
  /** The source worth keeping; it is never closed by "Close selected". */
  keep_ref: string | null;
  reason: string;
  default_selected: boolean;
}

export interface PruneSuggestionsResponse {
  suggestions: PruneSuggestion[];
  actions: Array<{ id: PruneActionId; label: string }>;
  note: string;
}
