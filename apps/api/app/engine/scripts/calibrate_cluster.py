r"""Calibrate R-5 clustering on three hand-labeled snapshots (demo + 2 calibration sets).

Run from apps/api:
    .venv\Scripts\python app\engine\scripts\calibrate_cluster.py

Embeds the snapshots with the R-4 cache under a calibration user (rows deleted at the end),
then grid-searches the cosine calibration and the merge threshold, ranking by the MINIMUM
ARI across the three snapshots (then the mean, then closeness to the plan's threshold 0.45).

Selection rule: the best minimum ARI over all three snapshots. The ranking restricted to sets
that keep the demo's narrated shape (4 trees + 1 sprout, proposal §21) is printed too: it costs
ARI and pushes GirlHacks tabs into the meadow, so it is reported, not used.
"""

from __future__ import annotations

import asyncio
import sys
from dataclasses import replace
from itertools import product
from pathlib import Path
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from app.engine import db  # noqa: E402
from app.engine.aoai import AzureOpenAIClient  # noqa: E402
from app.engine.cluster import PARAMS, ClusterParams, cluster, make_cluster_tabs  # noqa: E402
from app.engine.embeddings import embed_tabs  # noqa: E402
from app.engine.evaluation import SNAPSHOT_NAMES, ari, load_labeled_snapshot  # noqa: E402
from app.engine.normalize import normalize_tab  # noqa: E402

CAL_USER = UUID("00000000-0000-4000-8000-0000000000ee")
THRESHOLDS = [round(0.30 + 0.05 * i, 2) for i in range(11)]  # 0.30 .. 0.80


def grid() -> list[ClusterParams]:
    out = []
    for lo, hi, thr in product((0.05, 0.10, 0.15, 0.20), (0.40, 0.50, 0.60), THRESHOLDS):
        out.append(replace(PARAMS, calibration="fixed", lo=lo, hi=hi, threshold=thr))
    for plo, phi, thr in product((50, 60, 70, 80), (90, 95, 99), THRESHOLDS):
        out.append(replace(PARAMS, calibration="snapshot", lo=plo, hi=phi, threshold=thr))
    for i in range(19):
        out.append(replace(PARAMS, calibration="raw", lo=0.0, hi=1.0, threshold=round(0.50 + 0.025 * i, 3)))
    return out


async def embed_all(snapshots: dict) -> dict:
    client, pool = AzureOpenAIClient(), await db.get_pool()
    vectors = {}
    try:
        for name, snap in snapshots.items():
            result = await embed_tabs(CAL_USER, [normalize_tab(t) for t in snap["open_tabs"]], pool, client=client)
            vectors[name] = result.vectors
    finally:
        if pool is not None:
            await pool.execute("DELETE FROM memory_embeddings WHERE user_id = $1", CAL_USER)
        await db.close_pool()
        await client.aclose()
    return vectors


def evaluate(params: ClusterParams, snapshots: dict, vectors: dict) -> list[float]:
    return [ari(cluster(make_cluster_tabs(s["open_tabs"]), vectors[n], s["snapshot_at"], params=params), s["labels"])
            for n, s in snapshots.items()]


def demo_shape_ok(params: ClusterParams, snapshots: dict, vectors: dict) -> bool:
    demo = snapshots["demo"]
    r = cluster(make_cluster_tabs(demo["open_tabs"]), vectors["demo"], demo["snapshot_at"], params=params)
    return len(r.clusters) == 4 and len(r.sprouts) == 1


def describe(p: ClusterParams) -> str:
    if p.calibration == "fixed":
        return f"fixed lo={p.lo:.2f} hi={p.hi:.2f}"
    if p.calibration == "snapshot":
        return f"snapshot p{p.lo:.0f}/p{p.hi:.0f}"
    return "raw"


