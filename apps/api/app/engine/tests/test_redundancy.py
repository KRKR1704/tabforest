"""Audit fix 4: deterministic semantic vines (redundancy.py), their threshold fixture, and R-13's use of them.
No network: tab vectors are built from chosen cosines."""

import asyncio
import importlib.util
import uuid
from pathlib import Path
from types import SimpleNamespace

import numpy as np

from app.engine import grove as grove_mod
from app.engine import prune
from app.engine.adapters.stats import get_stats_source
from app.engine.fixtures import FIXTURES_DIR, _json
from app.engine.model_schema import ClusterInference
from app.engine.redundancy import (KEEPER_MIN_COSINE, MIN_SHARED_TERMS, SEMANTIC_VINE_THRESHOLD, distinctive_terms,
                                   semantic_vines, shared_distinctive_terms)
from app.engine.tests import test_grow as tg

SCRIPTS = Path(prune.__file__).parent / "scripts"


def script(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def vectors_for(refs: list[str], cos: dict[tuple[str, str], float], default: float = 0.4) -> dict[str, np.ndarray]:
    """Unit vectors with exactly the given pairwise cosines (Cholesky of the cosine matrix); unlisted pairs get
    `default`, below every threshold in play, which keeps the matrix a valid one."""
    c = np.full((len(refs), len(refs)), default)
    np.fill_diagonal(c, 1.0)
    for (a, b), v in cos.items():
        c[refs.index(a), refs.index(b)] = c[refs.index(b), refs.index(a)] = v
    assert np.linalg.eigvalsh(c).min() > 1e-9, "not a valid cosine matrix"
    return dict(zip(refs, np.linalg.cholesky(c), strict=True))


# The demo's situation: two articles that restate the official docs, a GitHub example, a Q&A page and a search tab.
REFS = ["docs", "art_a", "art_b", "code", "qa", "search"]
COS = {("art_a", "art_b"): 0.744, ("docs", "art_a"): 0.639, ("docs", "art_b"): 0.603, ("docs", "code"): 0.60,
       ("code", "art_b"): 0.64, ("code", "art_a"): 0.618, ("qa", "art_a"): 0.55, ("qa", "docs"): 0.543,
       ("search", "art_a"): 0.80, ("search", "art_b"): 0.80}
TYPES = {"docs": "docs", "art_a": "article", "art_b": "article", "code": "code", "qa": "qa", "search": "search"}
OFFICIAL = {"docs"}


def features(official=OFFICIAL, titles=None):
    return SimpleNamespace(tabs={r: SimpleNamespace(official=r in official, source_type=TYPES[r],
                                                    title=(titles or {}).get(r, f"Title of {r}")) for r in REFS})


def branch(*refs: str, types=TYPES):
    return {"label": "JWT", "status": "active", "leaves": [{"tab_ref": r, "source_type": types[r]} for r in refs]}


IMPORTANCE = {"docs": 0.4, "art_a": 0.3, "art_b": 0.2, "code": 0.5, "qa": 0.1, "search": 0.0}


def run(branches, vectors=None, **kw):
    return semantic_vines(branches, features(), vectors or vectors_for(REFS, COS), IMPORTANCE, **kw)


# --- the rule ------------------------------------------------------------------------------------------------------------

def test_two_redundant_articles_are_grouped_and_the_official_docs_are_the_keeper() -> None:
    [vine] = run([branch("docs", "art_a", "art_b", "code", "qa", "search")])
    assert vine["kind"] == "semantic" and vine["tab_refs"] == ["art_a", "art_b"] and vine["keep_ref"] == "docs"
    assert vine["reason"] == "These pages cover the same ground as the official docs: Title of docs"


def test_docs_versus_the_github_example_is_never_flagged_whatever_the_cosine() -> None:
    cos = {**COS, ("docs", "code"): 0.95}  # even identical-looking: different leaf types are different kinds of source
    vines = run([branch("docs", "art_a", "art_b", "code")], vectors_for(REFS, cos))
    assert all("code" not in v["tab_refs"] and v["keep_ref"] != "code" for v in vines)


def test_the_threshold_is_inclusive_and_below_it_nothing_is_grouped() -> None:
    at = vectors_for(REFS, {**COS, ("art_a", "art_b"): SEMANTIC_VINE_THRESHOLD})
    below = vectors_for(REFS, {**COS, ("art_a", "art_b"): SEMANTIC_VINE_THRESHOLD - 0.005})
    assert len(run([branch("docs", "art_a", "art_b")], at)) == 1
    assert run([branch("docs", "art_a", "art_b")], below) == []


def test_tabs_in_different_branches_or_of_the_search_type_are_not_grouped() -> None:
    assert run([branch("docs", "art_a"), branch("art_b", "code")]) == []
    searches = {**TYPES, "art_a": "search", "art_b": "search"}
    assert run([branch("docs", "art_a", "art_b", types=searches)]) == []


def test_without_a_close_official_page_the_keeper_is_in_the_group_by_importance() -> None:
    far = vectors_for(REFS, {**COS, ("docs", "art_a"): 0.50, ("docs", "art_b"): 0.49})  # below KEEPER_MIN_COSINE
    [vine] = run([branch("docs", "art_a", "art_b")], far)
    assert vine["keep_ref"] == "art_a" and vine["tab_refs"] == ["art_a", "art_b"]      # art_a: higher importance
    assert vine["reason"] == "These pages cover the same ground; the most-used one is kept"


def test_an_official_page_inside_the_group_is_kept_over_a_more_important_blog_post() -> None:
    types = {**TYPES, "docs": "article"}
    three = ["docs", "art_a", "art_b"]
    cos = {("docs", "art_a"): 0.80, ("docs", "art_b"): 0.70, ("art_a", "art_b"): 0.744}
    vines = semantic_vines([branch("docs", "art_a", "art_b", types=types)], features(), vectors_for(three, cos),
                           {**IMPORTANCE, "docs": 0.05})
    assert len(vines) == 1 and vines[0]["keep_ref"] == "docs" and set(vines[0]["tab_refs"]) == {"docs", "art_a", "art_b"}
    assert vines[0]["reason"].endswith("the official one is kept")


def test_groups_already_covered_by_an_exact_or_model_vine_are_skipped() -> None:
    assert run([branch("docs", "art_a", "art_b")], taken=[{"art_a", "art_b"}]) == []
    assert run([branch("docs", "art_a", "art_b")], taken=[{"art_a", "art_b", "qa"}]) == []
    assert len(run([branch("docs", "art_a", "art_b")], taken=[{"art_a", "code"}])) == 1   # partial overlap: still new
    assert run([branch("docs", "art_a", "art_b")], skip={"art_b"}) == []                  # art_b is an exact copy of another


def test_a_chain_of_close_pages_is_one_group() -> None:
    refs = ["a", "b", "c"]
    types = {"a": "article", "b": "article", "c": "article"}
    vecs = vectors_for(refs, {("a", "b"): 0.70, ("b", "c"): 0.70, ("a", "c"): 0.45})
    feats = SimpleNamespace(tabs={r: SimpleNamespace(official=False, source_type="article", title=r) for r in refs})
    [vine] = semantic_vines([{"label": "x", "status": "active", "leaves": [{"tab_ref": r, "source_type": types[r]} for r in refs]}],
                            feats, vecs, {"a": 0.1, "b": 0.3, "c": 0.2})
    assert vine["tab_refs"] == ["a", "b", "c"] and vine["keep_ref"] == "b"


def test_the_keeper_bar_equals_the_prune_gate() -> None:
    assert KEEPER_MIN_COSINE == prune.SIMILARITY_MIN


def test_prune_uses_the_redundancy_constant_for_model_groups() -> None:
    assert prune.SEMANTIC_VINE_THRESHOLD is SEMANTIC_VINE_THRESHOLD and prune.MIN_SHARED_TERMS == MIN_SHARED_TERMS == 2


def test_distinctive_terms_drop_stopwords_page_kind_words_and_the_leaf_type() -> None:
    assert distinctive_terms("Easy Chickpea Curry Recipe", "article") == {"chickpea", "curry"}
    assert distinctive_terms("Creamy Homemade Hummus Recipe", "article") == {"creamy", "hummus"}
    assert distinctive_terms("Securing FastAPI with JWT: a step-by-step guide") == {"securing", "fastapi", "jwt"}
    assert distinctive_terms("Rust docs: Ownership - The Rust Programming Language", "docs") == {"rust", "ownership"}  # suffix cut, "docs" dropped
    assert distinctive_terms("Quick Chickpea Curry in 20 Minutes") == {"chickpea", "curry"}


def test_two_shared_terms_are_needed_and_a_shared_page_kind_does_not_count() -> None:
    assert shared_distinctive_terms("Easy Chickpea Curry Recipe", "article", "Quick Chickpea Curry in 20 Minutes", "article") \
        == {"chickpea", "curry"}
    assert shared_distinctive_terms("Classic Hummus Recipe", "article", "Thai Green Curry Recipe", "article") == frozenset()
    assert len(shared_distinctive_terms("Easy Chickpea Curry Recipe", "article", "Chickpea Salad Recipe", "article")) == 1


def test_the_fixture_has_the_live_finding_recipes_as_related_never_redundant() -> None:
    data = _json(FIXTURES_DIR / "title_pairs.json")
    tabs = {t["id"]: t for t in data["tabs"]}
    finding = {"coconut_chickpea_curry", "thai_green_curry", "tikka_masala", "dal", "hummus", "pepper_hummus",
               "chickpea_salad", "roasted_chickpeas"}
    assert finding <= {t["group"] for t in tabs.values()}
    for p in data["pairs"]:
        a, b = tabs[p["a"]], tabs[p["b"]]
        if a["group"] in finding and b["group"] in finding:
            assert p["label"] == "related"


# --- the labeled title-pair fixture ----------------------------------------------------------------------------------------

def test_the_fixture_is_what_the_generator_writes_and_is_big_enough() -> None:
    data = _json(FIXTURES_DIR / "title_pairs.json")
    assert data == script("gen_title_pairs").build()                      # no drift between generator and file
    ids = {t["id"] for t in data["tabs"]}
    assert all(p["a"] in ids and p["b"] in ids for p in data["pairs"]) and len(data["pairs"]) >= 30
    counts = {k: sum(p["label"] == k for p in data["pairs"]) for k in ("redundant", "related", "unrelated")}
    assert counts["redundant"] >= 20 and counts["related"] >= 100 and counts["unrelated"] >= 50
    tabs = {t["id"]: t for t in data["tabs"]}
    for p in data["pairs"]:  # the labels follow the groups
        a, b = tabs[p["a"]], tabs[p["b"]]
        assert p["label"] == ("redundant" if (a["topic"], a["group"]) == (b["topic"], b["group"])
                              else "related" if a["topic"] == b["topic"] else "unrelated")
    titles = " ".join(t["title"].lower() for t in data["tabs"])
    assert "securing fastapi with jwt" not in titles and "fastapi jwt authentication explained" not in titles  # demo titles are not in it


def test_the_calibration_picks_the_best_f1_and_prefers_precision_on_ties() -> None:
    cal = script("calibrate_redundancy")
    rows = [(0.9, "redundant"), (0.8, "redundant"), (0.7, "redundant"), (0.62, "related"), (0.5, "related"), (0.2, "unrelated")]
    assert 0.63 <= cal.choose(rows) <= 0.70                  # every threshold in this range separates the two classes
    assert cal.choose(rows) == 0.70                          # ties go to the higher threshold
    p, r, f1, tp, fp = cal.scores(rows, cal.choose(rows))
    assert (p, r, tp, fp) == (1.0, 1.0, 3, 0)
    p, r, *_ = cal.scores(rows, 0.5)
    assert (round(p, 3), r) == (0.6, 1.0)


# --- in the grove, and through R-13 --------------------------------------------------------------------------------------------

def tab_vectors() -> dict[str, np.ndarray]:
    """Orthogonal vectors for every demo tab, except tabs 1 (docs), 4 (GitHub), 9 and 10 (the articles) at the live cosines."""
    refs = [tg.tid(n) for n in range(1, 29)]
    out = {r: np.eye(64)[i] for i, r in enumerate(refs)}
    four = [tg.tid(1), tg.tid(4), tg.tid(9), tg.tid(10)]
    small = vectors_for(four, {(tg.tid(9), tg.tid(10)): 0.744, (tg.tid(1), tg.tid(9)): 0.639, (tg.tid(1), tg.tid(10)): 0.603,
                               (tg.tid(1), tg.tid(4)): 0.600, (tg.tid(4), tg.tid(10)): 0.640, (tg.tid(4), tg.tid(9)): 0.618})
    for r, v in small.items():
        out[r] = np.concatenate([np.zeros(32), v, np.zeros(28)])
    out[tg.tid(2)] = out[tg.tid(1)]  # the exact duplicate of tab 1
    return out


def auth_inference(groups=()):
    ev = [{"ref": "t1", "why": "docs"}, {"ref": "t3", "why": "example"}]
    return ClusterInference.model_validate({
        "project_name": "Auth", "goal": {"text": "Choose an approach", "provenance": "inferred", "confidence": 0.8, "evidence": ev},
        # t1 = tab 1, t3 = tab 4, t6 = tab 9, t9 = tab 10: all in one branch, as in the live grove
        "branches": [{"branch_ref": "b1", "label": "JWT", "tab_refs": ["t1", "t3", "t6", "t9", "t7"], "status": "active"}],
        "current_direction": None, "decisions": [], "unresolved_questions": [], "blockers": [], "next_actions": [],
        "redundant_groups": list(groups), "important_tab_refs": ["t1"], "hypotheses": []})


def grow_with(monkeypatch, vectors, groups=()):
    async def fake_embed(user_id, normalized_tabs, pool, *, client=None, store=None):
        if vectors is None:
            raise RuntimeError("embeddings are down")
        return SimpleNamespace(vectors={t.tab_ref: vectors[t.tab_ref] for t in normalized_tabs})
    monkeypatch.setattr(grove_mod, "embed_tabs", fake_embed)
    run_, _ = tg.run_grow(tg.FakeClient({"auth": lambda _: auth_inference(groups)}), monkeypatch=monkeypatch)
    return run_.response, next(t for t in run_.response["trees"] if tg.tid(1) in [l["tab_ref"] for b in t["branches"] for l in b["leaves"]])


def test_the_grove_gets_a_semantic_vine_for_the_two_articles_and_not_for_docs_vs_github(monkeypatch) -> None:
    _, tree = grow_with(monkeypatch, tab_vectors())
    kinds = [(v["kind"], sorted(v["tab_refs"]), v["keep_ref"]) for v in tree["vines"]]
    assert ("exact", sorted([tg.tid(1), tg.tid(2)]), tg.tid(1)) in kinds
    assert ("semantic", sorted([tg.tid(9), tg.tid(10)]), tg.tid(1)) in kinds             # keeper = the official docs
    assert not any(tg.tid(4) in v["tab_refs"] or (v["kind"] == "semantic" and v["keep_ref"] == tg.tid(4)) for v in tree["vines"])
    assert not any(v["kind"] == "semantic" and tg.tid(2) in v["tab_refs"] for v in tree["vines"])   # the duplicate copy is skipped


def test_a_model_group_for_the_same_tabs_is_not_repeated(monkeypatch) -> None:
    group = {"tab_refs": ["t6", "t9"], "keep_ref": "t1", "reason": "Both restate the official docs"}
    _, tree = grow_with(monkeypatch, tab_vectors(), [group])
    semantic = [v for v in tree["vines"] if v["kind"] == "semantic"]
    assert len(semantic) == 1 and semantic[0]["reason"] == "Both restate the official docs"   # the model's wins, no twin


def test_without_embeddings_the_grow_still_works_and_has_no_semantic_vine(monkeypatch) -> None:
    response, tree = grow_with(monkeypatch, None)
    assert not [v for v in tree["vines"] if v["kind"] == "semantic"] and response["trees"]


def test_prune_flags_the_two_articles_keeps_the_official_docs_and_leaves_the_github_example_alone(monkeypatch) -> None:
    grove, _ = grow_with(monkeypatch, tab_vectors())
    vectors = tab_vectors()

    async def embed(items):
        return {ref: vectors[ref] for ref, _ in items}
    refs = [t["tab_ref"] for t in tg.DEMO["open_tabs"]]
    out = asyncio.run(prune.build_suggestions(uuid.uuid4(), refs, grove, embed=embed, stats=get_stats_source()))
    semantic = [s for s in out["suggestions"] if s["kind"] == "semantic_redundant"]
    assert len(semantic) == 1 and semantic[0]["keep_ref"] == tg.tid(1)
    assert set(semantic[0]["tab_refs"]) == {tg.tid(9), tg.tid(10)}      # the redundant ones; the keeper is keep_ref
    assert not any(tg.tid(4) in s["tab_refs"] for s in out["suggestions"] if s["kind"] in ("semantic_redundant", "exact_duplicate"))
    assert [s["tab_refs"] for s in out["suggestions"] if s["kind"] == "exact_duplicate"] == [[tg.tid(1), tg.tid(2)]]
    assert semantic[0]["default_selected"] is True


def test_the_prune_gate_still_drops_a_group_the_second_check_rejects(monkeypatch) -> None:
    grove, _ = grow_with(monkeypatch, tab_vectors())
    far = tab_vectors()
    far[tg.tid(9)] = np.concatenate([np.zeros(32), np.array([0, 0, 1.0, 0]), np.zeros(28)])  # near nothing the grove saw

    async def embed(items):
        return {ref: far[ref] for ref, _ in items}
    refs = [t["tab_ref"] for t in tg.DEMO["open_tabs"]]
    out = asyncio.run(prune.build_suggestions(uuid.uuid4(), refs, grove, embed=embed, stats=get_stats_source()))
    semantic = [s for s in out["suggestions"] if s["kind"] == "semantic_redundant"]
    assert all(tg.tid(9) not in s["tab_refs"] for s in semantic)


def test_the_tabs_the_grove_embeds_are_the_tabs_prune_will_embed() -> None:
    # same text => same cache key => prune costs no embedding call after a grow
    from app.engine.embeddings import tab_embedding_text
    from app.engine.normalize import normalize_tab
    tab = tg.DEMO["open_tabs"][8]
    leaf = {"tab_ref": tab["tab_ref"], "domain": tab["domain"], "title": tab["title"]}
    assert tab_embedding_text(normalize_tab(tab)) == tab_embedding_text(normalize_tab(leaf))
