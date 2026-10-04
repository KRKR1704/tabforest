-- 101_users_and_privacy.sql
-- Owner: P. Tables from BUILD_TASKS.md §4.5 / SPEC §8.1. No foreign keys to R's tables (§2 rule 6).
-- Idempotent: IF NOT EXISTS only; safe to run twice. Never drops anything.

-- id = uuid5(NAMESPACE_URL, 'tabforest:' || tid || ':' || oid) for Entra users (BUILD_TASKS.md §4.1),
-- or uuid5 of 'tabforest:local:' || email for fallback accounts. Created just in time by GET /api/me.
CREATE TABLE IF NOT EXISTS users (
    id            uuid        PRIMARY KEY,
    entra_tid     text,
    entra_oid     text,
    display_name  text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    deleted_at    timestamptz,
    CONSTRAINT users_entra_key UNIQUE (entra_tid, entra_oid)
);

-- Defaults per contracts/privacy.example.json: no exclusions, not paused, 90-day retention, cloud AI on.
-- paused_until = 9999-12-31T23:59:59Z means paused until resumed.
CREATE TABLE IF NOT EXISTS privacy_settings (
    user_id           uuid        PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    excluded_domains  text[]      NOT NULL DEFAULT '{}',
    paused_until      timestamptz,
    retention_days    integer     NOT NULL DEFAULT 90 CHECK (retention_days IN (7, 30, 90)),
    cloud_ai_enabled  boolean     NOT NULL DEFAULT true,
    updated_at        timestamptz NOT NULL DEFAULT now()
);
