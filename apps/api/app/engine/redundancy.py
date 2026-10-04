"""Deterministic semantic vines (audit fix 4, proposal §3.5): tabs that say the same thing, found by code.

The model's `redundant_groups` rarely fire (0 of 3 live runs on the demo), so R-13's prune suggestions never saw
a semantic group. This adds them without the model: leaves in the SAME branch with the SAME leaf type whose raw
embedding cosine is at least SEMANTIC_VINE_THRESHOLD form a group.

Why the rule has three parts (measured on fixtures/title_pairs.json, scripts/calibrate_redundancy.py):
- same leaf type: the official docs and the GitHub example score 0.60 on the demo, as high as the redundant pair, so
  cosine alone cannot tell "same ground" from "same topic"; leaf type can (docs vs code vs article vs Q&A);
- same branch: the model already decided they belong together;
- the cosine bar, 0.66, is the best F1 on 28 redundant against 250 related and unrelated same-type pairs.
The keeper is the official page (docs of the vendor or project) of the branch when it is close enough to the group,
else the highest-importance tab of the group. Prune's gate on the model's own groups is stricter than the old 0.55: a tab
must be SEMANTIC_VINE_THRESHOLD close to another tab of its group AND share MIN_SHARED_TERMS distinctive title terms
with it (prune._says_the_same); the keeper floor (SIMILARITY_MIN, 0.55) stays.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np

from .features import ClusterFeatures
from .labels import title_terms

# Best F1 of scripts/calibrate_redundancy.py on 65 labeled titles (278 same-type pairs, 28 of them redundant):
# precision 0.885, recall 0.821, F1 0.852 at 0.66. The demo's two redundant JWT articles score 0.744.
SEMANTIC_VINE_THRESHOLD = 0.66
# A keeper outside the group must be at least this close to every member. Equal to prune.SIMILARITY_MIN, which
# checks the same thing again at suggestion time (a test keeps them equal).
KEEPER_MIN_COSINE = 0.55
NEVER_COMPARED = frozenset({"search"})  # a search page is a step in a research path, not a page that duplicates another
# Two pages say the same thing only if their titles also share this many DISTINCTIVE terms (live finding: Chickpea
# Curry, Hummus and a second curry share "recipe"-ish embedding mass but no subject).
MIN_SHARED_TERMS = 2
# Words that name the kind of page or pad a title; they never count as shared subject matter. The leaf's own type word
# (docs, article, ...) is dropped on top of these.
GENERIC_TERMS = frozenset({
    "docs", "doc", "documentation", "guide", "tutorial", "tutorials", "article", "blog", "post", "code", "example",
    "examples", "recipe", "recipes", "overview", "introduction", "beginner", "beginners", "complete", "practical",
    "quick", "simple", "basic", "basics", "minutes", "review", "reviews", "comparison", "classic", "homemade", "page",
})


def _plain(term: str) -> str:
    return term[:-1] if len(term) > 4 and term.endswith("s") and not term.endswith(("ss", "us", "is")) else term


def distinctive_terms(title: str, source_type: str = "") -> frozenset[str]:
    """Title terms that carry the subject: no stopwords, no site suffix, no page-kind words, no leaf type word."""
    drop = {_plain(t) for t in GENERIC_TERMS} | {_plain(source_type.lower())}
    return frozenset(t for t in map(_plain, title_terms(title)) if t not in drop)


def shared_distinctive_terms(title_a: str, type_a: str, title_b: str, type_b: str) -> frozenset[str]:
    return distinctive_terms(title_a, type_a) & distinctive_terms(title_b, type_b)


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = float(np.linalg.norm(a)), float(np.linalg.norm(b))
    return float(np.dot(a, b)) / (na * nb) if na and nb else 0.0


def _components(refs: Sequence[str], vectors: Mapping[str, np.ndarray], threshold: float) -> list[list[str]]:
    """Single-linkage groups of refs whose cosine to some member is at least `threshold`; input order kept."""
    parent = {r: r for r in refs}

    def find(r: str) -> str:
        while parent[r] != r:
            parent[r] = parent[parent[r]]
            r = parent[r]
        return r

    for i, a in enumerate(refs):
        for b in refs[i + 1:]:
            if cosine(vectors[a], vectors[b]) >= threshold:
                parent[find(b)] = find(a)
    groups: dict[str, list[str]] = {}
    for r in refs:
        groups.setdefault(find(r), []).append(r)
    return [g for g in groups.values() if len(g) >= 2]


def semantic_vines(branches: Sequence[Mapping[str, Any]], features: ClusterFeatures, vectors: Mapping[str, np.ndarray],
                   importance: Mapping[str, float], *, taken: Sequence[set[str]] = (), skip: set[str] = frozenset(),
                   threshold: float = SEMANTIC_VINE_THRESHOLD) -> list[dict[str, Any]]:
    """Semantic vines (the grove's Vine shape) for a tree's branches.

    taken: tab sets already covered by a vine (exact duplicates, the model's groups); a group inside one is skipped.
    skip: tabs not compared (the extra copies of an exact duplicate)."""
    out: list[dict[str, Any]] = []
    for branch in branches:
        leaves = [leaf for leaf in branch["leaves"] if leaf["tab_ref"] in vectors]
        by_type: dict[str, list[str]] = {}
        for leaf in leaves:
            if leaf["source_type"] not in NEVER_COMPARED and leaf["tab_ref"] not in skip:
                by_type.setdefault(leaf["source_type"], []).append(leaf["tab_ref"])
        for refs in by_type.values():
            for group in _components(refs, vectors, threshold):
                if any(set(group) <= t for t in taken):
                    continue
                official = [r for r in (leaf["tab_ref"] for leaf in leaves)
                            if r not in group and r in features.tabs and features.tabs[r].official
                            and features.tabs[r].source_type not in NEVER_COMPARED
                            and all(cosine(vectors[r], vectors[m]) >= KEEPER_MIN_COSINE for m in group)]
                if official:
                    keep = max(official, key=lambda r: (importance.get(r, 0.0), r))
                    reason = f"These pages cover the same ground as the official docs: {features.tabs[keep].title[:70]}"
                else:
                    keep = max(group, key=lambda r: (features.tabs[r].official, importance.get(r, 0.0), r))
                    reason = ("These pages cover the same ground; the official one is kept"
                              if features.tabs[keep].official else
                              "These pages cover the same ground; the most-used one is kept")
                out.append({"tab_refs": list(group), "kind": "semantic", "keep_ref": keep, "reason": reason})
                taken = [*taken, set(group)]
    return out
