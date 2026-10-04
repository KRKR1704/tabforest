"""Embedding cache (R-4, proposal §14 step 4).

Text for a tab is "{title_clean} | {domain} | {source_type}". Vectors are cached in
memory_embeddings by SHA-256 of the exact string, per user, so a second grow makes 0 API
calls. Without a database (or before R's migration has run) an in-process LRU cache is used.

Azure errors propagate to the caller (R-9 decides what to do). Nothing is written until every
batch of a call has succeeded, so a partial failure never stores half a result.
"""

from __future__ import annotations

import hashlib
import logging
from collections import OrderedDict
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, NamedTuple, Protocol
from uuid import UUID

import asyncpg
import numpy as np

from .aoai import AzureOpenAIClient
from .normalize import NormalizedTab, leaf_source_type

log = logging.getLogger(__name__)

EmbedKind = Literal["tab", "query", "insight", "context"]
MAX_TAB_TEXT = 1000
BATCH = 64
LRU_SIZE = 4096


@dataclass
class EmbedStats:
    texts_requested: int = 0
    unique_texts: int = 0
    cache_hits: int = 0
    api_calls: int = 0
    inserted: int = 0
    store: Literal["db", "memory"] = "db"
    tabs_hash_updated: int | None = None  # rows of P's tabs updated by embed_tabs; None if skipped


class EmbedResult(NamedTuple):
    vectors: dict[str, np.ndarray]
    stats: EmbedStats


def tab_embedding_text(nt: NormalizedTab) -> str:
    return f"{nt.title_clean} | {nt.domain} | {leaf_source_type(nt.source_type).value}"[:MAX_TAB_TEXT]


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _to_pgvector(v: np.ndarray) -> str:
    return "[" + ",".join(f"{x:.9g}" for x in v.tolist()) + "]"


def _from_pgvector(text: str) -> np.ndarray:
    return np.array(text.strip("[]").split(","), dtype=np.float32)


# ---------------------------------------------------------------------------------------
# Stores
# ---------------------------------------------------------------------------------------

class Store(Protocol):
    name: Literal["db", "memory"]

    async def lookup(self, user_id: UUID, hashes: list[str]) -> dict[str, np.ndarray]: ...

    async def insert(self, user_id: UUID, kind: EmbedKind, rows: list[tuple[str, str, np.ndarray]]) -> int: ...


class MissingTable(Exception):
    """memory_embeddings does not exist (R's migration has not run)."""


class DbStore:
    name: Literal["db"] = "db"

    def __init__(self, pool: Any) -> None:
        self.pool = pool

    async def lookup(self, user_id: UUID, hashes: list[str]) -> dict[str, np.ndarray]:
        if not hashes:
            return {}
        try:
            rows = await self.pool.fetch(
                "SELECT content_hash, embedding::text AS embedding FROM memory_embeddings "
                "WHERE user_id = $1 AND content_hash = ANY($2::text[])", user_id, hashes)
        except asyncpg.UndefinedTableError as exc:
            raise MissingTable from exc
        return {r["content_hash"]: _from_pgvector(r["embedding"]) for r in rows}

    async def insert(self, user_id: UUID, kind: EmbedKind, rows: list[tuple[str, str, np.ndarray]]) -> int:
        """rows: (source_id, content_hash, vector). One statement; concurrent grows are safe."""
        if not rows:
            return 0
        inserted = await self.pool.fetch(
            "INSERT INTO memory_embeddings (user_id, kind, source_id, content_hash, embedding) "
            "SELECT $1, $2, s, h, e::vector FROM unnest($3::text[], $4::text[], $5::text[]) AS t(s, h, e) "
            "ON CONFLICT (user_id, content_hash) DO NOTHING RETURNING 1",
            user_id, kind, [r[0] for r in rows], [r[1] for r in rows], [_to_pgvector(r[2]) for r in rows])
        return len(inserted)


class LruStore:
    """In-process fallback when there is no database or no memory_embeddings table."""

    name: Literal["memory"] = "memory"

    def __init__(self, maxsize: int = LRU_SIZE) -> None:
        self.maxsize = maxsize
        self._items: OrderedDict[tuple[UUID, str], np.ndarray] = OrderedDict()

    async def lookup(self, user_id: UUID, hashes: list[str]) -> dict[str, np.ndarray]:
        found = {}
        for h in hashes:
            key = (user_id, h)
            if key in self._items:
                self._items.move_to_end(key)
                found[h] = self._items[key]
        return found

    async def insert(self, user_id: UUID, kind: EmbedKind, rows: list[tuple[str, str, np.ndarray]]) -> int:
        added = 0
        for _, h, vector in rows:
            key = (user_id, h)
            if key not in self._items:
                added += 1
            self._items[key] = vector
            self._items.move_to_end(key)
            while len(self._items) > self.maxsize:
                self._items.popitem(last=False)
        return added

    def clear(self) -> None:
        self._items.clear()


