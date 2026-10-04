"""R-5 clustering rules with synthetic vectors (no network)."""

import zlib
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

from app.engine.cluster import PARAMS, ClusterTab, affinity_matrix, calibrate, cluster
from app.engine.labels import top_terms

SNAP = datetime(2026, 10, 4, 12, 0, tzinfo=timezone.utc)
DIM = 16


def basis(k: int) -> np.ndarray:
    v = np.zeros(DIM)
    v[k] = 1.0
    return v


def unit(v: np.ndarray) -> np.ndarray:
    return v / np.linalg.norm(v)


def jitter(v: np.ndarray, seed: int) -> np.ndarray:
    return unit(v + np.random.default_rng(seed).normal(0, 0.03, DIM))


def tab(ref: str, minutes_ago: int, *, title: str = "", opener: str | None = None, search: bool = False) -> ClusterTab:
    return ClusterTab(ref, title or ref, opener, SNAP - timedelta(minutes=minutes_ago), search)


def two_groups():
    """Group A: a1..a3 near basis 0; group B: b1..b3 near basis 1; opened 15 min apart (no temporal edges)."""
    tabs, vecs = [], {}
    for g, k, start in (("a", 0, 300), ("b", 1, 200)):
        for i in range(3):
            ref = f"{g}{i + 1}"
            tabs.append(tab(ref, start - 15 * i, title=f"{'alpha' if g == 'a' else 'beta'} topic page {i}"))
            vecs[ref] = jitter(basis(k), zlib.crc32(ref.encode()))  # stable seed (str hash is per-process)
    return tabs, vecs


def members(result, ref: str) -> set[str]:
    return next(set(c.tab_refs) for c in result.clusters + result.sprouts if ref in c.tab_refs)


# --- affinity and calibration ------------------------------------------------------------

def test_calibration_options() -> None:
    cos = np.array([[1.0, 0.30, 0.05], [0.30, 1.0, 0.60], [0.05, 0.60, 1.0]])
    fixed, lo, hi = calibrate(cos, replace(PARAMS, calibration="fixed", lo=0.05, hi=0.50))
    assert (lo, hi) == (0.05, 0.50) and fixed[0, 1] == pytest.approx(0.25 / 0.45) and fixed[1, 2] == 1.0
    raw, _, _ = calibrate(cos, replace(PARAMS, calibration="raw"))
    assert np.array_equal(raw, cos)
    snap, lo, hi = calibrate(cos, replace(PARAMS, calibration="snapshot", lo=50, hi=95))
    off = cos[~np.eye(3, dtype=bool)]
    assert lo == pytest.approx(np.percentile(off, 50)) and hi == pytest.approx(np.percentile(off, 95))
    assert snap.min() >= 0 and snap.max() <= 1


def test_affinity_opener_and_temporal_components() -> None:
    tabs = [tab("x", 100), tab("y", 99, opener="x"), tab("z", 50)]
    vecs = np.stack([basis(0), basis(1), basis(2)])  # cosine 0 everywhere
    aff, _, _ = affinity_matrix(tabs, vecs, PARAMS)
    assert aff[0, 1] == pytest.approx(PARAMS.w_opener + PARAMS.w_temporal)  # opener + opened 1 min apart
    assert aff[0, 2] == pytest.approx(0.0)
    assert aff[1, 0] == aff[0, 1]


# --- clustering, search tabs, sprouts ----------------------------------------------------------

def test_two_clear_groups() -> None:
    tabs, vecs = two_groups()
    r = cluster(tabs, vecs, SNAP)
    assert len(r.clusters) == 2 and not r.sprouts and not r.meadow and not r.fog
    assert members(r, "a1") == {"a1", "a2", "a3"} and members(r, "b1") == {"b1", "b2", "b3"}


def test_search_tab_follows_the_tab_it_opened() -> None:
    tabs, vecs = two_groups()
    tabs.append(tab("s", 400, search=True))
    tabs = [t if t.tab_ref != "a2" else replace(t, opener_tab_ref="s") for t in tabs]
    vecs["s"] = jitter(basis(1), 7)  # text closest to group B
    r = cluster(tabs, vecs, SNAP)
    assert "s" in members(r, "a1")


def test_search_tab_uses_next_focus_then_nearest() -> None:
    tabs, vecs = two_groups()
    tabs.append(tab("s", 400, search=True))
    vecs["s"] = jitter(basis(0), 8)  # nearest is A
    assert "s" in members(cluster(tabs, vecs, SNAP), "a1")
    assert "s" in members(cluster(tabs, vecs, SNAP, next_focus={"s": "b2"}), "b1")


