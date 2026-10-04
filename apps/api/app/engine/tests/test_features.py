"""R-6 feature rules on synthetic events (no network)."""

import json
from datetime import datetime, timedelta, timezone
from itertools import count

import numpy as np
import pytest

from app.engine.adapters.stats import TabEvent
from app.engine.features import (UUID_RE, build_features, find_comparisons, finalize_importance, importance_pre,
                                 to_data_block, visits_from)

SNAP = datetime(2026, 10, 4, 12, 0, tzinfo=timezone.utc)
_ids = count(1)


def ref(n: int) -> str:
    return f"00000000-0000-4000-8000-{900 + n:012d}"


def at(minutes_ago: float) -> datetime:
    return SNAP - timedelta(minutes=minutes_ago)


def iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def tab(n: int, title: str, minutes_ago: float, *, domain: str = "example.com", opener: int | None = None,
        query: str | None = None) -> dict:
    return {"tab_ref": ref(n), "domain": domain, "title": title, "opened_at": iso(at(minutes_ago)),
            "opener_tab_ref": ref(opener) if opener else None, "search_query": query, "dup_key": f"k{n}"}


def search_tab(n: int, query: str, minutes_ago: float) -> dict:
    return tab(n, f"{query} - Google Search", minutes_ago, domain="www.google.com", query=query)


def ev(type_: str, n: int, minutes_ago: float, *, session: str = "ses_1", **kw) -> TabEvent:
    return TabEvent(event_id=str(next(_ids)), ts=at(minutes_ago), type=type_, tab_ref=ref(n), session_id=session, **kw)


def visit(n: int, minutes_ago: float, seconds: float, session: str = "ses_1") -> list[TabEvent]:
    return [ev("FOCUS", n, minutes_ago, session=session, previous_tab_ref=ref(n)),
            ev("BLUR", n, minutes_ago - seconds / 60, session=session, active_ms=int(seconds * 1000))]


def vectors(groups: dict[str, int]) -> dict[str, np.ndarray]:
    """Queries in the same group are near-identical, other groups orthogonal."""
    out = {}
    for text, g in groups.items():
        v = np.zeros(8)
        v[g] = 1.0
        v[7] = 0.05 * (len(text) % 3)
        out[text] = v
    return out


def build(snapshot, events, qvec, refs=None, window=None):
    by_ref = {t["tab_ref"]: t for t in snapshot}
    return build_features(refs or list(by_ref), by_ref, events, window if window is not None else events, qvec, SNAP)


# --- visits and per-tab features -----------------------------------------------------------------

def test_visits_pair_focus_with_next_blur() -> None:
    events = visit(1, 30, 20) + visit(2, 20, 5) + visit(1, 10, 40) + [ev("BLUR", 3, 5, active_ms=999)]
    v = visits_from(events)
    assert [(x.tab_ref, x.active_ms) for x in v] == [(ref(1), 20000), (ref(2), 5000), (ref(1), 40000)]


def test_tab_features_dwell_share_revisits_stale_distraction() -> None:
    snapshot = [tab(1, "Docs page", 60 * 24 * 5, domain="docs.python.org"), tab(2, "Quick look", 30),
                tab(3, "Main work", 50)]
    events = visit(1, 60 * 24 * 4, 60) + visit(2, 20, 9) + visit(3, 40, 120) + visit(3, 25, 60) + visit(3, 5, 60)
    f = build(snapshot, events, {})
    t1, t2, t3 = (f.tabs[ref(i)] for i in (1, 2, 3))
    assert (t3.dwell_ms, t3.focus_count, t3.revisits) == (240000, 3, 2)
    assert t3.dwell_share == pytest.approx(240 / 309, abs=1e-6) and t1.official and not t3.official
    assert t1.stale and not t3.stale                      # last focus 4 days ago vs 5 min ago
    assert t2.distraction and not t3.distraction          # 9 s total focus
    assert f.last_focus == iso(at(5)) and not f.dormant


def test_phases_follow_p_session_id() -> None:
    snapshot = [tab(1, "A", 200), tab(2, "B", 100)]
    events = visit(1, 190, 60, "ses_7") + visit(2, 95, 30, "ses_8") + visit(1, 90, 30, "ses_8")
    f = build(snapshot, events, {})
    assert [(p.session_id, [r[-1] for r in p.tab_refs], p.active_ms) for p in f.phases] == \
           [("ses_7", ["1"], 60000), ("ses_8", ["2", "1"], 60000)]


