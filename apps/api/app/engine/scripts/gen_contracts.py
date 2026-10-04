r"""Generate the demo tab set and the grove contract examples from one source.

Run from the repo root:
    apps\api\.venv\Scripts\python apps\api\app\engine\scripts\gen_contracts.py

Writes (LF line endings, UTF-8):
    apps/api/app/engine/fixtures/demo_tabs.json
    contracts/grove.example.json
    contracts/grove.degraded.example.json
    contracts/grove.stream.example.ndjson
"""

import hashlib
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(REPO / "apps" / "api"))
from app.engine import labels  # noqa: E402


def tid(n: int) -> str:
    return f"00000000-0000-4000-8000-{n:012d}"


def uid(prefix: str, lead: str, n: int) -> str:
    return f"{prefix}_{lead}0000000-0000-4000-8000-{n:012d}"


def dup_key(url: str) -> str:
    return hashlib.sha256(url.removeprefix("https://").encode()).hexdigest()  # §4.2: scheme, www, trailing slash removed


# n, domain, title, normalized url (on-device only; hashed), opener, opened_at, search_query, source_type, dwell_min
TABS = [
    # Backend Authentication (10)
    (1, "fastapi.tiangolo.com", "OAuth2 with Password (and hashing), Bearer with JWT tokens - FastAPI", "https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt", None, "2026-10-04T09:41:12Z", None, "docs", 9.5),
    (2, "fastapi.tiangolo.com", "OAuth2 with Password (and hashing), Bearer with JWT tokens - FastAPI", "https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt", 9, "2026-10-04T11:03:40Z", None, "docs", 0.3),
    (3, "stackoverflow.com", "JWT vs session-based authentication for a REST API - Stack Overflow", "https://stackoverflow.com/questions/43452896/jwt-vs-session-based-authentication-for-a-rest-api", None, "2026-10-04T09:48:05Z", None, "qa", 6.2),
    (4, "github.com", "fastapi-jwt-auth-example: login, refresh and protected routes", "https://github.com/devsamples/fastapi-jwt-auth-example", 3, "2026-10-04T09:55:31Z", None, "code", 14.0),
    (5, "learn.microsoft.com", "OAuth 2.0 authorization code flow - Microsoft identity platform | Microsoft Learn", "https://learn.microsoft.com/entra/identity-platform/v2-oauth2-auth-code-flow", None, "2026-10-04T10:05:47Z", None, "docs", 4.1),
    (6, "www.google.com", "where to store refresh token - Google Search", "https://google.com/search?q=where+to+store+refresh+token", None, "2026-10-04T10:58:02Z", "where to store refresh token", "search", 0.8),
    (7, "www.google.com", "refresh token httponly cookie vs localstorage - Google Search", "https://google.com/search?q=refresh+token+httponly+cookie+vs+localstorage", 6, "2026-10-04T11:09:26Z", "refresh token httponly cookie vs localstorage", "search", 1.1),
    (8, "www.google.com", "is it safe to keep refresh token in the browser - Google Search", "https://google.com/search?q=is+it+safe+to+keep+refresh+token+in+the+browser", 7, "2026-10-04T11:31:14Z", "is it safe to keep refresh token in the browser", "search", 0.6),
    (9, "medium.com", "Securing FastAPI with JWT: a step-by-step guide | Medium", "https://medium.com/@backendnotes/securing-fastapi-with-jwt-a-step-by-step-guide-3f9c2a", 6, "2026-10-04T11:00:15Z", None, "article", 5.8),
    (10, "dev.to", "FastAPI JWT authentication explained - DEV Community", "https://dev.to/pyweekly/fastapi-jwt-authentication-explained-4k2m", 7, "2026-10-04T11:10:03Z", None, "article", 0.4),
    # GirlHacks Prep (5)
    (11, "girlhacks-2026.devpost.com", "GirlHacks 2026 - Devpost", "https://girlhacks-2026.devpost.com", None, "2026-10-04T08:52:40Z", None, "other", 7.4),
    (12, "mlh.io", "MLH Official Hackathon Rules - Major League Hacking", "https://mlh.io/rules", 11, "2026-10-04T08:54:10Z", None, "docs", 3.2),
    (13, "docs.tigerdata.com", "Hypertables | Tiger Data Docs", "https://docs.tigerdata.com/use-timescale/latest/hypertables", None, "2026-10-04T09:12:55Z", None, "docs", 6.9),
    (14, "azure.microsoft.com", "Azure for Students – Free Account Credit | Microsoft Azure", "https://azure.microsoft.com/free/students", 11, "2026-10-04T08:58:21Z", None, "other", 2.0),
    (15, "d3js.org", "d3-hierarchy | D3 by Observable", "https://d3js.org/d3-hierarchy", None, "2026-10-04T09:20:44Z", None, "docs", 4.6),
    # Job Search (5), last focused 4 days ago
    (16, "www.linkedin.com", "Backend Engineer, Platform - Northwind Traders | LinkedIn", "https://linkedin.com/jobs/view/4011223344", None, "2026-09-29T19:12:08Z", None, "other", 5.3),
    (17, "job-boards.greenhouse.io", "Job Application for Software Engineer II, API at Tailspin Toys", "https://job-boards.greenhouse.io/tailspintoys/jobs/7712004", None, "2026-09-29T19:30:51Z", None, "other", 11.2),
    (18, "www.glassdoor.com", "Tailspin Toys Software Engineer Interview Questions | Glassdoor", "https://glassdoor.com/interview/tailspin-toys-software-engineer-interview-questions", 17, "2026-09-29T19:45:17Z", None, "discussion", 2.1),
    (19, "leetcode.com", "LRU Cache - LeetCode", "https://leetcode.com/problems/lru-cache", None, "2026-09-30T20:05:33Z", None, "other", 3.8),
    (20, "docs.google.com", "Resume 2026 - Google Docs", "https://docs.google.com/document/d/1resume2026", None, "2026-09-30T20:31:02Z", None, "work_tool", 4.4),
    # Weeknight Dinner (3)
    (21, "www.allrecipes.com", "One-Pan Lemon Garlic Chicken and Potatoes Recipe", "https://allrecipes.com/recipe/284512/one-pan-lemon-garlic-chicken-and-potatoes", None, "2026-10-03T21:48:10Z", None, "article", 3.6),
    (22, "www.bbcgoodfood.com", "Easy chickpea curry recipe | BBC Good Food", "https://bbcgoodfood.com/recipes/easy-chickpea-curry", None, "2026-10-03T21:52:37Z", None, "article", 2.9),
    (23, "www.instacart.com", "Instacart | Grocery delivery: cart", "https://instacart.com/store/cart", None, "2026-10-03T22:01:15Z", None, "other", 1.7),
    # Sprout (2), opened < 30 min before snapshot
    (24, "doc.rust-lang.org", "What is Ownership? - The Rust Programming Language", "https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html", None, "2026-10-04T11:18:22Z", None, "docs", 4.0),
    (25, "www.reddit.com", "Rust vs Go for a small CLI tool? : r/rust", "https://reddit.com/r/rust/comments/1fx2k9q/rust_vs_go_for_a_small_cli_tool", 24, "2026-10-04T11:24:49Z", None, "discussion", 2.2),
    # Meadow (2)
    (26, "www.youtube.com", "How to fix a squeaky door hinge in 60 seconds - YouTube", "https://youtube.com/watch?v=q8Xo2HhZt0c", None, "2026-10-03T18:20:11Z", None, "video", 0.15),
    (27, "www.springfieldgazette.com", "Library extends weekend hours starting in November - Springfield Gazette", "https://springfieldgazette.com/news/library-weekend-hours", None, "2026-10-04T07:58:40Z", None, "article", 1.4),
    # Fog (1)
    (28, "pomofocus.io", "Pomofocus - Pomodoro timer online", "https://pomofocus.io", None, "2026-10-04T09:39:03Z", None, "other", 0.5),
]
T = {row[0]: row for row in TABS}
ACTIVE, PINNED = 4, 11

