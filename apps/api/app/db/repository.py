"""Repository layer (P-5, SPEC §11.2): parameterized SQL only (no string-built SQL), user_id is the
first argument of every function and every statement filters on it. A lookup by id also matches
user_id; a miss returns None, which routes turn into 404 (never 403).
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

import asyncpg

from app.adapters.events_in import EventRow, TabUpdate
from app.sessions import GAP, StoredSession, plan_sessions


async def ensure_user(user_id: UUID, conn: asyncpg.Connection, *, entra_tid: str | None = None,
                      entra_oid: str | None = None, display_name: str | None = None
                      ) -> tuple[asyncpg.Record, asyncpg.Record, bool]:
    """Just-in-time provisioning on GET /api/me (SPEC §11.3): users row plus default privacy row.

    Returns (user, privacy, created). A second call creates nothing.
    """
    async with conn.transaction():
        user = await conn.fetchrow(
            "INSERT INTO users (id, entra_tid, entra_oid, display_name) VALUES ($1, $2, $3, $4) "
            "ON CONFLICT DO NOTHING RETURNING id, display_name, created_at",
            user_id, entra_tid, entra_oid, display_name)
        created = user is not None
        if not created:
            user = await conn.fetchrow("SELECT id, display_name, created_at FROM users WHERE id = $1", user_id)
        await conn.execute("INSERT INTO privacy_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
                           user_id)
        privacy = await conn.fetchrow(
            "SELECT excluded_domains, paused_until, retention_days, cloud_ai_enabled, updated_at "
            "FROM privacy_settings WHERE user_id = $1", user_id)
    return user, privacy, created


async def get_session(user_id: UUID, conn: asyncpg.Connection, session_id: UUID) -> asyncpg.Record | None:
    return await conn.fetchrow(
        "SELECT id, started_at, ended_at, event_count FROM browser_sessions WHERE id = $1 AND user_id = $2",
        session_id, user_id)


async def list_sessions(user_id: UUID, conn: asyncpg.Connection, since: datetime,
                        until: datetime) -> list[asyncpg.Record]:
    """Sessions that started in [since, until], newest first."""
    return await conn.fetch(
        "SELECT id, started_at, ended_at, event_count FROM browser_sessions "
        "WHERE user_id = $1 AND started_at BETWEEN $2 AND $3 ORDER BY started_at DESC",
        user_id, since, until)


# The ts bounds let TimescaleDB skip chunks; session_id picks the rows.
_SESSION_TABS = """
SELECT session_id, tab_ref, coalesce(sum(active_ms) FILTER (WHERE event_type = 'BLUR'), 0) AS active_ms
FROM browser_events
WHERE user_id = $1 AND ts BETWEEN $2 AND $3 AND session_id = ANY($4::uuid[])
  AND event_type IN ('FOCUS', 'BLUR')
GROUP BY session_id, tab_ref
"""

_SESSION_SWITCHES = """
SELECT session_id, previous_tab_ref, tab_ref, count(*) AS n
FROM browser_events
WHERE user_id = $1 AND ts BETWEEN $2 AND $3 AND session_id = ANY($4::uuid[]) AND is_tab_switch
GROUP BY session_id, previous_tab_ref, tab_ref
"""


async def session_activity(user_id: UUID, conn: asyncpg.Connection, sessions: list[asyncpg.Record]
                           ) -> tuple[list[asyncpg.Record], list[asyncpg.Record]]:
    """Per (session, tab) focused time from BLUR events, and per (session, from, to) tab switches."""
    if not sessions:
        return [], []
    ids = [s["id"] for s in sessions]
    lo, hi = min(s["started_at"] for s in sessions), max(s["ended_at"] for s in sessions)
    tabs = await conn.fetch(_SESSION_TABS, user_id, lo, hi, ids)
    switches = await conn.fetch(_SESSION_SWITCHES, user_id, lo, hi, ids)
    return tabs, switches


# SPEC §8.5 timeline query, re-bucketed to 30 minutes (two whole 15-minute buckets, X15). The join to
# cluster_tabs happens in the route through C12, so a reassigned leaf moves lanes on the next read.
_ATTENTION_30M = """
SELECT time_bucket('30 minutes', bucket) AS t, tab_ref, sum(active_ms)::bigint AS active_ms
FROM tab_attention_15m
WHERE user_id = $1 AND tab_ref = ANY($2::uuid[])
  AND bucket >= time_bucket('30 minutes', $3::timestamptz) AND bucket < $4
GROUP BY 1, 2
HAVING sum(active_ms) > 0
"""


async def attention_30m(user_id: UUID, conn: asyncpg.Connection, tab_refs: list[UUID], since: datetime,
                        until: datetime) -> list[asyncpg.Record]:
    """Focused time per (30-minute bucket, tab), from the continuous aggregate."""
    if not tab_refs:
        return []
    return await conn.fetch(_ATTENTION_30M, user_id, tab_refs, since, until)


_SWITCHES_TOUCHING = """
SELECT ts, previous_tab_ref, tab_ref
FROM browser_events
WHERE user_id = $1 AND ts BETWEEN $2 AND $3 AND is_tab_switch
  AND (tab_ref = ANY($4::uuid[]) OR previous_tab_ref = ANY($4::uuid[]))
