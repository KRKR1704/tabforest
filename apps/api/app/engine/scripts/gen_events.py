r"""Generate engine/fixtures/events_2h.json: browser events for the 28 demo tabs.

Run from the repo root:
    apps\api\.venv\Scripts\python apps\api\app\engine\scripts\gen_events.py

Deterministic (fixed seed for event ids). The late session (10:57:40-11:24:49) is P's
batch from contracts/events.example.json, copied verbatim; the generator adds the earlier
sessions and the end of the late session around it so that:
- each tab's total active_ms equals its leaf dwell_min in contracts/grove.example.json;
- the 30-minute gap rule gives the same sessions as contracts/sessions.example.json
  (ses_...004 to ...008), plus three Job Search sessions on 9/29 and 9/30;
- Job Search is untouched for 4 days; the refresh-token searches fall in one 40-minute window.
The two hours before the snapshot hold the Backend Authentication work; older sessions
are included so that every open tab has its history.
"""

from __future__ import annotations

import json
import random
import uuid
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
FIXTURES = ROOT / "apps/api/app/engine/fixtures"
CONTRACTS = ROOT / "contracts"
OUT = FIXTURES / "events_2h.json"

SEED = 20261004
USER_ID = "452b6018-022d-5e0b-bd7c-101d3c412b79"  # P's demo user (contracts/me.example.json)
SESSION_GAP = timedelta(minutes=30)
P_BATCH_START = "2026-10-04T10:57:40Z"


def tid(n: int) -> str:
    return f"00000000-0000-4000-8000-{n:012d}"


def ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# (tab, focus start, seconds focused); None start = right after the previous visit.
# Open events come from demo_tabs.json opened_at. ("IDLE", at, seconds) marks a pause:
# IDLE at `at`, ACTIVE `seconds` later.
EARLY_VISITS = [
    # ses 001, 2026-09-29: Job Search
    (16, "2026-09-29T19:12:08Z", 318), (17, "2026-09-29T19:30:51Z", 480), (18, "2026-09-29T19:45:17Z", 126),
    # ses 002, 2026-09-30 morning: back to the application
    (17, "2026-09-30T08:10:00Z", 192),
    # ses 003, 2026-09-30 evening: interview prep and resume (last Job Search activity)
    (19, "2026-09-30T20:05:33Z", 228), (20, "2026-09-30T20:31:02Z", 264),
    # ses 004, 2026-10-03: YouTube distraction (9 s)
    (26, "2026-10-03T18:20:11Z", 9),
    # ses 005, 2026-10-03 evening: Weeknight Dinner
    (21, "2026-10-03T21:48:10Z", 216), (22, "2026-10-03T21:52:37Z", 174),
    (23, "2026-10-03T22:01:15Z", 60), ("IDLE", "2026-10-03T22:02:30Z", 100), (23, "2026-10-03T22:04:18Z", 42),
    # ses 006, 2026-10-04 early: news
    (27, "2026-10-04T07:58:40Z", 84),
    # ses 007, 2026-10-04 08:52:40-10:22:30: GirlHacks Prep, then Backend Authentication
    (11, "2026-10-04T08:52:40Z", 180), (12, None, 192), (14, None, 120), (11, None, 144),
    ("IDLE", "2026-10-04T09:04:16Z", 500),
    (13, "2026-10-04T09:12:55Z", 414), (15, "2026-10-04T09:20:44Z", 276), (11, None, 120),
    ("IDLE", "2026-10-04T09:28:20Z", 640),
    (28, "2026-10-04T09:39:03Z", 30),
    (1, "2026-10-04T09:41:12Z", 330), (3, "2026-10-04T09:48:05Z", 240),
    (4, "2026-10-04T09:55:31Z", 360), (3, None, 132), (1, None, 240), (5, None, 246),
    ("IDLE", "2026-10-04T10:12:49Z", 400),
    (4, "2026-10-04T10:19:30Z", 180),
]
# After P's batch (ends with tab 25 focused at 11:24:49): finish 25, a last look at 7,
# then the third refresh-token search (tab 8). Last activity 11:31:50.
LATE_VISITS = [(7, "2026-10-04T11:27:01Z", None), (8, "2026-10-04T11:31:14Z", None)]
LAST_IDLE = "2026-10-04T11:32:50Z"


