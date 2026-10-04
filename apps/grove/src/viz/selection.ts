// What a click on the grove means. The canvas reports only a kind and an id;
// this turns that into words (and, for claims, the evidence to show).
import type { EvidenceClaim } from '../components/EvidenceDrawer';
import type { GroveResponse, GroveTab, TreeData } from '../types';

export type SelectionKind =
  | 'tree'
  | 'branch'
  | 'leaf'
  | 'fallen-leaf'
  | 'mushroom'
  | 'flower'
  | 'stone'
  | 'vine'
  | 'shared-vine'
  | 'hypothesis'
  | 'firefly'
  | 'sprout'
  | 'meadow'
  | 'fog';

export interface GroveSelection {
  kind: SelectionKind;
  id: string;
  treeId?: string;
}

export interface SelectionDescription {
  /** What kind of thing was clicked, in plain words. */
  label: string;
  text: string;
  detail?: string;
  /** Present for claims: opens the evidence drawer. */
  claim?: EvidenceClaim;
  tabs?: GroveTab[];
  /** Present for a tab: the domain it can be excluded by. */
  domain?: string;
  /** True for a tab in the Unclear patch, which can be given a goal. */
  inFog?: boolean;
  /** Present for a firefly: the saved grove it leads to. */
  contextId?: string;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function tabDetail(tab: GroveTab): string | undefined {
  const parts: string[] = [];
  if (tab.domain) parts.push(tab.domain);
  if (tab.dwell_minutes > 0) parts.push(`${tab.dwell_minutes} min`);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function describeInTree(tree: TreeData, selection: GroveSelection, grove: GroveResponse): SelectionDescription | null {
  const { kind, id } = selection;

  if (kind === 'tree') {
    return {
      label: 'Goal',
      text: tree.goal.display_text ?? tree.goal.text,
      detail: tree.project.name,
      claim: { kind: 'Goal', ...tree.goal, text: tree.goal.display_text ?? tree.goal.text },
      tabs: tree.tabs,
    };
  }

  if (kind === 'branch') {
    const branch = tree.branches.find((b) => b.branch_ref === id);
    if (!branch) return null;
    return {
      label: 'Research path',
      text: branch.label,
      detail: `${plural(branch.tab_refs.length, 'tab')} · ${branch.status}`,
    };
  }

  if (kind === 'leaf' || kind === 'fallen-leaf') {
    const tab = tree.tabs.find((t) => t.tab_ref === id);
    if (!tab) return null;
    return {
      label: kind === 'fallen-leaf' ? 'Stale tab' : 'Tab',
      text: tab.title,
      detail: tabDetail(tab),
      domain: tab.domain || undefined,
    };
  }

  if (kind === 'mushroom' || kind === 'flower') {
    const question = tree.unresolved_questions.find((q) => q.id === id);
    if (!question) return null;
    const text = question.display_text ?? question.question;
    const resolved = question.status === 'resolved';
    const label = resolved ? 'Resolved question' : 'Open question';
    return {
      label,
      text,
      detail: resolved
        ? question.answer ?? undefined
        : `Came up ${plural(question.recurrence_count ?? 1, 'time')}`,
      claim: {
        kind: label,
        text,
        provenance: question.provenance ?? 'inferred',
        confidence: question.confidence,
        evidence: question.evidence,
      },
      tabs: tree.tabs,
    };
  }

  if (kind === 'stone') {
    const decision = tree.decisions.find((d) => d.id === id);
    if (!decision) return null;
    const text = decision.display_text ?? decision.text;
    return {
      label: 'Decision',
      text,
      claim: { kind: 'Decision', ...decision, text },
      tabs: tree.tabs,
    };
  }

  if (kind === 'hypothesis') {
    const index = tree.hypotheses.findIndex(
      (h, i) => (h.id ?? `${tree.cluster_ref}:h${i + 1}`) === id
    );
    const hypothesis = tree.hypotheses[index];
    if (!hypothesis) return null;
    const text = hypothesis.display_text ?? `Maybe: ${hypothesis.text}`;
    return {
      label: 'Hypothesis',
      text,
      claim: {
        kind: 'Hypothesis',
        text,
        provenance: 'hypothesis',
        confidence: hypothesis.confidence,
        evidence: hypothesis.evidence,
      },
      tabs: tree.tabs,
    };
  }

  if (kind === 'vine') {
    const group = tree.redundant_groups.find((_, i) => `${tree.cluster_ref}:v${i + 1}` === id);
    if (!group) return null;
    const count = new Set([...group.tab_refs, group.keep_ref]).size;
    return {
      label: group.is_exact_dup ? 'Exact duplicates' : 'Overlapping sources',
      text: group.reason,
      detail: plural(count, 'tab'),
    };
  }

  if (kind === 'firefly') {
    const connection = (grove.past_connections ?? []).find(
      (c) => c.tree_cluster_ref === tree.cluster_ref && c.past_project_id === id
    );
    if (!connection) return null;
    return {
      label: 'Past research',
      text: connection.summary,
      detail: connection.past_project_title,
      contextId: connection.saved_context_id ?? undefined,
    };
  }

  return null;
}

export function describeSelection(
  grove: GroveResponse,
  selection: GroveSelection
): SelectionDescription | null {
  const { kind, id, treeId } = selection;

  if (treeId) {
    const tree = grove.trees.find((t) => t.cluster_ref === treeId);
    return tree ? describeInTree(tree, selection, grove) : null;
  }

  if (kind === 'shared-vine') {
    const owners = grove.trees.filter((tree) => tree.tabs.some((tab) => tab.tab_ref === id));
    const tab = owners[0]?.tabs.find((t) => t.tab_ref === id);
    if (!tab) return null;
    return {
      label: 'Shared tab',
      text: tab.title,
      detail: `Serves ${owners.map((tree) => tree.project.name).join(' and ')}`,
    };
  }

  if (kind === 'sprout') {
    const sprout = grove.sprouts.find((s) => s.sprout_ref === id);
    if (!sprout) return null;
    return {
      label: 'Sprout',
      text: sprout.label,
      detail: `Emerging · ${plural(sprout.tab_count, 'tab')}`,
    };
  }

  if (kind === 'meadow') {
    return {
      label: grove.meadow.label,
      text: `${plural(grove.meadow.tabs.length, 'tab')} not tied to any goal`,
    };
  }

  if (kind === 'fog') {
    return {
      label: 'Unclear',
      text: `${plural(grove.fog?.length ?? 0, 'tab')} the grove could not place`,
    };
  }

  if (kind === 'leaf') {
    const fogged = grove.fog?.find((item) => item.tab.tab_ref === id);
    if (fogged) {
      return {
        label: 'Unclear tab',
        text: fogged.tab.title,
        detail: fogged.reason,
        domain: fogged.tab.domain || undefined,
        inFog: true,
      };
    }
    const loose = [...grove.meadow.tabs, ...grove.sprouts.flatMap((sprout) => sprout.tabs)].find(
      (tab) => tab.tab_ref === id
    );
    if (!loose) return null;
    return {
      label: 'Tab',
      text: loose.title,
      detail: loose.domain || undefined,
      domain: loose.domain || undefined,
    };
  }

  return null;
}
