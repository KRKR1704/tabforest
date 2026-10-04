"""Per-cluster features (R-6, proposal §3.3–§3.5, §14 step 6) for R-7's DATA block and R-8.

All attention and event data comes through adapters/stats.py. Sessions are P's session_id;
the engine never computes sessions (BUILD_TASKS.md §4.11).

Numbers that differ from the plan are in the constants block with the reason.
"""

from __future__ import annotations

import json
import re
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

import numpy as np

from .adapters.stats import StatsSource, TabEvent, get_stats_source
from .embeddings import embed_queries
from .labels import STOPWORDS as STOPWORDS_FOR_TERMS
from .normalize import leaf_source_type, normalize_tab

# Query families (§3.3). Plan: cosine ≥ 0.80. scripts/calibrate_queries.py on 36 labeled queries
# (630 pairs): rephrasings 0.59–0.87, related-but-different 0.19–0.70, unrelated ≤ 0.39; 0.80 has
# recall 0.25, 0.65 has the best F1 (0.959: precision 0.946, recall 0.972).
QUERY_FAMILY_THRESHOLD = 0.65
QUERY_LOOKBACK = timedelta(hours=2)
OPEN_LOOP_REPHRASINGS = 3          # plan
OPEN_LOOP_WINDOW = timedelta(hours=2)  # plan
FOLLOW_UP_CLOSES_MS = 90_000       # plan: a later focus > 90 s closes the loop
STALE_AFTER = timedelta(days=3)    # plan
DISTRACTION_MS = 10_000            # plan: < 10 s total focus
PREFERENCE_SHARE = 0.70            # comparison resolved when ≥ 70 % of later dwell is on one side
DORMANT_AFTER = timedelta(minutes=30)
# Importance (§3.4): 0.45·dwell_share + 0.25·evidence + 0.2·revisits + 0.1·official, each term in
# [0, 1]: dwell_share = tab dwell / cluster dwell; evidence = claims citing the tab / max in the
# cluster; revisits = revisits / max in the cluster; official = 1 for vendor/project docs.
W_DWELL, W_EVIDENCE, W_REVISITS, W_OFFICIAL = 0.45, 0.25, 0.20, 0.10

_FAMILY_NS = uuid.UUID("2b8f0a4e-6c1d-4e5f-9a7b-3c2d1e0f4a5b")
UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE)


# ---------------------------------------------------------------------------------------
# Data shapes
# ---------------------------------------------------------------------------------------

@dataclass(frozen=True)
class Visit:
    tab_ref: str
    start: datetime
    active_ms: int
    session_id: str | None


@dataclass
class TabFeatures:
    tab_ref: str
    title: str
    domain: str
    source_type: str
    official: bool
    opened_at: str
    opener_tab_ref: str | None
    is_search: bool
    dwell_ms: int
    dwell_min: float
    dwell_share: float
    focus_count: int
    revisits: int
    last_focus: str | None
    stale: bool
    distraction: bool
    session_ids: list[str]


@dataclass
class QueryOccurrence:
    text: str
    ts: str
    tab_ref: str
    open: bool


@dataclass
class QueryFamily:
    id: str
    queries: list[str]
    occurrences: list[QueryOccurrence]
    tab_refs: list[str]           # open search tabs
    closed_tab_refs: list[str]    # search tabs closed before the snapshot
    rephrasings: int
    first_ts: str
    last_ts: str
    span_min: float
    open_loop: bool
    short_visits: list[str]       # cluster tabs visited ≤ 90 s after the first query (not search tabs)
    closing_visit: dict[str, Any] | None


@dataclass
class Comparison:
    id: str
    text: str
    options: list[str]
    source_tab_ref: str
    at: str
    dwell_by_option: dict[str, int]
    resolved: bool
    preferred: str | None
    dormant: bool
    side_tab_refs: dict[str, list[str]] = field(default_factory=dict)  # option -> cluster tabs on that side


@dataclass
class Phase:
    session_id: str
    start: str
    end: str
    tab_refs: list[str]
    active_ms: int


@dataclass
class ClusterFeatures:
    tab_refs: list[str]
    tabs: dict[str, TabFeatures]
    families: list[QueryFamily]
    comparisons: list[Comparison]
    phases: list[Phase]
    last_focus: str | None
    dormant: bool
    snapshot_at: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Importance:
    dwell: float
    evidence: float
    revisits: float
    official: float
    total: float


# ---------------------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------------------

