"""Deterministic clustering of open tabs (R-5, proposal §14 step 5, §27).

affinity = 0.65·cos_cal + 0.20·opener + 0.15·temporal, average-linkage agglomerative
clustering on 1 − affinity. cos_cal is the calibrated cosine: text-embedding-3-small puts
related tab titles at cosine ≈ 0.3–0.5 and unrelated ones at ≈ 0.1–0.25, so the raw cosine
cannot reach the plan's merge distance of 0.45. The calibration and threshold were chosen by
scripts/calibrate_cluster.py over three labeled snapshots (max of the minimum ARI).

Then: search tabs follow the tabs they opened; user pins override everything; leftover
singletons go to the fog (ambiguous between two clusters) or the meadow; a tab close to a
second cluster is shared (§27); young small clusters are sprouts; clusters are matched to the
user's existing projects by centroid.
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from typing import Any, Literal
from uuid import UUID

import asyncpg
import numpy as np
from sklearn.cluster import AgglomerativeClustering

from .embeddings import embed_tabs
from .labels import top_terms
from .normalize import SourceType, normalize_tab

MAX_TABS = 60
_ID_NAMESPACE = uuid.UUID("6f3c1d2e-5b4a-4c8d-9e7f-1a2b3c4d5e6f")


@dataclass(frozen=True)
class ClusterParams:
    # Plan weights (BUILD_TASKS.md R-5), unchanged.
    w_cos: float = 0.65
    w_opener: float = 0.20
    w_temporal: float = 0.15
    temporal_window_s: int = 180
    # Calibration (scripts/calibrate_cluster.py). "fixed": clip((cos − lo)/(hi − lo), 0, 1);
    # "snapshot": the same with lo/hi = percentiles of this snapshot's cosines; "raw": cos as is.
    # Chosen by the grid over demo + 2 labeled snapshots (max of the minimum ARI): fixed 0.05/0.50
    # beat per-snapshot percentiles and raw cosine. NOT the plan: the plan uses raw cosine, which
    # scores ARI 0.18 on all three snapshots.
    calibration: Literal["fixed", "snapshot", "raw"] = "fixed"
    lo: float = 0.05
    hi: float = 0.50
    # Average-linkage merge distance (1 − affinity). Plan: 0.45, which splits real goals with this
    # calibration (min ARI 0.70). 0.65 gives min ARI 0.886 (demo 0.886, others 0.905 and 1.0).
    threshold: float = 0.65
    # Sprouts (proposal §5): younger than 30 min and fewer than 3 tabs.
    sprout_age_min: int = 30
    sprout_max_tabs: int = 3
    # Singletons: fog when the top two cluster affinities are both ≥ floor and within margin.
    fog_floor: float = 0.30
    fog_margin: float = 0.05
    # Multi-membership (§27): mean affinity to the other cluster ≥ share_min and ≥ ratio × own.
    share_min: float = 0.45
    share_ratio: float = 0.9
    # Existing-project match on RAW centroid cosine: centroids average out noise, so their
    # cosines sit far above pairwise tab cosines and the pairwise calibration saturates.
    match_threshold: float = 0.80


PARAMS = ClusterParams()


@dataclass(frozen=True)
class ClusterTab:
    tab_ref: str
    title: str
    opener_tab_ref: str | None
    opened_at: datetime
    is_search: bool


@dataclass
class Cluster:
    id: str
    tab_refs: list[str]
    label: str
    centroid: list[float]
    pinned_tab_refs: list[str]
    is_existing_project_id: str | None
    earliest_opened_at: str


@dataclass
class Singleton:
    tab_ref: str
    reason: str


@dataclass
class ClusterResult:
    clusters: list[Cluster]
    sprouts: list[Cluster]
    meadow: list[Singleton]
    fog: list[Singleton]
    shared_tab_refs: dict[str, list[str]]  # tab_ref -> ids of the extra clusters it joined
    diagnostics: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def assignment(self) -> dict[str, str]:
        """Primary group per tab: cluster/sprout id, or the tab itself for singletons (ARI)."""
        out = {}
        for c in self.clusters + self.sprouts:
            for ref in c.tab_refs:
                if c.id not in self.shared_tab_refs.get(ref, ()):  # skip the extra (shared) membership
                    out[ref] = c.id
        for s in self.meadow + self.fog:
            out[s.tab_ref] = f"single:{s.tab_ref}"
        return out


def _ts(value: str | datetime) -> datetime:
    return value if isinstance(value, datetime) else datetime.fromisoformat(value.replace("Z", "+00:00"))


def make_cluster_tabs(snapshot_tabs: Sequence[Mapping[str, Any]]) -> list[ClusterTab]:
    """§4.2 snapshot tabs → ClusterTab (search tabs detected by R-2)."""
    out = []
    for t in snapshot_tabs:
        nt = normalize_tab(t)
        out.append(ClusterTab(tab_ref=t["tab_ref"], title=t.get("title") or nt.title_clean,
                              opener_tab_ref=t.get("opener_tab_ref"), opened_at=_ts(t["opened_at"]),
                              is_search=nt.source_type is SourceType.SEARCH))
    return out


def calibrate(cos: np.ndarray, params: ClusterParams) -> tuple[np.ndarray, float, float]:
    """Calibrated cosine matrix and the lo/hi actually used."""
    if params.calibration == "raw":
        return cos.copy(), 0.0, 1.0
    if params.calibration == "snapshot":
        off = cos[~np.eye(len(cos), dtype=bool)]
        lo, hi = (float(np.percentile(off, params.lo)), float(np.percentile(off, params.hi))) if off.size \
            else (0.0, 1.0)
    else:
        lo, hi = params.lo, params.hi
    hi = max(hi, lo + 1e-6)
    return np.clip((cos - lo) / (hi - lo), 0.0, 1.0), lo, hi


def affinity_matrix(tabs: Sequence[ClusterTab], vectors: np.ndarray, params: ClusterParams
                    ) -> tuple[np.ndarray, np.ndarray, dict[str, float]]:
    unit = vectors / np.maximum(np.linalg.norm(vectors, axis=1, keepdims=True), 1e-12)
    cos = np.clip(unit @ unit.T, -1.0, 1.0)
    cal, lo, hi = calibrate(cos, params)
    index = {t.tab_ref: i for i, t in enumerate(tabs)}
    opener = np.zeros_like(cos)
    for i, t in enumerate(tabs):
        j = index.get(t.opener_tab_ref) if t.opener_tab_ref else None
        if j is not None and j != i:
            opener[i, j] = opener[j, i] = 1.0
    stamps = np.array([t.opened_at.timestamp() for t in tabs])
    temporal = (np.abs(stamps[:, None] - stamps[None, :]) <= params.temporal_window_s).astype(float)
    aff = np.clip(params.w_cos * cal + params.w_opener * opener + params.w_temporal * temporal, 0.0, 1.0)
    np.fill_diagonal(aff, 1.0)
    off = ~np.eye(len(tabs), dtype=bool)
    stats = {"cos_mean": float(cos[off].mean()) if off.any() else 0.0,
             "cos_p50": float(np.percentile(cos[off], 50)) if off.any() else 0.0,
             "cos_p95": float(np.percentile(cos[off], 95)) if off.any() else 0.0,
             "affinity_mean": float(aff[off].mean()) if off.any() else 0.0,
             "lo_used": round(lo, 6), "hi_used": round(hi, 6)}
    return aff, cos, stats


def _agglomerate(dist: np.ndarray, threshold: float) -> list[int]:
    if len(dist) == 1:
        return [0]
    model = AgglomerativeClustering(n_clusters=None, metric="precomputed", linkage="average",
                                    distance_threshold=threshold)
    return [int(x) for x in model.fit_predict(dist)]


def _mean_aff(aff: np.ndarray, i: int, members: Sequence[int]) -> float:
    others = [m for m in members if m != i]
    return float(aff[i, others].mean()) if others else 0.0


def _stable_id(refs: Sequence[str]) -> str:
    return str(uuid.uuid5(_ID_NAMESPACE, ",".join(sorted(refs))))


def cluster(tabs: Sequence[ClusterTab], vectors: Mapping[str, np.ndarray], snapshot_at: str | datetime, *,
            pins: Mapping[str, str] | None = None, existing_projects: Mapping[str, np.ndarray] | None = None,
            next_focus: Mapping[str, str] | None = None, params: ClusterParams = PARAMS) -> ClusterResult:
    """Pure clustering. pins: tab_ref → project id (user assignments). existing_projects:
    project id → centroid. next_focus: search tab_ref → tab focused right after it."""
    if len(tabs) > MAX_TABS:
        raise ValueError(f"at most {MAX_TABS} tabs per snapshot")
    if not tabs:
        return ClusterResult([], [], [], [], {}, {"params": asdict(params), "tabs": 0})
    tabs = sorted(tabs, key=lambda t: (t.opened_at, t.tab_ref))
    pins = {ref: pid for ref, pid in (pins or {}).items() if any(t.tab_ref == ref for t in tabs)}
    snapshot_at = _ts(snapshot_at)
    refs = [t.tab_ref for t in tabs]
    index = {ref: i for i, ref in enumerate(refs)}
    matrix = np.stack([np.asarray(vectors[ref], dtype=np.float64) for ref in refs])
    aff, cos, stats = affinity_matrix(tabs, matrix, params)

    # 1. Agglomerative clustering of the core: not search, not pinned.
    core = [i for i, t in enumerate(tabs) if not t.is_search and t.tab_ref not in pins]
    groups: dict[int, list[int]] = {}
    if core:
        sub = 1.0 - aff[np.ix_(core, core)]
        np.fill_diagonal(sub, 0.0)
        for i, label in zip(core, _agglomerate(sub, params.threshold)):
            groups.setdefault(label, []).append(i)
    group_of = {i: g for g, members in groups.items() for i in members}

    # 2. Search tabs: follow the tabs they opened, else the next focused tab, else the nearest cluster.
    next_label = max(groups, default=-1) + 1
    for i, t in enumerate(tabs):
        if not t.is_search or t.tab_ref in pins:
            continue
        children = [j for j, c in enumerate(tabs) if c.opener_tab_ref == t.tab_ref and j in group_of]
        target = None
        if children:
            votes: dict[int, int] = {}
            for j in children:
                votes[group_of[j]] = votes.get(group_of[j], 0) + 1
            target = min(votes, key=lambda g: (-votes[g], min(groups[g])))
        elif next_focus and next_focus.get(t.tab_ref) in index and index[next_focus[t.tab_ref]] in group_of:
            target = group_of[index[next_focus[t.tab_ref]]]
        else:
            candidates = [g for g, members in groups.items() if len(members) >= 2]
            if candidates:
                target = max(candidates, key=lambda g: (_mean_aff(aff, i, groups[g]), -min(groups[g])))
        if target is None:
            target, next_label = next_label, next_label + 1
            groups[target] = []
        groups[target].append(i)
        group_of[i] = target

    # 3. Split into multi-tab groups and singletons.
    multi = {g: sorted(m) for g, m in groups.items() if len(m) >= 2}
    single = sorted(m[0] for m in groups.values() if len(m) == 1)

    # 4. Match multi-tab groups to existing projects by raw centroid cosine (one-to-one, greedy).
    def centroid(members: Sequence[int]) -> np.ndarray:
        c = matrix[list(members)].mean(axis=0)
        return c / max(np.linalg.norm(c), 1e-12)

    centroids = {g: centroid(m) for g, m in multi.items()}
    matched: dict[int, str] = {}
    if existing_projects:
        proj = {pid: np.asarray(c, dtype=np.float64) / max(np.linalg.norm(c), 1e-12)
                for pid, c in existing_projects.items()}
        pairs = sorted(((float(centroids[g] @ pc), g, pid) for g in multi for pid, pc in proj.items()),
                       key=lambda x: (-x[0], x[1], x[2]))
        used = set()
        for score, g, pid in pairs:
            if score >= params.match_threshold and g not in matched and pid not in used:
                matched[g] = pid
                used.add(pid)

    # 5. Build clusters; pinned tabs join the cluster of their project, or a new one.
    clusters: dict[str, dict[str, Any]] = {}
    for g, members in sorted(multi.items(), key=lambda kv: kv[1][0]):
        cid = matched.get(g) or _stable_id([refs[i] for i in members])
        clusters[cid] = {"members": list(members), "pinned": [], "project": matched.get(g)}
    for ref, pid in sorted(pins.items(), key=lambda kv: index[kv[0]]):
        if pid not in clusters:
            clusters[pid] = {"members": [], "pinned": [], "project": pid}
        clusters[pid]["members"].append(index[ref])
        clusters[pid]["pinned"].append(ref)

    # 6. Singletons: fog if ambiguous between two clusters, else meadow.
    def label_of(members: Sequence[int]) -> str:
        return top_terms(tabs[i].title for i in sorted(members))

    def is_sprout(members: Sequence[int], pinned: Sequence[str]) -> bool:
        earliest = min(tabs[i].opened_at for i in members)
        return (not pinned and len(members) < params.sprout_max_tabs
                and snapshot_at - earliest < timedelta(minutes=params.sprout_age_min))

    tree_ids = [cid for cid, c in clusters.items() if not is_sprout(c["members"], c["pinned"])]
    meadow, fog = [], []
    for i in single:
        scored = sorted(((_mean_aff(aff, i, clusters[cid]["members"]), cid) for cid in tree_ids),
                        key=lambda x: (-x[0], x[1]))
        if len(scored) >= 2 and scored[1][0] >= params.fog_floor and scored[0][0] - scored[1][0] <= params.fog_margin:
            a, b = (label_of(clusters[cid]["members"]) for _, cid in scored[:2])
            fog.append(Singleton(refs[i], f"unclear between {a} and {b}"))
        else:
            meadow.append(Singleton(refs[i], "low affinity to any goal"))

    # 7. Multi-membership (§27) among trees, computed on the clusters before any sharing.
    shared: dict[str, list[str]] = {}
    extra: dict[str, list[int]] = {cid: [] for cid in clusters}
    # Only trees with 2+ un-pinned tabs take shared tabs: a tree the user made by pinning keeps
    # exactly the tabs the user put there.
    hosts = [cid for cid in tree_ids if len(clusters[cid]["members"]) - len(clusters[cid]["pinned"]) >= 2]
    for cid in tree_ids:
        members = clusters[cid]["members"]
        for i in members:
            if refs[i] in clusters[cid]["pinned"] or len(members) < 2:
                continue
            own = _mean_aff(aff, i, members)
            best = max(((_mean_aff(aff, i, clusters[o]["members"]), o) for o in hosts if o != cid),
                       default=None, key=lambda x: (x[0], x[1]))
            if best and best[0] >= params.share_min and best[0] >= params.share_ratio * own:
                shared[refs[i]] = [best[1]]
                extra[best[1]].append(i)

    def build(cid: str) -> Cluster:
        c = clusters[cid]
        members = c["members"]
        return Cluster(id=cid, tab_refs=[refs[i] for i in sorted(set(members) | set(extra[cid]))],
                       label=label_of(members),
                       centroid=[round(float(x), 6) for x in centroid(members)],
                       pinned_tab_refs=sorted(c["pinned"]), is_existing_project_id=c["project"],
                       earliest_opened_at=min(tabs[i].opened_at for i in members).isoformat())

    order = sorted(clusters, key=lambda cid: (min(tabs[i].opened_at for i in clusters[cid]["members"]), cid))
    trees = [build(cid) for cid in order if cid in tree_ids]
    sprouts = [build(cid) for cid in order if cid not in tree_ids]
    stats.update({"tabs": len(tabs), "search_tabs": sum(t.is_search for t in tabs), "pinned": len(pins),
                  "clusters": len(trees), "sprouts": len(sprouts), "singletons": len(single)})
    return ClusterResult(trees, sprouts, meadow, fog, shared, {"params": asdict(params), **stats})


# ---------------------------------------------------------------------------------------
# Database inputs (pins and existing projects) and the async entry point
# ---------------------------------------------------------------------------------------

def _vec(text: str) -> np.ndarray:
    return np.array(text.strip("[]").split(","), dtype=np.float32)


async def load_pins(conn: Any, user_id: UUID, tab_refs: Sequence[str]) -> dict[str, str]:
    """User assignments (assigned_by='user'), latest per tab: tab_ref → project id."""
    try:
        rows = await conn.fetch(
            "SELECT DISTINCT ON (ct.tab_ref) ct.tab_ref::text AS tab_ref, ic.project_id::text AS project_id "
            "FROM cluster_tabs ct JOIN intent_clusters ic ON ic.id = ct.cluster_id AND ic.user_id = ct.user_id "
            "WHERE ct.user_id = $1 AND ct.assigned_by = 'user' AND ct.tab_ref = ANY($2::uuid[]) "
            "ORDER BY ct.tab_ref, ct.assigned_at DESC", user_id, [UUID(r) for r in tab_refs])
    except asyncpg.UndefinedTableError:
        return {}
    return {r["tab_ref"]: r["project_id"] for r in rows}


async def load_project_centroids(conn: Any, user_id: UUID) -> dict[str, np.ndarray]:
    """Centroid per existing project: mean of its cluster_tabs' tab embeddings."""
    try:
        rows = await conn.fetch(
            "SELECT ic.project_id::text AS project_id, avg(me.embedding)::text AS centroid "
            "FROM cluster_tabs ct JOIN intent_clusters ic ON ic.id = ct.cluster_id AND ic.user_id = ct.user_id "
            "JOIN memory_embeddings me ON me.user_id = ct.user_id AND me.kind = 'tab' "
            "AND me.source_id = ct.tab_ref::text WHERE ct.user_id = $1 GROUP BY ic.project_id", user_id)
    except asyncpg.UndefinedTableError:
        return {}
    return {r["project_id"]: _vec(r["centroid"]) for r in rows if r["centroid"]}


async def cluster_snapshot(user_id: UUID, snapshot_tabs: Sequence[Mapping[str, Any]], pool: Any,
                           snapshot_at: str | datetime, *, client: Any = None, pins: Mapping[str, str] | None = None,
                           next_focus: Mapping[str, str] | None = None, params: ClusterParams = PARAMS
                           ) -> ClusterResult:
    """Normalize (R-2), embed with the cache (R-4), read pins and project centroids, cluster."""
    normalized = [normalize_tab(t) for t in snapshot_tabs]
    vectors = (await embed_tabs(user_id, normalized, pool, client=client)).vectors
    if pins is None:
        pins = await load_pins(pool, user_id, [t["tab_ref"] for t in snapshot_tabs]) if pool is not None else {}
    existing = await load_project_centroids(pool, user_id) if pool is not None else {}
    return cluster(make_cluster_tabs(snapshot_tabs), vectors, snapshot_at, pins=pins,
                   existing_projects=existing, next_focus=next_focus, params=params)
