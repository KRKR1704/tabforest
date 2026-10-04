import { useCallback, useState } from 'react';
import { analyzeTree, assignTab, createNote, patchClaim } from '../adapters/claims';
import { sendBridgeMessage } from '../adapters/bridge';
import { saveContext as saveContextRequest } from '../adapters/contexts';
import { buildContextCard, buildContextTabs } from '../lib/contextCard';
import {
  addDecision,
  applyClaimUpdate,
  moveTab,
  nameFogTab,
  replaceTree,
} from '../lib/groveEdits';
import { useGroveStore } from '../store/useGroveStore';
import type {
  AssignTarget,
  ClaimPatchBody,
  GetUrlsData,
  GetUrlsPayload,
  GroveResponse,
  NoteKind,
  TreeData,
} from '../types';

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

  // Save: ask the extension for the tabs' stripped URLs, then store the card and tabs.
  const saveContext = useCallback(async (tree: TreeData) => {
    const reply = await sendBridgeMessage<GetUrlsPayload, GetUrlsData>('GET_URLS', {
      tab_refs: tree.tabs.map((tab) => tab.tab_ref),
    });
    const urls = reply.ok && reply.data?.urls ? reply.data.urls : {};
    try {
      const receipt = await saveContextRequest(tree.cluster_ref, {
        kind: 'resume',
        title: tree.project.name,
        card: buildContextCard(tree),
        tabs: buildContextTabs(tree, urls),
      });
      setNotice(
        `Saved. ${receipt.important_tab_count} of ${receipt.total_tab_count} tabs are marked to reopen. Find it under Saved Groves.`
      );
      return receipt;
    } catch (err) {
      console.warn('[Save context] failed:', err);
      setNotice('Could not save this context. Nothing was stored.');
      return null;
    }
  }, []);

  return { notice, setNotice, patch, addNote, clearFog, move, openTab, excludeDomain, saveContext };
}
