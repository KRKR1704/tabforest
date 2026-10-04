import React, { useCallback, useMemo, useState } from 'react';
import type { EvidenceRef, GroveResponse, GroveTab, TreeData } from '../types';
import type { EvidenceClaim } from '../components/EvidenceDrawer';
import { TreeDetailDrawer, type ActiveClaim } from '../components/TreeDetailDrawer';
import { PruneDialog } from '../components/PruneDialog';
import { TabsPanel, type TabHover } from '../components/TabsPanel';
import { listTabs } from '../lib/tabList';
import { hypothesisId } from '../lib/groveEdits';
import { GroveCanvas, type GroveRoots } from '../viz/GroveCanvas';
import type { LeafDrop } from '../viz/render';
import { describeSelection, type GroveSelection } from '../viz/selection';
import { GroveOutline } from './GroveOutline';
import { useGroveActions } from './useGroveActions';
import { NOTICES } from '../grow/controller';
import { useGroveStore } from '../store/useGroveStore';
import { countGroveTabs } from '../lib/grove';

interface CurrentGroveProps {
  grove: GroveResponse | null;
  onShowEvidence: (claim: EvidenceClaim, tabs: GroveTab[]) => void;
  onHideEvidence?: () => void;
  /** Open a saved grove, e.g. the one a firefly leads to. */
  onResume?: (contextId: string) => Promise<boolean>;
}

type GroveView = 'grove' | 'outline';

const VIEWS: Array<{ id: GroveView; label: string }> = [
  { id: 'grove', label: 'Grove' },
  { id: 'outline', label: 'Outline' },
];

const captionButton =
  'rounded-sm border border-forest-700 px-2 py-0.5 text-xs text-forest-200 hover:border-forest-500 hover:text-forest-50';
const captionInput =
  'w-full rounded-sm border border-forest-700 bg-forest-950 px-2 py-1.5 text-sm text-forest-50 placeholder:text-forest-500';

/** The leaves a claim's evidence points at: tabs directly, and the tabs of a search family. */
function evidenceTabRefs(tree: TreeData, evidence: EvidenceRef[]): string[] {
  return evidence.flatMap((item) => {
    if (item.ref_kind === 'query') {
      return tree.query_families?.find((family) => family.id === item.ref)?.tab_refs ?? [];
    }
    if (item.ref_kind === 'note' || item.ref_kind === 'document') return [];
    return [item.ref];
  });
}

/** The claim a clicked stone, mushroom, flower or hypothesis stands for. */
function claimFor(selection: GroveSelection): ActiveClaim | null {
  if (selection.kind === 'stone') return { id: selection.id, anchor: 'stone' };
  if (selection.kind === 'mushroom' || selection.kind === 'flower') {
    return { id: selection.id, anchor: 'mushroom' };
  }
  if (selection.kind === 'hypothesis') return { id: selection.id, anchor: 'trunk' };
  return null;
}

/** A claim's evidence as the tree holds it now, so roots follow an edit. */
function evidenceOf(tree: TreeData, claimId: string): EvidenceRef[] | null {
  if (tree.goal.id === claimId) return tree.goal.evidence;
  if (tree.current_direction.id === claimId) return tree.current_direction.evidence;
  const claim =
    tree.decisions.find((d) => d.id === claimId) ??
    tree.unresolved_questions.find((q) => q.id === claimId) ??
    tree.next_actions.find((a) => a.id === claimId) ??
    tree.hypotheses.find((h, i) => hypothesisId(tree, h, i) === claimId);
  return claim ? claim.evidence ?? [] : null;
}

const OPENS_DETAIL = new Set(['tree', 'stone', 'mushroom', 'flower', 'hypothesis']);