open_tabs = [
    {
        "tab_ref": tid(n),
        "domain": domain,
        "title": title,
        "opener_tab_ref": tid(opener) if opener else None,
        "opened_at": opened,
        "active": n == ACTIVE,
        "pinned": n == PINNED,
        "dup_key": dup_key(url),
        "search_query": query,
    }
    for n, domain, title, url, opener, opened, query, _, _ in TABS
]
demo_tabs = {
    "_about": "SAMPLE demo set: 28 open tabs in the BUILD_TASKS.md §4.2 snapshot format (POST /api/grove/grow body). Titles are already redacted. tab_ref 01-10 Backend Authentication, 11-15 GirlHacks Prep, 16-20 Job Search, 21-23 Weeknight Dinner, 24-25 sprout, 26-27 meadow, 28 fog. 01/02 are an exact duplicate (same dup_key).",
    "snapshot_at": "2026-10-04T11:40:00Z",
    "open_tabs": open_tabs,
}


def top_terms(ns: list[int], k: int = 3) -> str:
    """Top shared title terms of demo tabs (R-9). One implementation: app.engine.labels."""
    return labels.top_terms([T[n][2] for n in ns], k)


def leaf(n, importance, fallen=False):
    _, domain, title, _, _, _, _, stype, dwell = T[n]
    return {"tab_ref": tid(n), "title": title, "domain": domain, "source_type": stype, "dwell_min": dwell,
            "is_open": True, "importance": importance, "fallen": fallen}


def ev(kind, ref, why):
    return {"ref_kind": kind, "ref": ref, "why": why}


def tab_ev(n, why):
    return ev("tab", tid(n), why)


def claim(cid, text, prov, conf, display, evidence, **extra):
    c = {"id": cid, "text": text, "provenance": prov, "confidence": conf, "display_text": display}
    c.update(extra)
    c["evidence"] = evidence
    return c


P_AUTH, P_HACK, P_JOB, P_DINNER = (uid("p", "1", i) for i in range(1, 5))
NOTE = uid("n", "4", 7)
QF = uid("qf", "5", 1)
Q_REFRESH = uid("q", "3", 401)
Q_TRACKS = uid("q", "3", 402)