"""


async def switches_touching(user_id: UUID, conn: asyncpg.Connection, tab_refs: list[UUID], since: datetime,
                            until: datetime) -> list[asyncpg.Record]:
    """Tab switches that enter or leave any of these tabs."""
    if not tab_refs:
        return []
    return await conn.fetch(_SWITCHES_TOUCHING, user_id, since, until, tab_refs)


_PROJECT_ACTIVITY = """
SELECT count(DISTINCT session_id) AS session_count, max(ts) AS last_active_at
FROM browser_events
WHERE user_id = $1 AND tab_ref = ANY($2::uuid[]) AND event_type IN ('FOCUS', 'BLUR')
"""


async def project_activity(user_id: UUID, conn: asyncpg.Connection, tab_refs: list[UUID]
                           ) -> tuple[int, int, datetime | None]:
    """(active_ms from the aggregate, sessions with focus on these tabs, last focus or blur) over
    everything still stored, i.e. within retention."""
    if not tab_refs:
        return 0, 0, None
    active = await conn.fetchval(
        "SELECT coalesce(sum(active_ms), 0)::bigint FROM tab_attention_15m "
        "WHERE user_id = $1 AND tab_ref = ANY($2::uuid[])",
        user_id, tab_refs)
    row = await conn.fetchrow(_PROJECT_ACTIVITY, user_id, tab_refs)
    return int(active), int(row["session_count"]), row["last_active_at"]


async def insert_saved_context(user_id: UUID, conn: asyncpg.Connection, *, project_id: UUID, title: str,
                               kind: str, snapshot: dict, saved_at: datetime) -> asyncpg.Record:
    return await conn.fetchrow(
        "INSERT INTO saved_contexts (user_id, project_id, title, kind, snapshot, saved_at) "
        "VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, project_id, title, kind, snapshot, saved_at, last_resumed_at",
        user_id, project_id, title, kind, snapshot, saved_at)


async def list_saved_contexts(user_id: UUID, conn: asyncpg.Connection) -> list[asyncpg.Record]:
    return await conn.fetch(
        "SELECT id, project_id, title, kind, snapshot, saved_at, last_resumed_at "
        "FROM saved_contexts WHERE user_id = $1 ORDER BY saved_at DESC, id",
        user_id)


async def resume_saved_context(user_id: UUID, conn: asyncpg.Connection, context_id: UUID,
                               now: datetime) -> asyncpg.Record | None:
    """Mark the context resumed and return it; None if it isn't this user's."""
    return await conn.fetchrow(
        "UPDATE saved_contexts SET last_resumed_at = $3 WHERE id = $1 AND user_id = $2 "
        "RETURNING id, project_id, title, kind, snapshot, saved_at, last_resumed_at",
        context_id, user_id, now)


_TAB_INFO = """
SELECT t.tab_ref, t.domain,
       (SELECT e.title FROM browser_events e
        WHERE e.user_id = $1 AND e.tab_ref = t.tab_ref AND e.title IS NOT NULL
        ORDER BY e.ts DESC LIMIT 1) AS title
FROM tabs t
WHERE t.user_id = $1 AND t.tab_ref = ANY($2::uuid[])
"""


async def tab_info(user_id: UUID, conn: asyncpg.Connection, tab_refs: list[UUID]) -> dict[UUID, asyncpg.Record]:
    """Latest domain and latest (device-redacted) title per tab."""
    if not tab_refs:
        return {}
    return {r["tab_ref"]: r for r in await conn.fetch(_TAB_INFO, user_id, tab_refs)}


_INSERT_EVENTS = """
INSERT INTO browser_events (ts, user_id, event_id, session_id, tab_ref, event_type, domain, title,
                            search_query, opener_tab_ref, previous_tab_ref, dup_key, active_ms, is_tab_switch)
SELECT r.ts, $1, r.event_id, r.session_id, r.tab_ref, r.event_type, r.domain, r.title,
       r.search_query, r.opener_tab_ref, r.previous_tab_ref, r.dup_key, r.active_ms, r.is_tab_switch
FROM unnest($2::timestamptz[], $3::uuid[], $4::uuid[], $5::uuid[], $6::text[], $7::text[], $8::text[],
            $9::text[], $10::uuid[], $11::uuid[], $12::text[], $13::int[], $14::bool[])
     AS r(ts, event_id, session_id, tab_ref, event_type, domain, title,
          search_query, opener_tab_ref, previous_tab_ref, dup_key, active_ms, is_tab_switch)
ON CONFLICT (user_id, ts, event_id) DO NOTHING
RETURNING event_id
"""

_UPSERT_TABS = """
INSERT INTO tabs (user_id, tab_ref, domain, domain_seen_at, first_seen, last_focus)
SELECT $1, t.tab_ref, t.domain, t.domain_seen_at, t.first_seen, t.last_focus
FROM unnest($2::uuid[], $3::text[], $4::timestamptz[], $5::timestamptz[], $6::timestamptz[])
     AS t(tab_ref, domain, domain_seen_at, first_seen, last_focus)
