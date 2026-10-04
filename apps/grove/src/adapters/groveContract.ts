// Converts the wire format in contracts/grove.example.json (connection C3) into
// this app's own grove types. Any mismatch with the contract is fixed here and
// nowhere else (BUILD_TASKS.md §2 rule 3).
import type {
  CanopyColor,
  DecisionClaim,
  EvidenceKind,
  EvidenceRef,
  GroveResponse,
  GroveTab,
  Provenance,
  SourceType,
  StreamMessage,
  TreeData,
  UnresolvedQuestion,
} from '../types';

export interface WireEvidence {
  ref_kind: EvidenceKind;
  ref: string;
  why: string;
}

export interface WireClaim {
  id: string;
  text: string;
  provenance: Provenance;
  confidence: number;
  display_text: string;
  evidence: WireEvidence[];
}

export interface WireLeaf {
  tab_ref: string;
  title: string;
  domain: string;
  source_type: SourceType;
  dwell_min: number;
  is_open: boolean;
  importance: number;
  fallen: boolean;
}

export interface WireBranch {
  label: string;
  status: 'active' | 'explored';
  leaves: WireLeaf[];
}

export interface WireStone extends WireClaim {
  kind: 'carved' | 'mossy';
  user_note_id: string | null;
  quote: string | null;
}

export interface WireMushroom extends WireClaim {
  kind: UnresolvedQuestion['kind'];
  status: 'open' | 'resolved';
  answer: string | null;
  resolved_at: string | null;
  recurrence: number;
}

export interface WireNextAction extends WireClaim {
  unblocks: string | null;
  reason: string | null;
}

export interface WireVine {
  tab_refs: string[];
  kind: 'semantic' | 'exact';
  keep_ref: string;
  reason: string;
}

export interface WireTree {
  project_id: string;
  name: string;
  is_existing_project_id: string | null;
  goal: WireClaim;
  attention_min: number;
  days_since_active: number;
  canopy: CanopyColor;
  fogged: boolean;
  branches: WireBranch[];
  direction: WireClaim | null;
  stones: WireStone[];
  mushrooms: WireMushroom[];
  next_actions: WireNextAction[];
  vines: WireVine[];
  hypotheses: WireClaim[];
  important_tab_refs: string[];
  shared_tab_refs: string[];
  query_families?: Array<{ id: string; queries: string[]; tab_refs: string[]; open_loop: boolean }>;
}

export interface WireSprout {
  label: string;
  tab_refs: string[];
}

export interface WireFogTab {
  tab_ref: string;
  reason: string;
}

export interface WireFirefly {
  id: string;
  project_id: string;
  past_project_id: string;
  past_project_name: string;
  past_date: string;
  similarity: number;
  saved_context_id: string;
  display_text: string;
}

export interface WireGrove {
  run_id: string;
  generated_at: string;
  hollow_count: number;
  degraded: boolean;
  banner_text: string | null;
  trees: WireTree[];
  sprouts: WireSprout[];
  meadow: string[];
  fog: WireFogTab[];
  fireflies: WireFirefly[];
}

export type WireStreamMessage =
  | {
      type: 'clusters';
      run_id: string;
      hollow_count: number;
      clusters: Array<{ project_id: string; name: string; tab_refs: string[] }>;
      sprouts: WireSprout[];
      meadow: string[];
      fog: WireFogTab[];
    }
  | ({ type: 'tree' } & WireTree)
  | { type: 'done'; run_id: string; degraded: boolean; fireflies?: WireFirefly[] };

/**
 * Title and domain per tab_ref. The grove names meadow, fog and sprout tabs by
 * ref only, so their text comes from the open-tab snapshot.
 */
export type TabIndex = ReadonlyMap<string, { title: string; domain: string }>;

const EMPTY_INDEX: TabIndex = new Map();
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DORMANT_AFTER_DAYS = 3;

export function indexTabs(
  tabs: ReadonlyArray<{ tab_ref: string; title: string; domain: string }>
): TabIndex {
  return new Map(tabs.map((tab) => [tab.tab_ref, { title: tab.title, domain: tab.domain }]));
}

export function looseTab(tabRef: string, index: TabIndex = EMPTY_INDEX): GroveTab {
  const known = index.get(tabRef);
  return {
    tab_ref: tabRef,
    title: known?.title ?? 'Untitled tab',
    domain: known?.domain ?? '',
    dwell_minutes: 0,
    is_open: true,
  };
}

function evidence(items: WireEvidence[]): EvidenceRef[] {
  return items.map((item) => ({ ref: item.ref, why: item.why, ref_kind: item.ref_kind }));
}

function claim(wire: WireClaim) {
  return {
    id: wire.id,
    text: wire.text,
    display_text: wire.display_text,
    provenance: wire.provenance,
    confidence: wire.confidence,
    evidence: evidence(wire.evidence),
  };
}

function isDormant(wire: WireTree): boolean {
  return wire.canopy === 'amber' || wire.days_since_active >= DORMANT_AFTER_DAYS;
}