auth_tree = {
    "project_id": P_AUTH,
    "name": "Backend Authentication",
    "is_existing_project_id": None,
    "goal": claim(uid("g", "3", 101), "Choose an authentication architecture for the application", "inferred", 0.82,
                  "Appears to be choosing an authentication architecture for the application",
                  [tab_ev(1, "official FastAPI security docs, 9.5 min"),
                   tab_ev(3, "compared JWT and sessions"),
                   tab_ev(5, "read the OAuth 2.0 authorization code flow")]),
    "attention_min": 134,
    "days_since_active": 0,
    "canopy": "green",
    "fogged": False,
    "branches": [
        {"label": "JWT", "status": "active",
         "leaves": [leaf(1, 0.91), leaf(4, 0.86), leaf(9, 0.41), leaf(7, 0.33), leaf(6, 0.29), leaf(8, 0.27), leaf(10, 0.12), leaf(2, 0.08)]},
        {"label": "OAuth 2.0", "status": "explored", "leaves": [leaf(5, 0.62)]},
        {"label": "Sessions", "status": "explored", "leaves": [leaf(3, 0.74)]},
    ],
    "direction": claim(uid("dir", "3", 201), "JWT appears to be the preferred approach", "inferred", 0.71,
                       "JWT appears to be the preferred approach",
                       [tab_ev(4, "14 min dwell, 3 revisits"),
                        tab_ev(3, "opened the JWT example from this answer")]),
    "stones": [
        claim(uid("dec", "3", 301), "Not using OAuth providers for v1", "stated", 1.0,
              "Not using OAuth providers for v1",
              [ev("note", NOTE, "user note")],
              kind="carved", user_note_id=NOTE, quote=None),
        claim(uid("dec", "3", 302), "Using FastAPI's built-in OAuth2PasswordBearer instead of a third-party auth library", "inferred", 0.68,
              "Appears to be using FastAPI's built-in OAuth2PasswordBearer instead of a third-party auth library",
              [tab_ev(1, "9.5 min on the OAuth2PasswordBearer section"),
               tab_ev(4, "the example kept open uses OAuth2PasswordBearer")],
              kind="mossy", user_note_id=None, quote=None),
    ],
    "mushrooms": [
        claim(Q_REFRESH, "Where should refresh tokens be stored securely?", "inferred", 0.78,
              "Likely still open: where should refresh tokens be stored securely?",
              [ev("query", QF, "4 rephrasings in 33 min, no long read after"),
               tab_ev(6, "search: where to store refresh token"),
               tab_ev(7, "search: refresh token httponly cookie vs localstorage"),
               tab_ev(8, "search: is it safe to keep refresh token in the browser"),
               tab_ev(10, "short visit (24 s) from a search result")],
              kind="repeated_search", status="open", answer=None, resolved_at=None, recurrence=4),
    ],
    "next_actions": [
        claim(uid("a", "3", 501), "Prototype a refresh-token flow with HttpOnly, SameSite cookies", "inferred", 0.66,
              "Likely next: prototype a refresh-token flow with HttpOnly, SameSite cookies",
              [tab_ev(7, "searched HttpOnly cookie vs localStorage"),
               tab_ev(4, "the example has a refresh route to adapt")],
              unblocks=Q_REFRESH, reason="Most-searched open question"),
    ],
    "vines": [
        {"tab_refs": [tid(9), tid(10)], "kind": "semantic", "keep_ref": tid(1),
         "reason": "Both restate the official FastAPI docs' JWT token section"},
        {"tab_refs": [tid(1), tid(2)], "kind": "exact", "keep_ref": tid(1),
         "reason": "Same page open twice"},
    ],
    "hypotheses": [
        claim(uid("h", "3", 601), "May later host auth on Azure", "hypothesis", 0.41,
              "Maybe: may later host auth on Azure",
              [tab_ev(5, "Microsoft identity platform docs, opened once")]),
    ],
    "query_families": [
        {"id": QF,
         "queries": ["where to store refresh token", "refresh token httponly cookie vs localstorage",
                     "refresh token storage best practices spa", "is it safe to keep refresh token in the browser"],
         "tab_refs": [tid(6), tid(7), tid(8)], "open_loop": True},
    ],
    "important_tab_refs": [tid(1), tid(4), tid(3), tid(5)],
    "shared_tab_refs": [tid(5)],
}

hack_tree = {
    "project_id": P_HACK,
    "name": "GirlHacks Prep",
    "is_existing_project_id": None,
    "goal": claim(uid("g", "3", 102), "Prepare a project for the GirlHacks 2026 hackathon", "inferred", 0.74,
                  "Appears to be preparing a project for the GirlHacks 2026 hackathon",
                  [tab_ev(11, "GirlHacks 2026 Devpost page, pinned"),
                   tab_ev(12, "read the hackathon rules"),
                   tab_ev(13, "sponsor technology docs")]),
    "attention_min": 41,
    "days_since_active": 0,
    "canopy": "green",
    "fogged": False,
    "branches": [
        {"label": "Rules and submission", "status": "active", "leaves": [leaf(11, 0.71), leaf(12, 0.52)]},
        {"label": "Sponsor tech", "status": "active",
         "leaves": [leaf(13, 0.66), leaf(15, 0.55), leaf(5, 0.38), leaf(14, 0.31)]},
    ],
    "direction": None,
    "stones": [],
    "mushrooms": [
        claim(Q_TRACKS, "Which sponsor tracks should we submit to?", "inferred", 0.70,
              "Likely resolved: which sponsor tracks should we submit to?",
              [tab_ev(11, "Devpost page lists the sponsor tracks"),
               tab_ev(13, "read Tiger Data docs after the track list"),
               tab_ev(14, "opened Azure for Students from the Devpost page")],
              kind="unresolved_comparison", status="resolved",
              answer="Best Use of Azure and MLH Best Use of Tiger Data",
              resolved_at="2026-10-04T09:26:10Z", recurrence=2),
    ],
    "next_actions": [],
    "vines": [],
    "hypotheses": [],
    "query_families": [],
    "important_tab_refs": [tid(11), tid(13), tid(15)],
    "shared_tab_refs": [tid(5)],
}

