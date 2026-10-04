"""P-10: the nightly per-user retention job (SPEC §6.4, §8.4).

The global policy drops raw events after 90 days. A user who chose 7 or 30 days has their own older events and
sessions deleted here, once a day at 03:00 UTC. It runs inside the API process (one worker) and a database advisory
lock keeps a second process from running it at the same time. Only counts are logged.

Run it by hand against DATABASE_URL:  uv run python -m app.retention
"""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from uuid import UUID

import asyncpg

from app.db.deletion_repository import refresh_aggregates

log = logging.getLogger("tabforest.retention")

RUN_AT_HOUR_UTC = 3
GLOBAL_RETENTION_DAYS = 90
_LOCK = "SELECT pg_try_advisory_lock(hashtextextended('tabforest:retention', 11))"
_UNLOCK = "SELECT pg_advisory_unlock(hashtextextended('tabforest:retention', 11))"

_DELETE_EVENTS = (
    "DELETE FROM browser_events e USING privacy_settings p WHERE e.user_id = p.user_id AND p.retention_days < $1 "
    "AND e.ts < now() - make_interval(days => p.retention_days) AND ($2::uuid[] IS NULL OR e.user_id = ANY($2))")
# A session whose last event is older than the cutoff has no events left.
_DELETE_SESSIONS = (
    "DELETE FROM browser_sessions s USING privacy_settings p WHERE s.user_id = p.user_id AND p.retention_days < $1 "
    "AND s.ended_at < now() - make_interval(days => p.retention_days) AND ($2::uuid[] IS NULL OR s.user_id = ANY($2))")


def next_run(now: datetime) -> datetime:
    """The next 03:00 UTC strictly after `now`."""
    today = now.astimezone(UTC).replace(hour=RUN_AT_HOUR_UTC, minute=0, second=0, microsecond=0)
    return today if today > now else today + timedelta(days=1)


async def run_retention(pool: asyncpg.Pool, only_users: Sequence[UUID] | None = None) -> dict[str, int] | None:
    """Delete events and sessions older than each user's chosen retention. None if another process is running it.

    only_users limits the run to those users (tests); the nightly job passes None and covers everyone.
    """
    only = list(only_users) if only_users is not None else None
    async with pool.acquire() as conn:
        if not await conn.fetchval(_LOCK):
            return None
        try:
            async with conn.transaction():
                events = int((await conn.execute(_DELETE_EVENTS, GLOBAL_RETENTION_DAYS, only)).split()[-1])
                sessions = int((await conn.execute(_DELETE_SESSIONS, GLOBAL_RETENTION_DAYS, only)).split()[-1])
            if events:
                now = datetime.now(UTC)  # everything deleted is older than 7 days (the shortest choice)
                await refresh_aggregates(conn, now - timedelta(days=GLOBAL_RETENTION_DAYS), now - timedelta(days=7))
        finally:
            await conn.execute(_UNLOCK)
    log.info("retention: %d events and %d sessions deleted", events, sessions)
    return {"browser_events": events, "browser_sessions": sessions}


async def retention_loop(get_pool) -> None:
    """Sleep until 03:00 UTC, run, repeat. Never raises: a failed night is logged and the next one still runs."""
    while True:
        wait = (next_run(datetime.now(UTC)) - datetime.now(UTC)).total_seconds()
        await asyncio.sleep(max(wait, 1))
        try:
            await run_retention(await get_pool())
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            log.warning("retention run failed (%s)", type(exc).__name__)


async def _main() -> None:
    pool = await asyncpg.create_pool(os.environ["DATABASE_URL"], min_size=1, max_size=2, timeout=30)
    try:
        print(await run_retention(pool))
    finally:
        await pool.close()


if __name__ == "__main__":
    asyncio.run(_main())
