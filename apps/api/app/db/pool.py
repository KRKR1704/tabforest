"""One asyncpg pool per app (P-5). Tiger Cloud is reached with DATABASE_URL unchanged (sslmode=require).

The pool is opened at startup; if the database is down then, it is retried on the next request, and
requests get 503 + Retry-After until it is back (SPEC §13).
"""

from __future__ import annotations

import asyncio
import json
import logging

import asyncpg

log = logging.getLogger("tabforest.db")

# Errors that mean "the database is unreachable", not "the request is wrong".
STORAGE_ERRORS: tuple[type[BaseException], ...] = (
    OSError,
    TimeoutError,
    asyncpg.exceptions.PostgresConnectionError,
    asyncpg.exceptions.ConnectionDoesNotExistError,
    asyncpg.exceptions.CannotConnectNowError,
    asyncpg.exceptions.TooManyConnectionsError,
    asyncpg.exceptions.InvalidAuthorizationSpecificationError,
)


class StorageUnavailable(Exception):
    """The pool could not be opened."""


STORAGE_ERRORS = (*STORAGE_ERRORS, StorageUnavailable)


async def _init_connection(conn: asyncpg.Connection) -> None:
    await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


class Database:
    def __init__(self, dsn: str, *, min_size: int = 1, max_size: int = 5) -> None:
        self._dsn = dsn
        self._min_size = min_size
        self._max_size = max_size
        self._pool: asyncpg.Pool | None = None
        self._lock = asyncio.Lock()

    async def pool(self) -> asyncpg.Pool:
        if self._pool is None:
            async with self._lock:
                if self._pool is None:
                    try:
                        self._pool = await asyncpg.create_pool(
                            self._dsn, min_size=self._min_size, max_size=self._max_size,
                            timeout=10, command_timeout=30, init=_init_connection)
                    except STORAGE_ERRORS as exc:
                        raise StorageUnavailable(type(exc).__name__) from exc
                    log.info("database pool open")
        return self._pool

    async def close(self) -> None:
        if self._pool is not None:
            pool, self._pool = self._pool, None
            await pool.close()