job_tree = {
    "project_id": P_JOB,
    "name": "Job Search",
    "is_existing_project_id": P_JOB,
    "goal": claim(uid("g", "3", 103), "Apply for backend engineering roles", "inferred", 0.69,
                  "Appears to be applying for backend engineering roles",
                  [tab_ev(16, "backend engineer job posting"),
                   tab_ev(17, "application form, 11 min")]),
    "attention_min": 52,
    "days_since_active": 4,
    "canopy": "amber",
    "fogged": False,
    "branches": [
        {"label": "Applications", "status": "explored", "leaves": [leaf(17, 0.64), leaf(16, 0.51), leaf(20, 0.22, fallen=True)]},
        {"label": "Interview prep", "status": "explored", "leaves": [leaf(19, 0.18, fallen=True), leaf(18, 0.12, fallen=True)]},
    ],
    "direction": None,
    "stones": [],
    "mushrooms": [],
    "next_actions": [],
    "vines": [],
    "hypotheses": [],
    "query_families": [],
    "important_tab_refs": [tid(17), tid(16)],
    "shared_tab_refs": [],
}

dinner_tree = {
    "project_id": P_DINNER,
    "name": "Weeknight Dinner",
    "is_existing_project_id": None,
    "goal": claim(uid("g", "3", 104), "Plan a weeknight dinner", "inferred", 0.72,
                  "Appears to be planning a weeknight dinner",
                  [tab_ev(21, "recipe"), tab_ev(22, "recipe"), tab_ev(23, "grocery cart opened after the recipes")]),
    "attention_min": 9,
    "days_since_active": 0,
    "canopy": "green",
    "fogged": False,
    "branches": [
        {"label": "Recipes", "status": "active", "leaves": [leaf(21, 0.58), leaf(22, 0.47)]},
        {"label": "Groceries", "status": "active", "leaves": [leaf(23, 0.35)]},
    ],
    "direction": None,
    "stones": [],
    "mushrooms": [],
    "next_actions": [],
    "vines": [],
    "hypotheses": [],
    "query_families": [],
    "important_tab_refs": [tid(21), tid(23)],
    "shared_tab_refs": [],
}

grove = {
    "run_id": uid("r", "2", 81),
    "generated_at": "2026-10-04T11:40:04Z",
    "hollow_count": 3,
    "degraded": False,
    "banner_text": None,
    "trees": [auth_tree, hack_tree, job_tree, dinner_tree],
    "sprouts": [{"label": top_terms([24, 25]), "tab_refs": [tid(24), tid(25)]}],
    "meadow": [tid(26), tid(27)],
    "fog": [{"tab_ref": tid(28), "reason": "low affinity to any goal"}],
    "fireflies": [
        {"id": uid("ff", "7", 1), "project_id": P_AUTH, "past_project_id": uid("p", "1", 99),
         "past_project_name": "Backend Scaling", "past_date": "2026-03-12", "similarity": 0.84,
         "saved_context_id": uid("s", "6", 3), "display_text": "You researched this on March 12."},
    ],
}


def tree_tab_numbers(tree: dict) -> list[int]:
    return [int(leaf_["tab_ref"][-12:]) for branch in tree["branches"] for leaf_ in branch["leaves"]]


def seedling_tree(tree: dict) -> dict:
    """Seedling mode (R-9, proposal §8/§27): same cluster, deterministic label, everything fogged, no claims."""
    leaves = [leaf_ for branch in tree["branches"] for leaf_ in branch["leaves"]]
    label = top_terms(tree_tab_numbers(tree))
    words = label.replace(" · ", ", ")
    top = sorted(leaves, key=lambda l: -l["importance"])[:2]
    return {
        "project_id": tree["project_id"],
        "name": label,
        "is_existing_project_id": tree["is_existing_project_id"],
        "goal": claim(tree["goal"]["id"].replace("g_3", "g_8", 1), f"Tabs about {words}", "hypothesis", 0.45,
                      f"Maybe: tabs about {words}",
                      [tab_ev(int(l["tab_ref"][-12:]), "shares title terms with the group") for l in top]),
        "attention_min": tree["attention_min"],
        "days_since_active": tree["days_since_active"],
        "canopy": tree["canopy"],
        "fogged": True,
        "branches": [{"label": "All tabs", "status": "active", "leaves": leaves}],
        "direction": None,
        "stones": [],
        "mushrooms": [],
        "next_actions": [],
        "vines": [v for v in tree["vines"] if v["kind"] == "exact"],
        "hypotheses": [],
        "query_families": tree["query_families"],
        "important_tab_refs": tree["important_tab_refs"],
        "shared_tab_refs": tree["shared_tab_refs"],
    }


degraded = {
    "run_id": uid("r", "2", 82),
    "generated_at": grove["generated_at"],
    "hollow_count": grove["hollow_count"],
    "degraded": True,
    "banner_text": "AI unavailable — showing groups only",
    "trees": [seedling_tree(t) for t in grove["trees"]],
    "sprouts": grove["sprouts"],
    "meadow": grove["meadow"],
    "fog": grove["fog"],
    "fireflies": [],
}