def _ts(value: str | datetime) -> datetime:
    return value if isinstance(value, datetime) else datetime.fromisoformat(value.replace("Z", "+00:00"))


def _iso(value: datetime) -> str:
    return value.strftime("%Y-%m-%dT%H:%M:%SZ")


def visits_from(events: Sequence[TabEvent]) -> list[Visit]:
    """Focus visits: a FOCUS paired with the next BLUR of the same tab (its active_ms)."""
    open_focus: dict[str, TabEvent] = {}
    out = []
    for e in sorted(events, key=lambda e: e.ts):
        if e.type == "FOCUS":
            open_focus[e.tab_ref] = e
        elif e.type == "BLUR" and e.tab_ref in open_focus:
            f = open_focus.pop(e.tab_ref)
            out.append(Visit(e.tab_ref, f.ts, int(e.active_ms or 0), f.session_id))
    return out


def _unit(v: np.ndarray) -> np.ndarray:
    return v / max(float(np.linalg.norm(v)), 1e-12)


def _option_key(option: str) -> str | None:
    for token in re.findall(r"[a-z0-9+#]+", option.lower()):
        if len(token) >= 2 and token not in STOPWORDS_FOR_TERMS:
            return token
    return None


_VS = re.compile(r"\b(vs\.?|versus)\s", re.IGNORECASE)
_OR = re.compile(r"\bor\s", re.IGNORECASE)
_COMPARE = re.compile(r"\bcompar(?:e|ing|ison(?: of)?)\s+(?P<x>.+?)\s+(?:and|with|to|vs\.?)\s+(?P<y>.+)", re.IGNORECASE)
_WORD = re.compile(r"[\w.+#'-]+")
_STOP_AT = {"for", "in", "on", "with", "to", "a", "an", "the", "of", "when", "which", "is", "are", "should"}


def _sides(text: str, sep: re.Match) -> tuple[str, str] | None:
    before = _WORD.findall(text[:sep.start()])
    after = _WORD.findall(text[sep.end():])
    x = []
    for w in reversed(before):
        if w.lower() in _STOP_AT or len(x) == 2:
            break
        x.insert(0, w)
    y = []
    for w in after:
        if w.lower() in _STOP_AT or len(y) == 2:
            break
        y.append(w.rstrip("?.,!"))
    return (" ".join(x), " ".join(y)) if x and y else None


def find_comparisons(text: str, *, allow_or: bool) -> list[tuple[str, str]]:
    """'X vs Y' / 'X versus Y' / 'compare X and Y' (and 'X or Y' in queries only: too common in titles)."""
    found = []
    m = _COMPARE.search(text)
    if m:
        x, y = (" ".join(_WORD.findall(s)[:2]) for s in (m["x"], m["y"]))
        if x and y:
            found.append((x, y))
    for pattern in ((_VS, _OR) if allow_or else (_VS,)):
        for sep in pattern.finditer(text):
            sides = _sides(text, sep)
            if sides:
                found.append(sides)
    return found


# ---------------------------------------------------------------------------------------
# Features
# ---------------------------------------------------------------------------------------

