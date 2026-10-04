"""The contracts' demo story as stored data, for P's contract tests (P-7, P-8, P-9).

contracts/sessions.example.json, timeline.example.json and saved-context.example.json describe one
user on R's demo set (apps/api/app/engine/fixtures/demo_tabs.json, contracts/grove.example.json).
This module rebuilds that user's browser events and R's intent rows so the API can be asked for
the contract responses:

- session 8 (10:57:40 to 11:31:50): the 45 events of events.example.json plus the 7 later events
  of the same session;
- sessions 4 to 7 and an Oct 2 Backend Authentication session, synthesized to the contract's
  numbers (start, end, event count, focused time per tab and bucket, tab switches);
- R's rows: one project, current cluster, branches and leaves per grove tree, the stones,
  mushrooms and the stated note; plus the Backend Scaling project of the March 12 context.

Known gap (contract not edited, BUILD_TASKS §5.1): sessions.example.json gives the 08:52 session
intent_switches 3, but with that session's tabs every intent switch touches a Backend
Authentication tab and the timeline allows none beyond its 10:00 exit, which is an intent switch
only from the project's side (tab 05 shares the GirlHacks cluster). The story's session has 0.

Event times are the story clock's (snapshot 2026-10-04T11:40:00Z); tests pin the API clock to it.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import asyncpg

from tests.helpers import API_DIR, contract

STORY_NOW = datetime(2026, 10, 4, 11, 40, tzinfo=UTC)
DEMO = json.loads((API_DIR / "app/engine/fixtures/demo_tabs.json").read_text(encoding="utf-8"))
GROVE = contract("grove.example.json")
EVENTS = contract("events.example.json")
CONTEXTS = contract("saved-context.example.json")


def tid(n: int) -> str:
    return f"00000000-0000-4000-8000-{n:012d}"


def bare(prefixed: str) -> uuid.UUID:
    """The uuid behind a contract id such as p_10000000-… or dec_30000000-…."""
    return uuid.UUID(prefixed.split("_", 1)[1])


def _dup(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()


TABS: dict[str, dict[str, Any]] = {t["tab_ref"]: t for t in DEMO["open_tabs"]}
# Closed tabs the P contracts introduce (29, 30) and the Oct 2 session's tabs (31-33, story only).
TABS.update({
    tid(29): {"domain": "www.google.com", "title": "refresh token storage best practices spa - Google Search",
              "opener_tab_ref": tid(7), "dup_key": _dup("google.com/search?q=refresh+token+storage+best+practices+spa"),
              "search_query": "refresh token storage best practices spa"},
    tid(30): {"domain": "girlhacks-2026.devpost.com", "title": "Register for GirlHacks 2026 - Devpost",
              "opener_tab_ref": tid(11), "dup_key": _dup("girlhacks-2026.devpost.com/register"), "search_query": None},
    tid(31): {"domain": "jwt.io", "title": "JSON Web Tokens - jwt.io", "opener_tab_ref": None,
              "dup_key": _dup("jwt.io/introduction"), "search_query": None},
    tid(32): {"domain": "cheatsheetseries.owasp.org", "title": "Session Management - OWASP Cheat Sheet Series",
              "opener_tab_ref": None, "dup_key": _dup("cheatsheetseries.owasp.org/session-management"),
              "search_query": None},
    tid(33): {"domain": "fastapi.tiangolo.com", "title": "Security - First Steps - FastAPI", "opener_tab_ref": None,
              "dup_key": _dup("fastapi.tiangolo.com/tutorial/security/first-steps"), "search_query": None},
})


class Stream:
    """Builds API events; ids are deterministic per session so a resend is an exact duplicate."""

    def __init__(self, day: str, lead: str) -> None:
        self.day, self.lead, self.events = day, lead, []

    def _emit(self, hms: str, typ: str, n: int, **fields: Any) -> None:
        self.events.append({"event_id": f"{self.lead:0<8}-0000-4000-8000-{len(self.events) + 1:012d}",
                            "ts": f"2026-{self.day}T{hms}Z", "type": typ, "tab_ref": tid(n), **fields})

    def open(self, hms: str, n: int) -> None:
        t = TABS[tid(n)]
        self._emit(hms, "OPEN", n, domain=t["domain"], title=t["title"], opener_tab_ref=t["opener_tab_ref"],
                   dup_key=t["dup_key"], search_query=t["search_query"])

    def update(self, hms: str, n: int) -> None:
        t = TABS[tid(n)]
        self._emit(hms, "UPDATE", n, domain=t["domain"], title=t["title"], dup_key=t["dup_key"],
                   search_query=t["search_query"])

    def focus(self, hms: str, n: int, prev: int | None) -> None:
        self._emit(hms, "FOCUS", n, previous_tab_ref=tid(prev) if prev else None)

    def blur(self, hms: str, n: int, ms: int) -> None:
        self._emit(hms, "BLUR", n, active_ms=ms)

    def plain(self, hms: str, typ: str, n: int) -> None:   # CLOSE, IDLE, ACTIVE
        self._emit(hms, typ, n)

    def pad(self, n: int, start: str, step_s: int, total: int) -> None:
        """Title updates on one tab (a single-page app) until the session holds `total` events."""
        t0 = datetime.fromisoformat(f"2026-{self.day}T{start}+00:00")
        for k in range(total - len(self.events)):
            self.update((t0 + timedelta(seconds=step_s * k)).strftime("%H:%M:%S"), n)


def _video() -> list[dict]:          # session 4, Oct 3 18:20:11-18:20:20
    s = Stream("10-03", "a4")
    s.open("18:20:11", 26)
    s.focus("18:20:11", 26, 17)
    s.blur("18:20:20", 26, 9000)
    return s.events


def _dinner() -> list[dict]:         # session 5, Oct 3 21:48:10-22:05:00, 41 events
    s = Stream("10-03", "a5")
    s.open("21:48:10", 21)
    s.focus("21:48:10", 21, 26)
    s.blur("21:51:10", 21, 180000)                        # the window loses focus
    s.open("21:52:37", 22)
    s.focus("21:52:37", 22, 21)
    s.blur("21:54:37", 22, 120000)
    s.focus("21:54:37", 21, 22)
    s.blur("21:55:37", 21, 60000)
    s.open("22:01:15", 23)
    s.focus("22:01:15", 23, 21)
    s.blur("22:02:15", 23, 60000)
    s.focus("22:02:15", 22, 23)
    s.blur("22:03:15", 22, 60000)
    s.focus("22:03:15", 23, 22)
    s.plain("22:04:15", "IDLE", 23)
    s.plain("22:05:00", "ACTIVE", 23)
    s.blur("22:05:00", 23, 60000)
    s.pad(21, "21:48:15", 5, 41)
    return s.events


def _news() -> list[dict]:           # session 6, Oct 4 07:58:40-08:00:04
    s = Stream("10-04", "a6")
    s.open("07:58:40", 27)
    s.focus("07:58:40", 27, 23)
    s.blur("08:00:04", 27, 84000)
    return s.events


def _morning() -> list[dict]:        # session 7, Oct 4 08:52:40-10:22:30, 214 events
    s = Stream("10-04", "a7")
    s.open("08:52:40", 11)
    s.focus("08:52:40", 11, None)  # back at the browser: not a switch
    s.open("08:54:10", 12)
    s.blur("08:54:10", 11, 90000)
    s.focus("08:54:10", 12, 11)
    s.blur("08:56:10", 12, 120000)
    s.focus("08:56:10", 11, 12)
    s.open("08:58:21", 14)
    s.blur("08:58:21", 11, 131000)
    s.focus("08:58:21", 14, 11)
    s.blur("09:00:21", 14, 120000)
    s.focus("09:00:21", 11, 14)
    s.open("09:02:10", 30)
    s.blur("09:02:10", 11, 109000)
    s.focus("09:02:10", 30, 11)
    s.open("09:12:55", 13)
    s.blur("09:12:55", 30, 645000)
    s.focus("09:12:55", 13, 30)
    s.blur("09:17:55", 13, 300000)
    s.open("09:20:44", 15)
    s.focus("09:20:44", 15, 13)
    s.blur("09:24:04", 15, 200000)
    s.focus("09:24:04", 11, 15)
    s.blur("09:25:04", 11, 60000)
    s.focus("09:25:04", 12, 11)
    s.blur("09:26:16", 12, 72000)
    s.open("09:39:03", 28)
    s.focus("09:39:03", 28, 12)
    s.blur("09:39:33", 28, 30000)
    # Backend Authentication, 09:30 bucket: 6 switches touching its tabs, 1 of them unassigned (from 28).
    s.open("09:41:12", 1)
    s.focus("09:41:12", 1, 28)
    s.blur("09:46:12", 1, 300000)
    s.open("09:48:05", 3)
    s.focus("09:48:05", 3, 1)
    s.blur("09:50:35", 3, 150000)
    s.focus("09:50:35", 1, 3)
    s.blur("09:53:05", 1, 150000)
    s.focus("09:53:05", 3, 1)
    s.open("09:55:31", 4)                                   # opened from tab 03 in the background
    s.blur("09:56:05", 3, 180000)
    s.focus("09:56:05", 1, 3)
    s.blur("09:58:05", 1, 120000)
    s.focus("09:58:05", 3, 1)
    s.blur("09:58:47", 3, 42000)
    # 10:00 bucket: 5 switches; leaving through tab 05 is an intent switch for the project only.
    s.focus("10:00:20", 4, 3)
    s.open("10:05:47", 5)
    s.blur("10:05:47", 4, 327000)
    s.focus("10:05:47", 5, 4)
    s.blur("10:07:47", 5, 120000)
    s.focus("10:07:47", 4, 5)
    s.blur("10:11:20", 4, 213000)
    s.focus("10:11:20", 5, 4)
    s.blur("10:13:26", 5, 126000)
    s.focus("10:13:26", 13, 5)
    s.blur("10:15:20", 13, 114000)
    s.focus("10:15:20", 15, 13)
    s.blur("10:16:36", 15, 76000)
    s.focus("10:16:36", 30, 15)
    s.blur("10:18:39", 30, 123000)
    s.focus("10:18:39", 11, 30)
    s.plain("10:18:41", "CLOSE", 30)
    s.plain("10:19:33", "IDLE", 11)
    s.plain("10:22:30", "ACTIVE", 11)
    s.blur("10:22:30", 11, 54000)
    s.pad(30, "09:02:12", 4, 214)                           # the registration form's steps
    return s.events


def _late() -> list[dict]:           # session 8: the contract batch plus the same session's later events
    s = Stream("10-04", "9")
    s.events = [dict(e) for e in EVENTS["batch_request"]["events"]]
    s.blur("11:27:01", 25, 132000)
    s.focus("11:31:10", 7, 25)
    s.open("11:31:14", 8)
    s.blur("11:31:14", 7, 4000)
    s.focus("11:31:14", 8, 7)
    s.blur("11:31:50", 8, 36000)
    s.focus("11:31:50", 4, 8)
    return s.events


def _oct2() -> list[dict]:           # Oct 2 Backend Authentication: 134 min minus today's 2,598,000 ms
    s = Stream("10-02", "a2")
    s.open("19:05:00", 31)
    s.focus("19:05:00", 31, None)
    s.blur("19:35:00", 31, 1800000)
    s.open("19:35:00", 32)
    s.focus("19:35:00", 32, 31)
    s.blur("20:05:00", 32, 1800000)
    s.focus("20:05:00", 31, 32)
    s.blur("20:15:00", 31, 600000)
    s.open("20:15:00", 33)
    s.focus("20:15:00", 33, 31)
    s.blur("20:35:42", 33, 1242000)
    for n, hms in ((31, "20:36:00"), (32, "20:36:01"), (33, "20:36:02")):
        s.plain(hms, "CLOSE", n)
    return s.events


def events() -> list[dict]:
    return _oct2() + _video() + _dinner() + _news() + _morning() + _late()


# ---------- R's intent rows (C12 stand-in for the tests) ----------

NOTE_WRITTEN = {"n_40000000-0000-4000-8000-000000000007": "2026-10-04T10:12:20Z"}   # gen_p_contracts.py
EXTRA_LEAVES = {   # project -> (branch label, tab, importance): closed tabs that stay in the tree
    "p_10000000-0000-4000-8000-000000000001": [("JWT", tid(29), 0.05), ("JWT", tid(31), 0.2),
                                               ("Sessions", tid(32), 0.2), ("JWT", tid(33), 0.15)],
    "p_10000000-0000-4000-8000-000000000002": [("Rules and submission", tid(30), 0.6)],
}
SCALING = ("p_10000000-0000-4000-8000-000000000099", "Backend Scaling")


def _ts(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


def _claim_cols(c: dict) -> tuple:
    return (c["text"], c["provenance"], c["confidence"], json.dumps(c.get("evidence", [])),
            bare(c["user_note_id"]) if c.get("user_note_id") else None, c.get("quote"))


async def seed_intents(conn: asyncpg.Connection, user_id: uuid.UUID) -> None:
    """Insert R's rows for the story user (tests only; R owns these tables)."""
    async with conn.transaction():
        for project_id, name in [(t["project_id"], t["name"]) for t in GROVE["trees"]] + [SCALING]:
            await conn.execute("INSERT INTO projects (id, user_id, name) VALUES ($1, $2, $3)",
                               bare(project_id), user_id, name)
        for tree in GROVE["trees"]:
            pid = bare(tree["project_id"])
            cid = uuid.uuid5(pid, "cluster")
            goal = tree["goal"]
            await conn.execute(
                "INSERT INTO intent_clusters (id, user_id, project_id, label, goal, goal_provenance, goal_confidence, "
                "goal_evidence) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)",
                cid, user_id, pid, tree["name"], goal["text"], goal["provenance"], goal["confidence"],
                json.dumps(goal.get("evidence", [])))
            branch_ids = {}
            for pos, branch in enumerate(tree["branches"]):
                branch_ids[branch["label"]] = uuid.uuid5(cid, branch["label"])
                await conn.execute(
                    "INSERT INTO intent_branches (id, user_id, cluster_id, label, status, position) "
                    "VALUES ($1, $2, $3, $4, $5, $6)",
                    branch_ids[branch["label"]], user_id, cid, branch["label"], branch["status"], pos)
            leaves = [(b["label"], leaf["tab_ref"], leaf["importance"], bool(leaf.get("fallen")))
                      for b in tree["branches"] for leaf in b["leaves"]]
            leaves += [(label, ref, imp, True) for label, ref, imp in EXTRA_LEAVES.get(tree["project_id"], [])]
            for pos, (label, ref, importance, fallen) in enumerate(leaves):
                await conn.execute(
                    "INSERT INTO cluster_tabs (user_id, cluster_id, branch_id, tab_ref, importance, fallen, position) "
                    "VALUES ($1, $2, $3, $4, $5, $6, $7)",
                    user_id, cid, branch_ids[label], uuid.UUID(ref), importance, fallen, pos)
            claims = [tree["goal"], tree.get("direction") or {}] + tree["stones"] + tree["mushrooms"]
            for note_id in {c["user_note_id"] for c in claims if c.get("user_note_id")}:
                text = next(c["text"] for c in claims if c.get("user_note_id") == note_id)
                await conn.execute(
                    "INSERT INTO user_notes (id, user_id, project_id, cluster_id, kind, text, created_at) "
                    "VALUES ($1, $2, $3, $4, 'decision', $5, coalesce($6, now()))",
                    bare(note_id), user_id, pid, cid, text, _ts(NOTE_WRITTEN.get(note_id)))
            for stone in tree["stones"]:
                await conn.execute(
                    "INSERT INTO decisions (id, user_id, cluster_id, text, provenance, confidence, evidence, "
                    "user_note_id, quote) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)",
                    bare(stone["id"]), user_id, cid, *_claim_cols(stone))
            for q in tree["mushrooms"]:
                await conn.execute(
                    "INSERT INTO unresolved_questions (id, user_id, cluster_id, question, kind, provenance, "
                    "confidence, evidence, user_note_id, quote, recurrence, status, answer, resolved_at) "
                    "VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14)",
                    bare(q["id"]), user_id, cid, q["text"], q.get("kind"), *_claim_cols(q)[1:],
                    q.get("recurrence", 1), q["status"], q.get("answer"), _ts(q.get("resolved_at")))


