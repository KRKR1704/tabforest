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
  | 'work-tool'
  | 'work_tool'
  | 'article'
  | 'other';

export type EvidenceKind = 'tab' | 'query' | 'note' | 'document';

export type CanopyColor = 'green' | 'amber';

export interface EvidenceRef {
  ref: string;
  why: string;
  /** Set by the contract; older short refs (t1, q1) carry the kind in their prefix. */
  ref_kind?: EvidenceKind;
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
  /** Stale: lies on the ground under its branch (SPEC §9.1). */
  fallen?: boolean;
}

export interface GroveBranch {
  branch_ref: string;
  label: string;
  status: BranchStatus;
  tab_refs: string[];
  recency_minutes?: number;
}

export interface GoalClaim {
  id?: string;
  /** Wording generated from the provenance label by the server (SPEC §2.3). */
  display_text?: string;
  text: string;
  confidence: number;
  provenance: Provenance;
  evidence: EvidenceRef[];
}

export interface DirectionClaim {
  id?: string;
  display_text?: string;
  text: string;
  confidence: number;
  provenance: Provenance;
  evidence: EvidenceRef[];
}

export interface DecisionClaim {
  id: string;
  display_text?: string;
  /** Stone encoding: carved for stated or sourced, mossy for inferred. */
  stone_kind?: 'carved' | 'mossy';
  text: string;
  provenance: Provenance;
  user_note_id?: string | null;
  quote?: string | null;
  confidence: number;
  evidence: EvidenceRef[];
}

export interface UnresolvedQuestion {
  id: string;
  display_text?: string;
  provenance?: Provenance;
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
  display_text?: string;
  provenance?: Provenance;
  evidence?: EvidenceRef[];
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
  id?: string;
  display_text?: string;
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
  days_since_active?: number;
  canopy?: CanopyColor;
  /** True when the whole tree is low-confidence, e.g. in Seedling mode. */
  fogged?: boolean;
  /** Tabs that also appear on another tree. */
  shared_tab_refs?: string[];
  /** Groups of rephrased searches; query evidence points at one of these. */
  query_families?: QueryFamily[];
}

export interface QueryFamily {
  id: string;
  queries: string[];
  tab_refs: string[];
  open_loop: boolean;
}

export interface FogTab {
  tab: GroveTab;
  reason: string;
}

export interface MeadowData {
  label: string;
  tabs: GroveTab[];
}

export interface SproutData {
  sprout_ref: string;
  label: string;
  tab_count: number;
  age_minutes?: number;
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
  /** Tabs with no clear goal: the Unclear fog patch. */
  fog?: FogTab[];
  /** Shown when the grove is degraded, e.g. "AI unavailable — showing groups only". */
  banner_text?: string | null;
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
