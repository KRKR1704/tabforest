"""R-13 prune suggestions: rules, the similarity gate, requested-tabs-only, failure handling and the endpoint. No network."""

import asyncio
import copy
from datetime import UTC, datetime, timedelta
from uuid import UUID

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.engine import prune
from app.engine.adapters.stats import FixtureStats, TabAttention
from app.engine.fixtures import load_contract
from app.engine.prune import ACTIONS, NOTE, build_suggestions
from app.engine.schemas import PruneResponse

USER = UUID("00000000-0000-4000-8000-0000000000dd")
GROVE = load_contract("grove.example.json")
EXPECTED = load_contract("prune.example.json")["examples"][0]["response"]["body"]
DEMO = [t["tab_ref"] for t in load_contract("snapshot.example.json")["open_tabs"]]


def tid(n: int) -> str:
    return f"00000000-0000-4000-8000-{n:012d}"


def vec(*xs: float) -> np.ndarray:
    return np.array(xs, dtype=np.float32)


def embedder(by_ref: dict[str, np.ndarray], calls: list | None = None):
    async def embed(items):
        if calls is not None:
            calls.append([r for r, _ in items])
        return {r: by_ref[r] for r, _ in items}
    return embed


# 9 and 10 point almost the same way as the official docs tab 1
CLOSE = {tid(1): vec(1, 0), tid(9): vec(0.95, 0.1), tid(10): vec(0.97, 0.05)}


def run(refs=DEMO, grove=GROVE, embed=None, stats=None):
    return asyncio.run(build_suggestions(USER, refs, grove, embed=embed or embedder(CLOSE),
                                         stats=stats or FixtureStats()))


def by_kind(result):
    return {s["kind"]: s for s in result["suggestions"]}


# --- the contract example ----------------------------------------------------------------------------

def test_the_demo_snapshot_gives_the_contract_suggestions() -> None:
    got = run()
    PruneResponse.model_validate(got)
    assert got["actions"] == EXPECTED["actions"] and got["note"] == EXPECTED["note"]
    assert [s["kind"] for s in got["suggestions"]] == [s["kind"] for s in EXPECTED["suggestions"]]
    for mine, theirs in zip(got["suggestions"], EXPECTED["suggestions"], strict=True):
        assert set(mine["tab_refs"]) == set(theirs["tab_refs"]), mine["kind"]
        assert mine["keep_ref"] == theirs["keep_ref"] and mine["default_selected"] == theirs["default_selected"]
        assert mine["id"].startswith("pr_")
    kinds = by_kind(got)
    assert kinds["exact_duplicate"]["reason"] == "Same page open twice"
    assert kinds["semantic_redundant"]["reason"] == EXPECTED["suggestions"][1]["reason"]
    assert kinds["distraction"]["reason"] == "9 s of focus, unrelated to any goal"


def test_ids_are_unique_and_the_suggestions_default_to_safe_choices() -> None:
    got = run()
    assert len({s["id"] for s in got["suggestions"]}) == len(got["suggestions"])
    selected = {s["kind"] for s in got["suggestions"] if s["default_selected"]}
    assert selected == {"exact_duplicate", "semantic_redundant"}  # stale and distraction are never preselected


# --- only what was asked for -------------------------------------------------------------------------

def test_only_the_requested_tabs_are_considered() -> None:
    got = run(refs=[tid(1), tid(2)])
    assert [s["kind"] for s in got["suggestions"]] == ["exact_duplicate"]
    assert run(refs=[tid(1)])["suggestions"] == []  # one tab of a pair is not a duplicate
    assert run(refs=[tid(9), tid(10)])["suggestions"] == []  # the keeper is not among the requested tabs


def test_unknown_refs_are_ignored_not_an_error() -> None:
    got = run(refs=[tid(1), tid(2), "deadbeef-0000-4000-8000-000000000000"])
    assert [s["kind"] for s in got["suggestions"]] == ["exact_duplicate"]


