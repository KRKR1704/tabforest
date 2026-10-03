import { Provenance } from './grove';

export interface WorkContextItemInput {
  id?: string;
  title: string;
  source_type: 'selection' | 'page_text' | 'paste' | 'upload';
  text: string;
}

export interface WorkContextDecision {
  text: string;
  provenance: Provenance;
  quote?: string;
  source_title?: string;
  timestamp?: string;
  confidence: number;
}

export interface WorkContextBlocker {
  text: string;
  provenance: Provenance;
  quote?: string;
  source_title?: string;
  severity?: 'low' | 'medium' | 'high';
}

export interface WorkContextOwner {
  name: string;
  role: string;
}

export interface WorkContextOpenQuestion {
  question: string;
  kind?: string;
  confidence?: number;
}

export interface WorkContextNextAction {
  action: string;
  priority?: number;
  owner?: string;
}

export interface WorkContextResponse {
  project: string;
  goal: string;
  decisions: WorkContextDecision[];
  blockers: WorkContextBlocker[];
  owners: WorkContextOwner[];
  open_questions: WorkContextOpenQuestion[];
  next_actions: WorkContextNextAction[];
  handoff_brief_markdown: string;
}
