-- 200_engine_core.sql
-- Owner: R (intelligence engine). Tables from BUILD_TASKS.md §4.5.
-- Depends on: no extension (gen_random_uuid is built in). 201 needs vector + vectorscale.
-- Idempotent: CREATE ... IF NOT EXISTS only; safe to run twice. Never drops anything.
--
-- Every table has user_id uuid NOT NULL and an index leading with user_id.
-- No foreign keys to P's tables: user_id, tab_ref, session_id and saved_context_id are
-- plain uuid columns. Foreign keys only between R's own tables.
-- Ids are plain uuids; the API adds the contract prefixes (p_, dec_, q_, a_, n_, g_, r_ ...).
-- Note ids (user_note_id) are plain uuids too, so notes survive cluster re-analysis.

CREATE TABLE IF NOT EXISTS projects (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid        NOT NULL,
    name            text        NOT NULL,
    status          text        NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'dormant', 'done')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    last_active_at  timestamptz
);
CREATE INDEX IF NOT EXISTS projects_user_last_active_idx ON projects (user_id, last_active_at DESC);

-- A normal table, not a hypertable (BUILD_TASKS.md §16); AI-quality trends go to App Insights.
CREATE TABLE IF NOT EXISTS analysis_runs (
    run_id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid        NOT NULL,
    ts                timestamptz NOT NULL DEFAULT now(),
    kind              text        NOT NULL DEFAULT 'grow'
                                  CHECK (kind IN ('grow', 'analyze_project', 'work_context')),
    clusters          integer     NOT NULL DEFAULT 0 CHECK (clusters >= 0),
    model             text,
    latency_ms        integer     CHECK (latency_ms >= 0),
    llm_calls         integer     NOT NULL DEFAULT 0 CHECK (llm_calls >= 0),
    downgraded_claims integer     NOT NULL DEFAULT 0 CHECK (downgraded_claims >= 0),
    fallback_used     boolean     NOT NULL DEFAULT false,
    degraded          boolean     NOT NULL DEFAULT false,
    hollow_count      integer     CHECK (hollow_count >= 0),
    response          jsonb       -- last full response (grove or Work Context), served by GET /api/grove
);
CREATE INDEX IF NOT EXISTS analysis_runs_user_ts_idx ON analysis_runs (user_id, ts DESC);

