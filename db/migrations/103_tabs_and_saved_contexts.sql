-- 103_tabs_and_saved_contexts.sql
-- Owner: P. Shared columns per BUILD_TASKS.md §4.5. No foreign keys to R's tables (§2 rule 6).
-- Idempotent: IF NOT EXISTS only; safe to run twice. Never drops anything.

-- P writes user_id, tab_ref, domain (+ domain_seen_at), first_seen and last_focus at ingest.
-- R writes title_norm, source_type and embedding_hash with UPDATE only.
-- Keyed by (user_id, tab_ref), so one user's tab_ref can never touch another user's row.
CREATE TABLE IF NOT EXISTS tabs (
    user_id         uuid        NOT NULL,
    tab_ref         uuid        NOT NULL,
    domain          text,
    domain_seen_at  timestamptz,   -- ts of the event that set domain; a late batch can't overwrite a newer one
    title_norm      text,          -- R
    source_type     text,          -- R
    embedding_hash  text,          -- R
    first_seen      timestamptz NOT NULL,
    last_focus      timestamptz,   -- latest FOCUS or BLUR; null for a tab never focused
    PRIMARY KEY (user_id, tab_ref)
);
CREATE INDEX IF NOT EXISTS tabs_user_last_focus_idx ON tabs (user_id, last_focus DESC);

-- kind: 'resume' or 'references' (Save as references, §3.5). project_id is R's projects.id, no FK.
CREATE TABLE IF NOT EXISTS saved_contexts (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid        NOT NULL,
    project_id       uuid,
    title            text        NOT NULL CHECK (length(title) <= 300),
    kind             text        NOT NULL DEFAULT 'resume' CHECK (kind IN ('resume', 'references')),
    snapshot         jsonb       NOT NULL,
    saved_at         timestamptz NOT NULL DEFAULT now(),
    last_resumed_at  timestamptz
);
CREATE INDEX IF NOT EXISTS saved_contexts_user_saved_idx ON saved_contexts (user_id, saved_at DESC);