def main() -> None:
    snapshots = {n: load_labeled_snapshot(n) for n in SNAPSHOT_NAMES}
    vectors = asyncio.run(embed_all(snapshots))
    rows = []
    for p in grid():
        scores = evaluate(p, snapshots, vectors)
        rows.append((min(scores), sum(scores) / len(scores), -abs(p.threshold - 0.45), p, scores,
                     demo_shape_ok(p, snapshots, vectors)))
    rows.sort(key=lambda r: (-r[0], -r[1], -r[2], describe(r[3]), r[3].threshold))
    header = (f"{'rank':<5}{'calibration':<26}{'threshold':>10}{'min ARI':>9}{'mean ARI':>10}  {'demo 4+1':>9}   " +
              "  ".join(f"{n:>20}" for n in snapshots))

    def show(selection: list) -> None:
        print(header)
        for rank, (mn, mean, _, p, scores, shape) in enumerate(selection[:5], 1):
            print(f"{rank:<5}{describe(p):<26}{p.threshold:>10.3f}{mn:>9.3f}{mean:>10.3f}  {str(shape):>9}   " +
                  "  ".join(f"{s:>20.3f}" for s in scores))

    print(f"grid: {len(rows)} parameter sets x {len(snapshots)} snapshots; ranked by min ARI, then mean ARI")
    print("\nunconstrained top 5:")
    show(rows)
    constrained = [r for r in rows if r[5]]
    print(f"\ntop 5 with the demo shape kept (4 trees + 1 sprout; {len(constrained)} of {len(rows)} sets):")
    show(constrained)
    by_option = {}
    for r in rows:
        by_option.setdefault(r[3].calibration, r)
    print("\nbest per calibration option:")
    for option, (mn, mean, _, p, scores, _shape) in by_option.items():
        print(f"  {option:<9} {describe(p):<24} threshold {p.threshold:.3f}  min {mn:.3f}  mean {mean:.3f}  "
              f"per snapshot {[round(s, 3) for s in scores]}")
    plan = replace(PARAMS, calibration="raw", lo=0.0, hi=1.0, threshold=0.45)
    print(f"\nplan as written (raw cosine, threshold 0.45): ARI {[round(s, 3) for s in evaluate(plan, snapshots, vectors)]}")
    best = rows[0][3]
    print(f"\nchosen: calibration={best.calibration} lo={best.lo} hi={best.hi} threshold={best.threshold}")
    print(f"current PARAMS: calibration={PARAMS.calibration} lo={PARAMS.lo} hi={PARAMS.hi} threshold={PARAMS.threshold}"
          f" -> ARI {[round(s, 3) for s in evaluate(PARAMS, snapshots, vectors)]}")

    # Leave one snapshot out: choose on the other two, score the held-out one.
    names = list(snapshots)
    print("\nleave-one-snapshot-out (choose on two, test on the third):")
    for k, held in enumerate(names):
        ranked = sorted(rows, key=lambda r: (-min(s for j, s in enumerate(r[4]) if j != k),
                                             -sum(s for j, s in enumerate(r[4]) if j != k), -r[2],
                                             describe(r[3]), r[3].threshold))
        p, scores = ranked[0][3], ranked[0][4]
        print(f"  held out {held:<20} chosen {describe(p)} threshold {p.threshold:.3f} -> held-out ARI {scores[k]:.3f}")

    # Demo detail with the current PARAMS.
    demo = snapshots["demo"]
    result = cluster(make_cluster_tabs(demo["open_tabs"]), vectors["demo"], demo["snapshot_at"], params=PARAMS)
    label = {}
    for c in result.clusters:
        label.update(dict.fromkeys(c.tab_refs, c.label))
    for c in result.sprouts:
        label.update(dict.fromkeys(c.tab_refs, f"[sprout] {c.label}"))
    for s in result.meadow:
        label[s.tab_ref] = "[meadow]"
    for s in result.fog:
        label[s.tab_ref] = f"[fog] {s.reason}"
    primary = result.assignment()
    print(f"\ndemo with PARAMS (ARI {ari(result, demo['labels']):.3f}):")
    print(f"{'tab#':<5}| {'title':<46}| {'assigned cluster label':<44}| {'ground truth':<24}| ")
    truth_names = {"Backend Authentication": None, "GirlHacks Prep": None, "Job Search": None,
                   "Weeknight Dinner": None, "sprout": None}
    # map each ground-truth group to the predicted cluster holding most of its tabs
    for g in truth_names:
        ids = [primary[r] for r, t in demo["labels"].items() if t == g]
        truth_names[g] = max(set(ids), key=ids.count) if ids else None
    for t in demo["open_tabs"]:
        ref, truth = t["tab_ref"], demo["labels"][t["tab_ref"]]
        ok = (truth is None and primary[ref].startswith("single:")) or \
             (truth is not None and primary[ref] == truth_names[truth])
        shared = f" (+shared)" if ref in result.shared_tab_refs else ""
        print(f"{int(ref[-12:]):<5}| {t['title'][:45]:<46}| {(label[ref] + shared)[:43]:<44}| "
              f"{(truth or 'meadow/fog'):<24}| {'' if ok else 'MISMATCH'}")
    print(f"shared tabs: {result.shared_tab_refs or 'none'}")
    print(f"fog: {[(s.tab_ref[-2:], s.reason) for s in result.fog]}  meadow: {[s.tab_ref[-2:] for s in result.meadow]}")
    print(f"diagnostics: { {k: v for k, v in result.diagnostics.items() if k != 'params'} }")


if __name__ == "__main__":
    main()
