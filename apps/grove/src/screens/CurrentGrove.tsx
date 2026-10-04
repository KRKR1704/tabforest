import React, { useCallback, useMemo, useState } from 'react';
import type { EvidenceRef, GroveResponse, GroveTab, TreeData } from '../types';
import type { EvidenceClaim } from '../components/EvidenceDrawer';
import { TreeDetailDrawer, type ActiveClaim } from '../components/TreeDetailDrawer';
import { hypothesisId } from '../lib/groveEdits';
import { GroveCanvas, type GroveRoots } from '../viz/GroveCanvas';
import type { LeafDrop } from '../viz/render';
import { describeSelection, type GroveSelection } from '../viz/selection';
import { GroveOutline } from './GroveOutline';
import { useGroveActions } from './useGroveActions';
import { NOTICES } from '../grow/controller';
import { useGroveStore } from '../store/useGroveStore';

interface CurrentGroveProps {
  grove: GroveResponse | null;
  onShowEvidence: (claim: EvidenceClaim, tabs: GroveTab[]) => void;
  onHideEvidence?: () => void;
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
}) => {
  const [view, setView] = useState<GroveView>('grove');
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

  if (!grove || grove.trees.length === 0) {
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
          {isGrowing ? 'Your grove will start growing in a moment.' : 'Grow one from the tabs you have open.'}
        </p>
      </div>
    );
  }

  // Seedling mode says so in words; so does a grove that is not fresh.
  const banner = groveNotice ?? (grove.degraded ? grove.banner_text || NOTICES.degraded : null);

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
        className="flex shrink-0 gap-5 border-b border-forest-800 px-6"
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
      </div>

      {banner && (
        <p
          role="alert"
          className="shrink-0 border-b border-forest-800 bg-forest-900 px-6 py-2 text-sm text-amberCanopy-light"
        >
          {banner}
        </p>
      )}

      <div className="min-h-0 flex-1">
        {view === 'grove' ? (
          <div className="flex h-full">
            <div className="relative min-w-0 flex-1">
              <GroveCanvas
                grove={grove}
                selected={selection}
                onSelect={handleSelect}
                onDropLeaf={handleDrop}
                roots={roots}
                focusTreeId={detailTreeId}
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
            <GroveOutline grove={grove} onShowEvidence={onShowEvidence} />
          </div>
        )}
      </div>
    </div>
  );
};