# --- query families and open loops ---------------------------------------------------------------

def family_case(span_minutes: float, follow_up_seconds: float | None):
    """3 rephrasings: at -150, -150 + span/2 and -150 + span minutes; an optional follow-up after the last."""
    q = ["where to store refresh token", "refresh token storage", "safe place for refresh token"]
    snapshot = [search_tab(1, q[0], 150), search_tab(2, q[1], 150 - span_minutes / 2),
                search_tab(3, q[2], 150 - span_minutes), tab(4, "Some article", 160)]
    events = [ev("OPEN", i + 1, float(150 - span_minutes * i / 2), search_query=q[i]) for i in range(3)]
    events += visit(4, 155, 300)
    if follow_up_seconds is not None:
        events += visit(4, 150 - span_minutes - 1, follow_up_seconds)
    return build(snapshot, events, vectors(dict.fromkeys(q, 0)))


def test_three_rephrasings_exactly_two_hours_apart_are_an_open_loop() -> None:
    f = family_case(120, None)
    assert len(f.families) == 1
    fam = f.families[0]
    assert fam.rephrasings == 3 and fam.span_min == 120.0 and fam.open_loop


def test_rephrasings_spread_over_more_than_two_hours_are_not_an_open_loop() -> None:
    f = family_case(120.5, None)
    assert f.families[0].rephrasings == 3 and not f.families[0].open_loop


def test_a_91_second_follow_up_closes_the_loop_but_90_does_not() -> None:
    closed, still_open = family_case(60, 91), family_case(60, 90)
    assert not closed.families[0].open_loop and closed.families[0].closing_visit["active_ms"] == 91000
    assert still_open.families[0].open_loop and still_open.families[0].short_visits == [ref(4)]


def test_two_rephrasings_are_not_enough() -> None:
    q = ["a question here", "a question there"]
    snapshot = [search_tab(1, q[0], 30), search_tab(2, q[1], 20)]
    f = build(snapshot, [], vectors(dict.fromkeys(q, 0)))
    assert len(f.families) == 1 and not f.families[0].open_loop


def test_different_questions_form_different_families_with_stable_ids() -> None:
    q = {"jwt refresh storage": 0, "where to keep refresh token": 0, "kubectl restart pod": 1}
    snapshot = [search_tab(i + 1, text, 30 - i) for i, text in enumerate(q)]
    f1 = build(snapshot, [], vectors(q))
    f2 = build(list(reversed(snapshot)), [], vectors(q))
    assert [sorted(f.queries) for f in f1.families] == [["jwt refresh storage", "where to keep refresh token"],
                                                         ["kubectl restart pod"]]
    assert [f.id for f in f1.families] == [f.id for f in f2.families]


def test_closed_search_tab_linked_by_opener_joins_the_family() -> None:
    q = ["refresh token storage", "refresh token storage spa", "refresh token in browser"]
    snapshot = [search_tab(1, q[0], 50), search_tab(3, q[2], 10)]
    window = [ev("OPEN", 2, 30, search_query=q[1], opener_tab_ref=ref(1)), ev("CLOSE", 2, 29),
              ev("OPEN", 9, 25, search_query="unrelated closed search")]  # not linked: ignored
    f = build(snapshot, [], vectors(dict.fromkeys(q + ["unrelated closed search"], 0)), window=window)
    fam = f.families[0]
    assert fam.closed_tab_refs == [ref(2)] and fam.rephrasings == 3 and fam.open_loop
    assert all("unrelated" not in qq for fam in f.families for qq in fam.queries)


# --- comparisons ---------------------------------------------------------------------------------

def test_comparison_patterns() -> None:
    assert find_comparisons("JWT vs session-based authentication for a REST API", allow_or=False) == \
           [("JWT", "session-based authentication")]
    assert find_comparisons("Rust vs Go for a small CLI tool?", allow_or=False) == [("Rust", "Go")]
    assert find_comparisons("compare macbook air and xps for coding", allow_or=False)[0] == ("macbook air", "xps for")
    assert find_comparisons("Sign in or register", allow_or=False) == []
    assert find_comparisons("redis or postgres sessions", allow_or=True) == [("redis", "postgres sessions")]


