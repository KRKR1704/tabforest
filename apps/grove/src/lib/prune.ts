// Pure helpers for the prune dialog (SPEC §3.5: suggest, never close).
import type { ContextTab, ExcludedReason } from '../adapters/contexts';
import type { GroveResponse, GroveTab, PruneKind, PruneSuggestion, TreeData } from '../types';

export interface TabPlace {
  tab: Pick<GroveTab, 'tab_ref' | 'title' | 'domain'>;
  /** The tree and branch the tab hangs on; absent for meadow, fog and sprout tabs. */
  tree?: TreeData;
  branchLabel?: string;
}

/** Where every tab in the grove is, by ref. A tab shared by two trees is filed under the first. */
export function placeTabs(grove: GroveResponse): Map<string, TabPlace> {
  const places = new Map<string, TabPlace>();
  for (const tree of grove.trees) {
    for (const branch of tree.branches) {
      for (const ref of branch.tab_refs) {
        const tab = tree.tabs.find((t) => t.tab_ref === ref);
        if (tab && !places.has(ref)) places.set(ref, { tab, tree, branchLabel: branch.label });
      }
    }
  }
  const loose = [
    ...grove.meadow.tabs,
    ...(grove.fog ?? []).map((item) => item.tab),
    ...grove.sprouts.flatMap((sprout) => sprout.tabs),
  ];
  for (const tab of loose) if (!places.has(tab.tab_ref)) places.set(tab.tab_ref, { tab });
  return places;
}

export const KIND_LABELS: Record<PruneKind, string> = {
  exact_duplicate: 'Exact duplicate',
  semantic_redundant: 'Says the same as another source',
  stale: 'Stale',
  distraction: 'Distraction',
};

const selectedOf = (suggestions: PruneSuggestion[], selected: ReadonlySet<string>) =>
  suggestions.filter((suggestion) => selected.has(suggestion.id));

/** The tabs "Close selected" would close: the selected suggestions' tabs, minus any source worth keeping. */
export function tabsToClose(suggestions: PruneSuggestion[], selected: ReadonlySet<string>): string[] {
  const chosen = selectedOf(suggestions, selected);
  const keep = new Set(chosen.map((s) => s.keep_ref).filter((ref): ref is string => ref !== null));
  return [...new Set(chosen.flatMap((s) => s.tab_refs))].filter((ref) => !keep.has(ref));
}

export interface BranchCut {
  tree: TreeData;
  branchLabel: string;
  tabRefs: string[];
}

/**
 * "Prune branch": the whole branches the selected suggestions sit on. Every
 * tab on such a branch goes, including the source a suggestion would keep.
 */
export function branchesToPrune(
  grove: GroveResponse,
  suggestions: PruneSuggestion[],
  selected: ReadonlySet<string>
): BranchCut[] {
  const places = placeTabs(grove);
  const cuts = new Map<string, BranchCut>();
  for (const ref of tabsToClose(suggestions, selected)) {
    const place = places.get(ref);
    if (!place?.tree || place.branchLabel === undefined) continue;
    const key = `${place.tree.cluster_ref}\u0000${place.branchLabel}`;
    if (cuts.has(key)) continue;
    const branch = place.tree.branches.find((b) => b.label === place.branchLabel);
    cuts.set(key, { tree: place.tree, branchLabel: place.branchLabel, tabRefs: branch?.tab_refs ?? [] });
  }
  return [...cuts.values()];
}

const EXCLUDED: Partial<Record<PruneKind, ExcludedReason>> = {
  exact_duplicate: 'exact_duplicate',
  semantic_redundant: 'semantic_redundant',
  stale: 'stale',
};

export interface ReferenceSet {
  tree: TreeData;
  tabs: ContextTab[];
}

/**
 * "Save as references": the tabs to close, grouped by the project they belong
 * to, in the save-context shape. A tab on no tree has no project to be saved
 * under, so it is returned separately and left open.
 */
export function referenceSets(
  grove: GroveResponse,
  suggestions: PruneSuggestion[],
  selected: ReadonlySet<string>,
  urls: Record<string, string>
): { sets: ReferenceSet[]; unsaved: string[] } {
  const places = placeTabs(grove);
  const reasonOf = new Map<string, ExcludedReason | null>();
  for (const suggestion of selectedOf(suggestions, selected)) {
    for (const ref of suggestion.tab_refs) reasonOf.set(ref, EXCLUDED[suggestion.kind] ?? null);
  }

  const sets = new Map<string, ReferenceSet>();
  const unsaved: string[] = [];
  for (const ref of tabsToClose(suggestions, selected)) {
    const place = places.get(ref);
    if (!place?.tree) {
      unsaved.push(ref);
      continue;
    }
    const set = sets.get(place.tree.cluster_ref) ?? { tree: place.tree, tabs: [] };
    set.tabs.push({
      tab_ref: ref,
      ...(urls[ref] ? { fallback_url: urls[ref] } : {}),
      domain: place.tab.domain,
      title: place.tab.title,
      important: false,
      excluded_reason: reasonOf.get(ref) ?? null,
    });
    sets.set(place.tree.cluster_ref, set);
  }
  return { sets: [...sets.values()], unsaved };
}

/** After tabs are closed their leaves stay in the grove, but no longer as open tabs. */
export function markClosed(grove: GroveResponse, refs: string[]): GroveResponse {
  const closed = new Set(refs);
  const close = <T extends { tab_ref: string; is_open: boolean }>(tab: T): T =>
    closed.has(tab.tab_ref) ? { ...tab, is_open: false } : tab;
  return {
    ...grove,
    trees: grove.trees.map((tree) => ({ ...tree, tabs: tree.tabs.map(close) })),
    meadow: { ...grove.meadow, tabs: grove.meadow.tabs.map(close) },
    sprouts: grove.sprouts.map((sprout) => ({ ...sprout, tabs: sprout.tabs.map(close) })),
    fog: grove.fog?.map((item) => ({ ...item, tab: close(item.tab) })),
  };
}