OLD_CONTEXT = "s_60000000-0000-4000-8000-000000000003"   # Backend Scaling, saved March 12


async def seed_old_context(conn: asyncpg.Connection, user_id: uuid.UUID) -> None:
    """The March 12 context, whose events are past retention: stored with the totals recorded at
    save time, as the list example shows them."""
    listed = next(e for e in CONTEXTS["examples"] if e["name"] == "list_contexts")["response"]["body"]["contexts"]
    row = next(c for c in listed if c["id"] == OLD_CONTEXT)
    tabs = [{"tab_ref": str(uuid.uuid5(bare(OLD_CONTEXT), str(i))), "fallback_url": f"https://redis.io/docs/{i}",
             "domain": "redis.io", "title": f"Redis docs {i}", "important": i < row["important_tab_count"],
             "excluded_reason": None} for i in range(row["total_tab_count"])]
    card = {"goal": {"text": row["goal_summary"]}, "next_action": None}
    totals = {"active_ms": row["active_ms"], "session_count": row["session_count"],
              "last_active_at": row["last_active_at"]}
    snapshot = {"project_name": row["project_name"], "card": card, "tabs": tabs, "totals": totals}
    await conn.execute(
        "INSERT INTO saved_contexts (id, user_id, project_id, title, kind, snapshot, saved_at) "
        "VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)",
        bare(OLD_CONTEXT), user_id, bare(row["project_id"]), row["title"], row["kind"], json.dumps(snapshot),
        _ts(row["saved_at"]))


R_TABLES = ("user_notes", "suggested_actions", "decisions", "unresolved_questions", "cluster_tabs", "intent_branches",
            "intent_clusters", "research_insights", "analysis_runs", "projects")


async def purge_intents(conn: asyncpg.Connection, user_id: uuid.UUID) -> None:
    async with conn.transaction():
        for table in R_TABLES:
            await conn.execute(f"DELETE FROM {table} WHERE user_id = $1", user_id)  # noqa: S608 - fixed names


async def refresh_attention(conn: asyncpg.Connection) -> None:
    """Materialize the story days in tab_attention_15m: rows inserted behind the aggregate's
    watermark only show up after a refresh (X17)."""
    await conn.execute("CALL refresh_continuous_aggregate('tab_attention_15m', '2026-10-02', '2026-10-05')")
