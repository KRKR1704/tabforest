"""R-4 embedding cache, without network: fake Azure client and fake stores."""

import asyncio
import logging
from uuid import UUID

import asyncpg
import numpy as np
import pytest

from app.engine import embeddings
from app.engine.embeddings import (MAX_TAB_TEXT, DbStore, LruStore, content_hash, embed_queries, embed_texts,
                                   tab_embedding_text, _from_pgvector, _to_pgvector)
from app.engine.normalize import NormalizedTab, SourceType

USER = UUID("00000000-0000-4000-8000-0000000000cc")


class FakeClient:
    """Deterministic 8-d vectors from the text; can fail on a given call number."""

    def __init__(self, fail_on_call: int | None = None) -> None:
        self.calls: list[list[str]] = []
        self.fail_on_call = fail_on_call

    async def embed(self, texts, batch_size=64):
        self.calls.append(list(texts))
        if self.fail_on_call == len(self.calls):
            raise RuntimeError("azure down")
        return [[float(b) for b in content_hash(t).encode()[:8]] for t in texts]


class RecordingStore(LruStore):
    def __init__(self) -> None:
        super().__init__()
        self.insert_calls = 0

    async def insert(self, user_id, kind, rows):
        self.insert_calls += 1
        return await super().insert(user_id, kind, rows)


@pytest.fixture(autouse=True)
def fresh_module_state():
    embeddings._lru.clear()
    embeddings._warned.clear()
    yield
    embeddings._lru.clear()
    embeddings._warned.clear()


def run(coro):
    return asyncio.run(coro)


def test_dedupes_identical_texts() -> None:
    client, store = FakeClient(), RecordingStore()
    result = run(embed_texts(USER, "tab", [("a", "same"), ("b", "same"), ("c", "other")], None,
                             client=client, store=store))
    assert client.calls == [["same", "other"]]
    s = result.stats
    assert (s.texts_requested, s.unique_texts, s.api_calls, s.cache_hits, s.inserted) == (3, 2, 1, 0, 2)
    assert np.array_equal(result.vectors["a"], result.vectors["b"])
    assert result.vectors["a"].dtype == np.float32


def test_batches_150_texts_into_3_calls() -> None:
    client = FakeClient()
    result = run(embed_texts(USER, "query", [(str(i), f"text {i}") for i in range(150)], None,
                             client=client, store=RecordingStore()))
    assert [len(c) for c in client.calls] == [64, 64, 22]
    assert result.stats.api_calls == 3 and result.stats.inserted == 150 and len(result.vectors) == 150


def test_cache_hit_makes_no_calls() -> None:
    store = RecordingStore()
    items = [(str(i), f"text {i}") for i in range(10)]
    first = run(embed_texts(USER, "tab", items, None, client=FakeClient(), store=store))
    client = FakeClient()
    second = run(embed_texts(USER, "tab", items, None, client=client, store=store))
    assert client.calls == []
    assert (second.stats.api_calls, second.stats.cache_hits, second.stats.inserted) == (0, 10, 0)
    assert all(np.array_equal(first.vectors[k], second.vectors[k]) for k in first.vectors)


def test_partial_failure_writes_nothing() -> None:
    store = RecordingStore()
    with pytest.raises(RuntimeError):
        run(embed_texts(USER, "tab", [(str(i), f"text {i}") for i in range(150)], None,
                        client=FakeClient(fail_on_call=2), store=store))
    assert store.insert_calls == 0
    assert run(store.lookup(USER, [content_hash(f"text {i}") for i in range(150)])) == {}


def test_lru_fallback_when_pool_is_none(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.WARNING, logger="app.engine.embeddings")
    first = run(embed_queries(USER, ["q1", "q2"], None, client=FakeClient()))
    client = FakeClient()
    second = run(embed_queries(USER, ["q1", "q2"], None, client=client))
    assert first.stats.store == second.stats.store == "memory"
    assert client.calls == [] and second.stats.cache_hits == 2
    assert sum("in-process cache" in r.message for r in caplog.records) == 1


def test_missing_table_falls_back_to_lru(caplog: pytest.LogCaptureFixture) -> None:
    class NoTablePool:
        async def fetch(self, *args):
            raise asyncpg.UndefinedTableError('relation "memory_embeddings" does not exist')

    caplog.set_level(logging.WARNING, logger="app.engine.embeddings")
    result = run(embed_texts(USER, "tab", [("a", "x")], None, client=FakeClient(), store=DbStore(NoTablePool())))
    assert result.stats.store == "memory" and result.stats.api_calls == 1
    assert any("memory_embeddings is missing" in r.message for r in caplog.records)


def test_users_do_not_share_cache_entries() -> None:
    store = RecordingStore()
    run(embed_texts(USER, "tab", [("a", "x")], None, client=FakeClient(), store=store))
    client = FakeClient()
    other = run(embed_texts(UUID("00000000-0000-4000-8000-0000000000dd"), "tab", [("a", "x")], None,
                            client=client, store=store))
    assert len(client.calls) == 1 and other.stats.cache_hits == 0


def test_tab_embedding_text_and_hash() -> None:
    nt = NormalizedTab(tab_ref="00000000-0000-4000-8000-000000000001", domain="github.com",
                       title_clean="Add rotation · Pull Request #418", title_norm="add rotation pull request #418",
                       source_type=SourceType.PULL_REQUEST, official=False, search_query=None, dup_key=None)
    assert tab_embedding_text(nt) == "Add rotation · Pull Request #418 | github.com | code"
    long = nt.model_copy(update={"title_clean": "x" * 2000})
    assert len(tab_embedding_text(long)) == MAX_TAB_TEXT
    assert content_hash("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"  # FIPS 180-2 test vector
    assert content_hash("é") != content_hash("é")  # exact UTF-8 string, no normalization
    assert content_hash("a") != content_hash("a ")


def test_pgvector_text_round_trip() -> None:
    v = np.array([0.1, -2.5e-07, 3.0, 1 / 3], dtype=np.float32)
    assert np.array_equal(_from_pgvector(_to_pgvector(v)), v)
