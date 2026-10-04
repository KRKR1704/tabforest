import {
  GroveResponse,
  MemorySearchResponse,
  PruneSuggestionsResponse,
  WorkContextResponse,
  UserProfile,
  PrivacySettings,
  BrowserSession,
  TimelineResponse,
  SavedContextItem,
  ResumeCardData,
  SnapshotPayload,
} from '../types';
import groveContract from '@contracts/grove.example.json';
import snapshotContract from '@contracts/snapshot.example.json';
import { indexTabs, normalizeGrove, type WireGrove } from '../adapters/groveContract';

// The 28 demo tabs from the contract, in this app's snapshot shape.
export const mockSnapshot: SnapshotPayload = {
  captured_at: groveContract.generated_at,
  tabs: snapshotContract.open_tabs,
};

// The grove mock is the real contract example, read through the same adapter
// the live API goes through, so the mock can never drift from the contract.
export const mockGroveResponse: GroveResponse = normalizeGrove(
  groveContract as WireGrove,
  indexTabs(snapshotContract.open_tabs)
);

export const mockTimelineResponse: TimelineResponse = {
  project_id: 'p-backend-auth',
  project_name: 'Backend Authentication',
  range: '24h',
  buckets: [
    {
      time: '2026-10-04T09:00:00Z',
      branch_ref: 'b1',
      branch_label: 'JWT',
      minutes: 15.0,
      tab_switches: 4,
      intent_switches: 0,
      tabs: [
        { tab_ref: 't1', domain: 'fastapi.tiangolo.com', minutes: 9.5 },
        { tab_ref: 't2', domain: 'github.com', minutes: 5.5 },
      ],
      markers: [
        {
          type: 'question',
          id: 'q-1',
          label: 'Where should refresh tokens be stored securely?',
          ts: '2026-10-04T09:12:00Z',
        },
      ],
    },
    {
      time: '2026-10-04T09:20:00Z',
      branch_ref: 'b2',
      branch_label: 'OAuth 2.0',
      minutes: 8.0,
      tab_switches: 2,
      intent_switches: 1,
      tabs: [{ tab_ref: 't4', domain: 'auth0.com', minutes: 8.0 }],
      markers: [],
    },
    {
      time: '2026-10-04T09:40:00Z',
      branch_ref: 'b3',
      branch_label: 'Sessions',
      minutes: 12.0,
      tab_switches: 3,
      intent_switches: 1,
      tabs: [{ tab_ref: 't6', domain: 'redis.io', minutes: 12.0 }],
      markers: [],
    },
    {
      time: '2026-10-04T10:00:00Z',
      branch_ref: 'b1',
      branch_label: 'JWT',
      minutes: 22.0,
      tab_switches: 5,
      intent_switches: 1,
      tabs: [
        { tab_ref: 't3', domain: 'jwt.io', minutes: 14.0 },
        { tab_ref: 't5', domain: 'stackoverflow.com', minutes: 8.0 },
      ],
      markers: [
        {
          type: 'decision',
          id: 'dec-1',
          label: 'Not using OAuth providers for v1',
          ts: '2026-10-04T10:14:32Z',
        },
      ],
    },
  ],
};

export const mockSavedContexts: {
  list: SavedContextItem[];
  resumeCard: ResumeCardData;
} = {
  list: [
    {
      id: 'ctx-1',
      project_id: 'p-backend-auth',
      project_name: 'Backend Authentication',
      title: 'Backend Auth Research Context',
      kind: 'resume',
      saved_at: '2026-10-04T14:40:00Z',
      last_resumed_at: null,
      time_invested_minutes: 42.5,
      session_count: 3,
      open_question_count: 1,
      goal_summary: 'Choose an authentication architecture for the application',
      important_tab_count: 4,
      total_tab_count: 8,
    },
  ],
  resumeCard: {
    context_id: 'ctx-1',
    project_name: 'Backend Authentication',
    goal: 'Choose an authentication architecture for the application',
    direction: 'JWT appears to be the preferred approach',
    last_active: '2026-10-04T14:28:00Z',
    time_invested_text: '2 h 14 m across 3 sessions',
    open_questions: ['Where should refresh tokens be stored securely?'],
    next_action: 'Prototype a refresh-token flow using HttpOnly, SameSite=strict cookies',
    important_tabs: [
      {
        tab_ref: 't1',
        title: 'Security - FastAPI',
        domain: 'fastapi.tiangolo.com',
        fallback_url: 'https://fastapi.tiangolo.com/tutorial/security/',
      },
      {
        tab_ref: 't3',
        title: 'JWT.IO - Introduction',
        domain: 'jwt.io',
        fallback_url: 'https://jwt.io/introduction',
      },
    ],
    all_tabs: [
      {
        tab_ref: 't1',
        title: 'Security - FastAPI',
        domain: 'fastapi.tiangolo.com',
        fallback_url: 'https://fastapi.tiangolo.com/tutorial/security/',
      },
      {
        tab_ref: 't2',
        title: 'tiangolo/fastapi: JWT example',
        domain: 'github.com',
        fallback_url: 'https://github.com/tiangolo/fastapi',
      },
      {
        tab_ref: 't3',
        title: 'JWT.IO - Introduction',
        domain: 'jwt.io',
        fallback_url: 'https://jwt.io/introduction',
      },
      {
        tab_ref: 't4',
        title: 'OAuth 2.0 Overview',
        domain: 'auth0.com',
        fallback_url: 'https://auth0.com/overview',
      },
    ],
  },
};

export const mockWorkContextResponse: WorkContextResponse = {
  project: 'Cloud Migration',
  goal: 'Migrate data ingestion pipeline to Azure serverless architecture',
  decisions: [
    {
      text: 'Deploy ingestion workers on Azure Functions Consumption tier',
      provenance: 'sourced',
      quote: 'We decided to deploy the ingestion workers on Azure Functions Consumption tier for v1',
      source_title: 'Teams Transcript - Architecture Sync',
      timestamp: '00:14:32',
      confidence: 0.95,
    },
  ],
  blockers: [
    {
      text: 'Production service principal credentials awaiting Infosec signoff',
      provenance: 'sourced',
      quote: 'Production service principal credentials have not been approved by Infosec',
      source_title: 'Jira CAM-142 Migration Blocker',
      severity: 'high',
    },
  ],
  owners: [
    { name: 'Infosec Team', role: 'Credential Approver' },
    { name: 'Backend Team', role: 'Function Deployment' },
  ],
  open_questions: [
    {
      question: 'What is the expected cold-start latency budget on Consumption plan?',
      kind: 'unresolved_comparison',
      confidence: 0.8,
    },
  ],
  next_actions: [
    {
      action: 'Escalate ticket CAM-142 for service principal credentials',
      priority: 1,
      owner: 'Backend Lead',
    },
  ],
  handoff_brief_markdown: `# Cloud Migration — Handoff Brief

**Goal**: Migrate data ingestion pipeline to Azure serverless architecture.

### Key Decisions
- Deploy ingestion workers on Azure Functions Consumption tier (Teams Transcript 00:14:32).

### Critical Blockers
- Production service principal credentials awaiting Infosec signoff (Jira CAM-142).

### Immediate Next Step
- Escalate ticket CAM-142 for service principal credentials.`,
};

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
