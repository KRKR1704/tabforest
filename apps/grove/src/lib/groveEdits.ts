// Pure edits to a grove after the user corrects it. Each returns a new grove,
// so the canvas redraws from data and never from hand-tuned DOM changes.
import type {
  ClaimUpdate,
  DecisionClaim,
  GroveResponse,
  GroveTab,
  HypothesisClaim,
  StatedClaim,
  TreeData,
} from '../types';

export const hypothesisId = (tree: TreeData, hypothesis: HypothesisClaim, index: number): string =>
  hypothesis.id ?? `${tree.cluster_ref}:h${index + 1}`;

type ClaimFields = {
  text: string;
  display_text?: string;
  provenance?: ClaimUpdate['provenance'];
  confidence?: number;
};

/** Merges the fields the server sent back onto a claim. */
function merged<T extends ClaimFields>(claim: T, update: ClaimUpdate): T {
  const text = update.text ?? claim.text;
  const next = { ...claim, text };
  if (update.provenance !== undefined) next.provenance = update.provenance;
  if (update.confidence !== undefined) next.confidence = update.confidence;
  if (update.evidence !== undefined) Object.assign(next, { evidence: update.evidence });
  if (update.user_note_id !== undefined) Object.assign(next, { user_note_id: update.user_note_id });
  if (update.quote !== undefined) Object.assign(next, { quote: update.quote });
  // A stated claim is shown in the user's own words, without "appears to".
  next.display_text =
    update.display_text ?? (update.provenance === 'stated' ? text : claim.display_text);
  return next;
}

function applyToTree(tree: TreeData, update: ClaimUpdate): TreeData {
  const { id } = update;
  const next: TreeData = { ...tree };

  if (tree.goal.id === id && !update.dismissed) next.goal = merged(tree.goal, update);
  if (tree.current_direction.id === id && !update.dismissed) {
    next.current_direction = merged(tree.current_direction, update);
  }

  next.decisions = tree.decisions.flatMap((decision) => {
    if (decision.id !== id) return [decision];
    if (update.dismissed) return [];
    const changed = merged(decision, update);
    if (update.stone_kind) changed.stone_kind = update.stone_kind;
    else if (changed.provenance === 'stated' || changed.provenance === 'sourced') {
      changed.stone_kind = 'carved';
    }
    return [changed];
  });

  next.unresolved_questions = tree.unresolved_questions.flatMap((question) => {
    if (question.id !== id) return [question];
    if (update.dismissed) return [];
    const base = merged({ ...question, text: question.question }, update);
    const { text, ...rest } = base;
    return [
      {
        ...rest,
        question: text,
        status: update.status ?? question.status,
        answer: update.answer !== undefined ? update.answer : question.answer,
        resolved_at: update.resolved_at !== undefined ? update.resolved_at : question.resolved_at,
      },
    ];
  });

  next.next_actions = tree.next_actions.flatMap((action) => {
    if (action.id !== id) return [action];
    if (update.dismissed) return [];
    const base = merged({ ...action, text: action.action }, update);
    const { text, ...rest } = base;
    return [{ ...rest, action: text }];
  });

  const hypothesisIndex = tree.hypotheses.findIndex((h, i) => hypothesisId(tree, h, i) === id);
  if (hypothesisIndex >= 0) {
    const hypothesis = tree.hypotheses[hypothesisIndex];
    next.hypotheses = tree.hypotheses.filter((_, i) => i !== hypothesisIndex);
    // Once confirmed it is no longer a hypothesis: it becomes a stated decision.
    if (!update.dismissed && update.provenance === 'stated') {
      const decision: DecisionClaim = {
        id,
        text: update.text ?? hypothesis.text,
        display_text: update.display_text ?? update.text ?? hypothesis.text,
        provenance: 'stated',
        confidence: update.confidence ?? 1,
        stone_kind: 'carved',
        user_note_id: update.user_note_id ?? null,
        quote: null,
        evidence: update.evidence ?? hypothesis.evidence,
      };
      next.decisions = [...next.decisions, decision];
    } else if (!update.dismissed) {
      next.hypotheses = tree.hypotheses.map((h, i) =>
        i === hypothesisIndex ? { ...merged(h, update), id } : h
      );
    }
  }

  return next;
}

export function applyClaimUpdate(grove: GroveResponse, update: ClaimUpdate): GroveResponse {
  return { ...grove, trees: grove.trees.map((tree) => applyToTree(tree, update)) };
}

export function addDecision(grove: GroveResponse, treeId: string, claim: StatedClaim): GroveResponse {
  return {
    ...grove,
    trees: grove.trees.map((tree) =>
      tree.cluster_ref === treeId
        ? {
            ...tree,
            decisions: [...tree.decisions, { ...claim, stone_kind: 'carved' as const, quote: null }],
          }
        : tree
    ),
  };
}

