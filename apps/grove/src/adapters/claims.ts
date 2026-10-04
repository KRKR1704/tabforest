// Claims, assign, notes and project analyze (connection C4). Wire shapes follow
// contracts/claims.example.json; anything that differs is absorbed here.
import type {
  AssignResult,
  AssignTarget,
  ClaimPatchBody,
  ClaimUpdate,
  NoteBody,
  NoteResult,
  TreeData,
} from '../types';
import { apiBaseUrl, authHeaders, isMockMode } from './grove';
import { normalizeTree, type WireEvidence, type WireTree } from './groveContract';

/** PATCH /api/claims/{id} returns the claim in its grove shape, or a dismissal. */
export interface WireClaimResponse {
  id: string;
  status?: 'open' | 'resolved' | 'dismissed';
  text?: string;
  display_text?: string;
  provenance?: ClaimUpdate['provenance'];
  confidence?: number;
  evidence?: WireEvidence[];
  /** carved / mossy on a stone; the question kind on a mushroom. */
  kind?: string;
  user_note_id?: string | null;
  quote?: string | null;
  answer?: string | null;
  resolved_at?: string | null;
}

export interface WireNoteResponse {
  note: NoteResult['note'];
  project_id: string;
  claim: {
    id: string;
    text: string;
    display_text: string;
    provenance: NoteResult['claim']['provenance'];
    confidence: number;
    user_note_id?: string | null;
    evidence: WireEvidence[];
  };
}

function evidence(items: WireEvidence[]) {
  return items.map((item) => ({ ref: item.ref, why: item.why, ref_kind: item.ref_kind }));
}

export function normalizeClaimResponse(wire: WireClaimResponse): ClaimUpdate {
  if (wire.status === 'dismissed') return { id: wire.id, dismissed: true };
  const update: ClaimUpdate = { id: wire.id, dismissed: false };
  if (wire.text !== undefined) update.text = wire.text;
  if (wire.display_text !== undefined) update.display_text = wire.display_text;
  if (wire.provenance !== undefined) update.provenance = wire.provenance;
  if (wire.confidence !== undefined) update.confidence = wire.confidence;
  if (wire.evidence !== undefined) update.evidence = evidence(wire.evidence);
  if (wire.kind === 'carved' || wire.kind === 'mossy') update.stone_kind = wire.kind;
  if (wire.user_note_id !== undefined) update.user_note_id = wire.user_note_id;
  if (wire.quote !== undefined) update.quote = wire.quote;
  if (wire.status !== undefined) update.status = wire.status;
  if (wire.answer !== undefined) update.answer = wire.answer;
  if (wire.resolved_at !== undefined) update.resolved_at = wire.resolved_at;
  return update;
}

export function normalizeNoteResponse(wire: WireNoteResponse): NoteResult {
  return {
    note: wire.note,
    project_id: wire.project_id,
    claim: { ...wire.claim, evidence: evidence(wire.claim.evidence) },
  };
}

const localId = (prefix: string) => `${prefix}_local-${Date.now().toString(36)}`;

/** The stand-in server: what the real one would send back, without the evidence it adds. */
function mockClaimUpdate(id: string, body: ClaimPatchBody): ClaimUpdate {
  switch (body.action) {
    case 'dismiss':
      return { id, dismissed: true };
    case 'confirm':
      return {
        id,
        dismissed: false,
        provenance: 'stated',
        confidence: 1,
        stone_kind: 'carved',
        user_note_id: localId('n'),
      };
    case 'edit':
      return {
        id,
        dismissed: false,
        text: body.text,
        display_text: body.text,
        provenance: 'stated',
        confidence: 1,
        user_note_id: localId('n'),
      };
    case 'resolve':
      return {
        id,
        dismissed: false,
        status: 'resolved',
        answer: body.answer ?? null,
        resolved_at: new Date().toISOString(),
      };
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(await authHeaders()),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function patchClaim(id: string, body: ClaimPatchBody): Promise<ClaimUpdate> {
  if (isMockMode()) return mockClaimUpdate(id, body);
  try {
    const wire = await request<WireClaimResponse>(
      'PATCH',
      `/api/claims/${encodeURIComponent(id)}`,
      body
    );
    return normalizeClaimResponse(wire);
  } catch (err) {
    console.warn('[Claims Adapter] patchClaim failed, using the stand-in:', err);
    return mockClaimUpdate(id, body);
  }
}

function mockAssign(tabRef: string, target: AssignTarget): AssignResult {
  const isNew = 'new_project_name' in target;
  return {
    tab_ref: tabRef,
    from_project_id: '',
    project_id: isNew ? localId('p') : target.project_id,
    project_name: isNew ? target.new_project_name : '',
    branch_label: isNew ? null : target.branch_label ?? null,
    pinned: true,
    reanalyze_project_ids: [],
  };
}

export async function assignTab(tabRef: string, target: AssignTarget): Promise<AssignResult> {
  if (isMockMode()) return mockAssign(tabRef, target);
  try {
    return await request<AssignResult>(
      'POST',
      `/api/tabs/${encodeURIComponent(tabRef)}/assign`,
      target
    );
  } catch (err) {
    console.warn('[Claims Adapter] assignTab failed, using the stand-in:', err);
    return mockAssign(tabRef, target);
  }
}

function mockNote(body: NoteBody): NoteResult {
  const noteId = localId('n');
  const claimEvidence = [{ ref: noteId, ref_kind: 'note' as const, why: 'you wrote this' }];
  return {
    note: {
      id: noteId,
      kind: body.kind,
      tab_ref: body.tab_ref ?? null,
      text: body.text,
      created_at: new Date().toISOString(),
    },
    project_id: body.project_id ?? localId('p'),
    claim: {
      id: localId(body.kind === 'goal' ? 'g' : 'dec'),
      text: body.text,
      display_text: body.text,
      provenance: 'stated',
      confidence: 1,
      user_note_id: noteId,
      evidence: body.tab_ref
        ? [
            ...claimEvidence,
            { ref: body.tab_ref, ref_kind: 'tab' as const, why: 'the tab you cleared from the fog' },
          ]
        : claimEvidence,
    },
  };
}

export async function createNote(body: NoteBody): Promise<NoteResult> {
  if (isMockMode()) return mockNote(body);
  try {
    return normalizeNoteResponse(await request<WireNoteResponse>('POST', '/api/notes', body));
  } catch (err) {
    console.warn('[Claims Adapter] createNote failed, using the stand-in:', err);
    return mockNote(body);
  }
}

/**
 * POST /api/projects/{id}/analyze returns one tree. Offline there is nothing to
 * re-analyze, so the caller keeps the tree it already has.
 */
export async function analyzeTree(projectId: string): Promise<TreeData | null> {
  if (isMockMode()) return null;
  try {
    const wire = await request<WireTree>(
      'POST',
      `/api/projects/${encodeURIComponent(projectId)}/analyze`
    );
    return normalizeTree(wire, new Date().toISOString());
  } catch (err) {
    console.warn('[Claims Adapter] analyzeTree failed, keeping the current tree:', err);
    return null;
  }
}
