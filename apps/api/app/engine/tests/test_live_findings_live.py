"""Live-findings fixes, live: real Azure OpenAI (no database; embeddings use the in-process cache).

- the demo grows to the same trees twice;
- a burst of 20 tabs on 4 unrelated topics, all opened within 2.5 minutes, grows into trees that never mix topics;
- prune with real embeddings still flags tabs 9 and 10 (the redundant JWT articles) and never tab 4.
Run with -s to see the tree counts.
"""

import asyncio
import uuid
from datetime import datetime

import pytest

from app.engine.adapters.stats import FixtureStats
from app.engine.aoai import AzureOpenAIClient
from app.engine.embeddings import embed_texts
from app.engine.evaluation import load_labeled_snapshot
from app.engine.fixtures import load_contract, load_demo_tabs
from app.engine.grove import GrowRun
from app.engine.prune import build_suggestions
from app.engine.settings import get_settings

settings = get_settings()
pytestmark = pytest.mark.skipif(not settings.aoai_configured, reason="AZURE_OPENAI_API_KEY not set")
USER = uuid.UUID("00000000-0000-4000-8000-0000000000f8")
DEMO = load_demo_tabs()
GROVE = load_contract("grove.example.json")


def snap_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def leaves(tree: dict) -> list[str]:
    return [leaf["tab_ref"] for b in tree["branches"] for leaf in b["leaves"]]


def grow(tabs: list[dict], snapshot_at: str) -> dict:
    async def go():
        client = AzureOpenAIClient()
        try:
            run = GrowRun(USER, tabs, 0, pool=None, client=client, snapshot_at=snap_time(snapshot_at))
            async for _ in run.stream():
                pass
            return run.response
        finally:
            await client.aclose()
    return asyncio.run(go())


def test_the_demo_grows_to_the_same_trees_twice() -> None:
    first, second = (grow(DEMO["open_tabs"], DEMO["snapshot_at"]) for _ in range(2))
    names = [[t["name"] for t in r["trees"]] for r in (first, second)]
    print(f"\ndemo grow 1: {len(first['trees'])} trees {names[0]}\ndemo grow 2: {len(second['trees'])} trees {names[1]}")
    assert len(first["trees"]) == len(second["trees"]) >= 4
    assert sorted(sorted(leaves(t)) for t in first["trees"]) == sorted(sorted(leaves(t)) for t in second["trees"])


def test_a_burst_of_unrelated_tabs_does_not_merge_across_topics() -> None:
    burst = load_labeled_snapshot("burst_unrelated")
    response = grow(burst["open_tabs"], burst["snapshot_at"])
    topics = burst["labels"]
    print(f"\nburst grow: {len(response['trees'])} trees")
    for tree in response["trees"]:
        found = {topics[r] for r in leaves(tree)}
        print(f"   {tree['name']!r}: {len(leaves(tree))} tabs, topics {sorted(found)}")
        assert len(found) == 1, f"tree {tree['name']!r} mixes topics {found}"
    assert len(response["trees"]) == 4


def test_prune_with_real_embeddings_flags_9_and_10_and_never_4() -> None:
    def tid(n: int) -> str:
        return f"00000000-0000-4000-8000-{n:012d}"

    async def go():
        client = AzureOpenAIClient()

        async def embed(items):
            return (await embed_texts(USER, "tab", items, None, client=client)).vectors
        try:
            refs = [t["tab_ref"] for t in DEMO["open_tabs"]]
            return await build_suggestions(USER, refs, GROVE, embed=embed, stats=FixtureStats())
        finally:
            await client.aclose()
    got = asyncio.run(go())
    semantic = [s for s in got["suggestions"] if s["kind"] == "semantic_redundant"]
    print(f"\nsemantic suggestions: {[(sorted(int(r[-3:]) for r in s['tab_refs']), 'keep', int(s['keep_ref'][-3:])) for s in semantic]}")
    assert len(semantic) == 1 and set(semantic[0]["tab_refs"]) == {tid(9), tid(10)}
    assert all(tid(4) not in s["tab_refs"] for s in got["suggestions"])
