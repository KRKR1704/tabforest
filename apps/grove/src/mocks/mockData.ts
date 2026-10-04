import {
  GroveResponse,
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