def build() -> dict:
    """Build the fixture in memory. Deterministic: same input files, same output."""
    rng = random.Random(SEED)
    demo = json.loads((FIXTURES / "demo_tabs.json").read_text(encoding="utf-8"))
    tabs = {t["tab_ref"]: t for t in demo["open_tabs"]}
    grove = json.loads((CONTRACTS / "grove.example.json").read_text(encoding="utf-8"))
    dwell_ms = {l["tab_ref"]: round(l["dwell_min"] * 60000)
                for t in grove["trees"] for b in t["branches"] for l in b["leaves"]}
    dwell_ms.update({tid(24): 240000, tid(25): 132000, tid(26): 9000, tid(27): 84000, tid(28): 30000})
    p_batch = json.loads((CONTRACTS / "events.example.json").read_text(encoding="utf-8"))["batch_request"]["events"]

    events: list[dict] = []
    opened: set[str] = set()
    state = {"focus": None}

    def new_id() -> str:
        return str(uuid.UUID(int=rng.getrandbits(128), version=4))

    def emit(type_: str, at: datetime, tab: str, **fields) -> None:
        events.append({"event_id": new_id(), "ts": iso(at), "type": type_, "tab_ref": tab, **fields})

    def open_tab(tab: str) -> None:
        t = tabs[tab]
        opened.add(tab)
        emit("OPEN", ts(t["opened_at"]), tab, domain=t["domain"], title=t["title"],
             opener_tab_ref=t["opener_tab_ref"], dup_key=t["dup_key"], search_query=t["search_query"])

    def visit(tab: str, start: datetime, seconds: float) -> datetime:
        for other, t in tabs.items():  # background opens that happen before this focus
            if other not in opened and ts(t["opened_at"]) <= start:
                open_tab(other)
        emit("FOCUS", start, tab, previous_tab_ref=state["focus"] or tab)
        state["focus"] = tab
        end = start + timedelta(seconds=seconds)
        emit("BLUR", end, tab, active_ms=round(seconds * 1000))
        return end

    clock = None
    for tab_n, start, seconds in EARLY_VISITS:
        if tab_n == "IDLE":
            at = ts(start)
            emit("IDLE", at, state["focus"])
            emit("ACTIVE", at + timedelta(seconds=seconds), state["focus"])
            continue
        begin = ts(start) if start else clock
        clock = visit(tid(tab_n), begin, seconds)

    # P's late-session batch, verbatim.
    for e in p_batch:
        if e["type"] == "OPEN":
            opened.add(e["tab_ref"])
        if e["type"] == "FOCUS":
            state["focus"] = e["tab_ref"]
        events.append(dict(e))
    p_active = Counter()
    for e in p_batch:
        if e["type"] == "BLUR":
            p_active[e["tab_ref"]] += e["active_ms"]
    focused = state["focus"]
    last_ts = ts(p_batch[-1]["ts"])
    remaining = dwell_ms[focused] - p_active[focused]
    emit("BLUR", last_ts + timedelta(milliseconds=remaining), focused, active_ms=remaining)

    early_active = Counter()
    for e in events:
        if e["type"] == "BLUR" and ts(e["ts"]) < ts(P_BATCH_START):
            early_active[e["tab_ref"]] += e["active_ms"]
    for tab_n, start, _ in LATE_VISITS:
        tab = tid(tab_n)
        seconds = (dwell_ms[tab] - p_active[tab] - early_active[tab]) / 1000
        visit(tab, ts(start), seconds)
    emit("IDLE", ts(LAST_IDLE), state["focus"])

    events.sort(key=lambda e: ts(e["ts"]))  # stable: same-second events keep their order

    # Sessions by the 30-minute gap rule, numbered like contracts/sessions.example.json.
    session, previous = 0, None
    for e in events:
        at = ts(e["ts"])
        if previous is None or at - previous > SESSION_GAP:
            session += 1
        e["session_id"] = f"ses_80000000-0000-4000-8000-{session:012d}"
        previous = at

    # Self-checks against the grove and P's sessions.
    active = Counter()
    for e in events:
        if e["type"] == "BLUR":
            active[e["tab_ref"]] += e["active_ms"]
    for tab, ms in dwell_ms.items():
        assert active[tab] == ms, (tab, active[tab], ms)
    starts, ends = {}, {}
    for e in events:
        starts.setdefault(e["session_id"], e["ts"])
        ends[e["session_id"]] = e["ts"]
    p_sessions = json.loads((CONTRACTS / "sessions.example.json").read_text(encoding="utf-8"))["examples"][0]
    for s in p_sessions["response"]["body"]["sessions"]:
        assert starts.get(s["id"]) == s["started_at"], (s["id"], starts.get(s["id"]), s["started_at"])
        assert s["ended_at"] is None or ends[s["id"]] == s["ended_at"], (s["id"], ends[s["id"]], s["ended_at"])
    assert {e["tab_ref"] for e in events} >= set(tabs), "every demo tab has events"

    out = {
        "about": "Browser events for the 28 demo tabs as R reads them from P's browser_events (C11), "
                 "with session_id. Generated by app/engine/scripts/gen_events.py; the 10:57:40-11:24:49 "
                 "batch is P's contracts/events.example.json. Older sessions give every open tab its history.",
        "user_id": USER_ID,
        "snapshot_at": demo["snapshot_at"],
        "window_start": "2026-10-04T09:40:00Z",
        "events": events,
    }
    return out


def render(out: dict) -> bytes:
    return (json.dumps(out, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def main() -> None:
    out = build()
    OUT.write_bytes(render(out))
    events = out["events"]
    print(f"wrote {OUT.relative_to(ROOT).as_posix()}: {len(events)} events, "
          f"{len({e['session_id'] for e in events})} sessions, {len({e['tab_ref'] for e in events})} tab_refs, "
          f"{events[0]['ts']} .. {events[-1]['ts']}")


if __name__ == "__main__":
    main()
