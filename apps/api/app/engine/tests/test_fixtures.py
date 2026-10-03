"""Engine fixtures: events, user notes, and the adapters that read them."""

import asyncio
import importlib.util
import json
from datetime import datetime
from pathlib import Path
from uuid import UUID

from app.engine.adapters.contexts import get_contexts_source
from app.engine.adapters.stats import get_stats_source
from app.engine.fixtures import FIXTURES_DIR, load_contract, load_demo_tabs, load_events, load_user_notes

DEMO_USER = UUID("452b6018-022d-5e0b-bd7c-101d3c412b79")
GEN_EVENTS = Path(__file__).resolve().parents[1] / "scripts" / "gen_events.py"


def _ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def test_events_cover_all_demo_tabs() -> None:
    demo_refs = {t["tab_ref"] for t in load_demo_tabs()["open_tabs"]}
    assert len(demo_refs) == 28
    assert demo_refs <= {e["tab_ref"] for e in load_events()["events"]}


def test_events_ordered_unique_and_sessioned() -> None:
    events = load_events()["events"]
    stamps = [_ts(e["ts"]) for e in events]
    assert stamps == sorted(stamps)
    assert len({e["event_id"] for e in events}) == len(events)
    assert all(e["session_id"].startswith("ses_") for e in events)
    assert stamps[-1] <= _ts(load_events()["snapshot_at"])


def test_every_focus_has_previous_tab_ref() -> None:
    focus = [e for e in load_events()["events"] if e["type"] == "FOCUS"]
    assert focus and all(e.get("previous_tab_ref") for e in focus)


def test_events_fixture_is_regenerated_deterministically() -> None:
    spec = importlib.util.spec_from_file_location("gen_events", GEN_EVENTS)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.render(module.build()) == (FIXTURES_DIR / "events_2h.json").read_bytes()


def test_user_notes_match_grove_note_ids() -> None:
    grove = load_contract("grove.example.json")
    stones = {s["user_note_id"]: s["text"] for t in grove["trees"] for s in t["stones"] if s["user_note_id"]}
    note_refs = {e["ref"] for t in grove["trees"] for c in [t["goal"], *t["stones"], *t["mushrooms"],
                 *t["next_actions"], *t["hypotheses"]] for e in c["evidence"] if e["ref_kind"] == "note"}
    notes = {n["id"]: n["text"] for n in load_user_notes()}
    assert set(notes) == set(stones) == note_refs
    assert notes == stones


def test_stats_attention_matches_grove_dwell() -> None:
    grove = load_contract("grove.example.json")
    dwell = {l["tab_ref"]: l["dwell_min"] for t in grove["trees"] for b in t["branches"] for l in b["leaves"]}
    attention = asyncio.run(get_stats_source().attention(DEMO_USER, set(dwell)))
    for ref, minutes in dwell.items():
        assert attention[ref].active_ms == round(minutes * 60000), ref


def test_stats_events_carry_session_and_previous_tab() -> None:
    events = asyncio.run(get_stats_source().events(DEMO_USER, {"00000000-0000-4000-8000-000000000004"}))
    assert events and all(e.session_id for e in events)
    assert all(e.previous_tab_ref for e in events if e.type == "FOCUS")


def test_contexts_fixture() -> None:
    contexts = asyncio.run(get_contexts_source().saved_contexts(DEMO_USER))
    assert {c.kind for c in contexts} <= {"resume", "references"}
    assert any(c.project_id == "p_10000000-0000-4000-8000-000000000001" for c in contexts)


def test_sample_docs_and_expected_present() -> None:
    expected = json.loads((FIXTURES_DIR / "sample_docs" / "EXPECTED.json").read_text(encoding="utf-8"))
    assert expected["decisions"][0]["timestamp"] == "00:14:32"
