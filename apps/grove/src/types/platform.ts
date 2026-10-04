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

// Timeline (connection C7, contracts/timeline.example.json). Durations are
// whole milliseconds so sums stay exact; the screen converts to minutes.
export interface TimelineTab {
  tab_ref: string;
  domain: string;
  title: string;
  active_ms: number;
}

/** Attention on one branch during one bucket. `t` is the bucket's start, in UTC. */
export interface TimelinePoint {
  t: string;
  active_ms: number;
  tabs: TimelineTab[];
}

export interface TimelineLane {
  /** Branch label. Null collects project tabs that sit on no branch. */
  branch: string | null;
  status: 'active' | 'explored';
  active_ms: number;
  points: TimelinePoint[];
}

export interface TimelineSwitches {
  t: string;
  tab_switches: number;
  intent_switches: number;
  unassigned_switches: number;
}

/** When a question first appeared, or when a decision was made. */
export interface TimelineMarker {
  kind: 'question' | 'decision';
  t: string;
  id: string;
  text: string;
  provenance?: 'stated' | 'sourced' | 'inferred' | 'hypothesis';
  status?: 'open' | 'resolved';
}

export interface TimelineResponse {
  project_id: string;
  name: string;
  range: string;
  /** Bucket width, e.g. "30m". */
  bucket: string;
  from: string;
  to: string;
  lanes: TimelineLane[];
  switches: TimelineSwitches[];
  markers: TimelineMarker[];
  totals: {
    active_ms: number;
    tab_switches: number;
    intent_switches: number;
    unassigned_switches: number;
  };
}

export type TimelineResult =
  | { status: 'ok'; timeline: TimelineResponse }
  /** The memory store is down (503); the API says when to ask again. */
  | { status: 'reconnecting'; retryAfterMs: number }
  /** The project is unknown to the server, e.g. a tree planted a moment ago. */
  | { status: 'not-found' };

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