def test_no_grove_means_no_suggestions_but_the_same_shape() -> None:
    got = run(grove=None)
    assert got == {"suggestions": [], "actions": ACTIONS, "note": NOTE}


# --- semantic redundancy: same branch and similarity >= SIMILARITY_MIN ------------------------------

def test_a_member_below_the_similarity_gate_is_not_suggested() -> None:
    # 10 is about 0.5 from the keeper (below SIMILARITY_MIN); 9 is 0.8 from it and 0.92 from 10, and shares FastAPI and
    # JWT with 10, so 9 still says the same as a fellow member.
    vectors = {tid(1): vec(1, 0), tid(9): vec(0.8, 0.6), tid(10): vec(0.5, 0.866)}
    got = run(embed=embedder(vectors))
    semantic = by_kind(got)["semantic_redundant"]
    assert semantic["tab_refs"] == [tid(9)]


def test_nothing_above_the_gate_means_no_semantic_suggestion() -> None:
    far = {tid(1): vec(1, 0), tid(9): vec(0, 1), tid(10): vec(0.3, 0.9)}
    assert "semantic_redundant" not in by_kind(run(embed=embedder(far)))


def test_the_keeper_gate_sits_exactly_at_the_constant() -> None:
    lo = prune.SIMILARITY_MIN

    def at(cos: float) -> np.ndarray:
        return vec(cos, float(np.sqrt(1 - cos**2)))

    # 9 and 10 are 0.9+ apart from each other, so only their distance to the keeper decides
    vectors = {tid(1): vec(1, 0), tid(9): at(lo + 1e-3), tid(10): at(lo - 1e-3)}
    assert by_kind(run(embed=embedder(vectors)))["semantic_redundant"]["tab_refs"] == [tid(9)]


def pair_at(cos: float) -> dict:
    """Keeper at angle 0; tabs 9 and 10 mirrored around it so that cosine(9, 10) = cos and both are close to it."""
    half = float(np.arccos(cos)) / 2
    return {tid(1): vec(1, 0), tid(9): vec(np.cos(half), np.sin(half)), tid(10): vec(np.cos(half), -np.sin(half))}


def test_the_peer_gate_is_the_calibrated_redundancy_threshold() -> None:
    assert prune.SEMANTIC_VINE_THRESHOLD == 0.66
    above = by_kind(run(embed=embedder(pair_at(0.66 + 1e-3))))["semantic_redundant"]
    assert set(above["tab_refs"]) == {tid(9), tid(10)}
    assert "semantic_redundant" not in by_kind(run(embed=embedder(pair_at(0.66 - 1e-3))))


def retitled(titles: dict[str, str]) -> dict:
    grove = copy.deepcopy(GROVE)
    for tree in grove["trees"]:
        for branch in tree["branches"]:
            for leaf in branch["leaves"]:
                leaf["title"] = titles.get(leaf["tab_ref"], leaf["title"])
    return grove


def test_one_shared_title_term_is_not_enough_however_close_the_vectors() -> None:
    grove = retitled({tid(9): "Securing FastAPI with JWT: a step-by-step guide", tid(10): "Tokens in FastAPI, explained"})
    assert "semantic_redundant" not in by_kind(run(grove=grove, embed=embedder(pair_at(0.99))))


def test_two_shared_distinctive_terms_pass() -> None:
    grove = retitled({tid(9): "Securing FastAPI with JWT: a step-by-step guide", tid(10): "FastAPI JWT authentication explained"})
    assert set(by_kind(run(grove=grove, embed=embedder(pair_at(0.99))))["semantic_redundant"]["tab_refs"]) == {tid(9), tid(10)}