stream_lines = [
    {"type": "clusters", "run_id": grove["run_id"], "hollow_count": grove["hollow_count"],
     "clusters": [{"project_id": t["project_id"], "name": top_terms(tree_tab_numbers(t)),
                   "tab_refs": [tid(n) for n in tree_tab_numbers(t)], "attention_min": t["attention_min"],
                   "days_since_active": t["days_since_active"], "canopy": t["canopy"]} for t in grove["trees"]],
     "sprouts": grove["sprouts"], "meadow": grove["meadow"], "fog": grove["fog"]},
    # smallest cluster first: its Azure call returns soonest
    *({"type": "tree", **t} for t in sorted(grove["trees"], key=lambda t: len(tree_tab_numbers(t)))),
    {"type": "done", "run_id": grove["run_id"], "degraded": grove["degraded"], "fireflies": grove["fireflies"]},
]


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text.encode("utf-8"))
    print(f"wrote {path.relative_to(REPO).as_posix()} ({path.stat().st_size:,} bytes)")


def dump(path: Path, data) -> None:
    write(path, json.dumps(data, indent=2, ensure_ascii=False) + "\n")


dump(REPO / "apps/api/app/engine/fixtures/demo_tabs.json", demo_tabs)
dump(REPO / "contracts/grove.example.json", grove)
dump(REPO / "contracts/grove.degraded.example.json", degraded)
write(REPO / "contracts/grove.stream.example.ndjson",
      "".join(json.dumps(line, ensure_ascii=False) + "\n" for line in stream_lines))


# ---------------------------------------------------------------------------
# Request/response contracts (BUILD_TASKS.md §5.1, §4.4; R-10 to R-13)
# Every example: {name, request, response, introduces}. `introduces` lists the ids the
# response creates (or, for memory search, past rows first seen there); every other id
# must already exist in demo_tabs.json or the grove examples.
# ---------------------------------------------------------------------------

JSON_CT = "application/json"
PROBLEM_CT = "application/problem+json"
SAMPLE_DOCS = REPO / "apps/api/app/engine/fixtures/sample_docs"
by_name = {t["name"]: t for t in grove["trees"]}


def example(name, method, path, body, status, response_body, introduces=(), content_type=None,
            response_content_type=JSON_CT, **extra):
    ex = {"name": name,
          "request": {"method": method, "path": path, "content_type": content_type or (JSON_CT if body is not None else None),
                      "body": body},
          "response": {"status": status, "content_type": response_content_type, "body": response_body},
          "introduces": list(introduces)}
    ex.update(extra)
    return ex


def problem(status, title, detail, instance, **extra):
    return {"type": "about:blank", "title": title, "status": status, "detail": detail, "instance": instance, **extra}


def find_claim(cid):
    for t in grove["trees"]:
        for key in ("goal", "direction"):
            if t[key] and t[key]["id"] == cid:
                return t[key]
        for key in ("stones", "mushrooms", "next_actions", "hypotheses"):
            for c in t[key]:
                if c["id"] == cid:
                    return c
    raise KeyError(cid)


# --- claims.example.json (R-10) ---------------------------------------------
MOSSY = find_claim(uid("dec", "3", 302))
ACTION = find_claim(uid("a", "3", 501))
HYPOTHESIS = find_claim(uid("h", "3", 601))
MUSHROOM = find_claim(Q_REFRESH)
N_CONFIRM, N_EDIT, N_FOG = uid("n", "4", 8), uid("n", "4", 9), uid("n", "4", 10)
P_NEW_TREE, P_FOG_TREE = uid("p", "1", 5), uid("p", "1", 6)

confirmed = {**MOSSY, "provenance": "stated", "confidence": 1.0, "display_text": MOSSY["text"],
             "kind": "carved", "user_note_id": N_CONFIRM,
             "evidence": [ev("note", N_CONFIRM, "user confirmed this decision")] + MOSSY["evidence"]}
edited_text = "Prototype a refresh-token flow with HttpOnly, Secure, SameSite=Strict cookies"
edited = {**ACTION, "text": edited_text, "provenance": "stated", "confidence": 1.0, "display_text": edited_text,
          "user_note_id": N_EDIT, "evidence": [ev("note", N_EDIT, "user edited this action")] + ACTION["evidence"]}
resolved = {**MUSHROOM, "status": "resolved",
            "answer": "Keep the refresh token in an HttpOnly, Secure, SameSite=Strict cookie; keep the access token in memory",
            "resolved_at": "2026-10-04T12:05:31Z"}
fog_goal_text = "Use a Pomodoro timer for focused work blocks"
FOREIGN_CLAIM = "dec_e0000000-0000-4000-8000-000000000404"

