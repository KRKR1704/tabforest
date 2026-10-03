export type Provenance = 'stated' | 'sourced' | 'inferred' | 'hypothesis';

export type TreeStatus = 'active' | 'dormant' | 'done';

export type BranchStatus = 'active' | 'explored';

export type SourceType =
  | 'docs'
  | 'qa'
  | 'code'
  | 'discussion'
  | 'video'
  | 'search'
  | 'work-tool';

export interface EvidenceRef {
  ref: string;
  why: string;
}

export interface GroveTab {
  tab_ref: string;
  domain: string;
  title: string;
  dwell_minutes: number;
  is_open: boolean;
  importance?: number;
  source_type?: SourceType;
  opener_tab_ref?: string | null;
  dup_key?: string;
  search_query?: string | null;
}

export interface GroveBranch {
  branch_ref: string;
  label: string;
  status: BranchStatus;
  tab_refs: string[];
  recency_minutes?: number;
}

export interface GoalClaim {
  text: string;
  confidence: number;
  provenance: Provenance;
  evidence: EvidenceRef[];
}

export interface DirectionClaim {
  text: string;
  confidence: number;
  provenance: Provenance;
  evidence: EvidenceRef[];
}

export interface DecisionClaim {
  id: string;
  text: string;
  provenance: Provenance;
  user_note_id?: string | null;
  quote?: string | null;
  confidence: number;
  evidence: EvidenceRef[];
}

export interface UnresolvedQuestion {
  id: string;
  question: string;
  kind: 'repeated_search' | 'unresolved_comparison' | 'dormant_mid_comparison';
  confidence: number;
  status: 'open' | 'resolved';
  recurrence_count?: number;
  resolved_at?: string | null;
  answer?: string | null;
  evidence: EvidenceRef[];
}

export interface NextAction {
  id: string;
  action: string;
  unblocks?: string;
  reason?: string;
  confidence?: number;
  status?: 'open' | 'done' | 'dismissed';
}

export interface RedundantGroup {
  tab_refs: string[];
  keep_ref: string;
  reason: string;
  is_exact_dup?: boolean;
}

export interface HypothesisClaim {
  text: string;
  confidence: number;
  evidence: EvidenceRef[];
}

export interface ProjectInfo {
  id: string;
  name: string;
  is_existing_project_id: string | null;
}

export interface TreeData {
  cluster_ref: string;
  project: ProjectInfo;
  status: TreeStatus;
  attention_minutes: number;
  last_active_at: string;
  goal: GoalClaim;
  branches: GroveBranch[];
  current_direction: DirectionClaim;
  decisions: DecisionClaim[];
  unresolved_questions: UnresolvedQuestion[];
  blockers: string[];
  next_actions: NextAction[];
  redundant_groups: RedundantGroup[];
  important_tab_refs: string[];
  hypotheses: HypothesisClaim[];
  tabs: GroveTab[];
}

export interface MeadowData {
  label: string;
  tabs: GroveTab[];
}

export interface SproutData {
  sprout_ref: string;
  label: string;
  tab_count: number;
  age_minutes: number;
  tabs: Array<{
    tab_ref: string;
    domain: string;
    title: string;
    dwell_minutes: number;
    is_open: boolean;
  }>;
}

export interface PastConnection {
  tree_cluster_ref: string;
  past_project_id: string;
  past_project_title: string;
  similarity: number;
  summary: string;
}

export interface GroveResponse {
  schema_version: string;
  run_id: string;
  generated_at: string;
  degraded: boolean;
  hollow_count: number;
  trees: TreeData[];
  meadow: MeadowData;
  sprouts: SproutData[];
  past_connections?: PastConnection[];
}

// Stream NDJSON message shapes
export type StreamMessage =
  | {
      type: 'clusters';
      clusters: Array<{
        cluster_ref: string;
        project_name: string;
        tab_refs: string[];
      }>;
      sprouts?: Array<{
        sprout_ref: string;
        label: string;
        tab_count: number;
      }>;
      meadow_tab_refs?: string[];
    }
  | ({ type: 'tree' } & TreeData)
  | {
      type: 'done';
      run_id: string;
      degraded: boolean;
    };
