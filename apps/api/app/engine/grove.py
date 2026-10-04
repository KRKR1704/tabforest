"""Grove assembly and the grow pipeline (R-8, R-9, R-10; proposal §12 steps 6–10, §14, §22, §24, §27).

GrowRun.stream() yields the NDJSON lines of BUILD_TASKS.md §4.7: the `clusters` line as soon as
R-5 finishes, one `tree` line per cluster as each model result lands, then `done` (after the run
is persisted). GrowRun.response is the full GroveResponse (contracts/grove.example.json shape).
Every line and the response are validated against engine/schemas before they leave.

Failure behaviour (R-9, proposal §8, §27):
- every AI-eligible cluster fails (Azure down, wrong key, content filter on all): Seedling mode,
  deterministic labels, every tree fogged, no claims, degraded=true;
- some clusters fail: only those come back as fogged groups (per-cluster fallback);
- embeddings fail during clustering: affinity from opener + time + title-term Jaccard, no model calls,
  Seedling-labelled, degraded=true;
- 2-3 tabs: one sprout (and at most one model call to name it); 0-1 tabs: an empty grove.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections.abc import AsyncIterator, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from . import metrics
from .adapters.stats import StatsSource, get_stats_source
from .carry import Carry, load_carry
from .cluster import Cluster, cluster_snapshot, cluster_snapshot_no_embeddings
from .features import (ClusterFeatures, DataBlock, compute_features, finalize_importance, importance_pre,
                       to_data_block, visits_from)
from .infer import MAX_LLM_CALLS, InferenceOutcome, PriorInsight, infer_all, infer_cluster, retrieve_prior_research
from .labels import top_terms
from .model_schema import ClusterInference
from .normalize import duplicate_groups
from .schemas.grove import GroveResponse
from .schemas.stream import ClustersLine, DoneLine, TreeLine
from .validate import ValidatedClaim, ValidationContext, display_text, map_tab_refs, validate_claim

log = logging.getLogger("tabforest.engine.grove")

AMBER_AFTER_DAYS = 3
FALLBACK_CONFIDENCE = 0.45
SMALL_SNAPSHOT_MAX_TABS = 3
SINGLE_GOAL_MIN_CONFIDENCE = 0.60
SPROUT_LABEL_MAX = 80
BANNER_ALL_FALLBACK = "AI unavailable — showing groups only"
BANNER_LEARNING = "TabForest learns as you browse"
REASON_LABEL = {"content_filter": "content filter", "invalid_output": "invalid AI output",
                "ai_unavailable": "AI unavailable", "embeddings_unavailable": "embeddings unavailable"}


def _p(prefix: str, value: str) -> str:
    return value if value.startswith(prefix) else prefix + value


def _strip(value: str) -> str:
    return value.split("_", 1)[1] if "_" in value[:5] else value


# ---------------------------------------------------------------------------------------
# Tree assembly (pure)
# ---------------------------------------------------------------------------------------

@dataclass
class TreeBuild:
    cluster_id: str
    project_id: str                      # plain uuid
    matched_existing: bool
    label: str
    tree: dict[str, Any]                 # API shape (schemas.grove.Tree)
    pinned_tab_refs: list[str]
    decisions: list[dict[str, Any]] = field(default_factory=list)   # decisions-table rows: stones, hypotheses, direction
    questions: list[dict[str, Any]] = field(default_factory=list)   # mushrooms + downgraded questions
    blockers: list[dict[str, Any]] = field(default_factory=list)
    actions: list[dict[str, Any]] = field(default_factory=list)
    claims: list[ValidatedClaim] = field(default_factory=list)      # for the run report
    fallback_reason: str | None = None


def _claim_dict(prefix: str, c: ValidatedClaim) -> dict[str, Any]:
    return {"id": _p(prefix, str(uuid.uuid4())), "text": c.text, "provenance": c.provenance,
            "confidence": c.confidence, "display_text": c.display_text, "evidence": c.evidence,
            "user_note_id": c.user_note_id}


def _attention(features: ClusterFeatures, snapshot_tabs: Mapping[str, Mapping[str, Any]],
               snapshot_at: datetime) -> tuple[int, int, str]:
    minutes = round(sum(t.dwell_ms for t in features.tabs.values()) / 60000)
    last = features.last_focus or max(str(snapshot_tabs[r]["opened_at"]) for r in features.tab_refs)
    last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
    days = max((snapshot_at - last_dt).days, 0)
    return minutes, days, "amber" if days >= AMBER_AFTER_DAYS else "green"


def _exact_vines(refs: Sequence[str], snapshot_tabs: Mapping[str, Mapping[str, Any]],
                 importance: Mapping[str, float]) -> list[dict[str, Any]]:
    vines = []
    for group in duplicate_groups(snapshot_tabs[r] for r in refs):
        group = [r for r in refs if r in group]
        n = len(group)
        vines.append({"tab_refs": group, "kind": "exact", "keep_ref": max(group, key=lambda r: (importance[r], r)),
                      "reason": "Same page open twice" if n == 2 else f"Same page open {n} times"})
    return vines


def _query_families(features: ClusterFeatures) -> list[dict[str, Any]]:
    return [{"id": f.id, "queries": f.queries, "tab_refs": f.tab_refs, "open_loop": f.open_loop}
            for f in features.families]


def _leaf(ref: str, snapshot_tabs: Mapping[str, Mapping[str, Any]], features: ClusterFeatures,
          importance: Mapping[str, float], cited: set[str]) -> dict[str, Any]:
    t, f = snapshot_tabs[ref], features.tabs[ref]
    return {"tab_ref": ref, "title": t["title"], "domain": t["domain"], "source_type": f.source_type,
            "dwell_min": f.dwell_min, "is_open": True, "importance": round(importance[ref], 2),
            "fallen": f.stale and ref not in cited}


def fallback_tree(cluster: Cluster, project_id: str, features: ClusterFeatures,
                  snapshot_tabs: Mapping[str, Mapping[str, Any]], snapshot_at: datetime,
                  shared: set[str], reason: str | None) -> TreeBuild:
    """Deterministic fogged tree (Seedling, contracts/grove.degraded.example.json): the top shared title
    terms (labels.py) as the name, a "Maybe: tabs about …" goal below 0.60, and no stones, mushrooms,
    next actions or hypotheses."""
    imp = {r: i.total for r, i in importance_pre(features).items()}
    ranked = sorted(features.tab_refs, key=lambda r: (-imp[r], features.tab_refs.index(r)))
    terms = [t for t in cluster.label.split(" · ") if t]
    text = "Tabs about " + ", ".join(terms) if terms else "Tabs opened together"
    goal = {"id": _p("g_", str(uuid.uuid4())), "text": text, "provenance": "hypothesis",
            "confidence": FALLBACK_CONFIDENCE, "display_text": display_text("goal", "hypothesis", text),
            "evidence": [{"ref_kind": "tab", "ref": r, "why": "shares title terms with the group"} for r in ranked[:2]],
            "user_note_id": None}
    minutes, days, canopy = _attention(features, snapshot_tabs, snapshot_at)
    tree = {
        "project_id": _p("p_", project_id), "name": cluster.label or "Tabs opened together",
        "is_existing_project_id": _p("p_", cluster.is_existing_project_id) if cluster.is_existing_project_id else None,
        "goal": goal, "attention_min": minutes, "days_since_active": days, "canopy": canopy, "fogged": True,
        "branches": [{"label": "All tabs", "status": "active",
                      "leaves": [_leaf(r, snapshot_tabs, features, imp, set()) for r in ranked]}],
        "direction": None, "stones": [], "mushrooms": [], "next_actions": [],
        "vines": _exact_vines(features.tab_refs, snapshot_tabs, imp), "hypotheses": [],
        "query_families": _query_families(features), "important_tab_refs": ranked[:4],
        "shared_tab_refs": [r for r in features.tab_refs if r in shared],
    }
    return TreeBuild(cluster.id, project_id, bool(cluster.is_existing_project_id), cluster.label, tree,
                     list(cluster.pinned_tab_refs), fallback_reason=reason)


def _note_evidence(note_id: str, why: str) -> dict[str, str]:
    return {"ref_kind": "note", "ref": note_id, "why": why}


def assemble_tree(cluster: Cluster, project_id: str, features: ClusterFeatures, block: DataBlock,
                  inference: ClusterInference, snapshot_tabs: Mapping[str, Mapping[str, Any]],
                  snapshot_at: datetime, notes: Mapping[str, str], shared: set[str],
                  carry: Carry | None = None) -> TreeBuild:
    carry = carry or Carry()
    ctx = ValidationContext(block.refs, {r: f.source_type for r, f in features.tabs.items()}, notes,
                            anchors=block.anchors)
    short_of = {real: short for short, real in block.refs.items()}
    families = {f.id: f for f in features.families}
    build = TreeBuild(cluster.id, project_id, bool(cluster.is_existing_project_id), cluster.label, {},
                      list(cluster.pinned_tab_refs))
    hypotheses: list[dict[str, Any]] = []

    def check(kind, text, prov, conf, evidence, **kw) -> ValidatedClaim:
        c = validate_claim(kind, text, prov, conf, evidence, ctx, **kw)
        build.claims.append(c)
        return c

    def keep(c: ValidatedClaim, *, covered: bool = False) -> bool:
        """False (and forget the claim) when the user dismissed it, or already said it in a note."""
        if c.provenance != "stated" and (carry.is_dismissed(c.text) or (covered and carry.covered_by_note(c.text))):
            build.claims.remove(c)
            return False
        return True

    inf = inference
    goal_c = check("goal", inf.goal.text, inf.goal.provenance, inf.goal.confidence, inf.goal.evidence)
    goal = _claim_dict("g_", goal_c)
    named = carry.goal_note(set(cluster.tab_refs))
    if named is not None:  # the user named the goal (clear the fog, confirm or edit it): stated, never re-guessed
        goal = {**goal, "text": named.text, "provenance": "stated", "confidence": 1.0, "display_text": named.text,
                "evidence": [_note_evidence(named.id, "user named this goal"), *goal["evidence"]],
                "user_note_id": named.id}

    direction = None
    if inf.current_direction:
        d = inf.current_direction
        c = check("direction", d.text, d.provenance, d.confidence, d.evidence)
        if keep(c, covered=True):
            direction = _claim_dict("dir_", c)
            build.decisions.append(direction)
            if c.provenance == "hypothesis":
                hypotheses.append(direction)
                direction = None

    stones = []
    for d in inf.decisions:
        c = check("decision", d.text, d.provenance, d.confidence, d.evidence, user_note_ref=d.user_note_ref,
                  quote=d.quote)
        if not keep(c, covered=True):
            continue
        item = {**_claim_dict("dec_", c), "kind": "carved" if c.provenance in ("stated", "sourced") else "mossy",
                "quote": c.quote}
        build.decisions.append(item)
        if c.provenance == "hypothesis":
            hypotheses.append(_claim_dict_from(item))
        else:
            stones.append(item)

    mushrooms, question_ids = [], []
    taken_resolved: set[int] = set()

    def question_item(text: str, c: ValidatedClaim, kind: str, recurrence: int, family_ids: set[str]) -> dict[str, Any]:
        item = {**_claim_dict("q_", c), "kind": kind, "status": "open", "answer": None, "resolved_at": None,
                "recurrence": recurrence}
        done = carry.match_resolved(text, family_ids, taken_resolved)
        if done is not None:  # the user resolved this open loop before: it stays a flower
            item.update(text=done.text, display_text=display_text("question", c.provenance, done.text),
                        status="resolved", answer=done.answer, resolved_at=done.resolved_at)
        return item

    for q in inf.unresolved_questions:
        c = check("question", q.question, q.provenance, q.confidence, q.evidence)
        if not keep(c):
            continue
        cited = [families[block.refs[r]] for r in c.short_refs if r[0] == "q" and block.refs[r] in families]
        item = question_item(c.text, c, mushroom_kind(q.kind, c.short_refs, block, features),
                             max([f.rephrasings for f in cited] or [1]), {f.id for f in cited})
        build.questions.append(item)
        if c.provenance == "hypothesis" and item["status"] == "open":
            hypotheses.append(_claim_dict_from(item))
            question_ids.append(None)
        else:
            mushrooms.append(item)
            question_ids.append(item["id"])

    # Open-loop families no surviving mushroom covers become deterministic mushrooms (or flowers).
    covered = {e["ref"] for m in mushrooms for e in m["evidence"] if e["ref_kind"] == "query"}
    for f in features.families:
        if not f.open_loop or f.id in covered:
            continue
        ev = [_Ev(short_of[f.id], f"{f.rephrasings} rephrasings in {round(f.span_min)} min, no long read after")]
        ev += [_Ev(short_of[r], "search: " + features.tabs[r].title) for r in f.tab_refs if r in short_of]
        text = f.queries[0][:1].upper() + f.queries[0][1:].rstrip("?") + "?"
        c = check("question", text, "inferred", 0.75, ev)
        if not keep(c):
            continue
        item = question_item(text, c, "repeated_search", f.rephrasings, {f.id})
        build.questions.append(item)
        if c.provenance != "hypothesis" or item["status"] == "resolved":
            mushrooms.append(item)
        else:
            hypotheses.append(_claim_dict_from(item))

    for b in inf.blockers:
        c = check("blocker", b.text, b.provenance, b.confidence, b.evidence)
        build.blockers.append({**_claim_dict("q_", c), "kind": "blocker", "recurrence": 1})

    next_actions = []
    for a in inf.next_actions:
        c = check("action", a.action, a.provenance, a.confidence, a.evidence)
        if not keep(c):
            continue
        idx = a.unblocks_question
        unblocks = question_ids[idx] if idx is not None and 0 <= idx < len(question_ids) else None
        item = {**_claim_dict("a_", c), "unblocks": unblocks, "reason": a.reason.strip()[:300]}
        build.actions.append(item)
        if c.provenance == "hypothesis":
            hypotheses.append(_claim_dict_from(item))
        else:
            next_actions.append(item)

    for h in inf.hypotheses:
        c = check("hypothesis", h.text, h.provenance, h.confidence, h.evidence)
        if not keep(c, covered=True):
            continue
        item = _claim_dict("h_", c)
        build.decisions.append(item)
        hypotheses.append(item)

    # Decision notes are carved stones, always: a model that forgot them, or a re-grow, never loses them.
    have = {s["user_note_id"] for s in stones if s.get("user_note_id")}
    carved = []
    for n in carry.decision_notes():
        if n.id in have:
            continue
        item = {"id": _p("dec_", str(uuid.uuid4())), "text": n.text, "provenance": "stated", "confidence": 1.0,
                "display_text": n.text, "evidence": [_note_evidence(n.id, "user note")], "user_note_id": n.id,
                "kind": "carved", "quote": None}
        carved.append(item)
        build.decisions.append(item)
    stones = carved + stones

    # Importance with the validated evidence counts (R-6 finalize_importance).
    counts: dict[str, int] = {}
    for c in build.claims:
        for e in c.evidence:
            if e["ref_kind"] == "tab":
                counts[e["ref"]] = counts.get(e["ref"], 0) + 1
    imp = {r: i.total for r, i in finalize_importance(features, counts).items()}
    cited = set(counts)

    # Branches: the model's, mapped and de-duplicated; tabs it left out go to "Other".
    branches, placed = [], set()
    for b in inf.branches:
        refs = [r for r in map_tab_refs(b.tab_refs, ctx) if r not in placed]
        if not refs:
            continue
        placed.update(refs)
        branches.append({"label": b.label.strip()[:60] or "Branch", "status": b.status,
                         "leaves": [_leaf(r, snapshot_tabs, features, imp, cited)
                                    for r in sorted(refs, key=lambda r: -imp[r])]})
    rest = [r for r in features.tab_refs if r not in placed]
    if rest:
        branches.append({"label": "Other" if branches else "All tabs", "status": "explored" if branches else "active",
                         "leaves": [_leaf(r, snapshot_tabs, features, imp, cited)
                                    for r in sorted(rest, key=lambda r: -imp[r])]})

    vines = _exact_vines(features.tab_refs, snapshot_tabs, imp)
    exact = [set(v["tab_refs"]) for v in vines]
    for g in inf.redundant_groups:
        refs = map_tab_refs(g.tab_refs, ctx)
        if len(refs) < 2 or set(refs) in exact:
            continue
        keep_ref = map_tab_refs([g.keep_ref], ctx)
        vines.append({"tab_refs": refs, "kind": "semantic",
                      "keep_ref": keep_ref[0] if keep_ref else max(refs, key=lambda r: imp[r]),
                      "reason": g.reason.strip()[:300]})

    important = map_tab_refs(inf.important_tab_refs, ctx) or sorted(features.tab_refs, key=lambda r: -imp[r])[:4]
    minutes, days, canopy = _attention(features, snapshot_tabs, snapshot_at)
    name = carry.project_name if carry.user_named and carry.project_name else (inf.project_name.strip()[:60] or cluster.label)
    build.tree = {
        "project_id": _p("p_", project_id), "name": name,
        "is_existing_project_id": _p("p_", cluster.is_existing_project_id) if cluster.is_existing_project_id else None,
        "goal": goal, "attention_min": minutes, "days_since_active": days, "canopy": canopy,
        "fogged": goal["provenance"] == "hypothesis", "branches": branches, "direction": direction,
        "stones": stones, "mushrooms": mushrooms, "next_actions": next_actions, "vines": vines,
        "hypotheses": hypotheses, "query_families": _query_families(features), "important_tab_refs": important,
        "shared_tab_refs": [r for r in features.tab_refs if r in shared],
    }
    return build


def mushroom_kind(model_kind: str, short_refs: Sequence[str], block: DataBlock, features: ClusterFeatures) -> str:
    """Deterministic kind (overrides the model): a question citing an open-loop search family is a
    repeated_search; else one citing an unresolved comparison is an unresolved_comparison."""
    families = {f.id: f for f in features.families}
    comparisons = {c.id: c for c in features.comparisons}
    real = [block.refs[r] for r in short_refs if r in block.refs]
    if any(r in families and families[r].open_loop for r in real):
        return "repeated_search"
    if any(r in comparisons and not comparisons[r].resolved for r in real):
        return "unresolved_comparison"
    return model_kind


@dataclass
class _Ev:
    ref: str
    why: str


_CLAIM_KEYS = ("id", "text", "provenance", "confidence", "display_text", "evidence", "user_note_id")


def _claim_dict_from(item: Mapping[str, Any]) -> dict[str, Any]:
    """A stone/mushroom/action shown as a plain hypothesis claim (keeps its id, so R-10 finds its row)."""
    return {k: item[k] for k in _CLAIM_KEYS}


# ---------------------------------------------------------------------------------------
# The grow run
# ---------------------------------------------------------------------------------------

@dataclass
class RunReport:
    latency_ms: int = 0
    llm_calls: int = 0
    tokens: int = 0
    validation_failures: int = 0
    fallbacks: dict[str, str] = field(default_factory=dict)        # cluster id -> reason
    downgrades: list[dict[str, Any]] = field(default_factory=list)  # kind, from, to, confidence, reasons


async def load_notes(pool: Any, user_id: UUID, project_ids: Sequence[str], tab_refs: Sequence[str]
                     ) -> list[dict[str, Any]]:
    if pool is None:
        return []
    try:
        rows = await pool.fetch(
            "SELECT id::text AS id, text, kind, project_id::text AS project_id, tab_ref::text AS tab_ref "
            "FROM user_notes WHERE user_id = $1 AND (project_id = ANY($2::uuid[]) OR tab_ref = ANY($3::uuid[])) "
            "ORDER BY created_at, id", user_id, [UUID(p) for p in project_ids], [UUID(r) for r in tab_refs])
    except Exception as exc:  # noqa: BLE001 - notes are optional context
        log.warning("user notes unavailable (%s)", type(exc).__name__)
        return []
    return [dict(r) for r in rows]


Prepared = tuple[ClusterFeatures, DataBlock, list[PriorInsight], dict[str, str], Carry]

# Only these notes can make a claim "stated". A `note`-kind note (made by confirming or editing a next action or a
# question) is context for the model, never a decision source: the model once turned an edited action into a
# carved stone.
STATED_NOTE_KINDS = ("goal", "decision")


def stated_notes(note_rows: Sequence[Mapping[str, Any]]) -> dict[str, str]:
    return {r["id"]: r["text"] for r in note_rows if r.get("kind") in STATED_NOTE_KINDS}


class GrowRun:
    def __init__(self, user_id: UUID, open_tabs: Sequence[Mapping[str, Any]], hollow_count: int, *,
                 pool: Any, client: Any, snapshot_at: datetime | None = None, stats: StatsSource | None = None,
                 persist: Any = None, model_name: str | None = None) -> None:
        self.user_id = user_id
        self.tabs = [dict(t) for t in open_tabs]
        self.by_ref = {t["tab_ref"]: t for t in self.tabs}
        self.hollow_count = hollow_count
        self.pool = pool
        self.client = client
        self.snapshot_at = snapshot_at or datetime.now(timezone.utc)
        self.stats = stats or get_stats_source(pool)
        self.persist = persist
        self.model_name = model_name
        self.run_id = str(uuid.uuid4())
        self.report = RunReport()
        self.response: dict[str, Any] | None = None
        self.builds: list[TreeBuild] = []
        self.clusters: list[Cluster] = []
        self.prior: dict[str, list[PriorInsight]] = {}

    # -- preparation (shared with POST /api/projects/{id}/analyze) ---------------------------------

    async def prepare_clusters(self, clusters: Sequence[Cluster]) -> dict[str, Prepared]:
        """Features, notes, carry-over and prior research per cluster, then the DATA block."""
        existing = [c.is_existing_project_id for c in clusters if c.is_existing_project_id]
        notes = await load_notes(self.pool, self.user_id, existing, list(self.by_ref))
        carries = await asyncio.gather(*(load_carry(self.pool, self.user_id, c.is_existing_project_id)
                                         for c in clusters))

        async def prepare(c: Cluster, carry: Carry) -> Prepared:
            feats = await compute_features(self.user_id, c.tab_refs, self.tabs, self.snapshot_at, self.pool,
                                           stats=self.stats, client=self.client)
            mine = [n for n in notes if (n["project_id"] and n["project_id"] == c.is_existing_project_id)
                    or (n["tab_ref"] and n["tab_ref"] in c.tab_refs)]
            note_rows = [{"id": _p("n_", n["id"]), "text": n["text"], "kind": n.get("kind")} for n in mine]
            prior = await retrieve_prior_research(self.pool, self.user_id, c.centroid)
            block = to_data_block(feats, note_rows, [p.for_model() for p in prior], carry.dismissed)
            return feats, block, prior, stated_notes(note_rows), carry

        done = await asyncio.gather(*(prepare(c, k) for c, k in zip(clusters, carries, strict=True)))
        return dict(zip([c.id for c in clusters], done, strict=True))

    # -- the run -------------------------------------------------------------------------------------

    async def stream(self) -> AsyncIterator[dict[str, Any]]:
        t0 = time.perf_counter()
        if len(self.tabs) <= SMALL_SNAPSHOT_MAX_TABS:
            async for line in self._stream_small(t0):
                yield line
        else:
            async for line in self._stream_full(t0):
                yield line

    def _clusters_line(self, clusters: list[dict[str, Any]], sprouts: list[dict[str, Any]], meadow: list[str],
                       fog: list[dict[str, str]]) -> dict[str, Any]:
        return {"type": "clusters", "run_id": _p("r_", self.run_id), "hollow_count": self.hollow_count,
                "clusters": clusters, "sprouts": sprouts, "meadow": meadow, "fog": fog}

    async def _finish(self, t0: float, line: dict[str, Any], trees: list[dict[str, Any]], degraded: bool,
                      banner: str | None, fireflies: list[dict[str, Any]]) -> AsyncIterator[dict[str, Any]]:
        self.report.latency_ms = round((time.perf_counter() - t0) * 1000)
        response = {"run_id": _p("r_", self.run_id), "generated_at": datetime.now(timezone.utc),
                    "hollow_count": self.hollow_count, "degraded": degraded, "banner_text": banner,
                    "trees": trees, "sprouts": line["sprouts"], "meadow": line["meadow"],
                    "fog": line["fog"], "fireflies": fireflies}
        self.response = GroveResponse.model_validate(response).model_dump(mode="json")
        downgraded = len(self.report.downgrades)
        metrics.record_grow(self.report.latency_ms, downgraded, len(self.report.fallbacks),
                            self.report.validation_failures)
        log.info("grow run %s: %d trees, %d llm calls, %d tokens, %d downgraded, %d fallbacks, degraded=%s, %d ms",
                 self.run_id, len(trees), self.report.llm_calls, self.report.tokens, downgraded,
                 len(self.report.fallbacks), degraded, self.report.latency_ms)
        if self.persist is not None:
            await self.persist(self)
        yield DoneLine.model_validate({"type": "done", "run_id": self.response["run_id"], "degraded": degraded,
                                       "fireflies": self.response["fireflies"]}).model_dump(mode="json")

    async def _stream_small(self, t0: float) -> AsyncIterator[dict[str, Any]]:
        """0-1 tabs: an empty grove. 2-3 tabs: no forced clustering, one sprout, at most one model call."""
        sprouts: list[dict[str, Any]] = []
        if len(self.tabs) >= 2:
            ordered = sorted(self.tabs, key=lambda t: (str(t["opened_at"]), t["tab_ref"]))
            refs = [t["tab_ref"] for t in ordered]
            label = top_terms(t["title"] for t in ordered) or "Tabs opened together"
            sprouts = [{"label": await self._single_goal(refs) or label, "tab_refs": refs}]
        line = self._clusters_line([], sprouts, [], [])
        yield ClustersLine.model_validate(line).model_dump(mode="json")
        async for done in self._finish(t0, line, [], False, BANNER_LEARNING, []):
            yield done

    async def _single_goal(self, refs: list[str]) -> str | None:
        """One model call to name the goal of 2-3 tabs; used only when its validated confidence is >= 0.60."""
        try:
            feats = await compute_features(self.user_id, refs, self.tabs, self.snapshot_at, self.pool,
                                           stats=self.stats, client=self.client)
            notes = await load_notes(self.pool, self.user_id, [], refs)
            note_rows = [{"id": _p("n_", n["id"]), "text": n["text"], "kind": n.get("kind")} for n in notes]
            block = to_data_block(feats, note_rows)
            outcome = await infer_cluster("small", block, self.client, repair=False)
            self.report.llm_calls += outcome.llm_calls
            self.report.tokens += outcome.tokens
            if outcome.inference is None:
                return None
            g = outcome.inference.goal
            ctx = ValidationContext(block.refs, {r: f.source_type for r, f in feats.tabs.items()},
                                    stated_notes(note_rows), anchors=block.anchors)
            c = validate_claim("goal", g.text, g.provenance, g.confidence, g.evidence, ctx)
            if c.provenance not in ("inferred", "stated") or c.confidence < SINGLE_GOAL_MIN_CONFIDENCE:
                return None
            label = c.display_text
            return label if len(label) <= SPROUT_LABEL_MAX else label[:SPROUT_LABEL_MAX - 1].rstrip() + "…"
        except Exception as exc:  # noqa: BLE001 - the sprout keeps its deterministic label
            log.warning("single-goal call failed (%s)", type(exc).__name__)
            return None

    async def _stream_full(self, t0: float) -> AsyncIterator[dict[str, Any]]:
        at = self.snapshot_at.isoformat()
        embedding_failed = False
        try:
            result = await cluster_snapshot(self.user_id, self.tabs, self.pool, at, client=self.client)
        except Exception as exc:  # noqa: BLE001 - Seedling clustering without embeddings (R-9)
            log.warning("embeddings unavailable for clustering (%s); Seedling clustering", type(exc).__name__)
            embedding_failed = True
            result = await cluster_snapshot_no_embeddings(self.user_id, self.tabs, self.pool, at)
        clusters = result.clusters
        self.clusters = clusters
        pids = {c.id: (c.is_existing_project_id or str(uuid.uuid4())) for c in clusters}
        visits = visits_from(await self.stats.events(self.user_id, set(self.by_ref)))
        shared = set(result.shared_tab_refs)
        shared |= {r for c in clusters for r in c.tab_refs if sum(r in o.tab_refs for o in clusters) > 1}

        def attention(c: Cluster) -> tuple[int, int, str]:
            mine = [v for v in visits if v.tab_ref in c.tab_refs]
            minutes = round(sum(v.active_ms for v in mine) / 60000)
            last = max((v.start for v in mine), default=None)
            if last is None:
                last = max(datetime.fromisoformat(str(self.by_ref[r]["opened_at"]).replace("Z", "+00:00"))
                           for r in c.tab_refs)
            days = max((self.snapshot_at - last).days, 0)
            return minutes, days, "amber" if days >= AMBER_AFTER_DAYS else "green"

        line = self._clusters_line(
            [{"project_id": _p("p_", pids[c.id]), "name": c.label, "tab_refs": c.tab_refs,
              **dict(zip(("attention_min", "days_since_active", "canopy"), attention(c), strict=True))}
             for c in clusters],
            [{"label": s.label, "tab_refs": s.tab_refs} for s in result.sprouts],
            [s.tab_ref for s in result.meadow], [{"tab_ref": s.tab_ref, "reason": s.reason} for s in result.fog])
        yield ClustersLine.model_validate(line).model_dump(mode="json")

        prepared = await self.prepare_clusters(clusters)
        by_id = {c.id: c for c in clusters}
        self.prior = {cid: p[2] for cid, p in prepared.items()}
        trees: dict[str, dict[str, Any]] = {}
        async for outcome in self._outcomes(prepared, embedding_failed):
            build = self.build_tree(outcome, by_id[outcome.cluster_id], pids[outcome.cluster_id],
                                    prepared[outcome.cluster_id], shared)
            self.builds.append(build)
            trees[outcome.cluster_id] = build.tree
            tree_line = TreeLine.model_validate({"type": "tree", **build.tree}).model_dump(mode="json")
            yield {"type": tree_line.pop("type"), **tree_line}

        ai_eligible = [cid for cid in prepared if self.report.fallbacks.get(cid) != "llm_cap"]
        failed = [cid for cid in ai_eligible if cid in self.report.fallbacks]
        degraded = bool(ai_eligible) and len(failed) == len(ai_eligible)
        banner = None
        if degraded:
            banner = BANNER_ALL_FALLBACK
        elif failed:
            why = sorted({REASON_LABEL.get(self.report.fallbacks[cid].split(":")[0], "AI error") for cid in failed})
            banner = f"{len(failed)} of {len(clusters)} trees shown as groups only ({', '.join(why)})"
        fireflies = []
        for c in clusters if not degraded else []:  # Seedling shows no fireflies
            prior = prepared[c.id][2]
            if prior:
                p = prior[0]
                fireflies.append({"id": _p("ff_", p.insight_id), "project_id": _p("p_", pids[c.id]),
                                  "past_project_id": _p("p_", p.project_id), "past_project_name": p.project_name,
                                  "past_date": p.on.isoformat(), "similarity": min(max(p.similarity, 0.0), 1.0),
                                  "saved_context_id": _p("s_", p.saved_context_id) if p.saved_context_id else None,
                                  "display_text": f"You researched this on {p.on:%B} {p.on.day}."})
        async for done in self._finish(t0, line, [trees[c.id] for c in clusters], degraded, banner, fireflies):
            yield done

    async def _outcomes(self, prepared: Mapping[str, Prepared], embedding_failed: bool
                        ) -> AsyncIterator[InferenceOutcome]:
        if embedding_failed:  # Azure is unreachable for embeddings: Seedling, no model calls
            for cid in prepared:
                yield InferenceOutcome(cid, None, "embeddings_unavailable")
            return
        async for outcome in infer_all([(cid, p[1]) for cid, p in prepared.items()], self.client, cap=MAX_LLM_CALLS):
            yield outcome

    def build_tree(self, outcome: InferenceOutcome, c: Cluster, pid: str, prepared: Prepared,
                   shared: set[str]) -> TreeBuild:
        feats, block, _, notes, carry = prepared
        r = self.report
        r.llm_calls += outcome.llm_calls
        r.tokens += outcome.tokens
        r.validation_failures += outcome.validation_failures
        if outcome.inference is not None:
            try:
                build = assemble_tree(c, pid, feats, block, outcome.inference, self.by_ref, self.snapshot_at,
                                      notes, shared, carry)
                for claim in build.claims:
                    if claim.downgraded:
                        r.downgrades.append({"cluster": c.id, "kind": claim.kind, "from": claim.model_provenance,
                                             "to": claim.provenance, "model_confidence": claim.model_confidence,
                                             "confidence": claim.confidence, "reasons": claim.reasons})
                TreeLine.model_validate({"type": "tree", **build.tree})
                return build
            except Exception as exc:  # noqa: BLE001 - a bad assembly fogs this cluster only
                log.warning("cluster %s assembly failed (%s)", c.id, type(exc).__name__)
                r.validation_failures += 1
                outcome.fallback_reason = "invalid_output"
        r.fallbacks[c.id] = outcome.fallback_reason or "ai_unavailable"
        return fallback_tree(c, pid, feats, self.by_ref, self.snapshot_at, shared, r.fallbacks[c.id])
