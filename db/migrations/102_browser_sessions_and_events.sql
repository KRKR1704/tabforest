-- 102_browser_sessions_and_events.sql
-- Owner: P. Sessions (§4.11, P is the only owner) and the browser_events hypertable (SPEC §8.2, §8.4).
-- Idempotent: IF NOT EXISTS / if_not_exists only; safe to run twice. Never drops anything.

-- A session is a run of a user's events with no gap over 30 minutes (by event ts). started_at and
-- ended_at are the first and last event so far; the API reports a session as open while its last
-- event is less than 30 minutes old. event_count is recomputed from browser_events on every ingest.
CREATE TABLE IF NOT EXISTS browser_sessions (
    id           uuid        PRIMARY KEY,
    user_id      uuid        NOT NULL,
    started_at   timestamptz NOT NULL,
    ended_at     timestamptz NOT NULL,
    event_count  integer     NOT NULL DEFAULT 0 CHECK (event_count >= 0),
    CHECK (ended_at >= started_at)
);
CREATE INDEX IF NOT EXISTS browser_sessions_user_started_idx ON browser_sessions (user_id, started_at DESC);

-- SPEC §8.2 columns plus dup_key (BUILD_TASKS.md §4.2: events carry it; R's C11 adapter reads it).
-- event_id is minted on the device, so a retried batch hits the primary key and is skipped (§4.10).
CREATE TABLE IF NOT EXISTS browser_events (
    ts                timestamptz NOT NULL,
    user_id           uuid        NOT NULL,
    event_id          uuid        NOT NULL,
    session_id        uuid        NOT NULL,
    tab_ref           uuid        NOT NULL,
    event_type        text        NOT NULL
                                  CHECK (event_type IN ('OPEN', 'FOCUS', 'BLUR', 'UPDATE', 'CLOSE', 'IDLE', 'ACTIVE')),
    domain            text,
    title             text        CHECK (length(title) <= 300),
    search_query      text,
    opener_tab_ref    uuid,
    previous_tab_ref  uuid,
    dup_key           text        CHECK (dup_key ~ '^[0-9a-f]{64}$'),
    active_ms         integer     NOT NULL DEFAULT 0 CHECK (active_ms >= 0),
    is_tab_switch     boolean     NOT NULL DEFAULT false,
    PRIMARY KEY (user_id, ts, event_id)
);

SELECT create_hypertable('browser_events', by_range('ts', INTERVAL '1 day'), if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS browser_events_user_tab_ts_idx ON browser_events (user_id, tab_ref, ts DESC);
-- Session detail (P-7) and session merges at ingest.
CREATE INDEX IF NOT EXISTS browser_events_user_session_idx ON browser_events (user_id, session_id, ts);

-- Compression after 7 days, segmented by user; raw events dropped after 90 days (SPEC §8.4).
DO $$
BEGIN
    IF NOT (SELECT compression_enabled FROM timescaledb_information.hypertables
            WHERE hypertable_schema = 'public' AND hypertable_name = 'browser_events') THEN
        ALTER TABLE browser_events SET (timescaledb.compress, timescaledb.compress_segmentby = 'user_id');
    END IF;
END
$$;
SELECT add_compression_policy('browser_events', INTERVAL '7 days', if_not_exists => TRUE);
SELECT add_retention_policy('browser_events', INTERVAL '90 days', if_not_exists => TRUE);
