"""R-2 normalization: demo tabs agree with the grove contract; 20+ real-world titles."""

import pytest

from app.engine.fixtures import load_contract, load_demo_tabs, load_sample_doc
from app.engine.normalize import (NormalizedTab, SourceType, classify_source, clean_title, duplicate_groups,
                                  leaf_source_type, norm_title, normalize_for_match, normalize_tab,
                                  official_source, parse_search_query)

TABS = load_demo_tabs()["open_tabs"]


def tid(n: int) -> str:
    return f"00000000-0000-4000-8000-{n:012d}"


def grove_leaf_types() -> dict[str, str]:
    grove = load_contract("grove.example.json")
    return {l["tab_ref"]: l["source_type"] for t in grove["trees"] for b in t["branches"] for l in b["leaves"]}


# Tabs that are not grove leaves (sprout, meadow, fog): expected types listed explicitly.
NON_LEAF_TYPES = {
    tid(24): SourceType.DOCS,        # doc.rust-lang.org, The Rust book (sprout)
    tid(25): SourceType.DISCUSSION,  # reddit.com r/rust (sprout)
    tid(26): SourceType.VIDEO,       # youtube.com (meadow)
    tid(27): SourceType.OTHER,       # springfieldgazette.com, unknown news site (meadow)
    tid(28): SourceType.OTHER,       # pomofocus.io (fog)
}


def test_demo_tabs_match_grove_source_types() -> None:
    leaf = grove_leaf_types()
    assert set(leaf) | set(NON_LEAF_TYPES) == {t["tab_ref"] for t in TABS}
    for tab in TABS:
        expected = leaf.get(tab["tab_ref"]) or NON_LEAF_TYPES[tab["tab_ref"]]
        assert classify_source(tab["domain"], tab["title"]) == expected, tab["title"]


def test_demo_search_tabs_recover_their_query_from_the_title() -> None:
    search_tabs = [t for t in TABS if t["search_query"]]
    assert len(search_tabs) == 3
    for tab in search_tabs:
        assert parse_search_query(tab["domain"], tab["title"], None) == tab["search_query"]
        assert parse_search_query(tab["domain"], tab["title"], "from device") == "from device"
    for tab in (t for t in TABS if not t["search_query"]):
        assert parse_search_query(tab["domain"], tab["title"], None) is None


def test_demo_duplicate_groups() -> None:
    assert duplicate_groups(TABS) == [[tid(1), tid(2)]]


def test_normalize_tab_on_every_demo_tab() -> None:
    for tab in TABS:
        n = normalize_tab(tab)
        assert isinstance(n, NormalizedTab)
        assert n.title_clean and n.title_norm == n.title_norm.lower()
        assert n.dup_key == tab["dup_key"]
    assert normalize_tab(TABS[0]).official is True                      # FastAPI docs
    assert normalize_tab(TABS[3]).official is False                     # GitHub example


DEMO_CLEAN = {
    1: "OAuth2 with Password (and hashing), Bearer with JWT tokens",
    3: "JWT vs session-based authentication for a REST API",
    5: "OAuth 2.0 authorization code flow",
    6: "where to store refresh token",
    9: "Securing FastAPI with JWT: a step-by-step guide",
    10: "FastAPI JWT authentication explained",
    11: "GirlHacks 2026",
    12: "MLH Official Hackathon Rules",
    13: "Hypertables",
    14: "Azure for Students – Free Account Credit",
    15: "d3-hierarchy",
    16: "Backend Engineer, Platform - Northwind Traders",
    20: "Resume 2026",
    23: "Grocery delivery: cart",
    24: "What is Ownership?",
    25: "Rust vs Go for a small CLI tool?",
    26: "How to fix a squeaky door hinge in 60 seconds",
    27: "Library extends weekend hours starting in November",
    28: "Pomodoro timer online",
}


@pytest.mark.parametrize("n,expected", sorted(DEMO_CLEAN.items()))
def test_demo_clean_titles(n: int, expected: str) -> None:
    tab = TABS[n - 1]
    assert clean_title(tab["title"], tab["domain"]) == expected


