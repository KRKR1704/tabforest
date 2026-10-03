import { Provenance } from './grove';

export type ClaimAction = 'confirm' | 'edit' | 'dismiss' | 'resolve';

export interface UpdateClaimRequest {
  action: ClaimAction;
  updated_text?: string;
  answer?: string | null;
}

export interface UpdateClaimResponse {
  id: string;
  status: string;
  provenance: Provenance;
  user_note_id?: string | null;
  confirmed_at?: string;
  resolved_at?: string;
  answer?: string;
}

export interface AssignTabRequest {
  target_cluster_id: string;
  target_branch_id?: string;
}

export interface AssignTabResponse {
  tab_ref: string;
  cluster_id: string;
  branch_id?: string;
  assigned_by: 'user' | 'ai';
  pinned: boolean;
}

export interface AddNoteRequest {
  cluster_id: string;
  text: string;
}

export interface AddNoteResponse {
  note_id: string;
  cluster_id: string;
  text: string;
  created_at: string;
  cleared_fog?: boolean;
}
