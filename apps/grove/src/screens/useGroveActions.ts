import { useCallback, useState } from 'react';
import { analyzeTree, assignTab, createNote, patchClaim } from '../adapters/claims';
import { sendBridgeMessage } from '../adapters/bridge';
import {
  addDecision,
  applyClaimUpdate,
  moveTab,
  nameFogTab,
  replaceTree,
} from '../lib/groveEdits';
import { useGroveStore } from '../store/useGroveStore';
import type { AssignTarget, ClaimPatchBody, GroveResponse, NoteKind } from '../types';

export type MoveDestination =
  | { projectId: string; branchLabel: string | null }
  | { newProjectName: string };

const PATCH_NOTICES: Record<ClaimPatchBody['action'], string> = {
  confirm: 'Confirmed. This is now stated by you.',
  edit: 'Saved in your own words.',
  dismiss: 'Dismissed.',
  resolve: 'Marked resolved.',
};

/**
 * The user's corrections to the grove: each one is sent to the API (or the
 * extension bridge) and then applied to the grove in the store.
 */
export function useGroveActions() {
  const [notice, setNotice] = useState<string | null>(null);

  // Read at the moment of the edit: an await may have let another edit land first.
  const edit = useCallback((change: (grove: GroveResponse) => GroveResponse) => {
    const { grove, setGrove } = useGroveStore.getState();
    if (grove) setGrove(change(grove));
  }, []);

  const patch = useCallback(
    async (claimId: string, body: ClaimPatchBody) => {
      const update = await patchClaim(claimId, body);
      edit((grove) => applyClaimUpdate(grove, update));
      setNotice(PATCH_NOTICES[body.action]);
      return update;
    },
    [edit]
  );

  const addNote = useCallback(
    async (treeId: string, kind: NoteKind, text: string) => {
      const result = await createNote({ kind, text, project_id: treeId });
      if (kind === 'decision') edit((grove) => addDecision(grove, treeId, result.claim));
      setNotice(kind === 'decision' ? 'Decision added as a carved stone.' : 'Note saved.');
    },
    [edit]
  );

  const clearFog = useCallback(
    async (tabRef: string, goalText: string) => {
      const result = await createNote({ kind: 'goal', tab_ref: tabRef, text: goalText });
      edit((grove) => nameFogTab(grove, tabRef, result.project_id, result.claim));
      setNotice('Fog cleared. The tab has a tree of its own now.');
      return result.project_id;
    },
    [edit]
  );

  const move = useCallback(
    async (tabRef: string, fromTreeId: string, destination: MoveDestination) => {
      const isNew = 'newProjectName' in destination;
      const target: AssignTarget = isNew
        ? { new_project_name: destination.newProjectName }
        : {
            project_id: destination.projectId,
            ...(destination.branchLabel ? { branch_label: destination.branchLabel } : {}),
          };
      const result = await assignTab(tabRef, target);

      edit((grove) =>
        moveTab(
          grove,
          tabRef,
          fromTreeId,
          isNew
            ? { projectId: result.project_id, newProjectName: destination.newProjectName }
            : { projectId: destination.projectId, branchLabel: destination.branchLabel }
        )
      );

      // The server re-reads both trees after a move; take its version when there is one.
      for (const projectId of result.reanalyze_project_ids) {
        const tree = await analyzeTree(projectId);
        if (tree) edit((grove) => replaceTree(grove, tree));
      }
      setNotice(isNew ? 'Moved to a new tree.' : 'Moved. The tab is pinned to that goal.');
      return result.project_id;
    },
    [edit]
  );

  const openTab = useCallback((tabRef: string) => {
    void sendBridgeMessage('OPEN_TAB', { tab_ref: tabRef });
  }, []);

  const excludeDomain = useCallback(async (domain: string) => {
    const response = await sendBridgeMessage('EXCLUDE_DOMAIN', { domain });
    setNotice(
      response.ok ? `${domain} will no longer be analyzed.` : `Could not exclude ${domain}.`
    );
  }, []);

  return { notice, setNotice, patch, addNote, clearFog, move, openTab, excludeDomain };
}