claims_contract = {"examples": [
    example("confirm the mossy stone (inferred → stated, carved)", "PATCH", f"/api/claims/{MOSSY['id']}",
            {"action": "confirm"}, 200, confirmed, introduces=[N_CONFIRM]),
    example("edit a next action's text (becomes stated with a note)", "PATCH", f"/api/claims/{ACTION['id']}",
            {"action": "edit", "text": edited_text}, 200, edited, introduces=[N_EDIT]),
    example("dismiss the hypothesis", "PATCH", f"/api/claims/{HYPOTHESIS['id']}",
            {"action": "dismiss"}, 200, {"id": HYPOTHESIS["id"], "status": "dismissed", "dismissed_at": "2026-10-04T12:02:10Z"}),
    example("resolve the refresh-token mushroom (becomes a flower)", "PATCH", f"/api/claims/{MUSHROOM['id']}",
            {"action": "resolve", "answer": resolved["answer"]}, 200, resolved),
    example("move a leaf to another existing tree's branch (pinned)", "POST", f"/api/tabs/{tid(13)}/assign",
            {"project_id": P_AUTH, "branch_label": "Sessions"}, 200,
            {"tab_ref": tid(13), "from_project_id": P_HACK, "project_id": P_AUTH, "project_name": "Backend Authentication",
             "branch_label": "Sessions", "assigned_by": "user", "pinned": True,
             "reanalyze_project_ids": [P_HACK, P_AUTH]}),
    example("move a leaf to a new tree (pinned)", "POST", f"/api/tabs/{tid(19)}/assign",
            {"new_project_name": "Interview Practice"}, 201,
            {"tab_ref": tid(19), "from_project_id": P_JOB, "project_id": P_NEW_TREE, "project_name": "Interview Practice",
             "branch_label": None, "assigned_by": "user", "pinned": True, "reanalyze_project_ids": [P_JOB, P_NEW_TREE]},
            introduces=[P_NEW_TREE]),
    example("Clear the fog: name the goal of the fog tab (stated note)", "POST", "/api/notes",
            {"kind": "goal", "tab_ref": tid(28), "text": fog_goal_text}, 201,
            {"note": {"id": N_FOG, "kind": "goal", "tab_ref": tid(28), "text": fog_goal_text, "created_at": "2026-10-04T12:07:45Z"},
             "project_id": P_FOG_TREE,
             "claim": claim(uid("g", "3", 105), fog_goal_text, "stated", 1.0, fog_goal_text,
                            [ev("note", N_FOG, "user named this goal"), tab_ev(28, "the tab the user cleared from the fog")],
                            user_note_id=N_FOG)},
            introduces=[N_FOG, P_FOG_TREE, uid("g", "3", 105)]),
    example("re-analyze one project (one tree in the grove tree shape)", "POST", f"/api/projects/{P_AUTH}/analyze",
            None, 200, auth_tree),
    example("error: another user's claim id → 404", "PATCH", f"/api/claims/{FOREIGN_CLAIM}",
            {"action": "confirm"}, 404,
            problem(404, "Not Found", "Claim not found", f"/api/claims/{FOREIGN_CLAIM}"),
            response_content_type=PROBLEM_CT, unknown_ids=[FOREIGN_CLAIM]),
    example("error: body contains user_id → 422", "PATCH", f"/api/claims/{MOSSY['id']}",
            {"action": "confirm", "user_id": "8f14e45f-ceea-5e6b-9a3c-1b2d3e4f5a6b"}, 422,
            problem(422, "Unprocessable Entity", "Request body contains fields that are not allowed",
                    f"/api/claims/{MOSSY['id']}",
                    errors=[{"loc": ["body", "user_id"], "msg": "Extra inputs are not permitted", "type": "extra_forbidden"}]),
            response_content_type=PROBLEM_CT),
]}

# --- work-context.example.json (R-11) ----------------------------------------
def read_doc(name: str) -> str:
    return (SAMPLE_DOCS / name).read_text(encoding="utf-8")


def transcript_excerpt(first: str, last: str) -> str:
    """Verbatim cue blocks from the SAMPLE transcript whose start time is in [first, last]."""
    blocks = read_doc("teams-transcript.vtt").split("\n\n")
    cues = [b.strip("\n") for b in blocks if "-->" in b and first <= b.strip("\n")[:12] <= last]
    return "\n\n".join(cues)


WC_ITEMS = [
    {"kind": "page", "title": "CAM-142 · Customer Authentication Migration", "domain": "tabforest-api.azurewebsites.net",
     "text": read_doc("jira-CAM-142.md")},
    {"kind": "page", "title": "Token service on Azure Functions (WIP) #418", "domain": "tabforest-api.azurewebsites.net",
     "text": read_doc("pr-418.md")},
    {"kind": "page", "title": "Account note: Fabrikam", "domain": "tabforest-api.azurewebsites.net",
     "text": read_doc("customer-note.md")},
    {"kind": "paste", "title": "Teams transcript excerpt: CAM arch sync 2026-09-22",
     "text": transcript_excerpt("00:07:58.800", "00:20:05.100")},
]
D_JIRA, D_PR, D_NOTE, D_TRANSCRIPT = (uid("d", "9", i) for i in range(1, 5))
WC_DOCS = [
    {"id": D_JIRA, "kind": "page", "title": WC_ITEMS[0]["title"], "source_type": "ticket"},
    {"id": D_PR, "kind": "page", "title": WC_ITEMS[1]["title"], "source_type": "pull_request"},
    {"id": D_NOTE, "kind": "page", "title": WC_ITEMS[2]["title"], "source_type": "account_note"},
    {"id": D_TRANSCRIPT, "kind": "paste", "title": WC_ITEMS[3]["title"], "source_type": "transcript"},
]
DOC_TITLE = {d["id"]: d["title"] for d in WC_DOCS}


