// The grove as a flat list of tabs, for the Tabs panel: every tab once per
// place it sits, with its tree, its path, and whether it is a copy of another.
import type { GroveResponse, GroveTab, TreeData } from '../types';

export interface TabRow {
  /** Unique in the list: a shared tab has one row per tree it sits on. */
  key: string;
  tabRef: string;
  title: string;
  domain: string;
  isOpen: boolean;
  /** Stale: lies on the ground under its tree. */
  fallen: boolean;
  /** The tree it sits on, when it sits on one. */
  treeId: string | null;
  /** How it relates to other copies of the same page on this tree. */
  duplicate: { kind: 'kept' | 'copy' | 'overlap'; text: string } | null;
  /** The other tabs in its duplicate group, on the same tree. */
  duplicateRefs: string[];
  /** Other goals this same tab serves. */
  alsoOn: string[];
  /** Why the grove could not place it (Unclear tabs only). */
  reason?: string;
}

export interface TabSection {
  label: string;
  rows: TabRow[];
}

export interface TabGroup {
  id: string;
  kind: 'tree' | 'sprout' | 'meadow' | 'fog';
  name: string;
  /** A tree still waiting for its AI result. */
  pending: boolean;
  sections: TabSection[];
  count: number;
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

function duplicateOf(tree: TreeData, tab: GroveTab): Pick<TabRow, 'duplicate' | 'duplicateRefs'> {
  const titles = new Map(tree.tabs.map((item) => [item.tab_ref, item.title]));
  const groups = tree.redundant_groups.filter(
    (group) => group.keep_ref === tab.tab_ref || group.tab_refs.includes(tab.tab_ref)
  );
  const othersIn = (group: TreeData['redundant_groups'][number]) =>
    [...new Set([group.keep_ref, ...group.tab_refs])].filter((ref) => ref !== tab.tab_ref && titles.has(ref));

  // The tab the grove would keep: it can be the kept one of several groups at once.
  const keptFor = groups.filter((group) => group.keep_ref === tab.tab_ref);
  const kept = [...new Set(keptFor.flatMap(othersIn))];
  if (kept.length > 0) {
    const count = kept.length;
    const exact = keptFor.every((group) => group.is_exact_dup === true);
    const text = exact
      ? `Kept · ${count} ${count === 1 ? 'copy' : 'copies'}`
      : `Kept · ${count} overlapping ${count === 1 ? 'tab' : 'tabs'}`;
    return { duplicate: { kind: 'kept', text }, duplicateRefs: kept };
  }

  for (const group of groups) {
    const others = othersIn(group);
    if (others.length === 0) continue;
    const keptTitle = titles.get(group.keep_ref) ?? 'another tab';
    return {
      duplicate: group.is_exact_dup
        ? { kind: 'copy', text: `Copy of “${keptTitle}”` }
        : { kind: 'overlap', text: `Overlaps with “${keptTitle}”` },
      duplicateRefs: others,
    };
  }
  return { duplicate: null, duplicateRefs: [] };
}

/** Every tab in the grove, grouped the way the grove groups them: by goal, then by path. */
export function listTabs(grove: GroveResponse): TabGroup[] {
  const treesOf = new Map<string, string[]>();
  for (const tree of grove.trees) {
    for (const tab of tree.tabs) {
      treesOf.set(tab.tab_ref, [...(treesOf.get(tab.tab_ref) ?? []), tree.project.name]);
    }
  }

  const groups: TabGroup[] = grove.trees.map((tree) => {
    const byRef = new Map(tree.tabs.map((tab) => [tab.tab_ref, tab]));
    const row = (tab: GroveTab): TabRow => ({
      key: `${tree.cluster_ref}|${tab.tab_ref}`,
      tabRef: tab.tab_ref,
      title: tab.title,
      domain: tab.domain,
      isOpen: tab.is_open,
      fallen: tab.fallen === true,
      treeId: tree.cluster_ref,
      alsoOn: (treesOf.get(tab.tab_ref) ?? []).filter((name) => name !== tree.project.name),
      ...duplicateOf(tree, tab),
    });
    const placed = new Set<string>();
    const sections: TabSection[] = tree.branches
      .map((branch) => ({
        label: branch.label,
        rows: branch.tab_refs
          .map((ref) => byRef.get(ref))
          .filter((tab): tab is GroveTab => tab !== undefined)
          .map((tab) => {
            placed.add(tab.tab_ref);
            return row(tab);
          }),
      }))
      .filter((section) => section.rows.length > 0);
    // A tab the tree holds that no path lists is still shown, so the count always adds up.
    const loose = tree.tabs.filter((tab) => !placed.has(tab.tab_ref)).map(row);
    if (loose.length > 0) sections.push({ label: '', rows: loose });
    return {
      id: tree.cluster_ref,
      kind: 'tree' as const,
      name: tree.project.name,
      pending: tree.pending === true,
      sections,
      count: sections.reduce((sum, section) => sum + section.rows.length, 0),
    };
  });

  const plain = (owner: string, tab: Pick<GroveTab, 'tab_ref' | 'title' | 'domain' | 'is_open'>, reason?: string): TabRow => ({
    key: `${owner}|${tab.tab_ref}`,
    tabRef: tab.tab_ref,
    title: tab.title,
    domain: tab.domain,
    isOpen: tab.is_open,
    fallen: false,
    treeId: null,
    duplicate: null,
    duplicateRefs: [],
    alsoOn: [],
    reason,
  });

  for (const sprout of grove.sprouts) {
    if (sprout.tabs.length === 0) continue;
    groups.push({
      id: `sprout:${sprout.sprout_ref}`,
      kind: 'sprout',
      name: sprout.label,
      pending: false,
      sections: [{ label: '', rows: sprout.tabs.map((tab) => plain(`sprout:${sprout.sprout_ref}`, tab)) }],
      count: sprout.tabs.length,
    });
  }
  if (grove.meadow.tabs.length > 0) {
    groups.push({
      id: 'meadow',
      kind: 'meadow',
      name: grove.meadow.label,
      pending: false,
      sections: [{ label: '', rows: grove.meadow.tabs.map((tab) => plain('meadow', tab)) }],
      count: grove.meadow.tabs.length,
    });
  }
  if (grove.fog && grove.fog.length > 0) {
    groups.push({
      id: 'fog',
      kind: 'fog',
      name: 'Unclear',
      pending: false,
      sections: [{ label: '', rows: grove.fog.map((item) => plain('fog', item.tab, item.reason)) }],
      count: grove.fog.length,
    });
  }
  return groups;
}

/** What a group is, in a few words, for the line under its name. */
export function groupNote(group: TabGroup): string {
  const tabs = plural(group.count, 'tab');
  if (group.kind === 'tree') return group.pending ? `Listening… · ${tabs}` : `Goal · ${tabs}`;
  if (group.kind === 'sprout') return `Sprout, not yet a goal · ${tabs}`;
  if (group.kind === 'meadow') return `No goal · ${tabs}`;
  return `Could not be placed · ${tabs}`;
}