export function replaceTree(grove: GroveResponse, tree: TreeData): GroveResponse {
  const exists = grove.trees.some((t) => t.cluster_ref === tree.cluster_ref);
  return {
    ...grove,
    trees: exists
      ? grove.trees.map((t) => (t.cluster_ref === tree.cluster_ref ? tree : t))
      : [...grove.trees, tree],
  };
}

function withoutTab(tree: TreeData, tabRef: string): TreeData {
  return {
    ...tree,
    tabs: tree.tabs.filter((tab) => tab.tab_ref !== tabRef),
    branches: tree.branches.map((branch) => ({
      ...branch,
      tab_refs: branch.tab_refs.filter((ref) => ref !== tabRef),
    })),
    important_tab_refs: tree.important_tab_refs.filter((ref) => ref !== tabRef),
    shared_tab_refs: tree.shared_tab_refs?.filter((ref) => ref !== tabRef),
    redundant_groups: tree.redundant_groups
      .map((group) => ({ ...group, tab_refs: group.tab_refs.filter((ref) => ref !== tabRef) }))
      .filter((group) => group.keep_ref !== tabRef && group.tab_refs.length > 0),
  };
}

/** A new tree holding one tab, with the goal as the user named it. */
function treeFromTab(
  tab: GroveTab,
  projectId: string,
  name: string,
  goal?: StatedClaim
): TreeData {
  return {
    cluster_ref: projectId,
    project: { id: projectId, name, is_existing_project_id: null },
    status: 'active',
    attention_minutes: tab.dwell_minutes,
    last_active_at: new Date().toISOString(),
    days_since_active: 0,
    canopy: 'green',
    fogged: false,
    goal: goal ?? {
      text: name,
      display_text: name,
      provenance: 'stated',
      confidence: 1,
      evidence: [{ ref: tab.tab_ref, ref_kind: 'tab', why: 'you moved this tab here' }],
    },
    branches: [
      {
        branch_ref: `${projectId}:b1`,
        label: tab.domain || 'Sources',
        status: 'active',
        tab_refs: [tab.tab_ref],
      },
    ],
    current_direction: { text: '', display_text: '', provenance: 'stated', confidence: 1, evidence: [] },
    decisions: [],
    unresolved_questions: [],
    blockers: [],
    next_actions: [],
    redundant_groups: [],
    important_tab_refs: [tab.tab_ref],
    shared_tab_refs: [],
    hypotheses: [],
    tabs: [{ ...tab, fallen: false }],
  };
}

export type MoveTarget =
  | { projectId: string; branchLabel?: string | null }
  | { projectId: string; newProjectName: string };

/** Moves a leaf to another tree, or to a new tree of its own. */
export function moveTab(
  grove: GroveResponse,
  tabRef: string,
  fromTreeId: string,
  target: MoveTarget
): GroveResponse {
  const source = grove.trees.find((tree) => tree.cluster_ref === fromTreeId);
  const tab = source?.tabs.find((t) => t.tab_ref === tabRef);
  if (!source || !tab || target.projectId === fromTreeId) return grove;

  const trees = grove.trees
    .map((tree) => (tree.cluster_ref === fromTreeId ? withoutTab(tree, tabRef) : tree))
    // A tree with no leaves left has nothing to show.
    .filter((tree) => tree.cluster_ref !== fromTreeId || tree.tabs.length > 0);

  if ('newProjectName' in target) {
    return { ...grove, trees: [...trees, treeFromTab(tab, target.projectId, target.newProjectName)] };
  }

  return {
    ...grove,
    trees: trees.map((tree) => {
      if (tree.cluster_ref !== target.projectId) return tree;
      if (tree.tabs.some((t) => t.tab_ref === tabRef)) return tree;
      const index = Math.max(
        0,
        tree.branches.findIndex((branch) => branch.label === target.branchLabel)
      );
      const branches =
        tree.branches.length > 0
          ? tree.branches.map((branch, i) =>
              i === index ? { ...branch, tab_refs: [...branch.tab_refs, tabRef] } : branch
            )
          : [
              {
                branch_ref: `${tree.cluster_ref}:b1`,
                label: tab.domain || 'Sources',
                status: 'active' as const,
                tab_refs: [tabRef],
              },
            ];
      return { ...tree, branches, tabs: [...tree.tabs, { ...tab, fallen: false }] };
    }),
  };
}

/** "Clear the fog": the user names the goal of an unclear tab, which grows its own tree. */
export function nameFogTab(
  grove: GroveResponse,
  tabRef: string,
  projectId: string,
  goal: StatedClaim
): GroveResponse {
  const item = grove.fog?.find((fogged) => fogged.tab.tab_ref === tabRef);
  if (!item) return grove;
  return {
    ...grove,
    fog: grove.fog?.filter((fogged) => fogged.tab.tab_ref !== tabRef),
    trees: [...grove.trees, treeFromTab(item.tab, projectId, goal.text, goal)],
  };
}