def build_features(tab_refs: Sequence[str], snapshot_tabs: Mapping[str, Mapping[str, Any]],
                   history: Sequence[TabEvent], window: Sequence[TabEvent],
                   query_vectors: Mapping[str, np.ndarray], snapshot_at: str | datetime, *,
                   threshold: float = QUERY_FAMILY_THRESHOLD) -> ClusterFeatures:
    """Pure. history: all events of the cluster's tabs; window: every event of the last 2 h
    (closed tabs included); query_vectors: embedding per distinct query text."""
    snapshot_at = _ts(snapshot_at)
    refs = sorted(tab_refs, key=lambda r: (_ts(snapshot_tabs[r]["opened_at"]), r))
    ref_set = set(refs)
    norm = {r: normalize_tab(snapshot_tabs[r]) for r in refs}
    cluster_visits = [v for v in visits_from(history) if v.tab_ref in ref_set]

    # Per tab.
    total_ms = sum(v.active_ms for v in cluster_visits)
    tabs: dict[str, TabFeatures] = {}
    for r in refs:
        mine = [v for v in cluster_visits if v.tab_ref == r]
        dwell = sum(v.active_ms for v in mine)
        last = max((v.start for v in mine), default=None)
        tabs[r] = TabFeatures(
            tab_ref=r, title=norm[r].title_clean, domain=norm[r].domain,
            source_type=leaf_source_type(norm[r].source_type).value, official=norm[r].official,
            opened_at=_iso(_ts(snapshot_tabs[r]["opened_at"])), opener_tab_ref=snapshot_tabs[r].get("opener_tab_ref"),
            is_search=norm[r].source_type.value == "search", dwell_ms=dwell, dwell_min=round(dwell / 60000, 1),
            dwell_share=round(dwell / total_ms, 6) if total_ms else 0.0, focus_count=len(mine),
            revisits=max(len(mine) - 1, 0), last_focus=_iso(last) if last else None,
            stale=last is None or snapshot_at - last >= STALE_AFTER, distraction=dwell < DISTRACTION_MS,
            session_ids=sorted({v.session_id for v in mine if v.session_id}))
    last_focus = max((v.start for v in cluster_visits), default=None)

    # Query occurrences: open search tabs, and searches in the last 2 h on cluster tabs or on
    # closed tabs linked to the cluster by an opener edge (either direction).
    since = snapshot_at - QUERY_LOOKBACK
    opener_of = {e.tab_ref: e.opener_tab_ref for e in window if e.type == "OPEN"}
    linked = {t for t, o in opener_of.items() if t not in snapshot_tabs and o in ref_set}
    linked |= {snapshot_tabs[r].get("opener_tab_ref") for r in refs} - set(snapshot_tabs) - {None}
    occurrences: dict[tuple[str, str], QueryOccurrence] = {}
    for r in refs:
        q = norm[r].search_query
        at = _ts(snapshot_tabs[r]["opened_at"])
        if q and at >= since:
            occurrences[(q, r)] = QueryOccurrence(q, _iso(at), r, True)
    for e in window:
        if e.search_query and e.type in ("OPEN", "UPDATE") and (e.tab_ref in ref_set or e.tab_ref in linked):
            occurrences.setdefault((e.search_query, e.tab_ref),
                                   QueryOccurrence(e.search_query, _iso(e.ts), e.tab_ref, e.tab_ref in ref_set))
    occ = sorted(occurrences.values(), key=lambda o: (o.ts, o.text, o.tab_ref))

    # Families: connected components of cosine ≥ threshold, in first-seen order.
    texts = list(dict.fromkeys(o.text for o in occ))
    parent = list(range(len(texts)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    units = [_unit(np.asarray(query_vectors[t], dtype=np.float64)) for t in texts]
    for i in range(len(texts)):
        for j in range(i + 1, len(texts)):
            if float(units[i] @ units[j]) >= threshold:
                parent[find(j)] = find(i)
    groups: dict[int, list[str]] = {}
    for i, t in enumerate(texts):
        groups.setdefault(find(i), []).append(t)

    families = []
    for members in groups.values():
        f_occ = [o for o in occ if o.text in members]
        first_seen = sorted(min(_ts(o.ts) for o in f_occ if o.text == t) for t in members)
        in_window = max(sum(1 for t in first_seen if s <= t <= s + OPEN_LOOP_WINDOW) for s in first_seen)
        first, last = _ts(f_occ[0].ts), _ts(f_occ[-1].ts)
        after_first = [v for v in cluster_visits if v.start >= first and not tabs[v.tab_ref].is_search]
        closing = next((v for v in sorted(cluster_visits, key=lambda v: v.start)
                        if v.start > last and v.active_ms > FOLLOW_UP_CLOSES_MS), None)
        families.append(QueryFamily(
            id="qf_" + str(uuid.uuid5(_FAMILY_NS, "\n".join(sorted(members)))),
            queries=members, occurrences=f_occ,
            tab_refs=sorted({o.tab_ref for o in f_occ if o.open}, key=refs.index),
            closed_tab_refs=sorted({o.tab_ref for o in f_occ if not o.open}),
            rephrasings=len(members), first_ts=_iso(first), last_ts=_iso(last),
            span_min=round((last - first).total_seconds() / 60, 1),
            open_loop=in_window >= OPEN_LOOP_REPHRASINGS and closing is None,
            short_visits=sorted({v.tab_ref for v in after_first if v.active_ms <= FOLLOW_UP_CLOSES_MS},
                                key=refs.index),
            closing_visit={"tab_ref": closing.tab_ref, "start": _iso(closing.start), "active_ms": closing.active_ms}
            if closing else None))

    # Comparisons in titles and queries; resolved by later dwell concentrated on one side.
    dormant = last_focus is None or snapshot_at - last_focus >= DORMANT_AFTER
    sources = [(tabs[r].title, r, _ts(snapshot_tabs[r]["opened_at"]), False) for r in refs]
    sources += [(o.text, o.tab_ref, _ts(o.ts), True) for o in occ]
    comparisons, seen = [], set()
    for text, src, at, is_query in sources:
        for x, y in find_comparisons(text, allow_or=is_query):
            kx, ky = _option_key(x), _option_key(y)
            if not kx or not ky or kx == ky or tuple(sorted((kx, ky))) in seen:
                continue
            seen.add(tuple(sorted((kx, ky))))
            dwell = {x: 0, y: 0}
            for v in cluster_visits:
                if v.start < at or v.tab_ref == src:
                    continue
                words = set(re.findall(r"[a-z0-9+#]+", tabs[v.tab_ref].title.lower()))
                if (kx in words) != (ky in words):
                    dwell[x if kx in words else y] += v.active_ms
            sides: dict[str, list[str]] = {x: [], y: []}
            for r in refs:
                words = set(re.findall(r"[a-z0-9+#]+", tabs[r].title.lower()))
                if r != src and (kx in words) != (ky in words):
                    sides[x if kx in words else y].append(r)
            total = dwell[x] + dwell[y]
            top = max((x, y), key=lambda o: dwell[o])
            resolved = total > 0 and dwell[top] / total >= PREFERENCE_SHARE
            comparisons.append(Comparison(
                id="cmp_" + str(uuid.uuid5(_FAMILY_NS, f"{kx}|{ky}")), text=f"{x} vs {y}", options=[x, y],
                source_tab_ref=src, at=_iso(at), dwell_by_option=dwell, resolved=resolved,
                preferred=top if resolved else None, dormant=not resolved and dormant, side_tab_refs=sides))

    # Research phases: contiguous runs by P's session_id.
    phases: dict[str, dict[str, Any]] = {}
    for v in sorted(cluster_visits, key=lambda v: v.start):
        if v.session_id:
            p = phases.setdefault(v.session_id, {"start": v.start, "end": v.start, "tabs": [], "ms": 0})
            p["end"] = v.start + timedelta(milliseconds=v.active_ms)
            p["ms"] += v.active_ms
            if v.tab_ref not in p["tabs"]:
                p["tabs"].append(v.tab_ref)
    phase_list = [Phase(sid, _iso(p["start"]), _iso(p["end"]), p["tabs"], p["ms"])
                  for sid, p in sorted(phases.items(), key=lambda kv: kv[1]["start"])]

    return ClusterFeatures(refs, tabs, families, comparisons, phase_list,
                           _iso(last_focus) if last_focus else None, dormant, _iso(snapshot_at))


async def compute_features(user_id: UUID, tab_refs: Sequence[str], snapshot_tabs: Sequence[Mapping[str, Any]],
                           snapshot_at: str | datetime, pool: Any, *, stats: StatsSource | None = None,
                           client: Any = None, threshold: float = QUERY_FAMILY_THRESHOLD) -> ClusterFeatures:
    """Events through adapters/stats.py, query embeddings through the R-4 cache, then build_features()."""
    stats = stats or get_stats_source()
    by_ref = {t["tab_ref"]: t for t in snapshot_tabs}
    snapshot_at = _ts(snapshot_at)
    history = await stats.events(user_id, set(tab_refs))
    window = await stats.events_since(user_id, snapshot_at - QUERY_LOOKBACK)
    queries = sorted({normalize_tab(by_ref[r]).search_query for r in tab_refs} - {None}
                     | {e.search_query for e in window if e.search_query})
    vectors = (await embed_queries(user_id, queries, pool, client=client)).vectors if queries else {}
    return build_features(tab_refs, by_ref, history, window, vectors, snapshot_at, threshold=threshold)


# ---------------------------------------------------------------------------------------
# Importance (§3.4)
# ---------------------------------------------------------------------------------------

def _importance(features: ClusterFeatures, evidence_counts: Mapping[str, int]) -> dict[str, Importance]:
    max_rev = max((t.revisits for t in features.tabs.values()), default=0)
    max_ev = max((evidence_counts.get(r, 0) for r in features.tabs), default=0)
    out = {}
    for r, t in features.tabs.items():
        d = t.dwell_share
        e = evidence_counts.get(r, 0) / max_ev if max_ev else 0.0
        v = t.revisits / max_rev if max_rev else 0.0
        o = 1.0 if t.official else 0.0
        out[r] = Importance(round(W_DWELL * d, 4), round(W_EVIDENCE * e, 4), round(W_REVISITS * v, 4),
                            round(W_OFFICIAL * o, 4), round(W_DWELL * d + W_EVIDENCE * e + W_REVISITS * v + W_OFFICIAL * o, 4))
    return out


def importance_pre(features: ClusterFeatures) -> dict[str, Importance]:
    """Before R-8 validation: the evidence term is 0."""
    return _importance(features, {})


def finalize_importance(features: ClusterFeatures, evidence_counts: Mapping[str, int]) -> dict[str, Importance]:
    """After R-8: evidence_counts = number of validated claims citing each tab_ref."""
    return _importance(features, evidence_counts)


# ---------------------------------------------------------------------------------------
# DATA block for R-7 (proposal §14 "Prompt shape")
# ---------------------------------------------------------------------------------------

@dataclass
class DataBlock:
    payload: dict[str, Any]
    refs: dict[str, str] = field(default_factory=dict)  # short ref -> real id
    # c* refs have no id in the API contract's evidence kinds; each is shown as its source tab, or
    # the search family of its query, or its most-read side tab: comparison id -> (ref_kind, real id)
    anchors: dict[str, tuple[str, str]] = field(default_factory=dict)

    def to_json(self) -> str:
        return json.dumps(self.payload, ensure_ascii=False, sort_keys=False)


def to_data_block(features: ClusterFeatures, notes: Sequence[Mapping[str, Any]] = (),
                  prior_research: Sequence[Mapping[str, Any]] = ()) -> DataBlock:
    """Short refs only (t1.., q1.., c1.., n1..); the model never sees a real id."""
    t = {r: f"t{i}" for i, r in enumerate(features.tab_refs, 1)}
    q = {f.id: f"q{i}" for i, f in enumerate(features.families, 1)}
    c = {cmp.id: f"c{i}" for i, cmp in enumerate(features.comparisons, 1)}
    n = {str(note["id"]): f"n{i}" for i, note in enumerate(notes, 1)}
    payload = {
        "tabs": [{"ref": t[r], "title": f.title, "domain": f.domain, "type": f.source_type,
                  "dwell_min": f.dwell_min, "revisits": f.revisits} for r, f in features.tabs.items()],
        "opener_edges": [[t[f.opener_tab_ref], t[r]] for r, f in features.tabs.items() if f.opener_tab_ref in t],
        "search_families": [{"ref": q[f.id], "queries": f.queries, "rephrasings": f.rephrasings,
                             "window_min": f.span_min, "open_loop": f.open_loop,
                             "tabs": [t[r] for r in f.tab_refs], "closed_searches": len(f.closed_tab_refs),
                             "short_visits_after": [t[r] for r in f.short_visits]} for f in features.families],
        "comparisons": [{"ref": c[cmp.id], "text": cmp.text, "tab": t.get(cmp.source_tab_ref),
                         "sides": [{"option": o, "tabs": [t[r] for r in cmp.side_tab_refs.get(o, [])],
                                    "dwell_min_after": round(cmp.dwell_by_option[o] / 60000, 1)} for o in cmp.options],
                         "resolved": cmp.resolved, "preferred": cmp.preferred, "dormant": cmp.dormant}
                        for cmp in features.comparisons],
        "user_notes": [{"ref": n[str(note["id"])], "text": note["text"]} for note in notes],
        "prior_research": [dict(p) for p in prior_research],
    }
    text = json.dumps(payload, ensure_ascii=False)
    if UUID_RE.search(text):
        raise ValueError("DATA block contains a real id")
    refs = {v: k for k, v in {**t, **q, **c, **n}.items()}
    return DataBlock(payload, refs, {cmp.id: _anchor(cmp, features) for cmp in features.comparisons})


def _anchor(cmp: Comparison, features: ClusterFeatures) -> tuple[str, str]:
    if cmp.source_tab_ref in features.tabs:
        return "tab", cmp.source_tab_ref
    family = next((f for f in features.families if any(o.tab_ref == cmp.source_tab_ref for o in f.occurrences)), None)
    if family:
        return "query", family.id
    sides = [r for o in cmp.options for r in cmp.side_tab_refs.get(o, [])]
    return "tab", max(sides, key=lambda r: features.tabs[r].dwell_ms) if sides else features.tab_refs[0]
