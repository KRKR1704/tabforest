export interface MemorySearchResult {
  id: string;
  project_id: string;
  project_name: string;
  date: string;
  similarity: number;
  summary: string;
  decisions: string[];
  attention_minutes: number;
  sessions_count: number;
}

export interface MemorySearchResponse {
  query: string;
  results: MemorySearchResult[];
  message?: string;
}

export interface PruneSuggestion {
  id: string;
  kind: 'exact_duplicate' | 'semantic_redundancy' | 'stale' | 'distraction';
  branch_label: string;
  tab_refs: string[];
  keep_ref: string | null;
  title: string;
  domain: string;
  reason: string;
}

export interface PruneSuggestionsResponse {
  suggestions: PruneSuggestion[];
}