def test_recipe_tabs_that_share_only_the_page_kind_or_one_ingredient_are_not_redundant() -> None:
    leaves = {r: {"title": t, "source_type": "article"} for r, t in (
        ("curry", "Easy Chickpea Curry Recipe"), ("thai", "Thai Green Curry with Chicken Recipe"),
        ("hummus", "Classic Creamy Hummus Recipe"), ("salad", "Chickpea Salad Sandwich Recipe"),
        ("curry2", "Quick Chickpea Curry in 20 Minutes"))}
    same = {r: vec(1, 0) for r in leaves}  # identical vectors: only the title rule can say no
    assert not prune._says_the_same("thai", ["curry", "thai"], same, leaves)      # curry only
    assert not prune._says_the_same("hummus", ["curry", "hummus"], same, leaves)  # nothing shared but "recipe"
    assert not prune._says_the_same("salad", ["curry", "salad"], same, leaves)    # chickpea only
    assert prune._says_the_same("curry2", ["curry", "curry2"], same, leaves)      # chickpea + curry


def test_the_gate_keeps_the_real_demo_pair_and_rejects_unrelated_tabs() -> None:
    # measured with the deployed embedding model on the 28 demo tabs (see the SIMILARITY_MIN comment)
    assert 0.60 >= prune.SIMILARITY_MIN > 0.50
    assert prune.SIMILARITY_MIN < 0.603 and prune.SIMILARITY_MIN < 0.639


def test_a_group_spanning_branches_only_keeps_the_members_in_the_keepers_branch() -> None:
    grove = {**GROVE, "trees": [dict(t) for t in GROVE["trees"]]}
    tree = grove["trees"][0]
    tree["vines"] = [{"tab_refs": [tid(9), tid(5)], "kind": "semantic", "keep_ref": tid(1), "reason": "x"}]
    grove = {**grove, "trees": [{**t, "branches": retitled({tid(9): "OAuth2 password flow with JWT tokens in FastAPI"})
                                 ["trees"][0]["branches"]} if t is tree else t for t in grove["trees"]]}
    vectors = {tid(1): vec(1, 0), tid(9): vec(0.99, 0.01), tid(5): vec(0.99, 0.01)}  # 5 is in the OAuth 2.0 branch
    got = run(grove=grove, embed=embedder(vectors), refs=[tid(1), tid(9), tid(5)])
    assert by_kind(got)["semantic_redundant"]["tab_refs"] == [tid(9)]


def test_embeddings_are_asked_only_for_the_tabs_that_matter() -> None:
    calls: list = []
    run(embed=embedder(CLOSE, calls))
    assert len(calls) == 1 and set(calls[0]) == {tid(1), tid(9), tid(10)}


def test_when_the_embeddings_fail_semantic_suggestions_are_dropped_and_the_rest_stay() -> None:
    async def broken(items):
        raise RuntimeError("azure down")
    got = run(embed=broken)
    assert [s["kind"] for s in got["suggestions"]] == ["exact_duplicate", "stale", "distraction"]


def test_a_zero_vector_never_passes_the_gate() -> None:
    zero = {tid(1): vec(0, 0), tid(9): vec(0, 0), tid(10): vec(0, 0)}
    assert "semantic_redundant" not in by_kind(run(embed=embedder(zero)))


def test_the_semantic_group_is_not_repeated_when_the_same_vine_is_in_two_trees() -> None:
    grove = {**GROVE, "trees": [dict(t) for t in GROVE["trees"]]}
    second = dict(grove["trees"][1]); second["vines"] = list(grove["trees"][0]["vines"])
    grove["trees"][1] = second
    got = run(grove=grove)
    assert [s["kind"] for s in got["suggestions"]].count("semantic_redundant") == 1
    assert [s["kind"] for s in got["suggestions"]].count("exact_duplicate") == 1


# --- stale and distraction ---------------------------------------------------------------------------

