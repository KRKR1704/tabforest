import {
  GroveResponse,
  UpdateClaimResponse,
  AssignTabResponse,
  AddNoteResponse,
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

export const mockSnapshot: SnapshotPayload = {
  captured_at: '2026-10-04T14:30:00Z',
  tabs: [
    {
      tab_ref: 't1',
      domain: 'fastapi.tiangolo.com',
      title: 'Security - FastAPI',
      opener_tab_ref: null,
      opened_at: '2026-10-04T13:45:00Z',
      active: false,
      pinned: false,
      dup_key: '9a7f3e1b4c6d',
      search_query: null,
    },
    {
      tab_ref: 't2',
      domain: 'github.com',
      title: 'tiangolo/fastapi: JWT authentication example',
      opener_tab_ref: 't1',
      opened_at: '2026-10-04T13:50:00Z',
      active: false,
      pinned: false,
      dup_key: '8b6e2d1a3c5f',
      search_query: null,
    },
    {
      tab_ref: 't3',
      domain: 'jwt.io',
      title: 'JWT.IO - JSON Web Tokens Introduction',
      opener_tab_ref: 't2',
      opened_at: '2026-10-04T13:55:00Z',
      active: true,
      pinned: false,
      dup_key: '7c5d1b2a4e6e',
      search_query: null,
    },
    {
      tab_ref: 't4',
      domain: 'auth0.com',
      title: 'OAuth 2.0 and OpenID Connect Overview',
      opener_tab_ref: null,
      opened_at: '2026-10-04T14:00:00Z',
      active: false,
      pinned: false,
      dup_key: '6b4c0a1f3e5d',
      search_query: null,
    },
    {
      tab_ref: 't5',
      domain: 'stackoverflow.com',
      title: 'Where to store JWT refresh tokens in React app?',
      opener_tab_ref: 't3',
      opened_at: '2026-10-04T14:05:00Z',
      active: false,
      pinned: false,
      dup_key: '5a3b9f0e2d4c',
      search_query: null,
    },
    {
      tab_ref: 't6',
      domain: 'redis.io',
      title: 'Session Management with Redis',
      opener_tab_ref: null,
      opened_at: '2026-10-04T14:10:00Z',
      active: false,
      pinned: false,
      dup_key: '4f2a8e9d1c3b',
      search_query: null,
    },
    {
      tab_ref: 't7',
      domain: 'medium.com',
      title: 'FastAPI Auth in 5 Minutes',
      opener_tab_ref: 't1',
      opened_at: '2026-10-04T14:12:00Z',
      active: false,
      pinned: false,
      dup_key: '3e1f7d8c0b2a',
      search_query: null,
    },
    {
      tab_ref: 't8',
      domain: 'dev.to',
      title: 'FastAPI Auth in 5 Minutes (Mirror)',
      opener_tab_ref: 't7',
      opened_at: '2026-10-04T14:15:00Z',
      active: false,
      pinned: false,
      dup_key: '3e1f7d8c0b2a',
      search_query: null,
    },
  ],
};

export const mockGroveResponse: GroveResponse = {
  schema_version: '1.0',
  run_id: 'run-7f8a9b0c-1d2e-3f4a-5b6c-7d8e9f0a1b2c',
  generated_at: '2026-10-04T14:30:05Z',
  degraded: false,
  hollow_count: 3,
  trees: [
    {
      cluster_ref: 'c1',
      project: {
        id: 'p-backend-auth',
        name: 'Backend Authentication',
        is_existing_project_id: null,
      },
      status: 'active',
      attention_minutes: 42.5,
      last_active_at: '2026-10-04T14:28:00Z',
      goal: {
        text: 'Choose an authentication architecture for the application',
        confidence: 0.82,
        provenance: 'inferred',
        evidence: [
          { ref: 't1', why: 'official security docs, 9.5 min' },
          { ref: 'q1', why: 'search: jwt vs session auth fastapi' },
        ],
      },
      branches: [
        {
          branch_ref: 'b1',
          label: 'JWT',
          status: 'active',
          tab_refs: ['t2', 't3', 't7', 't8'],
          recency_minutes: 5,
        },
        {
          branch_ref: 'b2',
          label: 'OAuth 2.0',
          status: 'explored',
          tab_refs: ['t4'],
          recency_minutes: 30,
        },
        {
          branch_ref: 'b3',
          label: 'Sessions',
          status: 'explored',
          tab_refs: ['t6'],
          recency_minutes: 20,
        },
      ],
      current_direction: {
        text: 'JWT appears to be the preferred approach',
        provenance: 'inferred',
        confidence: 0.71,
        evidence: [
          { ref: 't3', why: '14 min dwell, 3 revisits' },
          { ref: 't2', why: 'opened JWT example' },
        ],
      },
      decisions: [
        {
          id: 'dec-1',
          text: 'Not using OAuth providers for v1',
          provenance: 'stated',
          user_note_id: 'n7',
          quote: null,
          confidence: 1.0,
          evidence: [{ ref: 'n7', why: 'user note' }],
        },
      ],
      unresolved_questions: [
        {
          id: 'q-1',
          question: 'Where should refresh tokens be stored securely?',
          kind: 'repeated_search',
          confidence: 0.78,
          status: 'open',
          recurrence_count: 4,
          evidence: [
            { ref: 'q2', why: '4 rephrasings in 40 min' },
            { ref: 't5', why: 'short visit' },
          ],
        },
      ],
      blockers: [],
      next_actions: [
        {
          id: 'act-1',
          action: 'Prototype a refresh-token flow using HttpOnly, SameSite=strict cookies',
          unblocks: 'q-1',
          reason: 'most-searched open question',
          confidence: 0.66,
        },
      ],
      redundant_groups: [
        {
          tab_refs: ['t7', 't8'],
          keep_ref: 't1',
          reason: 'Both restate the official docs token section',
          is_exact_dup: false,
        },
      ],
      important_tab_refs: ['t1', 't3', 't2', 't4'],
      hypotheses: [
        {
          text: 'May later host auth on Azure',
          confidence: 0.41,
          evidence: [{ ref: 't9', why: 'opened once' }],
        },
      ],
      tabs: [
        {
          tab_ref: 't1',
          domain: 'fastapi.tiangolo.com',
          title: 'Security - FastAPI',
          dwell_minutes: 9.5,
          is_open: true,
          importance: 0.92,
          source_type: 'docs',
        },
        {
          tab_ref: 't2',
          domain: 'github.com',
          title: 'tiangolo/fastapi: JWT authentication example',
          dwell_minutes: 6.2,
          is_open: true,
          importance: 0.81,
          source_type: 'code',
        },
        {
          tab_ref: 't3',
          domain: 'jwt.io',
          title: 'JWT.IO - JSON Web Tokens Introduction',
          dwell_minutes: 14.0,
          is_open: true,
          importance: 0.88,
          source_type: 'docs',
        },
        {
          tab_ref: 't4',
          domain: 'auth0.com',
          title: 'OAuth 2.0 and OpenID Connect Overview',
          dwell_minutes: 4.1,
          is_open: true,
          importance: 0.65,
          source_type: 'docs',
        },
        {
          tab_ref: 't5',
          domain: 'stackoverflow.com',
          title: 'Where to store JWT refresh tokens in React app?',
          dwell_minutes: 2.3,
          is_open: true,
          importance: 0.72,
          source_type: 'qa',
        },
        {
          tab_ref: 't6',
          domain: 'redis.io',
          title: 'Session Management with Redis',
          dwell_minutes: 3.4,
          is_open: true,
          importance: 0.58,
          source_type: 'docs',
        },
        {
          tab_ref: 't7',
          domain: 'medium.com',
          title: 'FastAPI Auth in 5 Minutes',
          dwell_minutes: 1.2,
          is_open: true,
          importance: 0.35,
          source_type: 'discussion',
        },
        {
          tab_ref: 't8',
          domain: 'dev.to',
          title: 'FastAPI Auth in 5 Minutes',
          dwell_minutes: 0.8,
          is_open: true,
          importance: 0.31,
          source_type: 'discussion',
        },
      ],
    },
    {
      cluster_ref: 'c2',
      project: {
        id: 'p-hackathon-prep',
        name: 'GirlHacks 2026 Submission',
        is_existing_project_id: null,
      },
      status: 'active',
      attention_minutes: 28.0,
      last_active_at: '2026-10-04T14:20:00Z',
      goal: {
        text: 'Complete Devpost submission requirements and track criteria',
        confidence: 0.89,
        provenance: 'inferred',
        evidence: [{ ref: 't10', why: 'Devpost portal rules' }],
      },
      branches: [
        {
          branch_ref: 'b4',
          label: 'Devpost & Guidelines',
          status: 'active',
          tab_refs: ['t10', 't11'],
          recency_minutes: 10,
        },
      ],
      current_direction: {
        text: 'Targeting Azure AI track and Tiger Data memory track',
        provenance: 'stated',
        confidence: 1.0,
        evidence: [{ ref: 'n2', why: 'user note' }],
      },
      decisions: [
        {
          id: 'dec-2',
          text: 'Build pitch video with live demo recording',
          provenance: 'stated',
          user_note_id: 'n3',
          confidence: 1.0,
          evidence: [{ ref: 'n3', why: 'team note' }],
        },
      ],
      unresolved_questions: [],
      blockers: [],
      next_actions: [
        {
          id: 'act-2',
          action: 'Record 2-minute demo video following script',
          reason: 'submission deadline requirement',
          confidence: 0.95,
        },
      ],
      redundant_groups: [],
      important_tab_refs: ['t10', 't11'],
      hypotheses: [],
      tabs: [
        {
          tab_ref: 't10',
          domain: 'girlhacks2026.devpost.com',
          title: 'GirlHacks 2026 Devpost Submission Rules',
          dwell_minutes: 18.0,
          is_open: true,
          importance: 0.95,
          source_type: 'work-tool',
        },
        {
          tab_ref: 't11',
          domain: 'github.com',
          title: 'tabforest/tabforest: README and Setup',
          dwell_minutes: 10.0,
          is_open: true,
          importance: 0.85,
          source_type: 'code',
        },
      ],
    },
    {
      cluster_ref: 'c3',
      project: {
        id: 'p-job-search',
        name: 'Summer 2027 Internships',
        is_existing_project_id: null,
      },
      status: 'dormant',
      attention_minutes: 15.2,
      last_active_at: '2026-10-01T10:00:00Z',
      goal: {
        text: 'Research distributed systems internships',
        confidence: 0.75,
        provenance: 'inferred',
        evidence: [{ ref: 't12', why: 'careers page' }],
      },
      branches: [
        {
          branch_ref: 'b5',
          label: 'Job Listings',
          status: 'explored',
          tab_refs: ['t12', 't13'],
          recency_minutes: 4320,
        },
      ],
      current_direction: {
        text: 'Reviewed 4 listings; resume needs distributed systems bullet',
        provenance: 'inferred',
        confidence: 0.65,
        evidence: [{ ref: 't12', why: 'job description focus' }],
      },
      decisions: [],
      unresolved_questions: [
        {
          id: 'q-3',
          question: 'Is graduation date within the May 2027 window?',
          kind: 'unresolved_comparison',
          confidence: 0.7,
          status: 'open',
          recurrence_count: 1,
          evidence: [{ ref: 't13', why: 'eligibility check' }],
        },
      ],
      blockers: [],
      next_actions: [],
      redundant_groups: [],
      important_tab_refs: ['t12'],
      hypotheses: [],
      tabs: [
        {
          tab_ref: 't12',
          domain: 'careers.microsoft.com',
          title: 'Software Engineering Intern - Cloud & AI',
          dwell_minutes: 11.2,
          is_open: false,
          importance: 0.88,
          source_type: 'work-tool',
        },
        {
          tab_ref: 't13',
          domain: 'levels.fyi',
          title: 'Software Engineer Intern Salaries & Roles',
          dwell_minutes: 4.0,
          is_open: false,
          importance: 0.6,
          source_type: 'discussion',
        },
      ],
    },
  ],
  meadow: {
    label: 'Wildflower Meadow',
    tabs: [
      {
        tab_ref: 't14',
        domain: 'open.spotify.com',
        title: 'Deep Focus Playlist',
        dwell_minutes: 25.0,
        is_open: true,
        importance: 0.2,
        source_type: 'video',
      },
      {
        tab_ref: 't15',
        domain: 'weather.com',
        title: 'Newark, NJ Weather Forecast',
        dwell_minutes: 0.5,
        is_open: false,
        importance: 0.1,
        source_type: 'search',
      },
    ],
  },
  sprouts: [
    {
      sprout_ref: 'sp-1',
      label: 'Timescale Vector indexing',
      tab_count: 2,
      age_minutes: 12,
      tabs: [
        {
          tab_ref: 't16',
          domain: 'docs.timescale.com',
          title: 'DiskANN Indexing on Timescale Vector',
          dwell_minutes: 2.1,
          is_open: true,
        },
      ],
    },
  ],
  past_connections: [
    {
      tree_cluster_ref: 'c1',
      past_project_id: 'proj-march12',
      past_project_title: 'Backend Scaling - March 12',
      similarity: 0.84,
      summary: 'Researched session cookies vs token storage; chose Redis backplane.',
    },
  ],
};

export const mockClaimsResponse: {
  updateClaim: UpdateClaimResponse;
  assignTab: AssignTabResponse;
  addNote: AddNoteResponse;
} = {
  updateClaim: {
    id: 'dec-1',
    status: 'confirmed',
    provenance: 'stated',
    user_note_id: 'n7',
    confirmed_at: '2026-10-04T14:35:00Z',
  },
  assignTab: {
    tab_ref: 't5',
    cluster_id: 'c1',
    branch_id: 'b1',
    assigned_by: 'user',
    pinned: true,
  },
  addNote: {
    note_id: 'n8',
    cluster_id: 'c1',
    text: 'Named goal: finalize auth library by tonight',
    created_at: '2026-10-04T14:36:00Z',
    cleared_fog: true,
  },
};

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
