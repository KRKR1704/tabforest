"""R-4 live: real Azure OpenAI + Tiger Cloud. Runs only when both are configured.

Test user 00000000-0000-4000-8000-0000000000bb; its memory_embeddings rows are deleted
before and after. Run with -s to see the stats, timings and the similarity preview.
"""

import asyncio
import time
from itertools import combinations
from uuid import UUID

import numpy as np
import pytest

from app.engine import db
from app.engine.aoai import AzureOpenAIClient
from app.engine.embeddings import embed_queries, embed_tabs
from app.engine.fixtures import load_contract, load_demo_tabs
from app.engine.normalize import normalize_tab
from app.engine.settings import get_settings

settings = get_settings()
pytestmark = pytest.mark.skipif(not (settings.aoai_configured and settings.db_configured),
                                reason="AZURE_OPENAI_API_KEY or DATABASE_URL not set")
USER = UUID("00000000-0000-4000-8000-0000000000bb")
TABS = load_demo_tabs()["open_tabs"]


async def delete_rows(pool) -> int:
    await pool.execute("DELETE FROM memory_embeddings WHERE user_id = $1", USER)
    return await pool.fetchval("SELECT count(*) FROM memory_embeddings WHERE user_id = $1", USER)


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


def test_live_embed_tabs_twice_then_queries_twice() -> None:
    normalized = [normalize_tab(t) for t in TABS]
    queries = [t["search_query"] for t in TABS if t["search_query"]]

    async def run():
        client, pool = AzureOpenAIClient(), await db.get_pool()
        out = {}
        try:
            out["before"] = await delete_rows(pool)
            t = time.perf_counter()
            out["run1"] = await embed_tabs(USER, normalized, pool, client=client)
            out["t1"] = time.perf_counter() - t
            t = time.perf_counter()
            out["run2"] = await embed_tabs(USER, normalized, pool, client=client)
            out["t2"] = time.perf_counter() - t
            out["stored"] = await pool.fetchval("SELECT count(*) FROM memory_embeddings WHERE user_id = $1 "
                                                "AND kind = 'tab'", USER)
            out["q1"] = await embed_queries(USER, queries, pool, client=client)
            out["q2"] = await embed_queries(USER, queries, pool, client=client)
        finally:
            out["after"] = await delete_rows(pool)
            await db.close_pool()
            await client.aclose()
        return out

    r = asyncio.run(run())
    s1, s2, q1, q2 = r["run1"].stats, r["run2"].stats, r["q1"].stats, r["q2"].stats
    print(f"\nrun 1 tabs: {s1}  time {r['t1'] * 1000:.0f} ms")
    print(f"run 2 tabs: {s2}  time {r['t2'] * 1000:.0f} ms")
    print(f"queries 1:  {q1}")
    print(f"queries 2:  {q2}")
    sims = [cosine(r["run1"].vectors[k], r["run2"].vectors[k]) for k in r["run1"].vectors]
    print(f"run 1 vs run 2 cosine: min {min(sims):.7f}; vector length {len(next(iter(r['run1'].vectors.values())))}")
    print(f"tab rows stored: {r['stored']}; rows left for test user after cleanup: {r['after']}")

    assert r["before"] == 0
    assert s1.texts_requested == 28 and s1.unique_texts == 27  # tabs 01 and 02 are the same page
    assert s1.api_calls >= 1 and s1.cache_hits == 0 and s1.inserted == s1.unique_texts and s1.store == "db"
    assert s2.api_calls == 0 and s2.cache_hits == s1.unique_texts and s2.inserted == 0
    assert r["stored"] == s1.unique_texts
    assert min(sims) >= 0.9999
    assert q1.api_calls == 1 and q1.inserted == 3
    assert q2.api_calls == 0 and q2.cache_hits == 3
    assert r["after"] == 0


def groups() -> dict[str, list[str]]:
    grove = load_contract("grove.example.json")
    out = {t["name"]: [l["tab_ref"] for b in t["branches"] for l in b["leaves"]] for t in grove["trees"]}
    out["Sprout"] = grove["sprouts"][0]["tab_refs"]
    out["Meadow"] = grove["meadow"]
    out["Fog"] = [f["tab_ref"] for f in grove["fog"]]
    return out


def test_live_similarity_preview() -> None:
    normalized = [normalize_tab(t) for t in TABS]

    async def run():
        client, pool = AzureOpenAIClient(), await db.get_pool()
        try:
            await delete_rows(pool)
            result = await embed_tabs(USER, normalized, pool, client=client)
            left = await delete_rows(pool)
        finally:
            await db.close_pool()
            await client.aclose()
        return result.vectors, left

    vectors, left = asyncio.run(run())
    g = groups()
    names = list(g)

    def mean_pairs(a: list[str], b: list[str] | None = None) -> float | None:
        pairs = combinations(a, 2) if b is None else ((x, y) for x in a for y in b if x != y)
        values = [cosine(vectors[x], vectors[y]) for x, y in pairs]
        return sum(values) / len(values) if values else None

    short = {"Backend Authentication": "Auth", "GirlHacks Prep": "GirlHacks", "Job Search": "Job",
             "Weeknight Dinner": "Dinner"}
    labels = [short.get(n, n) for n in names]
    print("\nmean cosine (diagonal = intra-group, '-' = single tab)")
    print(f"{'':<10}" + "".join(f"{label:>10}" for label in labels))
    for n, label in zip(names, labels):
        row = [mean_pairs(g[n]) if n == m else mean_pairs(g[n], g[m]) for m in names]
        print(f"{label:<10}" + "".join(f"{'-' if v is None else f'{v:.3f}':>10}" for v in row))
    print(f"rows left for test user after cleanup: {left}")

    auth, dinner = g["Backend Authentication"], g["Weeknight Dinner"]
    assert mean_pairs(auth) > mean_pairs(auth, dinner)
    assert left == 0