def test_stale_is_no_focus_for_three_days_and_not_cited_for_the_tabs_that_were_asked_about() -> None:
    # Job Search: 16 and 17 are stale too but cited as evidence of the goal; 18, 19 and 20 are stale and uncited
    assert set(by_kind(run())["stale"]["tab_refs"]) == {tid(18), tid(19), tid(20)}
    assert set(by_kind(run(refs=[tid(18), tid(1)]))["stale"]["tab_refs"]) == {tid(18)}
    assert "stale" not in by_kind(run(refs=[tid(1), tid(2), tid(16), tid(17)]))   # fresh, or cited


class Attention(FixtureStats):
    """Attention for every requested tab: `ms` of focus, last focused at `last` (None: never)."""

    def __init__(self, ms: int | None, last: datetime | None = datetime(2026, 10, 4, tzinfo=UTC), per_tab=None) -> None:
        super().__init__()
        self.ms, self.last, self.per_tab = ms, last, per_tab or {}

    async def attention(self, user_id, tab_refs, since=None):
        if self.ms is None:
            return {}
        return {r: TabAttention(r, *self.per_tab.get(r, (self.ms, self.last))[:1], 1,
                                self.per_tab.get(r, (self.ms, self.last))[1]) for r in tab_refs}


NOW = datetime(2026, 10, 4, 11, 40, tzinfo=UTC)


def test_stale_comes_from_attention_for_every_tab_the_grove_knows_not_only_uncited_leaves() -> None:
    old = datetime(2026, 10, 1, tzinfo=UTC)  # 3 days 11 h 40 min before NOW
    stats = Attention(60_000, per_tab={tid(26): (60_000, old), tid(9): (60_000, old), tid(1): (60_000, old),
                                       tid(2): (60_000, NOW - timedelta(days=2, hours=23))})
    got = by_kind(run(stats=stats))["stale"]
    # 26 is a meadow tab, 9 an uncited leaf the grove did not mark fallen: both are listed; 1 is cited; 2 is under 3 days
    assert set(got["tab_refs"]) == {tid(26), tid(9)} and got["default_selected"] is False
    # exactly three days is stale, one minute short of it is not
    edge = Attention(60_000, per_tab={tid(26): (60_000, NOW - timedelta(days=3)), tid(9): (60_000, NOW - timedelta(days=3) + timedelta(minutes=1))})
    assert by_kind(run(stats=edge, grove={**GROVE, "generated_at": "2026-10-04T11:40:00Z"}))["stale"]["tab_refs"] == [tid(26)]
    # a tab with no focus record at all is not called stale
    assert "stale" not in by_kind(run(stats=Attention(None)))


def test_stale_is_measured_at_the_time_of_the_grove_not_at_the_time_of_the_request() -> None:
    later = {**GROVE, "generated_at": "2026-10-20T00:00:00Z"}
    assert set(by_kind(run(grove=later))["stale"]["tab_refs"]) >= {tid(18), tid(19), tid(20), tid(26)}  # 16 days on
    assert set(by_kind(run(grove=GROVE))["stale"]["tab_refs"]) == {tid(18), tid(19), tid(20)}
    assert asyncio.run(prune.stale(GROVE, {tid(18)}, prune._leaves(GROVE), USER, FixtureStats(), NOW))[0]["tab_refs"] == [tid(18)]
    assert prune.reference_time({"generated_at": "garbage"}).year >= 2026 and prune.reference_time({}).year >= 2026


def test_distraction_is_under_ten_seconds_for_tabs_in_a_tree_or_not() -> None:
    cited = prune.cited_tabs(GROVE)
    uncited = [r for r in prune.known_tabs(GROVE, prune._leaves(GROVE)) if r not in cited
               and prune._leaves(GROVE).get(r, {}).get("source_type") != "search"]
    for ms, flagged in ((0, True), (9_999, True), (10_000, False), (84_000, False)):
        got = {r for s in run(stats=Attention(ms))["suggestions"] if s["kind"] == "distraction" for r in s["tab_refs"]}
        assert got == (set(uncited) if flagged else set()), ms
    assert tid(9) in uncited and tid(26) in uncited                    # an in-tree leaf and a meadow tab, both candidates