def comparison_case(jwt_seconds: float, session_seconds: float, last_focus_minutes_ago: float = 5):
    snapshot = [tab(1, "JWT vs session-based authentication", 100), tab(2, "FastAPI JWT guide", 90),
                tab(3, "Server session storage explained", 80)]
    events = visit(2, 90, jwt_seconds) + visit(3, 80, session_seconds) + visit(1, last_focus_minutes_ago, 1)
    return build(snapshot, events, {}).comparisons


def test_comparison_resolved_when_70_percent_of_later_dwell_is_on_one_side() -> None:
    [c] = comparison_case(700, 300)
    assert c.resolved and c.preferred == "JWT" and c.dwell_by_option == {"JWT": 700000, "session-based authentication": 300000}
    [c] = comparison_case(600, 400)
    assert not c.resolved and c.preferred is None and not c.dormant


def test_unresolved_comparison_goes_dormant_after_30_minutes_without_focus() -> None:
    [c] = comparison_case(600, 400, last_focus_minutes_ago=31)
    assert not c.resolved and c.dormant


# --- importance and the DATA block ------------------------------------------------------------------

def test_importance_terms_and_normalisation() -> None:
    snapshot = [tab(1, "Official docs", 60, domain="docs.python.org"), tab(2, "Blog", 50)]
    events = visit(1, 55, 60) + visit(2, 45, 180) + visit(2, 30, 60) + visit(2, 20, 60)
    f = build(snapshot, events, {})
    pre = importance_pre(f)
    assert pre[ref(1)].evidence == 0 and pre[ref(1)].official == 0.1
    assert pre[ref(2)].revisits == 0.2 and pre[ref(1)].revisits == 0.0
    assert pre[ref(2)].dwell == pytest.approx(0.45 * 300 / 360, abs=1e-4)
    final = finalize_importance(f, {ref(1): 2, ref(2): 1})
    assert final[ref(1)].evidence == 0.25 and final[ref(2)].evidence == 0.125
    for imp in final.values():
        assert 0 <= imp.total <= 1 and imp.total == pytest.approx(imp.dwell + imp.evidence + imp.revisits + imp.official, abs=1e-4)
    assert importance_pre(build([tab(1, "Never focused", 10)], [], {}))[ref(1)].total == 0.0


def test_data_block_short_refs_no_uuids_deterministic() -> None:
    q = ["where to store refresh token", "refresh token storage", "safe place for refresh token"]
    snapshot = [search_tab(1, q[0], 50), search_tab(2, q[1], 40), search_tab(3, q[2], 30),
                tab(4, "JWT vs session-based authentication", 60), tab(5, "FastAPI JWT guide", 45, opener=4)]
    events = visit(5, 44, 30)
    f = build(snapshot, events, vectors(dict.fromkeys(q, 0)))
    notes = [{"id": "n_40000000-0000-4000-8000-000000000007", "text": "Not using OAuth providers for v1"}]
    block = to_data_block(f, notes, prior_research=[{"date": "2026-03-12", "project": "Backend Scaling",
                                                       "summary": "Redis not needed"}])
    text = json.dumps(block.payload)
    assert not UUID_RE.search(text)
    assert set(block.payload) == {"tabs", "opener_edges", "search_families", "comparisons", "user_notes", "prior_research"}
    # short refs follow opening order: tab 4 (60 min ago) = t1, tab 1 = t2, tab 5 = t3, ...
    assert block.refs["t1"] == ref(4) and block.refs["t3"] == ref(5)
    assert block.refs["n1"] == notes[0]["id"] and block.refs["q1"] == f.families[0].id
    assert block.payload["opener_edges"] == [["t1", "t3"]]  # tab 4 opened tab 5
    assert sorted(block.refs) == sorted([f"t{i}" for i in range(1, 6)] + ["q1", "c1", "n1"])
    # tab 4's title is a comparison: c1, sourced at t1, with tab 5 (FastAPI JWT guide) on the JWT side
    assert block.refs["c1"] == f.comparisons[0].id and block.anchors[f.comparisons[0].id] == ("tab", ref(4))
    assert block.payload["comparisons"][0]["ref"] == "c1" and block.payload["comparisons"][0]["tab"] == "t1"
    assert block.payload["comparisons"][0]["sides"][0] == {"option": "JWT", "tabs": ["t3"], "dwell_min_after": 0.5}
    assert to_data_block(f, notes).to_json() == to_data_block(f, notes).to_json()
    with pytest.raises(ValueError):
        to_data_block(f, notes, prior_research=[{"saved_context_id": "s_60000000-0000-4000-8000-000000000003"}])
