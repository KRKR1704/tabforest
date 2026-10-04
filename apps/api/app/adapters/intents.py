"""C12 adapter (R → P): reads R's tables (projects, intent_clusters, intent_branches, cluster_tabs,
decisions, unresolved_questions, user_notes). Read only; R owns these tables (§4.5).

If R's tables don't exist yet, the user has no projects and no clusters: project counts are 0,
every tab is "unassigned" and a project lookup misses (404). Those are the true values, not
guesses (§2 rule 4); fixture intent rows exist only in the tests.

A project's current tree is its newest browser cluster (origin 'browser'); older clusters from
earlier analysis runs are ignored, so a re-grow replaces the tree instead of adding to it.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from uuid import UUID

import asyncpg

log = logging.getLogger("tabforest.adapters.intents")

MISSING = (asyncpg.exceptions.UndefinedTableError, asyncpg.exceptions.UndefinedColumnError)


async def _fetch(conn: asyncpg.Connection, sql: str, *args: Any) -> list[asyncpg.Record]:
    try:
        return await conn.fetch(sql, *args)
    except MISSING as exc:
        log.warning("R's tables are not readable yet (%s); treating the user as having no clusters",
                    type(exc).__name__)
        return []


_CURRENT_CLUSTERS = """
SELECT DISTINCT ON (project_id) id, project_id
FROM intent_clusters
WHERE user_id = $1 AND origin = 'browser'
ORDER BY project_id, created_at DESC, id
"""

# Static SQL only: the CTE above is a constant, never built from input.
_MEMBERSHIP = "WITH current AS (" + _CURRENT_CLUSTERS + """)
SELECT ct.tab_ref, ct.cluster_id, c.project_id, p.name
FROM current c
JOIN projects p ON p.id = c.project_id AND p.user_id = $1
JOIN cluster_tabs ct ON ct.cluster_id = c.id AND ct.user_id = $1
"""

_OPEN_QUESTIONS = "WITH current AS (" + _CURRENT_CLUSTERS + """)
SELECT c.project_id, count(q.id) AS n
FROM current c
JOIN unresolved_questions q ON q.cluster_id = c.id AND q.user_id = $1
WHERE c.project_id = ANY($2::uuid[]) AND q.status = 'open' AND q.dismissed_at IS NULL
GROUP BY c.project_id
"""

_PROJECT_TABS = "WITH current AS (" + _CURRENT_CLUSTERS + """)
SELECT c.project_id, ct.tab_ref
FROM current c
JOIN cluster_tabs ct ON ct.cluster_id = c.id AND ct.user_id = $1
WHERE c.project_id = ANY($2::uuid[])
"""


@dataclass(frozen=True)
class Membership:
    """Which current clusters and projects each tab belongs to (a tab can be in two)."""

    clusters_of: dict[UUID, frozenset[UUID]] = field(default_factory=dict)
    projects_of: dict[UUID, tuple[UUID, ...]] = field(default_factory=dict)
    names: dict[UUID, str] = field(default_factory=dict)


async def membership(user_id: UUID, conn: asyncpg.Connection) -> Membership:
    rows = await _fetch(conn, _MEMBERSHIP, user_id)
    clusters: dict[UUID, set[UUID]] = {}
    projects: dict[UUID, set[UUID]] = {}
    names: dict[UUID, str] = {}
    for r in rows:
        clusters.setdefault(r["tab_ref"], set()).add(r["cluster_id"])
        projects.setdefault(r["tab_ref"], set()).add(r["project_id"])
        names[r["project_id"]] = r["name"]
    return Membership(clusters_of={t: frozenset(c) for t, c in clusters.items()},
                      projects_of={t: tuple(sorted(p, key=str)) for t, p in projects.items()},
                      names=names)


@dataclass(frozen=True)
class Project:
    id: UUID
    name: str
    cluster_id: UUID | None   # the current tree; None before the first analysis


async def project(user_id: UUID, conn: asyncpg.Connection, project_id: UUID) -> Project | None:
    rows = await _fetch(conn, """
        SELECT p.id, p.name,
               (SELECT ic.id FROM intent_clusters ic
                WHERE ic.user_id = $1 AND ic.project_id = p.id AND ic.origin = 'browser'
                ORDER BY ic.created_at DESC, ic.id LIMIT 1) AS cluster_id
        FROM projects p WHERE p.id = $2 AND p.user_id = $1
        """, user_id, project_id)
    return Project(rows[0]["id"], rows[0]["name"], rows[0]["cluster_id"]) if rows else None


async def project_names(user_id: UUID, conn: asyncpg.Connection, project_ids: list[UUID]) -> dict[UUID, str]:
    rows = await _fetch(conn, "SELECT id, name FROM projects WHERE user_id = $1 AND id = ANY($2::uuid[])",
                        user_id, project_ids)
    return {r["id"]: r["name"] for r in rows}


@dataclass(frozen=True)
class Branch:
    id: UUID
    label: str
    status: str


@dataclass(frozen=True)
class Leaf:
    tab_ref: UUID
    branch_id: UUID | None
    importance: float


async def tree(user_id: UUID, conn: asyncpg.Connection, cluster_id: UUID) -> tuple[list[Branch], list[Leaf]]:
    """The cluster's branches in R's order and its leaves (fallen leaves included: closed tabs keep
    their place in the project's history)."""
    branches = await _fetch(conn, """
        SELECT id, label, status FROM intent_branches
        WHERE user_id = $1 AND cluster_id = $2 ORDER BY position, created_at, id
        """, user_id, cluster_id)
    leaves = await _fetch(conn, """
        SELECT tab_ref, branch_id, importance FROM cluster_tabs
        WHERE user_id = $1 AND cluster_id = $2 ORDER BY position, tab_ref
        """, user_id, cluster_id)
    return ([Branch(r["id"], r["label"], r["status"]) for r in branches],
            [Leaf(r["tab_ref"], r["branch_id"], r["importance"]) for r in leaves])


@dataclass(frozen=True)
class Marker:
    kind: str           # decision | question
    id: UUID
    text: str
    t: datetime | None
    provenance: str | None = None
    status: str | None = None


async def markers(user_id: UUID, conn: asyncpg.Connection, cluster_id: UUID) -> list[Marker]:
    """Timeline markers (contracts/timeline.example.json): a decision at its note's created_at when
    stated, else at confirmed_at (inferred, unconfirmed decisions get none); a question at the
    earliest first_seen among its evidence tabs. Dismissed claims are left out."""
    decisions = await _fetch(conn, """
        SELECT d.id, d.text, d.provenance,
               CASE WHEN d.provenance = 'stated' THEN coalesce(n.created_at, d.confirmed_at)
                    ELSE d.confirmed_at END AS t
        FROM decisions d
        LEFT JOIN user_notes n ON n.id = d.user_note_id AND n.user_id = $1
        WHERE d.user_id = $1 AND d.cluster_id = $2 AND d.dismissed_at IS NULL
        """, user_id, cluster_id)
    questions = await _fetch(conn, """
        SELECT q.id, q.question, q.status,
               (SELECT min(t.first_seen) FROM jsonb_array_elements(q.evidence) ev
                JOIN tabs t ON t.user_id = $1 AND ev->>'ref_kind' = 'tab'
                           AND t.tab_ref::text = ev->>'ref') AS t
        FROM unresolved_questions q
        WHERE q.user_id = $1 AND q.cluster_id = $2 AND q.dismissed_at IS NULL
        """, user_id, cluster_id)
    return ([Marker("decision", r["id"], r["text"], r["t"], provenance=r["provenance"]) for r in decisions]
            + [Marker("question", r["id"], r["question"], r["t"], status=r["status"]) for r in questions])


async def open_question_counts(user_id: UUID, conn: asyncpg.Connection,
                               project_ids: list[UUID]) -> dict[UUID, int]:
    rows = await _fetch(conn, _OPEN_QUESTIONS, user_id, project_ids)
    return {r["project_id"]: int(r["n"]) for r in rows}


async def project_tab_refs(user_id: UUID, conn: asyncpg.Connection, project_ids: list[UUID]) -> dict[UUID, list[UUID]]:
    """Each project's tabs in its current tree."""
    rows = await _fetch(conn, _PROJECT_TABS, user_id, project_ids)
    out: dict[UUID, list[UUID]] = {}
    for r in rows:
        out.setdefault(r["project_id"], []).append(r["tab_ref"])
    return out

# me.example.json notes: total_forests = projects the user has; active_goals = projects active in
# the last 3 days; total_attention_ms = attention summed over projects (a tab shared by two projects
# counts for both); total_resolved_questions = questions with status resolved.
_STATS_SQL = """
WITH project_tabs AS (
    SELECT DISTINCT ic.project_id, ct.tab_ref
    FROM cluster_tabs ct
    JOIN intent_clusters ic ON ic.id = ct.cluster_id AND ic.user_id = $1
    WHERE ct.user_id = $1
), tab_ms AS (
    SELECT tab_ref, sum(active_ms) AS ms
    FROM tab_attention_15m
    WHERE user_id = $1
    GROUP BY tab_ref
)
SELECT
    (SELECT count(*) FROM projects WHERE user_id = $1) AS total_forests,
    (SELECT count(*) FROM projects WHERE user_id = $1 AND last_active_at >= now() - interval '3 days')
        AS active_goals,
    (SELECT coalesce(sum(tab_ms.ms), 0) FROM project_tabs JOIN tab_ms USING (tab_ref)) AS total_attention_ms,
    (SELECT count(*) FROM unresolved_questions WHERE user_id = $1 AND status = 'resolved')
        AS total_resolved_questions
"""


async def user_stats(user_id: UUID, conn: asyncpg.Connection) -> dict[str, int]:
    try:
        row = await conn.fetchrow(_STATS_SQL, user_id)
    except (asyncpg.exceptions.UndefinedTableError, asyncpg.exceptions.UndefinedColumnError) as exc:
        log.warning("R's tables are not readable yet (%s); project stats are 0", type(exc).__name__)
        return {"total_forests": 0, "active_goals": 0, "total_attention_ms": 0, "total_resolved_questions": 0}
    return {key: int(row[key]) for key in
            ("total_forests", "active_goals", "total_attention_ms", "total_resolved_questions")}