def test_a_cited_tab_and_a_search_page_are_never_distractions() -> None:
    got = {r for s in run(stats=Attention(0))["suggestions"] if s["kind"] == "distraction" for r in s["tab_refs"]}
    assert got.isdisjoint(prune.cited_tabs(GROVE))                       # 1, 3, 4 ... are the evidence of a goal
    searches = {t for t, leaf in prune._leaves(GROVE).items() if leaf["source_type"] == "search"}
    assert searches and got.isdisjoint(searches)                         # 6, 7, 8: steps of a research path


def test_an_in_tree_uncited_leaf_with_a_few_seconds_is_flagged_with_its_own_seconds() -> None:
    got = run(stats=Attention(84_000, per_tab={tid(9): (4_000, NOW), tid(10): (3_000, NOW)}))
    flagged = {s["tab_refs"][0]: s["reason"] for s in got["suggestions"] if s["kind"] == "distraction"}
    assert flagged == {tid(9): "4 s of focus, unrelated to any goal"}    # 10 is cited as evidence: kept out


def test_each_distraction_is_its_own_suggestion_with_its_own_seconds() -> None:
    got = run(refs=GROVE["meadow"])
    flagged = [s for s in got["suggestions"] if s["kind"] == "distraction"]
    assert [s["tab_refs"] for s in flagged] == [[tid(26)]]  # tab 27 had 84 s
    assert flagged[0]["reason"] == "9 s of focus, unrelated to any goal"


# --- the endpoint ------------------------------------------------------------------------------------

@pytest.fixture
def api(client: TestClient, dev_mode: None, monkeypatch: pytest.MonkeyPatch):
    state = {"grove": GROVE, "pool": object(), "asked": []}

    async def get_pool():
        return state["pool"]

    async def last_grove(pool, user_id):
        state["asked"].append(user_id)
        return state["grove"]

    monkeypatch.setattr(prune.db, "get_pool", get_pool)
    monkeypatch.setattr(prune, "last_grove", last_grove)
    monkeypatch.setattr(prune, "_default_embed", lambda user_id, pool: embedder(CLOSE))
    return client, state


H = {"X-Dev-User": str(USER)}


def test_endpoint_returns_the_contract_response(api) -> None:
    client, state = api
    r = client.post("/api/tabs/prune-suggestions", json={"tab_refs": DEMO}, headers=H)
    assert r.status_code == 200
    PruneResponse.model_validate(r.json())
    assert [s["kind"] for s in r.json()["suggestions"]] == [s["kind"] for s in EXPECTED["suggestions"]]
    assert state["asked"] == [USER]  # the grove is looked up for the signed-in user only


def test_endpoint_without_a_database_or_a_grove_is_an_empty_list_not_an_error(api) -> None:
    client, state = api
    state["pool"] = None
    r = client.post("/api/tabs/prune-suggestions", json={"tab_refs": DEMO}, headers=H)
    assert r.status_code == 200 and r.json()["suggestions"] == [] and r.json()["note"] == NOTE
    state["pool"], state["grove"] = object(), None
    assert client.post("/api/tabs/prune-suggestions", json={"tab_refs": DEMO}, headers=H).json()["suggestions"] == []


@pytest.mark.parametrize("body", [
    {}, {"tab_refs": []}, {"tab_refs": ["not-a-uuid"]}, {"tab_refs": [tid(1)], "user_id": "x"},
    {"tab_refs": [f"00000000-0000-4000-8000-{n:012d}" for n in range(1, 62)]},
])
def test_endpoint_rejects_bad_requests_with_a_problem_body(api, body) -> None:
    client, _ = api
    r = client.post("/api/tabs/prune-suggestions", json=body, headers=H)
    assert r.status_code == 422


def test_endpoint_needs_a_user(api) -> None:
    client, _ = api
    r = client.post("/api/tabs/prune-suggestions", json={"tab_refs": [tid(1)]})
    assert r.status_code == 401