-- One tree. Goal, direction and hypotheses are the cluster's own claims.
CREATE TABLE IF NOT EXISTS intent_clusters (
    id                    uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               uuid             NOT NULL,
    project_id            uuid             NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    analysis_run_id       uuid             REFERENCES analysis_runs (run_id) ON DELETE SET NULL,
    origin                text             NOT NULL DEFAULT 'browser' CHECK (origin IN ('browser', 'work_context')),
    label                 text,            -- deterministic name (top shared title terms), stream + Seedling
    matched_existing      boolean          NOT NULL DEFAULT false,  -- is_existing_project_id = project_id
    goal_id               uuid             NOT NULL DEFAULT gen_random_uuid(),
    goal                  text             NOT NULL,
    goal_provenance       text             NOT NULL
                                           CHECK (goal_provenance IN ('stated', 'sourced', 'inferred', 'hypothesis')),
    goal_confidence       double precision NOT NULL CHECK (goal_confidence BETWEEN 0 AND 1),
    goal_evidence         jsonb            NOT NULL DEFAULT '[]'::jsonb,
    goal_user_note_id     uuid,
    goal_quote            text,
    goal_source           text,
    goal_source_timestamp text,
    direction             jsonb,           -- claim or null
    hypotheses            jsonb            NOT NULL DEFAULT '[]'::jsonb,
    vines                 jsonb            NOT NULL DEFAULT '[]'::jsonb,
    query_families        jsonb            NOT NULL DEFAULT '[]'::jsonb,
    important_tab_refs    uuid[]           NOT NULL DEFAULT '{}',
    fogged                boolean          NOT NULL DEFAULT false,
    created_at            timestamptz      NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS intent_clusters_user_project_idx ON intent_clusters (user_id, project_id);
CREATE INDEX IF NOT EXISTS intent_clusters_user_run_idx ON intent_clusters (user_id, analysis_run_id);

CREATE TABLE IF NOT EXISTS intent_branches (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL,
    cluster_id  uuid        NOT NULL REFERENCES intent_clusters (id) ON DELETE CASCADE,
    label       text        NOT NULL,
    status      text        NOT NULL DEFAULT 'explored' CHECK (status IN ('active', 'explored')),
    position    smallint    NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS intent_branches_user_cluster_idx ON intent_branches (user_id, cluster_id);

-- Leaves. Many-to-many: one tab may sit in two clusters. Title, domain and source_type come
-- from P's browser_events/tabs (R's tabs columns); dwell from P's tab_attention_15m.
CREATE TABLE IF NOT EXISTS cluster_tabs (
    user_id      uuid             NOT NULL,
    cluster_id   uuid             NOT NULL REFERENCES intent_clusters (id) ON DELETE CASCADE,
    branch_id    uuid             REFERENCES intent_branches (id) ON DELETE SET NULL,
    tab_ref      uuid             NOT NULL,
    importance   double precision NOT NULL DEFAULT 0 CHECK (importance BETWEEN 0 AND 1),
    assigned_by  text             NOT NULL DEFAULT 'ai' CHECK (assigned_by IN ('ai', 'user')),
    fallen       boolean          NOT NULL DEFAULT false,
    position     smallint         NOT NULL DEFAULT 0,
    assigned_at  timestamptz      NOT NULL DEFAULT now(),
    PRIMARY KEY (cluster_id, tab_ref)
);
CREATE INDEX IF NOT EXISTS cluster_tabs_user_tab_idx ON cluster_tabs (user_id, tab_ref);

-- Stones (browser) and Work Context decisions. kind carved/mossy is derived from provenance.
CREATE TABLE IF NOT EXISTS decisions (
    id                uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid             NOT NULL,
    cluster_id        uuid             NOT NULL REFERENCES intent_clusters (id) ON DELETE CASCADE,
    text              text             NOT NULL,
    provenance        text             NOT NULL CHECK (provenance IN ('stated', 'sourced', 'inferred', 'hypothesis')),
    confidence        double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    evidence          jsonb            NOT NULL DEFAULT '[]'::jsonb,
    user_note_id      uuid,
    quote             text,
    source            text,
    source_timestamp  text,
    speaker           text,
    confirmed_at      timestamptz,
    dismissed_at      timestamptz,
    created_at        timestamptz      NOT NULL DEFAULT now(),
    CHECK (provenance <> 'stated' OR user_note_id IS NOT NULL),
    CHECK (provenance <> 'sourced' OR quote IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS decisions_user_cluster_idx ON decisions (user_id, cluster_id);

-- Mushrooms, Work Context open questions and blockers (kind 'blocker').
CREATE TABLE IF NOT EXISTS unresolved_questions (
    id                uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid             NOT NULL,
    cluster_id        uuid             NOT NULL REFERENCES intent_clusters (id) ON DELETE CASCADE,
    question          text             NOT NULL,
    kind              text             CHECK (kind IN ('repeated_search', 'unresolved_comparison',
                                                       'dormant_mid_comparison', 'blocker')),
    provenance        text             NOT NULL CHECK (provenance IN ('stated', 'sourced', 'inferred', 'hypothesis')),
    confidence        double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    evidence          jsonb            NOT NULL DEFAULT '[]'::jsonb,
    recurrence        integer          NOT NULL DEFAULT 1 CHECK (recurrence >= 1),
    status            text             NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    answer            text,
    resolved_at       timestamptz,
    dismissed_at      timestamptz,
    user_note_id      uuid,
    quote             text,
    source            text,
    source_timestamp  text,
    created_at        timestamptz      NOT NULL DEFAULT now(),
    CHECK (status <> 'resolved' OR resolved_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS unresolved_questions_user_status_idx ON unresolved_questions (user_id, status);
CREATE INDEX IF NOT EXISTS unresolved_questions_user_cluster_idx ON unresolved_questions (user_id, cluster_id);

-- Next actions, and Work Context owners (kind 'ownership': owner + task).
CREATE TABLE IF NOT EXISTS suggested_actions (
    id                    uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               uuid             NOT NULL,
    cluster_id            uuid             NOT NULL REFERENCES intent_clusters (id) ON DELETE CASCADE,
    kind                  text             NOT NULL DEFAULT 'next_action' CHECK (kind IN ('next_action', 'ownership')),
    action                text             NOT NULL,
    reason                text,
    owner                 text,
    task                  text,
    rank                  smallint         CHECK (rank >= 1),
    unblocks_question_id  uuid             REFERENCES unresolved_questions (id) ON DELETE SET NULL,
    provenance            text             NOT NULL CHECK (provenance IN ('stated', 'sourced', 'inferred', 'hypothesis')),
    confidence            double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    evidence              jsonb            NOT NULL DEFAULT '[]'::jsonb,
    user_note_id          uuid,
    quote                 text,
    source                text,
    source_timestamp      text,
    status                text             NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'dismissed')),
    created_at            timestamptz      NOT NULL DEFAULT now(),
    CHECK (kind <> 'ownership' OR (owner IS NOT NULL AND task IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS suggested_actions_user_status_idx ON suggested_actions (user_id, status);
CREATE INDEX IF NOT EXISTS suggested_actions_user_cluster_idx ON suggested_actions (user_id, cluster_id);

-- Stated notes: Clear the fog (goal), confirmed decisions, edits, free notes.
CREATE TABLE IF NOT EXISTS user_notes (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL,
    project_id  uuid        REFERENCES projects (id) ON DELETE CASCADE,
    cluster_id  uuid        REFERENCES intent_clusters (id) ON DELETE SET NULL,
    tab_ref     uuid,
    kind        text        NOT NULL DEFAULT 'note' CHECK (kind IN ('goal', 'decision', 'note')),
    text        text        NOT NULL CHECK (length(text) BETWEEN 1 AND 2000),
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_notes_user_cluster_idx ON user_notes (user_id, cluster_id);
CREATE INDEX IF NOT EXISTS user_notes_user_project_idx ON user_notes (user_id, project_id);

-- Research memory (R-12): written when an intent goes quiet or a context is saved.
CREATE TABLE IF NOT EXISTS research_insights (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            uuid        NOT NULL,
    project_id         uuid        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    saved_context_id   uuid,       -- P's saved_contexts.id, no foreign key
    summary            text        NOT NULL,
    compared           text[]      NOT NULL DEFAULT '{}',
    conclusion         jsonb,      -- claim (e.g. stated, with user_note_id) or null
    rejected           jsonb       NOT NULL DEFAULT '[]'::jsonb,
    open_questions     jsonb       NOT NULL DEFAULT '[]'::jsonb,
    period_start       timestamptz,
    period_end         timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS research_insights_user_created_idx ON research_insights (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS research_insights_user_project_idx ON research_insights (user_id, project_id);
