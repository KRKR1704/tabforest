"""Normalization (proposal §14 steps 2-3): clean titles, classify sources, recover search
queries, group exact duplicates. Pure functions: no I/O, no network.

Rules are data: TITLE_SUFFIXES (any site), DOMAIN_SUFFIXES (per site), DOMAIN_TYPES and
OFFICIAL_DOCS (domain tables with suffix matching), plus one generic rule that strips a
leading or trailing title segment naming the site itself ("... - FastAPI", "GitHub - ...").
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable, Mapping
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict


class SourceType(StrEnum):
    # Tab source types (contracts/grove.example.json leaves)
    DOCS = "docs"
    QA = "qa"
    CODE = "code"
    DISCUSSION = "discussion"
    VIDEO = "video"
    SEARCH = "search"
    WORK_TOOL = "work_tool"
    ARTICLE = "article"
    OTHER = "other"
    # Document types (Work Context, contracts/work-context.example.json)
    TICKET = "ticket"
    PULL_REQUEST = "pull_request"
    ACCOUNT_NOTE = "account_note"
    TRANSCRIPT = "transcript"


# Grove leaves only allow the tab types; document types map onto the closest tab type.
LEAF_TYPE = {SourceType.TICKET: SourceType.WORK_TOOL, SourceType.PULL_REQUEST: SourceType.CODE,
             SourceType.ACCOUNT_NOTE: SourceType.WORK_TOOL, SourceType.TRANSCRIPT: SourceType.WORK_TOOL}

# ---------------------------------------------------------------------------------------
# Tables
# ---------------------------------------------------------------------------------------

_SEP = r"\s*[-|·—–:]\s*"
TITLE_SUFFIXES = [re.compile(p, re.IGNORECASE) for p in (
    _SEP + r"Stack Overflow( en español| em Português| на русском)?$",
    _SEP + r"[^-|·—–]*Stack Exchange$",
    r"\s*[-|]\s*(Super User|Server Fault|Ask Ubuntu)$",
    r"\s*\|\s*MDN( Web Docs)?$",
    r"\s*-\s*YouTube$",
    r"\s*·\s*GitHub$",
    r"\s*-\s*Google Search$",
    r"\s+at DuckDuckGo$",
    r"\s*[-|]\s*Microsoft Learn$",
    r"\s*\|\s*by\s+[^|]+?(\s*\|\s*in\s+[^|]+?)?\s*\|\s*Medium$",
    r"\s*\|\s*Medium$",
    r"\s*-\s*DEV Community\b.*$",
    r"\s*:\s*r/\w+$",
    r"\s*-\s*Reddit$",
    r"\s*-\s*(Jira|Confluence)$",
    r"\s*[-|]\s*Microsoft Teams$",
)]
NOTIFICATION_COUNTER = re.compile(r"^\(\d+\+?\)\s*")

# Site names that do not resemble the domain, so the generic rule cannot find them.
DOMAIN_SUFFIXES: dict[str, tuple[str, ...]] = {
    "mlh.io": ("Major League Hacking",),
    "doc.rust-lang.org": ("The Rust Programming Language",),
    "d3js.org": ("D3 by Observable",),
    "bing.com": ("Bing", "Search"),
}

# Suffix-matched: "stackexchange.com" also matches "security.stackexchange.com".
DOMAIN_TYPES: dict[str, SourceType] = {
    # docs
    "fastapi.tiangolo.com": SourceType.DOCS, "learn.microsoft.com": SourceType.DOCS,
    "docs.python.org": SourceType.DOCS, "developer.mozilla.org": SourceType.DOCS,
    "readthedocs.io": SourceType.DOCS, "docs.github.com": SourceType.DOCS, "doc.rust-lang.org": SourceType.DOCS,
    "d3js.org": SourceType.DOCS, "react.dev": SourceType.DOCS, "nodejs.org": SourceType.DOCS,
    "kubernetes.io": SourceType.DOCS, "mlh.io": SourceType.DOCS,
    # Q&A
    "stackoverflow.com": SourceType.QA, "stackexchange.com": SourceType.QA, "superuser.com": SourceType.QA,
    "serverfault.com": SourceType.QA, "askubuntu.com": SourceType.QA,
    # code (GitHub issues and PRs are refined by title in classify_source)
    "github.com": SourceType.CODE, "gitlab.com": SourceType.CODE, "bitbucket.org": SourceType.CODE,
    # discussion
    "reddit.com": SourceType.DISCUSSION, "news.ycombinator.com": SourceType.DISCUSSION,
    "glassdoor.com": SourceType.DISCUSSION, "lobste.rs": SourceType.DISCUSSION,
    # video
    "youtube.com": SourceType.VIDEO, "youtu.be": SourceType.VIDEO, "vimeo.com": SourceType.VIDEO,
    "twitch.tv": SourceType.VIDEO,
    # work tools (Jira tickets and Teams transcripts are refined by title)
    "docs.google.com": SourceType.WORK_TOOL, "drive.google.com": SourceType.WORK_TOOL,
    "atlassian.net": SourceType.WORK_TOOL, "slack.com": SourceType.WORK_TOOL,
    "teams.microsoft.com": SourceType.WORK_TOOL, "notion.so": SourceType.WORK_TOOL,
    "figma.com": SourceType.WORK_TOOL, "trello.com": SourceType.WORK_TOOL,
    # articles
    "medium.com": SourceType.ARTICLE, "dev.to": SourceType.ARTICLE, "substack.com": SourceType.ARTICLE,
    "hashnode.dev": SourceType.ARTICLE, "towardsdatascience.com": SourceType.ARTICLE,
    "allrecipes.com": SourceType.ARTICLE, "bbcgoodfood.com": SourceType.ARTICLE,
    # CRM account pages
    "dynamics.com": SourceType.ACCOUNT_NOTE, "force.com": SourceType.ACCOUNT_NOTE,
    "salesforce.com": SourceType.ACCOUNT_NOTE, "hubspot.com": SourceType.ACCOUNT_NOTE,
}

# Vendor or project documentation (R-6 importance: +0.1 for official sources).
OFFICIAL_DOCS = ("fastapi.tiangolo.com", "learn.microsoft.com", "docs.python.org", "developer.mozilla.org",
                 "readthedocs.io", "docs.github.com", "doc.rust-lang.org", "d3js.org", "react.dev", "nodejs.org",
                 "kubernetes.io", "docs.tigerdata.com", "docs.timescale.com")
NOT_DOCS = ("docs.google.com",)

# Search engines: (exact domain without www, title pattern capturing the query).
SEARCH_ENGINES: list[tuple[str, re.Pattern[str]]] = [
    ("google.com", re.compile(r"^(?P<q>.+?)\s*-\s*Google Search$", re.IGNORECASE)),
    ("google.co.uk", re.compile(r"^(?P<q>.+?)\s*-\s*Google Search$", re.IGNORECASE)),
    ("google.ca", re.compile(r"^(?P<q>.+?)\s*-\s*Google Search$", re.IGNORECASE)),
    ("bing.com", re.compile(r"^(?P<q>.+?)\s*-\s*(Bing|Search)$", re.IGNORECASE)),
    ("duckduckgo.com", re.compile(r"^(?P<q>.+?)\s+at DuckDuckGo$", re.IGNORECASE)),
]
SEARCH_RESULT_TITLE = re.compile(r"^search results\b", re.IGNORECASE)  # on-site search pages

_GENERIC_LABELS = {"www", "m", "en", "app", "api", "docs", "doc", "learn", "developer", "com", "org", "net",
                   "io", "co", "uk", "dev", "ca", "jobs"}
_SEGMENT_SEP = re.compile(r"\s+[-|·—–]\s+")
_TICKET_KEY = re.compile(r"\b[A-Z][A-Z0-9]+-\d+\b")

# ---------------------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------------------

_MATCH_TRANSLATE = str.maketrans({
    "‘": "'", "’": "'", "‚": "'", "‛": "'", "′": "'",
    "“": '"', "”": '"', "„": '"', "‟": '"', "″": '"',
    "–": "-", "—": "-", "‒": "-", "―": "-", "−": "-",
    " ": " ", " ": " ", " ": " ", "​": "",
})


def normalize_for_match(text: str) -> str:
    """Normalize text for quote verification (R-8, R-11): curly quotes to straight, en/em
    dashes to "-", non-breaking spaces to spaces, whitespace collapsed, ends stripped.

    Compare the normalized forms of BOTH the quote and the source text, but always return
    and store the quote exactly as it appears in the source.
    """
    return re.sub(r"\s+", " ", (text or "").translate(_MATCH_TRANSLATE)).strip()


def normalize_domain(domain: str) -> str:
    d = (domain or "").strip().lower().rstrip(".")
    d = d.split(":", 1)[0]
    return d[4:] if d.startswith("www.") else d


def _domain_in(domain: str, table: Iterable[str]) -> str | None:
    """Longest table entry equal to the domain or a parent of it."""
    d = normalize_domain(domain)
    matches = [key for key in table if d == key or d.endswith("." + key)]
    return max(matches, key=len) if matches else None


def _alnum(text: str) -> str:
    return re.sub(r"[\W_]+", "", unicodedata.normalize("NFKC", text).casefold())


def _site_labels(domain: str) -> list[str]:
    parts = normalize_domain(domain).split(".")
    return [label for label in (_alnum(p) for p in parts) if len(label) >= 3 and label not in _GENERIC_LABELS]


def _names_site(segment: str, domain: str, exact: bool) -> bool:
    s = _alnum(segment)
    if len(s) < 3 or len(segment.split()) > 4:
        return False
    labels = _site_labels(domain)
    if exact:
        return s in labels
    return any(label in s or s in label for label in labels)


def _collapse(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


# ---------------------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------------------

def clean_title(title: str, domain: str) -> str:
    """Display title without site suffixes, prefixes and notification counters. Keeps the
    original casing. Never empty: falls back to the domain."""
    t = NOTIFICATION_COUNTER.sub("", _collapse(title))
    site = _domain_in(domain, DOMAIN_SUFFIXES)
    for _ in range(3):
        before = t
        for pattern in TITLE_SUFFIXES:
            t = pattern.sub("", t).strip()
        if site:
            for name in DOMAIN_SUFFIXES[site]:
                t = re.sub(_SEP + re.escape(name) + r"$", "", t, flags=re.IGNORECASE).strip()
        seps = list(_SEGMENT_SEP.finditer(t))
        if seps and _names_site(t[seps[-1].end():], domain, exact=False):
            t = t[:seps[-1].start()].strip()
        seps = list(_SEGMENT_SEP.finditer(t))
        if seps and _names_site(t[:seps[0].start()], domain, exact=True):
            t = t[seps[0].end():].strip()
        if t == before:
            break
    return t or normalize_domain(domain)


def norm_title(title: str, domain: str) -> str:
    """Lowercased, punctuation-normalized clean title, for embeddings and matching."""
    t = normalize_for_match(unicodedata.normalize("NFKC", clean_title(title, domain))).casefold()
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s+#]", " ", t)).strip()


def _is_search_engine(domain: str) -> re.Pattern[str] | None:
    """Exact match only, so docs.google.com or accounts.google.com are not search engines."""
    return dict(SEARCH_ENGINES).get(normalize_domain(domain))


def classify_source(domain: str, title: str) -> SourceType:
    """Source type from a domain table (suffix matching), refined by title for GitHub
    issues/PRs, Jira tickets, Teams transcripts and on-site search pages."""
    t = _collapse(title)
    engine = _is_search_engine(domain)
    if engine is not None:
        return SourceType.SEARCH if engine.match(t) else SourceType.OTHER
    hit = _domain_in(domain, DOMAIN_TYPES)
    kind = DOMAIN_TYPES[hit] if hit else None
    if kind is None and not _domain_in(domain, NOT_DOCS) and normalize_domain(domain).split(".")[0] in ("docs", "developer"):
        kind = SourceType.DOCS
    if kind is None:
        return SourceType.OTHER
    if kind is SourceType.QA and SEARCH_RESULT_TITLE.match(t):
        return SourceType.SEARCH
    if hit in ("github.com", "gitlab.com"):
        if re.search(r"\b(Pull Request|Merge Request)\b", t, re.IGNORECASE):
            return SourceType.PULL_REQUEST
        if re.search(r"·\s*Issue\s*#\d+|\bIssues?\b", t):
            return SourceType.DISCUSSION
    if hit == "atlassian.net" and _TICKET_KEY.search(t):
        return SourceType.TICKET
    if hit == "teams.microsoft.com" and re.search(r"\btranscript\b", t, re.IGNORECASE):
        return SourceType.TRANSCRIPT
    return kind


def official_source(domain: str) -> bool:
    """Vendor or project documentation (R-6 importance formula)."""
    if _domain_in(domain, OFFICIAL_DOCS):
        return True
    d = normalize_domain(domain)
    return not _domain_in(d, NOT_DOCS) and d.split(".")[0] in ("docs", "developer")


def leaf_source_type(source_type: SourceType) -> SourceType:
    """Grove leaves allow only tab types; document types map to the closest tab type."""
    return LEAF_TYPE.get(source_type, source_type)


def parse_search_query(domain: str, title: str, existing_query: str | None) -> str | None:
    """The device-parsed query if present (returned unchanged); otherwise the query from a
    search-engine results title. None for other pages."""
    if existing_query:
        return existing_query
    engine = _is_search_engine(domain)
    if engine is None:
        return None
    m = engine.match(_collapse(title))
    return m.group("q").strip() or None if m else None


def _field(tab: Any, name: str) -> Any:
    return tab.get(name) if isinstance(tab, Mapping) else getattr(tab, name, None)


def duplicate_groups(tabs: Iterable[Any]) -> list[list[str]]:
    """Exact duplicates: tab_refs sharing a dup_key, 2+ members, members and groups ordered
    by opened_at (then input order)."""
    ordered = sorted(enumerate(tabs), key=lambda it: (_field(it[1], "opened_at") or "", it[0]))
    groups: dict[str, list[str]] = {}
    for _, tab in ordered:
        key = _field(tab, "dup_key")
        if key:
            groups.setdefault(key, []).append(_field(tab, "tab_ref"))
    return [refs for refs in groups.values() if len(refs) > 1]


class NormalizedTab(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    tab_ref: str
    domain: str
    title_clean: str
    title_norm: str
    source_type: SourceType
    official: bool
    search_query: str | None
    dup_key: str | None


def normalize_tab(tab: Mapping[str, Any]) -> NormalizedTab:
    """One snapshot tab (BUILD_TASKS.md §4.2 fields) → everything R-4/R-5 need."""
    domain, title = tab["domain"], tab.get("title") or ""
    return NormalizedTab(
        tab_ref=tab["tab_ref"],
        domain=domain,
        title_clean=clean_title(title, domain),
        title_norm=norm_title(title, domain),
        source_type=classify_source(domain, title),
        official=official_source(domain),
        search_query=parse_search_query(domain, title, tab.get("search_query")),
        dup_key=tab.get("dup_key"),
    )