# (domain, title, expected clean title, expected source type, expected query from title)
REAL_WORLD = [
    # GitHub: issue vs repo vs PR vs gist
    ("github.com", "Token refresh returns 401 after deploy · Issue #2178 · tiangolo/fastapi · GitHub",
     "Token refresh returns 401 after deploy · Issue #2178 · tiangolo/fastapi", SourceType.DISCUSSION, None),
    ("github.com", "Add refresh token rotation by octocat · Pull Request #418 · tiangolo/fastapi · GitHub",
     "Add refresh token rotation by octocat · Pull Request #418 · tiangolo/fastapi", SourceType.PULL_REQUEST, None),
    ("github.com", "GitHub - tiangolo/fastapi: FastAPI framework, high performance, easy to learn",
     "tiangolo/fastapi: FastAPI framework, high performance, easy to learn", SourceType.CODE, None),
    ("gist.github.com", "jwt_refresh.py · GitHub", "jwt_refresh.py", SourceType.CODE, None),
    # Q&A, incl. a site search page, Stack Exchange and a non-English title
    ("stackoverflow.com", "Where to store JWT in browser? How to protect against CSRF? - Stack Overflow",
     "Where to store JWT in browser? How to protect against CSRF?", SourceType.QA, None),
    ("stackoverflow.com", "Search Results - Stack Overflow", "Search Results", SourceType.SEARCH, None),
    ("security.stackexchange.com", "Is it safe to store a JWT in localStorage? - Information Security Stack Exchange",
     "Is it safe to store a JWT in localStorage?", SourceType.QA, None),
    ("es.stackoverflow.com", "¿Dónde guardar el refresh token en una SPA? - Stack Overflow en español",
     "¿Dónde guardar el refresh token en una SPA?", SourceType.QA, None),
    # Docs
    ("developer.mozilla.org", "Set-Cookie - HTTP | MDN", "Set-Cookie - HTTP", SourceType.DOCS, None),
    ("learn.microsoft.com", "Configure CORS in ASP.NET Core | Microsoft Learn", "Configure CORS in ASP.NET Core",
     SourceType.DOCS, None),
    ("requests.readthedocs.io", "Quickstart — Requests 2.32.3 documentation", "Quickstart", SourceType.DOCS, None),
    # Video, incl. a notification counter and a title that is only the site name
    ("www.youtube.com", "(3) JWT authentication in FastAPI - full tutorial - YouTube",
     "JWT authentication in FastAPI - full tutorial", SourceType.VIDEO, None),
    ("www.youtube.com", "YouTube", "YouTube", SourceType.VIDEO, None),
    # Articles, incl. Medium's author and publication suffixes
    ("medium.com", "How I store refresh tokens safely | by Jane Doe | Medium", "How I store refresh tokens safely",
     SourceType.ARTICLE, None),
    ("levelup.gitconnected.com", "Rotating refresh tokens | by Jane Doe | in Level Up Coding | Medium",
     "Rotating refresh tokens", SourceType.OTHER, None),
    ("dev.to", "Stop storing JWTs in localStorage - DEV Community", "Stop storing JWTs in localStorage",
     SourceType.ARTICLE, None),
    ("someone.substack.com", "Why sessions still beat JWTs", "Why sessions still beat JWTs", SourceType.ARTICLE, None),
    # Discussion
    ("www.reddit.com", "Where do you keep refresh tokens in a SPA? : r/webdev",
     "Where do you keep refresh tokens in a SPA?", SourceType.DISCUSSION, None),
    ("news.ycombinator.com", "Show HN: A tiny JWT library | Hacker News", "Show HN: A tiny JWT library",
     SourceType.DISCUSSION, None),
    # Search engines
    ("www.google.co.uk", "fastapi refresh token - Google Search", "fastapi refresh token", SourceType.SEARCH,
     "fastapi refresh token"),
    ("www.bing.com", "refresh token rotation - Bing", "refresh token rotation", SourceType.SEARCH,
     "refresh token rotation"),
    ("duckduckgo.com", "httponly cookie samesite at DuckDuckGo", "httponly cookie samesite", SourceType.SEARCH,
     "httponly cookie samesite"),
    ("accounts.google.com", "Sign in - Google Accounts", "Sign in", SourceType.OTHER, None),
    # Work tools and document types
    ("contoso.atlassian.net", "[CAM-142] Customer Authentication Migration - Jira",
     "[CAM-142] Customer Authentication Migration", SourceType.TICKET, None),
    ("contoso.atlassian.net", "Customer Auth Migration Plan - Confluence", "Customer Auth Migration Plan",
     SourceType.WORK_TOOL, None),
    ("teams.microsoft.com", "CAM arch sync | Microsoft Teams", "CAM arch sync", SourceType.WORK_TOOL, None),
    ("teams.microsoft.com", "Recording and transcript: CAM arch sync | Microsoft Teams",
     "Recording and transcript: CAM arch sync", SourceType.TRANSCRIPT, None),
    ("contoso.crm.dynamics.com", "Account: Fabrikam, Inc. - Dynamics 365", "Account: Fabrikam, Inc.",
     SourceType.ACCOUNT_NOTE, None),
    ("app.slack.com", "general (Channel) - Contoso - Slack", "general (Channel) - Contoso", SourceType.WORK_TOOL, None),
    ("docs.google.com", "Q4 planning - Google Sheets", "Q4 planning", SourceType.WORK_TOOL, None),
    # Unknown site and an empty title
    ("www.example-blog.net", "My weekend project", "My weekend project", SourceType.OTHER, None),
    ("example.org", "", "example.org", SourceType.OTHER, None),
]