export const CurrentGrove: React.FC<CurrentGroveProps> = ({
  grove,
  onShowEvidence,
  onHideEvidence,
  onResume,
}) => {
  const [view, setView] = useState<GroveView>('grove');
  const [pruning, setPruning] = useState(false);
  const [tabsOpen, setTabsOpen] = useState(false);
  const [hoveredTab, setHoveredTab] = useState<TabHover | null>(null);
  const [selection, setSelection] = useState<GroveSelection | null>(null);
  const [detailTreeId, setDetailTreeId] = useState<string | null>(null);
  const [activeClaim, setActiveClaim] = useState<ActiveClaim | null>(null);
  const [pendingNewTree, setPendingNewTree] = useState<{ tabRef: string; fromTreeId: string } | null>(
    null
  );
  const [draft, setDraft] = useState('');
  const actions = useGroveActions();
  const groveNotice = useGroveStore((state) => state.groveNotice);
  const isGrowing = useGroveStore((state) => state.isStreaming);
  const growSeq = useGroveStore((state) => state.growSeq);

  const detailTree = grove?.trees.find((tree) => tree.cluster_ref === detailTreeId) ?? null;

  const roots = useMemo<GroveRoots | null>(() => {
    if (!detailTree || !activeClaim) return null;
    const evidence = evidenceOf(detailTree, activeClaim.id);
    if (!evidence) return null;
    return {
      treeId: detailTree.cluster_ref,
      anchor: { kind: activeClaim.anchor, id: activeClaim.id },
      tabRefs: evidenceTabRefs(detailTree, evidence),
    };
  }, [detailTree, activeClaim]);

  const closeDetail = useCallback(() => {
    setDetailTreeId(null);
    setActiveClaim(null);
  }, []);

  // The hovered tab's copies on the same tree are lit along with it.
  const tabHighlight = useMemo(() => {
    if (!hoveredTab || !grove) return null;
    const row = listTabs(grove)
      .flatMap((group) => group.sections.flatMap((section) => section.rows))
      .find((item) => item.tabRef === hoveredTab.tabRef && (!hoveredTab.treeId || item.treeId === hoveredTab.treeId));
    return { ...hoveredTab, copyRefs: row?.duplicateRefs ?? [] };
  }, [grove, hoveredTab]);

  const tabTotal = countGroveTabs(grove);
  if (!grove || (grove.trees.length === 0 && tabTotal === 0)) {
    return (
      <div className="mx-auto max-w-2xl px-8 py-12">
        {groveNotice && (
          <p role="alert" className="mb-6 text-sm text-amberCanopy-light">
            {groveNotice}
          </p>
        )}
        <p className="font-serif text-lg text-forest-100">
          {isGrowing ? 'Reading your open tabs…' : 'No grove yet.'}
        </p>
        <p className="mt-2 text-sm text-forest-400">
          {isGrowing
            ? 'Your grove will start growing in a moment.'
            : 'Open at least two tabs, then press “Grow grove”.'}
        </p>
      </div>
    );
  }

  // Seedling mode says so in words; so does a grove that is not fresh.
  const banner = groveNotice ?? (grove.degraded ? grove.banner_text || NOTICES.degraded : null);

  // Too little to tell goals apart (SPEC §13): the tabs show as sprouts and the grove says why.
  const learning = !isGrowing && (grove.trees.length === 0 || tabTotal <= 3);

  const selected = selection ? describeSelection(grove, selection) : null;
  const showsDetail = selection !== null && OPENS_DETAIL.has(selection.kind);

  const handleSelect = (next: GroveSelection | null) => {
    setSelection(next);
    setPendingNewTree(null);
    setDraft('');
    actions.setNotice(null);
    onHideEvidence?.();
    if (!next) return;

    // A tree, or a claim standing at its base, opens Tree Detail on that tree.
    const tree = grove.trees.find((t) => t.cluster_ref === next.treeId);
    // A tree that is still listening has nothing to detail yet.
    if (tree?.pending && OPENS_DETAIL.has(next.kind)) return;
    if (tree && OPENS_DETAIL.has(next.kind)) {
      setDetailTreeId(tree.cluster_ref);
      setActiveClaim(claimFor(next));
      return;
    }
    if (next.kind === 'leaf' || next.kind === 'fallen-leaf') actions.openTab(next.id);
    // A vine marks redundant tabs: it opens the prune suggestions.
    if (next.kind === 'vine') setPruning(true);
  };

  const handleDrop = (drop: LeafDrop) => {
    actions.setNotice(null);
    if (drop.target.kind === 'new') {
      setSelection(null);
      setDraft('');
      setPendingNewTree({ tabRef: drop.tabRef, fromTreeId: drop.fromTreeId });
      return;
    }
    void actions.move(drop.tabRef, drop.fromTreeId, {
      projectId: drop.target.treeId,
      branchLabel: drop.target.branchLabel,
    });
  };

  const submitNewTree = (event: React.FormEvent) => {
    event.preventDefault();
    const name = draft.trim();
    if (!name || !pendingNewTree) return;
    void actions.move(pendingNewTree.tabRef, pendingNewTree.fromTreeId, { newProjectName: name });
    setPendingNewTree(null);
    setDraft('');
  };

  const submitClearFog = (event: React.FormEvent) => {
    event.preventDefault();
    const goal = draft.trim();
    if (!goal || !selection) return;
    void actions.clearFog(selection.id, goal);
    setSelection(null);
    setDraft('');
  };

  const caption = selected && !showsDetail ? selected : null;

  return (
    <div className="flex h-full flex-col">
      <div
        role="group"
        aria-label="Grove view"
        className="flex shrink-0 items-center gap-5 border-b border-forest-800 px-6"
      >
        {VIEWS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={view === option.id}
            onClick={() => setView(option.id)}
            className={`-mb-px border-b-2 py-2 text-sm ${
              view === option.id
                ? 'border-forest-400 font-medium text-forest-50'
                : 'border-transparent text-forest-300 hover:text-forest-100'
            }`}
          >
            {option.label}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-2">
          {view === 'grove' && (
            <button
              type="button"
              className={captionButton}
              aria-pressed={tabsOpen}
              onClick={() => {
                setTabsOpen(!tabsOpen);
                setHoveredTab(null);
              }}
            >
              {tabsOpen ? 'Hide tabs' : 'Show tabs'}
            </button>
          )}
          <button type="button" className={captionButton} onClick={() => setPruning(true)}>
            Review tabs to prune
          </button>
        </span>
      </div>

      {banner && (
        <p
          role="alert"
          className="shrink-0 border-b border-forest-800 bg-forest-900 px-6 py-2 text-sm text-amberCanopy-light"
        >
          {banner}
        </p>
      )}

      {learning && (
        <div role="status" className="shrink-0 border-b border-forest-800 px-6 py-4">
          <p className="font-serif text-lg text-forest-50">TabForest learns as you browse</p>
          <p className="mt-1 max-w-2xl text-sm text-forest-300">
            {tabTotal <= 3
              ? `With only ${tabTotal} ${tabTotal === 1 ? 'tab' : 'tabs'} open there is not enough yet to tell your goals apart.`
              : 'No goal stands out among these tabs yet.'}{' '}
            {grove.trees.length === 0
              ? 'They are shown as they are, with no goal guessed for them.'
              : 'What is shown is a first reading and may change.'}{' '}
            Keep browsing, then grow again.
          </p>
        </div>
      )}

      <div className="min-h-0 flex-1">
        {view === 'grove' ? (
          <div className="flex h-full">
            {tabsOpen && (
              <TabsPanel
                grove={grove}
                hovered={hoveredTab}
                onHover={setHoveredTab}
                onOpenTab={actions.openTab}
                onClose={() => {
                  setTabsOpen(false);
                  setHoveredTab(null);
                }}
              />
            )}
            <div className="relative min-w-0 flex-1">
              <GroveCanvas
                grove={grove}
                selected={selection}
                onSelect={handleSelect}
                onDropLeaf={handleDrop}
                roots={roots}
                focusTreeId={detailTreeId}
                growKey={growSeq}
                highlight={tabsOpen ? tabHighlight : null}
                onHoverLeaf={tabsOpen ? setHoveredTab : undefined}
              />

              {(caption || pendingNewTree || actions.notice) && (
                <div
                  role="status"
                  className="absolute bottom-4 left-4 w-80 rounded-md border border-forest-800 bg-forest-900 px-4 py-3"
                >
                  {pendingNewTree ? (
                    <form onSubmit={submitNewTree} className="space-y-2">
                      <label className="block">
                        <span className="text-xs font-medium uppercase tracking-wider text-forest-400">
                          Name the new tree
                        </span>
                        <input
                          autoFocus
                          value={draft}
                          onChange={(event) => setDraft(event.target.value)}
                          placeholder="What is this tab for?"
                          className={`mt-1 ${captionInput}`}
                        />
                      </label>
                      <div className="flex gap-2">
                        <button type="submit" className={captionButton}>
                          Plant tree
                        </button>
                        <button
                          type="button"
                          className={captionButton}
                          onClick={() => setPendingNewTree(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    caption && (
                      <>
                        <p className="text-xs font-medium uppercase tracking-wider text-forest-400">
                          {caption.label}
                        </p>
                        <p className="mt-1 font-serif text-forest-50">{caption.text}</p>
                        {caption.detail && (
                          <p className="mt-1 text-xs text-forest-300">{caption.detail}</p>
                        )}
                        {caption.domain && (
                          <button
                            type="button"
                            className={`mt-2 ${captionButton}`}
                            onClick={() => void actions.excludeDomain(caption.domain ?? '')}
                          >
                            Exclude {caption.domain}
                          </button>
                        )}
                        {caption.contextId && onResume && (
                          <button
                            type="button"
                            className={`mt-2 ${captionButton}`}
                            onClick={() =>
                              void onResume(caption.contextId as string).then((ok) => {
                                if (!ok) actions.setNotice('That grove could not be opened.');
                              })
                            }
                          >
                            Open that grove
                          </button>
                        )}
                        {caption.inFog && (
                          <form onSubmit={submitClearFog} className="mt-3 space-y-2">
                            <label className="block">
                              <span className="sr-only">Goal of this tab</span>
                              <input
                                value={draft}
                                onChange={(event) => setDraft(event.target.value)}
                                placeholder="What was this tab for?"
                                className={captionInput}
                              />
                            </label>
                            <button type="submit" className={captionButton}>
                              Clear the fog
                            </button>
                          </form>
                        )}
                      </>
                    )
                  )}
                  {actions.notice && (
                    <p
                      data-notice
                      className={`text-sm text-forest-200 ${caption || pendingNewTree ? 'mt-2' : ''}`}
                    >
                      {actions.notice}
                    </p>
                  )}
                </div>
              )}
            </div>

            {detailTree && (
              <TreeDetailDrawer
                tree={detailTree}
                activeClaimId={activeClaim?.id ?? null}
                onActivateClaim={setActiveClaim}
                onPatchClaim={(claimId, body) => {
                  if (body.action === 'dismiss' && activeClaim?.id === claimId) setActiveClaim(null);
                  void actions.patch(claimId, body);
                }}
                onAddNote={(kind, text) => void actions.addNote(detailTree.cluster_ref, kind, text)}
                onOpenTab={actions.openTab}
                onExcludeDomain={(domain) => void actions.excludeDomain(domain)}
                onSaveContext={() => void actions.saveContext(detailTree)}
                onClose={closeDetail}
              />
            )}
          </div>
        ) : (
          <div className="h-full overflow-y-auto">
            <GroveOutline grove={grove} onShowEvidence={onShowEvidence} onOpenTab={actions.openTab} />
          </div>
        )}
      </div>

      {pruning && (
        <PruneDialog
          grove={grove}
          onClose={() => setPruning(false)}
          onDone={(message) => {
            setPruning(false);
            setSelection(null);
            actions.setNotice(message);
          }}
        />
      )}
    </div>
  );
};
