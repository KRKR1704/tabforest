"""Clustering evaluation against hand labels (R-5 calibration, R-16 metrics)."""

from __future__ import annotations

from typing import Any

from sklearn.metrics import adjusted_rand_score

from .cluster import ClusterResult
from .fixtures import FIXTURES_DIR, _json, load_contract, load_demo_tabs

SNAPSHOT_NAMES = ("demo", "trip_laptops_thesis", "nextjs_k8s_gift")


def demo_ground_truth() -> dict[str, str | None]:
    """Demo membership from contracts/grove.example.json: tree name per tab (a tab shared by two
    trees counts for the first tree that lists it), 'sprout' for sprout tabs, None for meadow/fog."""
    grove = load_contract("grove.example.json")
    truth: dict[str, str | None] = {}
    for tree in grove["trees"]:
        for branch in tree["branches"]:
            for leaf in branch["leaves"]:
                truth.setdefault(leaf["tab_ref"], tree["name"])
    for sprout in grove["sprouts"]:
        truth.update(dict.fromkeys(sprout["tab_refs"], "sprout"))
    truth.update(dict.fromkeys(grove["meadow"], None))
    truth.update({f["tab_ref"]: None for f in grove["fog"]})
    return truth


def load_labeled_snapshot(name: str) -> dict[str, Any]:
    """{snapshot_at, open_tabs, labels} for 'demo' or a fixtures/cluster_snapshots/ file."""
    if name == "demo":
        demo = load_demo_tabs()
        return {"snapshot_at": demo["snapshot_at"], "open_tabs": demo["open_tabs"], "labels": demo_ground_truth()}
    return _json(FIXTURES_DIR / "cluster_snapshots" / f"{name}.json")


def ari(result: ClusterResult, labels: dict[str, str | None]) -> float:
    """Adjusted Rand index; tabs labeled None (no group) and predicted singletons are their own group."""
    predicted = result.assignment()
    refs = sorted(labels)
    truth = [labels[r] if labels[r] is not None else f"single:{r}" for r in refs]
    return float(adjusted_rand_score(truth, [predicted[r] for r in refs]))