_lru = LruStore()
_warned: set[str] = set()


def _warn_once(key: str, message: str) -> None:
    if key not in _warned:
        _warned.add(key)
        log.warning(message)


_client: AzureOpenAIClient | None = None


def _default_client() -> AzureOpenAIClient:
    global _client
    if _client is None:
        _client = AzureOpenAIClient()
    return _client


# ---------------------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------------------

async def embed_texts(user_id: UUID, kind: EmbedKind, items: Sequence[tuple[str, str]], pool: Any, *,
                      client: AzureOpenAIClient | None = None, store: Store | None = None) -> EmbedResult:
    """Embed (source_id, text) pairs with the per-user cache. Returns float32 vectors by source_id."""
    stats = EmbedStats(texts_requested=len(items))
    unique: dict[str, str] = {}  # content_hash -> text, first-seen order
    for _, text in items:
        unique.setdefault(content_hash(text), text)
    stats.unique_texts = len(unique)

    if store is None:
        if pool is None:
            _warn_once("no-pool", "embeddings: no DATABASE_URL; using the in-process cache")
            store = _lru
        else:
            store = DbStore(pool)
    try:
        cached = await store.lookup(user_id, list(unique))
    except MissingTable:
        _warn_once("no-table", "embeddings: memory_embeddings is missing; using the in-process cache")
        store = _lru
        cached = await store.lookup(user_id, list(unique))
    stats.store = store.name
    stats.cache_hits = len(cached)

    misses = [h for h in unique if h not in cached]
    fresh: dict[str, np.ndarray] = {}
    if misses:
        client = client or _default_client()
        for start in range(0, len(misses), BATCH):  # every batch must succeed before anything is stored
            batch = misses[start:start + BATCH]
            vectors = await client.embed([unique[h] for h in batch], batch_size=BATCH)
            stats.api_calls += 1
            fresh.update({h: np.asarray(v, dtype=np.float32) for h, v in zip(batch, vectors, strict=True)})
        source_of = {}
        for source_id, text in items:
            source_of.setdefault(content_hash(text), source_id)
        stats.inserted = await store.insert(user_id, kind, [(source_of[h], h, fresh[h]) for h in misses])

    by_hash = {**cached, **fresh}
    return EmbedResult({source_id: by_hash[content_hash(text)] for source_id, text in items}, stats)


async def embed_tabs(user_id: UUID, normalized_tabs: Sequence[NormalizedTab], pool: Any, *,
                     client: AzureOpenAIClient | None = None, store: Store | None = None) -> EmbedResult:
    """kind='tab', source_id=tab_ref. Also sets P's tabs.embedding_hash (UPDATE only, §4.5)."""
    items = [(nt.tab_ref, tab_embedding_text(nt)) for nt in normalized_tabs]
    result = await embed_texts(user_id, "tab", items, pool, client=client, store=store)
    if pool is not None and items:
        result.stats.tabs_hash_updated = await _update_tab_hashes(pool, user_id, items)
    return result


async def _update_tab_hashes(pool: Any, user_id: UUID, items: list[tuple[str, str]]) -> int | None:
    try:
        status = await pool.execute(
            "UPDATE tabs SET embedding_hash = v.h FROM unnest($2::uuid[], $3::text[]) AS v(ref, h) "
            "WHERE tabs.user_id = $1 AND tabs.tab_ref = v.ref AND tabs.embedding_hash IS DISTINCT FROM v.h",
            user_id, [UUID(ref) for ref, _ in items], [content_hash(text) for _, text in items])
    except (asyncpg.UndefinedTableError, asyncpg.UndefinedColumnError):
        if "tabs-missing" not in _warned:
            _warned.add("tabs-missing")
            log.debug("embeddings: P's tabs.embedding_hash is not there yet; skipped")
        return None
    return int(status.split()[-1])


async def embed_queries(user_id: UUID, queries: Sequence[str], pool: Any, *,
                        client: AzureOpenAIClient | None = None, store: Store | None = None) -> EmbedResult:
    """kind='query' (R-6 query families); source_id is the query text."""
    return await embed_texts(user_id, "query", [(q, q) for q in queries], pool, client=client, store=store)
