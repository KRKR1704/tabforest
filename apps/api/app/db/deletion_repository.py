"""Deletion (P-11, SPEC §11.3): hard deletes in one transaction, parameterized SQL only, user_id on every statement.

Children are deleted explicitly, before their parents, so every table reports an exact count (the foreign keys
would cascade, but silently). R's tables may be missing on a database where R's migrations were not applied; a
missing table counts as 0 instead of failing the deletion. Aggregates are refreshed after the commit, because
refresh_continuous_aggregate cannot run inside a transaction.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from uuid import UUID

import asyncpg

log = logging.getLogger("tabforest.deletion")

# Names are constants, never input. Order = the response order of contracts/me.example.json.
ME_TABLES = ("users", "privacy_settings", "browser_sessions", "browser_events", "tabs", "saved_contexts", "projects",
             "intent_clusters", "intent_branches", "cluster_tabs", "research_insights", "decisions",
             "unresolved_questions", "suggested_actions", "user_notes", "memory_embeddings", "analysis_runs")
PROJECT_TABLES = ("projects", "intent_clusters", "intent_branches", "cluster_tabs", "research_insights", "decisions",
                  "unresolved_questions", "suggested_actions", "user_notes", "saved_contexts", "memory_embeddings")
AGGREGATES = ("tab_attention_15m", "user_attention_daily", "search_activity_1h")

_IN_PROJECT = "SELECT id FROM intent_clusters WHERE user_id = $1 AND project_id = $2"

# Children before parents. $1 = user id, $2 = project id (project) .
_PROJECT_STEPS: tuple[tuple[str, str], ...] = (
    ("memory_embeddings",
     "DELETE FROM memory_embeddings WHERE user_id = $1 AND ("
     "(kind = 'insight' AND source_id IN "
     "(SELECT id::text FROM research_insights WHERE user_id = $1 AND project_id = $2))"
     " OR (kind = 'context' AND source_id IN "
     "(SELECT id::text FROM saved_contexts WHERE user_id = $1 AND project_id = $2)))"),
    ("suggested_actions", f"DELETE FROM suggested_actions WHERE user_id = $1 AND cluster_id IN ({_IN_PROJECT})"),
    ("unresolved_questions", f"DELETE FROM unresolved_questions WHERE user_id = $1 AND cluster_id IN ({_IN_PROJECT})"),
    ("decisions", f"DELETE FROM decisions WHERE user_id = $1 AND cluster_id IN ({_IN_PROJECT})"),
    ("cluster_tabs", f"DELETE FROM cluster_tabs WHERE user_id = $1 AND cluster_id IN ({_IN_PROJECT})"),
    ("intent_branches", f"DELETE FROM intent_branches WHERE user_id = $1 AND cluster_id IN ({_IN_PROJECT})"),
    ("user_notes", f"DELETE FROM user_notes WHERE user_id = $1 AND (project_id = $2 OR cluster_id IN ({_IN_PROJECT}))"),
    ("research_insights", "DELETE FROM research_insights WHERE user_id = $1 AND project_id = $2"),
    ("saved_contexts", "DELETE FROM saved_contexts WHERE user_id = $1 AND project_id = $2"),
    ("intent_clusters", "DELETE FROM intent_clusters WHERE user_id = $1 AND project_id = $2"),
    ("projects", "DELETE FROM projects WHERE user_id = $1 AND id = $2"),
)

# The last stored grove (GET /api/grove) holds every tree; drop the deleted project's so it cannot reappear.
_STRIP_TREE = (
    "UPDATE analysis_runs SET response = jsonb_set(response, '{trees}', coalesce((SELECT jsonb_agg(t) "
    "FROM jsonb_array_elements(response->'trees') AS t WHERE t->>'project_id' <> $2), '[]'::jsonb)) "
    "WHERE user_id = $1 AND kind = 'grow' AND jsonb_typeof(response->'trees') = 'array'")

_ME_STEPS: tuple[tuple[str, str], ...] = (
    ("memory_embeddings", "DELETE FROM memory_embeddings WHERE user_id = $1"),
    ("suggested_actions", "DELETE FROM suggested_actions WHERE user_id = $1"),
    ("unresolved_questions", "DELETE FROM unresolved_questions WHERE user_id = $1"),
    ("decisions", "DELETE FROM decisions WHERE user_id = $1"),
    ("cluster_tabs", "DELETE FROM cluster_tabs WHERE user_id = $1"),
    ("intent_branches", "DELETE FROM intent_branches WHERE user_id = $1"),
    ("user_notes", "DELETE FROM user_notes WHERE user_id = $1"),
    ("research_insights", "DELETE FROM research_insights WHERE user_id = $1"),
    ("intent_clusters", "DELETE FROM intent_clusters WHERE user_id = $1"),
    ("projects", "DELETE FROM projects WHERE user_id = $1"),
    ("analysis_runs", "DELETE FROM analysis_runs WHERE user_id = $1"),
    ("saved_contexts", "DELETE FROM saved_contexts WHERE user_id = $1"),
    ("tabs", "DELETE FROM tabs WHERE user_id = $1"),
    ("browser_events", "DELETE FROM browser_events WHERE user_id = $1"),
    ("browser_sessions", "DELETE FROM browser_sessions WHERE user_id = $1"),
    ("privacy_settings", "DELETE FROM privacy_settings WHERE user_id = $1"),
    ("users", "DELETE FROM users WHERE id = $1"),
)

# P's own tables must exist; a missing R table just means R's migrations were not applied there.
_REQUIRED = {"users", "privacy_settings", "browser_sessions", "browser_events", "tabs", "saved_contexts"}


def deleted_count(status: str) -> int:
    """asyncpg returns the command tag, for example 'DELETE 12'."""
    return int(status.split()[-1])


def total(counts: dict[str, int]) -> int:
    return sum(counts.values())


async def _lock(conn: asyncpg.Connection, user_id: UUID) -> None:
    # Same key as ingest, so a batch in flight cannot re-create rows while they are being deleted.
    await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended($1, 7))", str(user_id))


async def _run(conn: asyncpg.Connection, table: str, sql: str, *args: object) -> int:
    """One DELETE inside its own savepoint, so a missing optional table cannot abort the whole transaction."""
    try:
        async with conn.transaction():
            return deleted_count(await conn.execute(sql, *args))
    except asyncpg.UndefinedTableError:
        if table in _REQUIRED:
            raise
        log.warning("deletion: table %s does not exist; counted as 0", table)
        return 0


async def delete_project(user_id: UUID, conn: asyncpg.Connection, project_id: UUID) -> dict[str, int] | None:
    """Everything derived from the project, in one transaction; None if the project is not this user's.

    Raw browser_events and tabs stay (a tab can belong to several projects); they go through retention or
    DELETE /api/me.
    """
    async with conn.transaction():
        await _lock(conn, user_id)
        if await conn.fetchval("SELECT 1 FROM projects WHERE id = $2 AND user_id = $1 FOR UPDATE",
                               user_id, project_id) is None:
            return None
        counts = {table: await _run(conn, table, sql, user_id, project_id) for table, sql in _PROJECT_STEPS}
        await _run(conn, "analysis_runs", _STRIP_TREE, user_id, f"p_{project_id}")
    return {table: counts[table] for table in PROJECT_TABLES}


async def delete_me(user_id: UUID,
                    conn: asyncpg.Connection) -> tuple[dict[str, int], datetime | None, datetime | None]:
    """Every row the user owns in every table, in one transaction, plus the time span of the deleted events."""
    async with conn.transaction():
        await _lock(conn, user_id)
        span = await conn.fetchrow(
            "SELECT min(ts) AS lo, max(ts) AS hi FROM browser_events WHERE user_id = $1", user_id)
        counts = {table: await _run(conn, table, sql, user_id) for table, sql in _ME_STEPS}
    return {table: counts[table] for table in ME_TABLES}, span["lo"], span["hi"]


async def refresh_aggregates(conn: asyncpg.Connection, lo: datetime | None, hi: datetime | None) -> bool:
    """Recompute the continuous aggregates over the affected range, so deleted attention disappears at once.

    Best effort and outside any transaction: the deletion has already committed, and the aggregates' own
    policies catch up if this fails. Returns True when every view was refreshed.
    """
    if lo is None or hi is None:
        return True
    ok = True
    # A refresh window must contain at least one bucket of every view (the widest is one day).
    start, end = lo - timedelta(days=2), hi + timedelta(days=2)
    for view in AGGREGATES:
        try:
            await conn.execute("CALL refresh_continuous_aggregate($1::regclass, $2::timestamptz, $3::timestamptz)",
                               view, start, end)
        except Exception as exc:  # noqa: BLE001 - nothing here may undo a committed deletion
            ok = False
            log.warning("aggregate %s not refreshed after deletion (%s)", view, type(exc).__name__)
    return ok
