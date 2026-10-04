"""Deterministic cluster labels: top shared title terms (R-5, R-9 Seedling mode, the stream's
`clusters` line). One function, used by the engine and by scripts/gen_contracts.py."""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Iterable

STOPWORDS = {
    "a", "an", "and", "are", "for", "how", "in", "is", "it", "of", "on", "or", "the", "to", "vs", "what",
    "where", "with", "your", "you", "step", "guide", "explained", "easy", "free", "online", "small", "keep",
    "safe", "starting", "official", "job", "application", "at", "one",
}
SITE_SUFFIX = re.compile(r"\s+[-|–:]\s+.*$")


def title_terms(title: str) -> list[str]:
    """Normalize a title as in proposal §14 step 2 (strip site suffix, lowercase) and return its terms."""
    core = SITE_SUFFIX.sub("", title).lower()
    seen: list[str] = []
    for term in re.findall(r"[a-z][a-z0-9]+", core):
        if term not in STOPWORDS and len(term) > 2 and term not in seen:
            seen.append(term)
    return seen


def top_terms(titles: Iterable[str], k: int = 3) -> str:
    """Top shared title terms: most titles containing the term first, then first appearance."""
    order: list[str] = []
    counts: Counter = Counter()
    for title in titles:
        for term in title_terms(title):
            counts[term] += 1
            if term not in order:
                order.append(term)
    ranked = sorted(order, key=lambda t: (-counts[t], order.index(t)))
    return " · ".join(ranked[:k])
