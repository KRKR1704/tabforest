-- 104_continuous_aggregates.sql
-- Owner: P. Continuous aggregates on browser_events (SPEC §8.3, BUILD_TASKS.md P-3).
-- Idempotent: IF NOT EXISTS / if_not_exists only; safe to run twice. Never drops anything.
-- All three are real-time (materialized_only = false): queries add rows newer than the last refresh,
-- so a new event shows up immediately and the idempotency check (P-6) can read them right away.

-- Attention per tab per 15 minutes. Keyed by tab_ref, not cluster: per-intent attention joins
-- cluster_tabs at query time, so a user's corrections apply without re-materializing (SPEC §8.5).
CREATE MATERIALIZED VIEW IF NOT EXISTS tab_attention_15m
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket('15 minutes', ts)             AS bucket,
       user_id,
       tab_ref,
       sum(active_ms)                            AS active_ms,
       count(*) FILTER (WHERE event_type = 'FOCUS') AS focus_count,
       count(*) FILTER (WHERE is_tab_switch)     AS tab_switches
FROM browser_events
GROUP BY bucket, user_id, tab_ref
WITH NO DATA;

SELECT add_continuous_aggregate_policy('tab_attention_15m',
    start_offset      => INTERVAL '3 days',
    end_offset        => INTERVAL '1 minute',
    schedule_interval => INTERVAL '1 minute',
    if_not_exists     => TRUE);

-- Daily attention per user, built on the 15-minute view (hierarchical).
CREATE MATERIALIZED VIEW IF NOT EXISTS user_attention_daily
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket('1 day', bucket) AS day,
       user_id,
       sum(active_ms)               AS active_ms,
       sum(tab_switches)            AS tab_switches
FROM tab_attention_15m
GROUP BY day, user_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('user_attention_daily',
    start_offset      => INTERVAL '7 days',
    end_offset        => INTERVAL '1 hour',
    schedule_interval => INTERVAL '30 minutes',
    if_not_exists     => TRUE);

-- Search events and distinct queries per user per hour (recurring questions over weeks).
CREATE MATERIALIZED VIEW IF NOT EXISTS search_activity_1h
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket('1 hour', ts)                              AS bucket,
       user_id,
       count(*) FILTER (WHERE search_query IS NOT NULL)       AS search_events,
       count(DISTINCT search_query)                           AS distinct_queries
FROM browser_events
GROUP BY bucket, user_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('search_activity_1h',
    start_offset      => INTERVAL '7 days',
    end_offset        => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists     => TRUE);