def test_sprout_rule() -> None:
    tabs, vecs = two_groups()
    for i, minutes in enumerate((20, 10)):
        tabs.append(tab(f"n{i}", minutes))
        vecs[f"n{i}"] = jitter(basis(2), 20 + i)
    r = cluster(tabs, vecs, SNAP)
    assert [set(s.tab_refs) for s in r.sprouts] == [{"n0", "n1"}]
    assert len(r.clusters) == 2
    old = [replace(t, opened_at=SNAP - timedelta(minutes=45)) if t.tab_ref == "n0" else t for t in tabs]
    assert not cluster(old, vecs, SNAP).sprouts  # earliest tab 45 min old: a tree
    tabs.append(tab("n2", 5))
    vecs["n2"] = jitter(basis(2), 30)
    assert not cluster(tabs, vecs, SNAP).sprouts  # 3 tabs: a tree


# --- singletons: fog vs meadow -----------------------------------------------------------

def test_fog_when_ambiguous_meadow_otherwise() -> None:
    tabs, vecs = two_groups()
    tabs += [tab("between", 500), tab("lonely", 600)]
    vecs["between"] = unit(0.27 * basis(0) + 0.27 * basis(1) + 0.924 * basis(5))
    vecs["lonely"] = basis(9)
    r = cluster(tabs, vecs, SNAP)
    assert [s.tab_ref for s in r.fog] == ["between"]
    assert r.fog[0].reason.startswith("unclear between ") and " and " in r.fog[0].reason
    assert [(s.tab_ref, s.reason) for s in r.meadow] == [("lonely", "low affinity to any goal")]


# --- multi-membership (§27) ---------------------------------------------------------------

def test_tab_between_two_clusters_is_shared() -> None:
    tabs, vecs = two_groups()
    tabs.append(tab("bridge", 250))
    vecs["bridge"] = unit(basis(0) + basis(1))
    r = cluster(tabs, vecs, SNAP)
    assert list(r.shared_tab_refs) == ["bridge"]
    holding = [c.id for c in r.clusters if "bridge" in c.tab_refs]
    assert len(holding) == 2 and r.shared_tab_refs["bridge"][0] in holding
    assert sum(1 for v in r.assignment().values() if v in holding) == 7  # primary membership counted once


# --- pins and existing projects ---------------------------------------------------------------

def projects(vecs) -> dict[str, np.ndarray]:
    return {"p_a": unit(sum(vecs[f"a{i}"] for i in (1, 2, 3))), "p_b": unit(sum(vecs[f"b{i}"] for i in (1, 2, 3)))}


def test_existing_project_match_and_none_without_history() -> None:
    tabs, vecs = two_groups()
    r = cluster(tabs, vecs, SNAP, existing_projects=projects(vecs))
    assert {c.id: c.is_existing_project_id for c in r.clusters} == {"p_a": "p_a", "p_b": "p_b"}
    assert all(c.is_existing_project_id is None for c in cluster(tabs, vecs, SNAP).clusters)


def test_pin_to_another_project_wins_and_survives_a_rerun() -> None:
    tabs, vecs = two_groups()
    for _ in range(2):
        r = cluster(tabs, vecs, SNAP, pins={"a2": "p_b"}, existing_projects=projects(vecs))
        by_id = {c.id: c for c in r.clusters}
        assert "a2" in by_id["p_b"].tab_refs and by_id["p_b"].pinned_tab_refs == ["a2"]
        assert "a2" not in by_id["p_a"].tab_refs


def test_pin_to_new_tree_creates_a_cluster() -> None:
    tabs, vecs = two_groups()
    r = cluster(tabs, vecs, SNAP, pins={"b3": "p_new"})
    new = [c for c in r.clusters if c.id == "p_new"]
    assert len(new) == 1 and new[0].tab_refs == ["b3"] and new[0].is_existing_project_id == "p_new"
    assert members(r, "b1") == {"b1", "b2"}  # b3 left its group; nothing is shared into the pinned tree
    assert not r.shared_tab_refs


# --- labels, determinism, limits ----------------------------------------------------------------

def test_labels_are_top_shared_title_terms() -> None:
    tabs, vecs = two_groups()
    r = cluster(tabs, vecs, SNAP)
    assert {c.label for c in r.clusters} == {top_terms([f"alpha topic page {i}" for i in range(3)]),
                                             top_terms([f"beta topic page {i}" for i in range(3)])}
    assert top_terms(["Hypertables | Tiger Data Docs", "d3-hierarchy | D3 by Observable"]) == "hypertables · hierarchy"


def test_deterministic_and_order_independent() -> None:
    tabs, vecs = two_groups()
    tabs += [tab("between", 500), tab("lonely", 600)]
    vecs["between"], vecs["lonely"] = unit(0.27 * basis(0) + 0.27 * basis(1) + 0.924 * basis(5)), basis(9)
    first = cluster(tabs, vecs, SNAP).to_dict()
    assert cluster(tabs, vecs, SNAP).to_dict() == first
    assert cluster(list(reversed(tabs)), vecs, SNAP).to_dict() == first


def test_limits_and_empty_input() -> None:
    with pytest.raises(ValueError):
        cluster([tab(f"t{i}", i) for i in range(61)], {f"t{i}": basis(i % DIM) for i in range(61)}, SNAP)
    empty = cluster([], {}, SNAP)
    assert empty.clusters == [] and empty.meadow == []
