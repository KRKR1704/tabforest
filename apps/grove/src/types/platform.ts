export interface UserProfile {
  id: string;
  display_name: string;
  email: string;
  created_at: string;
  privacy: PrivacySettings;
  stats?: {
    total_forests: number;
    active_goals: number;
    total_attention_hours: number;
    total_resolved_questions: number;
  };
}

export interface PrivacySettings {
  user_id?: string;
  excluded_domains: string[];
  paused_until: string | null;
  retention_days: number;
  cloud_ai_enabled: boolean;
  hollow_categories?: string[];
}

export interface BrowserSession {
  id: string;
  started_at: string;
  ended_at: string;
  duration_minutes: number;
  event_count: number;
  tab_switches: number;
  intent_switches: number;
  dominant_project?: string;
  unassigned_switches?: number;
}

export interface TimelineMarker {
  type: 'question' | 'decision' | 'note';
  id: string;
  label: string;
  ts: string;
}

export interface TimelineBucket {
  time: string;
  branch_ref: string;
  branch_label: string;
  minutes: number;
  tab_switches: number;
  intent_switches: number;
  tabs: Array<{
    tab_ref: string;
    domain: string;
    minutes: number;
  }>;
  markers: TimelineMarker[];
}

export interface TimelineResponse {
  project_id: string;
  project_name: string;
  range: string;
  buckets: TimelineBucket[];
}

export interface SavedContextItem {
  id: string;
  project_id: string;
  project_name: string;
  title: string;
  kind: 'resume' | 'references';
  saved_at: string;
  last_resumed_at?: string | null;
  time_invested_minutes: number;
  session_count: number;
  open_question_count: number;
  goal_summary: string;
  important_tab_count: number;
  total_tab_count: number;
}

export interface ResumeCardData {
  context_id: string;
  project_name: string;
  goal: string;
  direction: string;
  last_active: string;
  time_invested_text: string;
  open_questions: string[];
  next_action: string;
  important_tabs: Array<{
    tab_ref: string;
    title: string;
    domain: string;
    fallback_url?: string;
  }>;
  all_tabs: Array<{
    tab_ref: string;
    title: string;
    domain: string;
    fallback_url?: string;
  }>;
}
