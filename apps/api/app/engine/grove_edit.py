"""Edits of the stored grove (analysis_runs.response) for R-10's mutations (proposal §17, §27).

Pure functions on the GroveResponse dict. Every mutation that changes a claim, a tab's tree or a
tree's goal also changes the stored grove in the same transaction, so GET /api/grove reflects it
at once. Claims live in six slots of a tree: goal, direction, stones, mushrooms, next_actions,
hypotheses.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

LIST_SLOTS = ("stones", "mushrooms", "next_actions", "hypotheses")


def find_claim(grove: dict[str, Any], api_id: str) -> tuple[dict[str, Any], str, int | None] | None:
    """(tree, slot, index) of the claim with this api id, or None."""
    for tree in grove.get("trees", []):
        if tree["goal"]["id"] == api_id:
            return tree, "goal", None
        if tree.get("direction") and tree["direction"]["id"] == api_id:
            return tree, "direction", None
        for slot in LIST_SLOTS:
            for i, claim in enumerate(tree[slot]):
                if claim["id"] == api_id:
                    return tree, slot, i
    return None


def remove_claim(tree: dict[str, Any], slot: str, index: int | None) -> None:
    if slot == "direction":
        tree["direction"] = None
    elif slot in LIST_SLOTS and index is not None:
        del tree[slot][index]
    else:
        raise ValueError(f"a {slot} cannot be removed")


def place_claim(tree: dict[str, Any], old: tuple[str, int | None], home: str, claim: dict[str, Any]) -> None:
    """Put `claim` in slot `home` of `tree`, taking the place of the claim at `old` (slot, index).
    Same slot: replaced in place. Other slot: removed from the old one and added to the new one
    (carved stones go first)."""
    slot, index = old
    if home == "goal":
        tree["goal"] = claim
        return
    if slot == home and home in LIST_SLOTS and index is not None:
        tree[home][index] = claim
        return
    if slot == home == "direction":
        tree["direction"] = claim
        return
    if slot not in ("goal",):
        remove_claim(tree, slot, index)
    if home == "direction":
        tree["direction"] = claim
    elif home == "stones" and claim.get("kind") == "carved":
        tree["stones"].insert(0, claim)
    else:
        tree[home].append(claim)


def iter_leaves(tree: dict[str, Any]) -> Iterator[tuple[dict[str, Any], dict[str, Any]]]:
    for branch in tree["branches"]:
        for leaf in branch["leaves"]:
            yield branch, leaf


def find_leaf(grove: dict[str, Any], tab_ref: str) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]] | None:
    """(tree, branch, leaf) of a tab placed in a tree."""
    for tree in grove.get("trees", []):
        for branch, leaf in iter_leaves(tree):
            if leaf["tab_ref"] == tab_ref:
                return tree, branch, leaf
    return None


def tab_in_grove(grove: dict[str, Any], tab_ref: str) -> bool:
    return (find_leaf(grove, tab_ref) is not None or tab_ref in grove.get("meadow", [])
            or any(f["tab_ref"] == tab_ref for f in grove.get("fog", []))
            or any(tab_ref in s["tab_refs"] for s in grove.get("sprouts", [])))


def take_tab(grove: dict[str, Any], tab_ref: str) -> dict[str, Any] | None:
    """Remove the tab from wherever it is (a tree leaf, a sprout, the meadow or the fog); returns its leaf
    if it was one. A tree left without leaves is dropped from the grove."""
    leaf = None
    found = find_leaf(grove, tab_ref)
    if found:
        tree, branch, leaf = found
        branch["leaves"] = [l for l in branch["leaves"] if l["tab_ref"] != tab_ref]
        tree["branches"] = [b for b in tree["branches"] if b["leaves"]]
        tree["important_tab_refs"] = [r for r in tree["important_tab_refs"] if r != tab_ref]
        tree["shared_tab_refs"] = [r for r in tree["shared_tab_refs"] if r != tab_ref]
        for fam in tree["query_families"]:
            fam["tab_refs"] = [r for r in fam["tab_refs"] if r != tab_ref]
        for vine in tree["vines"]:
            vine["tab_refs"] = [r for r in vine["tab_refs"] if r != tab_ref]
        tree["vines"] = [v for v in tree["vines"] if len(v["tab_refs"]) >= 2 and v["keep_ref"] != tab_ref]
        if not tree["branches"]:
            grove["trees"] = [t for t in grove["trees"] if t is not tree]
    grove["meadow"] = [r for r in grove.get("meadow", []) if r != tab_ref]
    grove["fog"] = [f for f in grove.get("fog", []) if f["tab_ref"] != tab_ref]
    for sprout in grove.get("sprouts", []):
        sprout["tab_refs"] = [r for r in sprout["tab_refs"] if r != tab_ref]
    grove["sprouts"] = [s for s in grove.get("sprouts", []) if s["tab_refs"]]
    return leaf


def add_leaf(tree: dict[str, Any], leaf: dict[str, Any], branch_label: str | None) -> str | None:
    """Add a leaf to a tree's branch (created, as "explored", when new); without a label it joins "Other"
    (or the only branch). Returns the branch label used."""
    label = branch_label
    if label is None:
        label = "Other" if len(tree["branches"]) != 1 else tree["branches"][0]["label"]
    for branch in tree["branches"]:
        if branch["label"].lower() == label.lower():
            branch["leaves"].append(leaf)
            return branch["label"]
    tree["branches"].append({"label": label, "status": "explored", "leaves": [leaf]})
    return label


def find_tree(grove: dict[str, Any], project_api_id: str) -> dict[str, Any] | None:
    return next((t for t in grove.get("trees", []) if t["project_id"] == project_api_id), None)


def replace_tree(grove: dict[str, Any], tree: dict[str, Any]) -> bool:
    for i, old in enumerate(grove.get("trees", [])):
        if old["project_id"] == tree["project_id"]:
            grove["trees"][i] = tree
            return True
    return False