@pytest.mark.parametrize("domain,title,clean,source_type,query", REAL_WORLD, ids=[r[1][:40] or "empty" for r in REAL_WORLD])
def test_real_world_titles(domain, title, clean, source_type, query) -> None:
    assert clean_title(title, domain) == clean
    assert classify_source(domain, title) == source_type
    assert parse_search_query(domain, title, None) == query


def test_real_world_set_covers_every_source_type() -> None:
    assert len(REAL_WORLD) >= 20
    assert {r[3] for r in REAL_WORLD} == set(SourceType)


def test_existing_query_is_returned_unchanged() -> None:
    assert parse_search_query("stackoverflow.com", "Search Results - Stack Overflow", "refresh token httponly") \
        == "refresh token httponly"
    assert parse_search_query("www.google.com", "anything - Google Search", "  As Typed  ") == "  As Typed  "


def test_norm_title() -> None:
    assert norm_title("We’ll go with Functions – v2!! | MDN", "developer.mozilla.org") == "we ll go with functions v2"
    assert norm_title("¿Dónde guardar el token? - Stack Overflow en español", "es.stackoverflow.com") \
        == "dónde guardar el token"
    assert norm_title("", "example.org") == "example org"


def test_official_source() -> None:
    assert official_source("fastapi.tiangolo.com") and official_source("learn.microsoft.com")
    assert official_source("requests.readthedocs.io") and official_source("docs.tigerdata.com")
    assert not official_source("docs.google.com")
    assert not official_source("medium.com") and not official_source("stackoverflow.com")


def test_leaf_source_type_maps_document_types() -> None:
    assert leaf_source_type(SourceType.PULL_REQUEST) == SourceType.CODE
    assert leaf_source_type(SourceType.TICKET) == SourceType.WORK_TOOL
    assert leaf_source_type(SourceType.DOCS) == SourceType.DOCS


def test_duplicate_groups_order_and_size() -> None:
    tabs = [
        {"tab_ref": "c", "dup_key": "k1", "opened_at": "2026-10-04T10:00:00Z"},
        {"tab_ref": "a", "dup_key": "k1", "opened_at": "2026-10-04T09:00:00Z"},
        {"tab_ref": "b", "dup_key": "k2", "opened_at": "2026-10-04T08:00:00Z"},
        {"tab_ref": "d", "dup_key": "k2", "opened_at": "2026-10-04T11:00:00Z"},
        {"tab_ref": "e", "dup_key": "k3", "opened_at": "2026-10-04T07:00:00Z"},
        {"tab_ref": "f", "dup_key": None, "opened_at": "2026-10-04T07:00:00Z"},
    ]
    assert duplicate_groups(tabs) == [["b", "d"], ["a", "c"]]


def test_normalize_for_match() -> None:
    assert normalize_for_match("we’ll go with Functions") == normalize_for_match("we'll go with Functions")
    assert normalize_for_match("“quoted” text — here\n\t ok ") == '"quoted" text - here ok'


def test_normalize_for_match_against_transcript_cue() -> None:
    cue = next(block for block in load_sample_doc("teams-transcript.vtt").split("\n\n")
               if block.startswith("00:14:32.000"))
    curly = "For the token service we’ll go with Functions, Premium plan"
    assert curly not in cue
    assert normalize_for_match(curly) in normalize_for_match(cue)
