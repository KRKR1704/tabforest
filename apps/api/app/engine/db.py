"""Optional asyncpg pool for Tiger Cloud.

DATABASE_URL is passed to asyncpg unchanged, so `sslmode=require` is kept. When it is
unset, get_pool() returns None and callers use the fixtures instead.
"""

from __future__ import annotations

import asyncio

import asyncpg

from .settings import get_settings

_pool: asyncpg.Pool | None = None
_lock = asyncio.Lock()


async def get_pool() -> asyncpg.Pool | None:
    global _pool
    settings = get_settings()
    if not settings.db_configured:
        return None
    if _pool is None:
        async with _lock:
            if _pool is None:
                _pool = await asyncpg.create_pool(
                    settings.database_url.get_secret_value(), min_size=1, max_size=5, command_timeout=30)
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