export function normalizeTree(wire: WireTree, generatedAt: string): TreeData {
  const lastActive = new Date(Date.parse(generatedAt) - wire.days_since_active * MS_PER_DAY);

  const decisions: DecisionClaim[] = wire.stones.map((stone) => ({
    ...claim(stone),
    stone_kind: stone.kind,
    user_note_id: stone.user_note_id,
    quote: stone.quote,
  }));

  const questions: UnresolvedQuestion[] = wire.mushrooms.map((mushroom) => ({
    id: mushroom.id,
    question: mushroom.text,
    display_text: mushroom.display_text,
    provenance: mushroom.provenance,
    kind: mushroom.kind,
    confidence: mushroom.confidence,
    status: mushroom.status,
    recurrence_count: mushroom.recurrence,
    resolved_at: mushroom.resolved_at,
    answer: mushroom.answer,
    evidence: evidence(mushroom.evidence),
  }));

  return {
    cluster_ref: wire.project_id,
    project: {
      id: wire.project_id,
      name: wire.name,
      is_existing_project_id: wire.is_existing_project_id,
    },
    status: isDormant(wire) ? 'dormant' : 'active',
    attention_minutes: wire.attention_min,
    last_active_at: Number.isNaN(lastActive.getTime()) ? generatedAt : lastActive.toISOString(),
    days_since_active: wire.days_since_active,
    canopy: wire.canopy,
    fogged: wire.fogged,
    goal: claim(wire.goal),
    branches: wire.branches.map((branch, index) => ({
      branch_ref: `${wire.project_id}:b${index + 1}`,
      label: branch.label,
      status: branch.status,
      tab_refs: branch.leaves.map((leaf) => leaf.tab_ref),
    })),
    // Seedling mode sends no direction. An empty claim keeps the type total; screens skip empty text.
    current_direction: claim(wire.direction ?? { ...wire.goal, text: '', display_text: '', evidence: [] }),
    decisions,
    unresolved_questions: questions,
    blockers: [],
    next_actions: wire.next_actions.map((action) => ({
      id: action.id,
      action: action.text,
      display_text: action.display_text,
      provenance: action.provenance,
      confidence: action.confidence,
      unblocks: action.unblocks ?? undefined,
      reason: action.reason ?? undefined,
      evidence: evidence(action.evidence),
    })),
    redundant_groups: wire.vines.map((vine) => ({
      tab_refs: vine.tab_refs,
      keep_ref: vine.keep_ref,
      reason: vine.reason,
      is_exact_dup: vine.kind === 'exact',
    })),
    important_tab_refs: wire.important_tab_refs,
    shared_tab_refs: wire.shared_tab_refs,
    query_families: wire.query_families ?? [],
    hypotheses: wire.hypotheses.map(claim),
    tabs: wire.branches.flatMap((branch) =>
      branch.leaves.map((leaf) => ({
        tab_ref: leaf.tab_ref,
        title: leaf.title,
        domain: leaf.domain,
        source_type: leaf.source_type,
        dwell_minutes: leaf.dwell_min,
        is_open: leaf.is_open,
        importance: leaf.importance,
        fallen: leaf.fallen,
      }))
    ),
  };
}

function normalizeSprouts(sprouts: WireSprout[], index: TabIndex) {
  return sprouts.map((sprout, i) => ({
    sprout_ref: `sprout-${i + 1}`,
    label: sprout.label,
    tab_count: sprout.tab_refs.length,
    tabs: sprout.tab_refs.map((ref) => looseTab(ref, index)),
  }));
}

function normalizeFireflies(fireflies: WireFirefly[] | undefined) {
  return (fireflies ?? []).map((firefly) => ({
    tree_cluster_ref: firefly.project_id,
    past_project_id: firefly.past_project_id,
    past_project_title: firefly.past_project_name,
    similarity: firefly.similarity,
    summary: firefly.display_text,
    past_date: firefly.past_date,
    saved_context_id: firefly.saved_context_id ?? null,
  }));
}

export function normalizeGrove(wire: WireGrove, index: TabIndex = EMPTY_INDEX): GroveResponse {
  return {
    schema_version: '1.0',
    run_id: wire.run_id,
    generated_at: wire.generated_at,
    degraded: wire.degraded,
    banner_text: wire.banner_text,
    hollow_count: wire.hollow_count,
    trees: wire.trees.map((tree) => normalizeTree(tree, wire.generated_at)),
    meadow: {
      label: 'Wildflower Meadow',
      tabs: wire.meadow.map((ref) => looseTab(ref, index)),
    },
    sprouts: normalizeSprouts(wire.sprouts, index),
    fog: wire.fog.map((item) => ({ tab: looseTab(item.tab_ref, index), reason: item.reason })),
    past_connections: normalizeFireflies(wire.fireflies),
  };
}

export function normalizeStreamMessage(
  wire: WireStreamMessage,
  index: TabIndex = EMPTY_INDEX,
  receivedAt: string = new Date().toISOString()
): StreamMessage {
  if (wire.type === 'clusters') {
    return {
      type: 'clusters',
      run_id: wire.run_id,
      hollow_count: wire.hollow_count,
      clusters: wire.clusters.map((cluster) => ({
        cluster_ref: cluster.project_id,
        project_name: cluster.name,
        tab_refs: cluster.tab_refs,
        tabs: cluster.tab_refs.map((ref) => looseTab(ref, index)),
      })),
      sprouts: normalizeSprouts(wire.sprouts ?? [], index),
      meadow_tab_refs: wire.meadow ?? [],
      meadow: {
        label: 'Wildflower Meadow',
        tabs: (wire.meadow ?? []).map((ref) => looseTab(ref, index)),
      },
      fog: (wire.fog ?? []).map((item) => ({
        tab: looseTab(item.tab_ref, index),
        reason: item.reason,
      })),
    };
  }
  if (wire.type === 'tree') {
    return { type: 'tree', ...normalizeTree(wire, receivedAt) };
  }
  return {
    type: 'done',
    run_id: wire.run_id,
    degraded: wire.degraded,
    past_connections: normalizeFireflies(wire.fireflies),
  };
}
