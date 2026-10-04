import {
  GroveResponse,
  MemorySearchResponse,
  PruneSuggestionsResponse,
  UserProfile,
  PrivacySettings,
  BrowserSession,
  TimelineResponse,
  SnapshotPayload,
} from '../types';
import groveContract from '@contracts/grove.example.json';
import snapshotContract from '@contracts/snapshot.example.json';
import timelineContract from '@contracts/timeline.example.json';
import { indexTabs, normalizeGrove, type WireGrove } from '../adapters/groveContract';

// The 28 demo tabs from the contract, as GET_SNAPSHOT returns them.
export const mockSnapshot: SnapshotPayload = {
  open_tabs: snapshotContract.open_tabs,
};

// The grove mock is the real contract example, read through the same adapter
// the live API goes through, so the mock can never drift from the contract.
export const mockGroveResponse: GroveResponse = normalizeGrove(
  groveContract as WireGrove,
  indexTabs(snapshotContract.open_tabs)
);

// The Backend Authentication timeline from the contract (its "story_24h" example).
export const mockTimelineResponse = timelineContract.examples[0].response
  .body as unknown as TimelineResponse;

export const mockMemorySearchResponse: MemorySearchResponse = {
  query: 'session storage',
  results: [
    {
      id: 'mem-1',
      project_id: 'proj-march12',
      project_name: 'Backend Scaling - March 12',
      date: '2026-03-12',
      similarity: 0.86,
      summary: 'Researched session cookies vs token storage; chose Redis backplane with 2h expiration.',
      decisions: ['Store session state in Redis rather than JWT for instant revocation'],
      attention_minutes: 54.0,
      sessions_count: 2,
    },
  ],
};

export const mockPruneSuggestionsResponse: PruneSuggestionsResponse = {
  suggestions: [
    {
      id: 'prune-1',
      kind: 'exact_duplicate',
      branch_label: 'JWT',
      tab_refs: ['t7', 't8'],
      keep_ref: 't1',
      title: 'FastAPI Auth in 5 Minutes (Duplicate)',
      domain: 'dev.to',
      reason: 'Exact mirror of previously loaded medium.com article (dup_key match)',
    },
    {
      id: 'prune-2',
      kind: 'semantic_redundancy',
      branch_label: 'JWT',
      tab_refs: ['t7'],
      keep_ref: 't1',
      title: 'FastAPI Auth in 5 Minutes',
      domain: 'medium.com',
      reason: 'Restates FastAPI official documentation with lower dwell and no unique code examples',
    },
    {
      id: 'prune-3',
      kind: 'stale',
      branch_label: 'Job Listings',
      tab_refs: ['t13'],
      keep_ref: null,
      title: 'Software Engineer Intern Salaries & Roles',
      domain: 'levels.fyi',
      reason: 'No focus in 3+ days and not cited as evidence',
    },
    {
      id: 'prune-4',
      kind: 'distraction',
      branch_label: 'Wildflower Meadow',
      tab_refs: ['t15'],
      keep_ref: null,
      title: 'Newark, NJ Weather Forecast',
      domain: 'weather.com',
      reason: 'Single tab visit under 10 seconds total focus',
    },
  ],
};

export const mockUserProfile: UserProfile = {
  id: 'usr-5d0a-9b1e-3f4a',
  display_name: 'Maya Lin',
  email: 'maya@tabforest.local',
  created_at: '2026-10-01T08:00:00Z',
  privacy: {
    excluded_domains: ['chase.com', 'bankofamerica.com', 'fidelity.com'],
    paused_until: null,
    retention_days: 30,
    cloud_ai_enabled: true,
  },
  stats: {
    total_forests: 3,
    active_goals: 2,
    total_attention_hours: 14.8,
    total_resolved_questions: 12,
  },
};

export const mockPrivacySettings: PrivacySettings = {
  user_id: 'usr-5d0a-9b1e-3f4a',
  excluded_domains: ['chase.com', 'bankofamerica.com', 'fidelity.com'],
  paused_until: null,
  retention_days: 30,
  cloud_ai_enabled: true,
  hollow_categories: [
    'banking_payments',
    'health_portals',
    'personal_email',
    'password_managers',
    'auth_identity_providers',
  ],
};

export const mockSessions: BrowserSession[] = [
  {
    id: 'sess-1',
    started_at: '2026-10-04T13:30:00Z',
    ended_at: '2026-10-04T14:30:00Z',
    duration_minutes: 60,
    event_count: 142,
    tab_switches: 24,
    intent_switches: 4,
    dominant_project: 'Backend Authentication',
    unassigned_switches: 1,
  },
  {
    id: 'sess-2',
    started_at: '2026-10-04T09:00:00Z',
    ended_at: '2026-10-04T10:45:00Z',
    duration_minutes: 105,
    event_count: 218,
    tab_switches: 38,
    intent_switches: 6,
    dominant_project: 'GirlHacks 2026 Submission',
    unassigned_switches: 2,
  },
];