ON CONFLICT (user_id, tab_ref) DO UPDATE SET
    first_seen = LEAST(tabs.first_seen, EXCLUDED.first_seen),
    last_focus = GREATEST(tabs.last_focus, EXCLUDED.last_focus),
    domain = CASE WHEN EXCLUDED.domain_seen_at IS NOT NULL
                   AND (tabs.domain_seen_at IS NULL OR EXCLUDED.domain_seen_at >= tabs.domain_seen_at)
                  THEN EXCLUDED.domain ELSE tabs.domain END,
    domain_seen_at = GREATEST(tabs.domain_seen_at, EXCLUDED.domain_seen_at)
"""

# Bounds and counts come from the stored events, so retries and merges stay exact.
_REFRESH_SESSIONS = """
WITH agg AS (
    SELECT session_id, min(ts) AS lo, max(ts) AS hi, count(*) AS n
    FROM browser_events
    WHERE user_id = $1 AND ts BETWEEN $2 AND $3 AND session_id = ANY($4::uuid[])
    GROUP BY session_id
)
UPDATE browser_sessions s SET started_at = agg.lo, ended_at = agg.hi, event_count = agg.n
FROM agg WHERE s.user_id = $1 AND s.id = agg.session_id
"""

_DROP_EMPTY_SESSIONS = """
DELETE FROM browser_sessions s
WHERE s.user_id = $1 AND s.id = ANY($2::uuid[])
  AND NOT EXISTS (SELECT 1 FROM browser_events e
                  WHERE e.user_id = $1 AND e.session_id = s.id AND e.ts BETWEEN $3 AND $4)
"""


async def ingest_events(user_id: UUID, conn: asyncpg.Connection, rows: list[EventRow],
                        tabs: list[TabUpdate]) -> int:
    """Idempotent ingest (§4.10) with sessionization (§4.11) in one transaction.

    Returns how many events were new; the rest were already stored (same user_id, ts, event_id).
    A per-user advisory lock serializes batches from the same user, so two concurrent batches
    can't both open a session for the same stretch of time.
    """
    rows = sorted(rows, key=lambda r: r.ts)
    lo, hi = rows[0].ts, rows[-1].ts
    async with conn.transaction():
        await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended($1, 7))", str(user_id))
        stored = [StoredSession(r["id"], r["started_at"], r["ended_at"]) for r in await conn.fetch(
            "SELECT id, started_at, ended_at FROM browser_sessions "
            "WHERE user_id = $1 AND started_at <= $3 AND ended_at >= $2",
            user_id, lo - GAP, hi + GAP)]
        plan = plan_sessions(stored, [r.ts for r in rows])

        session_of: dict[int, UUID] = {}
        touched: list[UUID] = []
        span_lo, span_hi = lo, hi
        for group in plan:
            touched.append(group.session_id)
            span_lo, span_hi = min(span_lo, group.start), max(span_hi, group.end)
            for i in group.event_indexes:
                session_of[i] = group.session_id
            if group.is_new:
                await conn.execute(
                    "INSERT INTO browser_sessions (id, user_id, started_at, ended_at, event_count) "
                    "VALUES ($1, $2, $3, $4, 0)", group.session_id, user_id, group.start, group.end)
            if group.merged_ids:  # this batch filled the gap between stored sessions
                await conn.execute(
                    "UPDATE browser_events SET session_id = $2 "
                    "WHERE user_id = $1 AND ts BETWEEN $3 AND $4 AND session_id = ANY($5::uuid[])",
                    user_id, group.session_id, group.start, group.end, group.merged_ids)
                await conn.execute("DELETE FROM browser_sessions WHERE user_id = $1 AND id = ANY($2::uuid[])",
                                   user_id, group.merged_ids)

        inserted = await conn.fetch(
            _INSERT_EVENTS, user_id,
            [r.ts for r in rows], [r.event_id for r in rows], [session_of[i] for i in range(len(rows))],
            [r.tab_ref for r in rows], [r.event_type for r in rows], [r.domain for r in rows],
            [r.title for r in rows], [r.search_query for r in rows], [r.opener_tab_ref for r in rows],
            [r.previous_tab_ref for r in rows], [r.dup_key for r in rows], [r.active_ms for r in rows],
            [r.is_tab_switch for r in rows])

        await conn.execute(_REFRESH_SESSIONS, user_id, span_lo, span_hi, touched)
        await conn.execute(_DROP_EMPTY_SESSIONS, user_id, touched, span_lo, span_hi)
        await conn.execute(
            _UPSERT_TABS, user_id, [t.tab_ref for t in tabs], [t.domain for t in tabs],
            [t.domain_seen_at for t in tabs], [t.first_seen for t in tabs], [t.last_focus for t in tabs])
    return len(inserted)
