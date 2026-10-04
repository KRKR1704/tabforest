"""C12 adapter (R → P): reads R's tables (projects, intent_clusters, cluster_tabs,
unresolved_questions). Read only; R owns these tables (§4.5).

If R's tables don't exist yet, the user has no projects, so every project count is 0; that is
the true value, not a guess (§2 rule 4).
"""

from __future__ import annotations

import logging
from uuid import UUID

import asyncpg

log = logging.getLogger("tabforest.adapters.intents")

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