def doc_ev(ref, why):
    return ev("doc", ref, why)


def wc_item(cid, text, prov, conf, display, evidence, quote=None, source=None, timestamp=None, **extra):
    c = claim(cid, text, prov, conf, display, evidence, **extra)
    evidence_ = c.pop("evidence")
    c.update(quote=quote, source=DOC_TITLE[source] if source else None, timestamp=timestamp, evidence=evidence_)
    return c


def sourced(cid, text, conf, quote, source, evidence, timestamp=None, **extra):
    return wc_item(cid, text, "sourced", conf, text, evidence, quote=quote, source=source, timestamp=timestamp, **extra)


WC_BLOCKER = uid("b", "9", 301)
WC_QUESTION = uid("q", "9", 501)
wc_response = {
    "run_id": uid("r", "2", 83),
    "project": "Customer Authentication Migration",
    "documents": WC_DOCS,
    "goal": sourced(uid("g", "9", 101), "Migrate customer authentication to Azure", 0.85,
                    "Migrate customer authentication to Azure before the Fabrikam go-live", D_JIRA,
                    [doc_ev(D_JIRA, "goal stated in the ticket description"),
                     doc_ev(D_NOTE, "account note ties the go-live to CAM-142")]),
    "decisions": [
        sourced(uid("dec", "9", 201), "Azure Functions selected for the token service", 0.85,
                "For the token service we'll go with Functions, Premium plan, one always-ready instance.", D_TRANSCRIPT,
                [doc_ev(D_TRANSCRIPT, "00:14:32 Marcus Lee states the decision"),
                 doc_ev(D_PR, "PR retitled to Token service on Azure Functions (WIP)")],
                timestamp="00:14:32", speaker="Marcus Lee"),
    ],
    "blockers": [
        sourced(WC_BLOCKER, "Customer test credentials have not arrived", 0.90,
                "Heads up: the customer test credentials have not arrived, so I can't run the end-to-end flow against the Fabrikam tenant yet.",
                D_PR,
                [doc_ev(D_PR, "Priya Shah's PR comment"),
                 doc_ev(D_TRANSCRIPT, "00:07:58 Priya Shah repeats it in the meeting"),
                 doc_ev(D_NOTE, "credentials were promised for 9/15")]),
    ],
    "owners": [
        sourced(uid("o", "9", 401), "Priya Shah owns the credentials follow-up", 0.80,
                "I'll follow up with the customer tomorrow and cc Dana", D_PR,
                [doc_ev(D_PR, "commits to follow up in the PR"),
                 doc_ev(D_TRANSCRIPT, "00:08:15 says she will ping their IT contact")],
                person="Priya Shah", task="Follow up with the customer on test credentials"),
        sourced(uid("o", "9", 402), "You own the OAuth callback (CAM-145)", 0.80,
                "Assigning the OAuth callback work to You (CAM-145)", D_JIRA,
                [doc_ev(D_JIRA, "Marcus Lee assigns CAM-145 in a comment"),
                 doc_ev(D_TRANSCRIPT, "00:18:25 You say you are on the OAuth callback")],
                person="You", task="OAuth callback (CAM-145)"),
    ],
    "open_questions": [
        wc_item(WC_QUESTION, "Where should session state be stored?", "inferred", 0.74,
                "Likely still open: where should session state be stored?",
                [doc_ev(D_TRANSCRIPT, "00:09:30 Sam Rivera asks; parked"),
                 doc_ev(D_TRANSCRIPT, "00:19:52 You ask again; taken offline"),
                 doc_ev(D_PR, "same question in review, no reply")],
                status="open", answer=None, resolved_at=None, recurrence=2),
    ],
    "next_actions": [
        sourced(uid("a", "9", 601), "Test the OAuth callback", 0.80,
                "OAuth callback (`/auth/callback`) tested end to end against the Fabrikam test tenant", D_JIRA,
                [doc_ev(D_JIRA, "open acceptance criterion"),
                 doc_ev(D_TRANSCRIPT, "00:18:25 You plan to test it this week")],
                rank=1, unblocks=None),
        sourced(uid("a", "9", 602), "Review migration doc §4 (Cutover and rollback)", 0.80,
                "Everyone please read section 4 of the migration doc, cutover and rollback, before Thursday.", D_TRANSCRIPT,
                [doc_ev(D_TRANSCRIPT, "00:15:40 Marcus Lee asks everyone to review it"),
                 doc_ev(D_JIRA, "acceptance criterion: rollback rehearsed (migration plan §4)")],
                timestamp="00:15:40", rank=2, unblocks=None),
        sourced(uid("a", "9", 603), "Follow up on the customer test credentials", 0.80,
                "I'll follow up with the customer tomorrow", D_PR,
                [doc_ev(D_PR, "Priya Shah commits to follow up"),
                 doc_ev(D_TRANSCRIPT, "00:08:15 she will ping their IT contact today")],
                rank=3, unblocks=WC_BLOCKER),
    ],
    "handoff_brief": "\n".join([
        "Customer Authentication Migration (CAM-142)",
        "Goal: Migrate customer authentication to Azure.",
        "Decided: Azure Functions for the token service (Marcus Lee, arch sync 00:14:32).",
        "Blocked: customer test credentials have not arrived. Priya Shah is following up with Fabrikam.",
        "Open: where should session state be stored? Raised twice, never answered.",
        "Owners: Priya Shah, credentials follow-up. You, OAuth callback (CAM-145).",
        "Next: 1. Test the OAuth callback. 2. Review migration doc §4 (Cutover and rollback). 3. Follow up on the customer test credentials.",
    ]),
}
wc_introduces = [wc_response["run_id"], *(d["id"] for d in WC_DOCS)] + [
    c["id"] for key in ("decisions", "blockers", "owners", "open_questions", "next_actions") for c in wc_response[key]
] + [wc_response["goal"]["id"]]

