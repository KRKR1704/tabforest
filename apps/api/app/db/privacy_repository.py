"""Privacy settings (P-10): parameterized SQL only, user_id first, every statement filters on it."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from uuid import UUID

import asyncpg

MAX_EXCLUDED_DOMAINS = 500

_COLUMNS = "excluded_domains, paused_until, retention_days, cloud_ai_enabled, updated_at"


class TooManyDomains(Exception):
    """The exclusion list would pass MAX_EXCLUDED_DOMAINS."""


async def get_privacy(user_id: UUID, conn: asyncpg.Connection) -> asyncpg.Record | None:
    return await conn.fetchrow(f"SELECT {_COLUMNS} FROM privacy_settings WHERE user_id = $1", user_id)  # noqa: S608


async def patch_privacy(user_id: UUID, conn: asyncpg.Connection, *, add: Sequence[str], remove: Sequence[str],
                        set_paused: bool, paused_until: datetime | None, retention_days: int | None,
                        cloud_ai_enabled: bool | None) -> asyncpg.Record | None:
    """Change only what was sent; returns the full settings (None if the user has no row).

    The row is locked first, so two PATCHes from two devices cannot overwrite each other's domains.
    Adding a present domain or removing an absent one changes nothing. The list is kept sorted.
    """
    async with conn.transaction():
        row = await conn.fetchrow("SELECT excluded_domains FROM privacy_settings WHERE user_id = $1 FOR UPDATE",
                                  user_id)
        if row is None:
            return None
        domains = sorted((set(row["excluded_domains"]) | set(add)) - set(remove))
        if len(domains) > MAX_EXCLUDED_DOMAINS:
            raise TooManyDomains
        return await conn.fetchrow(
            "UPDATE privacy_settings SET excluded_domains = $2::text[], "
            "paused_until = CASE WHEN $3::boolean THEN $4::timestamptz ELSE paused_until END, "
            "retention_days = coalesce($5::integer, retention_days), "
            "cloud_ai_enabled = coalesce($6::boolean, cloud_ai_enabled), updated_at = now() "
            f"WHERE user_id = $1 RETURNING {_COLUMNS}",  # noqa: S608
            user_id, domains, set_paused, paused_until, retention_days, cloud_ai_enabled)