work_context_contract = {
    "examples": [
        example("analyze captured pages and a pasted transcript excerpt", "POST", "/api/work-context/analyze",
                {"items": WC_ITEMS}, 200, wc_response, introduces=wc_introduces),
        example("error: upload over 5 MB → 413", "POST", "/api/work-context/upload", None, 413,
                problem(413, "Payload Too Large", "customer-deck.pdf is 7.4 MB; the limit is 5 MB per file",
                        "/api/work-context/upload"),
                content_type="multipart/form-data", response_content_type=PROBLEM_CT),
    ],
    "upload": {
        "method": "POST",
        "path": "/api/work-context/upload",
        "content_type": "multipart/form-data",
        "fields": [
            {"name": "files[]", "type": "file", "required": False, "repeatable": True,
             "accepted_extensions": [".pdf", ".txt", ".md", ".vtt"], "max_bytes_per_file": 5 * 1024 * 1024,
             "max_pdf_pages": 30, "example_files": ["migration-doc.md", "teams-transcript.vtt"]},
            {"name": "items_json", "type": "string", "required": False,
             "description": "JSON string holding the same items array as the analyze request",
             "example": json.dumps(WC_ITEMS, ensure_ascii=False)},
        ],
        "notes": "Text is extracted in memory and never stored; each item and file is capped at 12,000 characters. The response has the same shape as analyze.",
        "response": "same as the analyze response",
    },
}

# --- memory-search.example.json (R-12) ---------------------------------------
FIREFLY = grove["fireflies"][0]
PAST_NOTE = uid("n", "4", 3)
memory_contract = {"examples": [
    example("found: session storage", "GET", "/api/memory/search?q=session%20storage", None, 200,
            {"found": True, "query": "session storage", "message": None, "matches": [
                {"project_id": FIREFLY["past_project_id"], "project": FIREFLY["past_project_name"],
                 "date": FIREFLY["past_date"], "similarity": FIREFLY["similarity"], "attention_min": 100,
                 "compared": ["Redis", "Postgres sessions"],
                 "conclusion": claim(uid("dec", "3", 901), "Redis not needed at expected scale", "stated", 1.0,
                                     "Redis not needed at expected scale", [ev("note", PAST_NOTE, "user note, March 12")],
                                     user_note_id=PAST_NOTE),
                 "saved_context_id": FIREFLY["saved_context_id"]}]},
            introduces=[PAST_NOTE, uid("dec", "3", 901)]),
    example("not found: recipe", "GET", "/api/memory/search?q=recipe", None, 200,
            {"found": False, "query": "recipe", "message": "No related research found", "matches": []}),
]}

# --- prune.example.json (R-13) -------------------------------------------------
vines = {v["kind"]: v for v in auth_tree["vines"]}
fallen = [l["tab_ref"] for t in grove["trees"] for b in t["branches"] for l in b["leaves"] if l["fallen"]]
prune_contract = {"examples": [
    example("prune suggestions for the open snapshot", "POST", "/api/tabs/prune-suggestions",
            {"tab_refs": [t["tab_ref"] for t in open_tabs]}, 200,
            {"suggestions": [
                {"id": uid("pr", "b", 1), "kind": "exact_duplicate", "tab_refs": vines["exact"]["tab_refs"],
                 "keep_ref": vines["exact"]["keep_ref"], "reason": vines["exact"]["reason"], "default_selected": True},
                {"id": uid("pr", "b", 2), "kind": "semantic_redundant", "tab_refs": vines["semantic"]["tab_refs"],
                 "keep_ref": vines["semantic"]["keep_ref"], "reason": vines["semantic"]["reason"], "default_selected": True},
                {"id": uid("pr", "b", 3), "kind": "stale", "tab_refs": fallen, "keep_ref": None,
                 "reason": "No focus for 4 days and not used as evidence", "default_selected": False},
                {"id": uid("pr", "b", 4), "kind": "distraction", "tab_refs": [tid(26)], "keep_ref": None,
                 "reason": "9 s of focus, unrelated to any goal", "default_selected": False},
            ],
             "actions": [
                 {"id": "keep_all", "label": "Keep all"},
                 {"id": "close_selected", "label": "Close selected"},
                 {"id": "save_as_references", "label": "Save as references"},
                 {"id": "prune_branch", "label": "Prune branch"},
             ],
             "note": "Suggestions only. The extension closes tabs only after an explicit click."},
            introduces=[uid("pr", "b", i) for i in range(1, 5)]),
]}

dump(REPO / "contracts/claims.example.json", claims_contract)
dump(REPO / "contracts/work-context.example.json", work_context_contract)
dump(REPO / "contracts/memory-search.example.json", memory_contract)
dump(REPO / "contracts/prune.example.json", prune_contract)
