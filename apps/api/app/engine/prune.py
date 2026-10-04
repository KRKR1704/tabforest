"""R-13: prune suggestions. Suggest, never close (SPEC §3.5): the extension closes tabs only after an explicit click.

POST /api/tabs/prune-suggestions {tab_refs} reads the user's last stored grove and returns, for the requested tabs only:

- exact_duplicate     the same page open twice or more (the vine the grow run found from the device's dup_key);
- semantic_redundant  tabs in the same branch whose embedding similarity to the tab we keep is at least SIMILARITY_MIN; the keeper is
                      the strongest source (importance, then dwell) and the one-line reason is the model's, from grow;
- stale               any requested tab with no focus for 3+ days (stats.attention, measured at the time of the grove) that no
                      claim in the grove cites as evidence;
- distraction         any requested tab with under 10 s of total focus that no claim cites and that is not a search page,
                      in a tree or not (the meadow, the fog, the sprouts).

No model call is made here. Semantic suggestions are dropped, never guessed, when the embeddings cannot be read.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Awaitable, Callable, Iterable, Mapping, Sequence
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

import numpy as np
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from . import db
from .adapters.auth import get_user_id
from .adapters.stats import StatsSource, get_stats_source
from .embeddings import embed_texts, tab_embedding_text
from .features import DISTRACTION_MS, STALE_AFTER
from .normalize import normalize_tab
from .persist import last_grove
from .redundancy import MIN_SHARED_TERMS, SEMANTIC_VINE_THRESHOLD, shared_distinctive_terms
from .schemas.prune import PruneRequest, PruneResponse

log = logging.getLogger("tabforest.engine.prune")
router = APIRouter()

# BUILD_TASKS R-13 says 0.90, but measured on the demo tabs with the deployed embedding model (title | domain | type),
# the contract's redundant pair scores 0.60 and 0.64 against its keeper (0.74 with each other) and two different
# articles on the same topic never reach 0.90. At 0.90 only an exact duplicate would pass, so the semantic suggestion
# could never appear. 0.55 stays above unrelated tabs (0.2 to 0.5) and below the real pair; which tabs are
# redundant is still grow's call (same branch, model-written reason). To be confirmed by R's calibration (R-12).
SIMILARITY_MIN = 0.55
NOTE = "Suggestions only. The extension closes tabs only after an explicit click."
ACTIONS = [
    {"id": "keep_all", "label": "Keep all"},
    {"id": "close_selected", "label": "Close selected"},
    {"id": "save_as_references", "label": "Save as references"},
    {"id": "prune_branch", "label": "Prune branch"},
]

Embed = Callable[[Sequence[tuple[str, str]]], Awaitable[Mapping[str, np.ndarray]]]


def _leaves(grove: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    """tab_ref -> its leaf plus where it sits. A tab in two trees keeps the place with the higher importance."""
    found: dict[str, dict[str, Any]] = {}
    for tree in grove.get("trees", []):
        for branch_no, branch in enumerate(tree.get("branches", [])):
            for leaf in branch.get("leaves", []):
                here = {**leaf, "branch": (tree.get("project_id"), branch_no)}
                old = found.get(leaf["tab_ref"])
                if old is None or leaf.get("importance", 0) > old.get("importance", 0):
                    found[leaf["tab_ref"]] = here
    return found


def _strength(leaf: Mapping[str, Any]) -> tuple[float, float]:
    return (leaf.get("importance", 0.0), leaf.get("dwell_min", 0.0))


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = float(np.linalg.norm(a)), float(np.linalg.norm(b))
    return float(a @ b) / (na * nb) if na and nb else 0.0


def _vines(grove: Mapping[str, Any], kind: str) -> list[dict[str, Any]]:
    seen: set[frozenset[str]] = set()
    out = []
    for tree in grove.get("trees", []):
        for vine in tree.get("vines", []):
            key = frozenset(vine.get("tab_refs", []))
            if vine.get("kind") == kind and key not in seen:
                seen.add(key)
                out.append(vine)
    return out


def exact_duplicates(grove: Mapping[str, Any], wanted: set[str],
                     leaves: Mapping[str, Mapping[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for vine in _vines(grove, "exact"):
        refs = [r for r in vine["tab_refs"] if r in wanted]
        if len(refs) < 2:
            continue
        keep = vine.get("keep_ref")
        if keep not in refs:
            keep = max(refs, key=lambda r: (_strength(leaves[r]) if r in leaves else (0.0, 0.0), r))
        out.append({"kind": "exact_duplicate", "tab_refs": refs, "keep_ref": keep,
                    "reason": vine.get("reason") or "Same page open twice", "default_selected": True})
    return out


def _says_the_same(ref: str, group: Sequence[str], vectors: Mapping[str, np.ndarray],
                   leaves: Mapping[str, Mapping[str, Any]]) -> bool:
    """The model proposed this tab as redundant; keep it only if some other tab of the group (the keeper or a fellow
    member) is at least SEMANTIC_VINE_THRESHOLD close AND shares MIN_SHARED_TERMS distinctive title terms with it.
    The keeper check (SIMILARITY_MIN) stays separate: an official page is a looser keeper than a peer (as in
    redundancy.py), so the demo's two JWT articles (0.60 and 0.64 to the docs, 0.74 to each other) still qualify."""
    mine = leaves[ref]
    return any(other != ref
               and _cosine(vectors[ref], vectors[other]) >= SEMANTIC_VINE_THRESHOLD
               and len(shared_distinctive_terms(mine["title"], mine["source_type"], leaves[other]["title"],
                                                leaves[other]["source_type"])) >= MIN_SHARED_TERMS
               for other in group)


async def semantic_redundant(grove: Mapping[str, Any], wanted: set[str], leaves: Mapping[str, Mapping[str, Any]],
                             embed: Embed, taken: set[frozenset[str]]) -> list[dict[str, Any]]:
    candidates = []
    for vine in _vines(grove, "semantic"):
        members = [r for r in vine["tab_refs"] if r in wanted and r in leaves]
        keep = vine.get("keep_ref")
        if keep not in leaves or keep not in wanted:
            continue  # the keeper must be a tab we can see and the user asked about
        same_branch = [r for r in members if leaves[r]["branch"] == leaves[keep]["branch"] and r != keep]
        if same_branch:
            candidates.append((vine, same_branch, keep))
    if not candidates:
        return []
    needed = sorted({r for _, members, keep in candidates for r in (*members, keep)})
    try:
        vectors = await embed([(r, tab_embedding_text(normalize_tab(
            {"tab_ref": r, "domain": leaves[r]["domain"], "title": leaves[r]["title"]}))) for r in needed])
    except Exception:  # noqa: BLE001 - any failure means we cannot verify similarity, so we do not suggest
        log.warning("prune: embeddings unavailable; semantic suggestions skipped", exc_info=True)
        return []
    out = []
    for vine, members, keep in candidates:
        similar = [r for r in members if _cosine(vectors[r], vectors[keep]) >= SIMILARITY_MIN
                   and _says_the_same(r, [keep, *members], vectors, leaves)]
        if not similar or frozenset(similar) in taken:
            continue
        refs = ([keep] if keep in vine["tab_refs"] else []) + similar
        out.append({"kind": "semantic_redundant", "tab_refs": refs, "keep_ref": keep,
                    "reason": vine.get("reason") or "These tabs say the same thing", "default_selected": True})
    return out


def cited_tabs(grove: Mapping[str, Any]) -> set[str]:
    """Every tab some claim of the grove cites as evidence (goal, direction, stones, mushrooms, actions, hypotheses)."""
    out: set[str] = set()
    for tree in grove.get("trees", []):
        claims = [tree.get("goal"), tree.get("direction"), *tree.get("stones", []), *tree.get("mushrooms", []),
                  *tree.get("next_actions", []), *tree.get("hypotheses", [])]
        out |= {e["ref"] for c in claims if c for e in c.get("evidence", []) if e.get("ref_kind") == "tab"}
    return out


def known_tabs(grove: Mapping[str, Any], leaves: Mapping[str, Mapping[str, Any]]) -> list[str]:
    """Every tab the grove knows, in a fixed order: tree leaves, sprouts, the meadow, the fog."""
    order = [*leaves, *(r for s in grove.get("sprouts", []) for r in s.get("tab_refs", [])),
             *grove.get("meadow", []), *(f["tab_ref"] for f in grove.get("fog", []))]
    return list(dict.fromkeys(order))


def reference_time(grove: Mapping[str, Any]) -> datetime:
    """When the grove was made: stale means "3 days before that", not before whenever the request arrives."""
    stamp = grove.get("generated_at")
    try:
        return datetime.fromisoformat(str(stamp).replace("Z", "+00:00")) if stamp else datetime.now(timezone.utc)
    except ValueError:
        return datetime.now(timezone.utc)


async def stale(grove: Mapping[str, Any], wanted: set[str], leaves: Mapping[str, Mapping[str, Any]], user_id: UUID,
                stats: StatsSource, now: datetime) -> list[dict[str, Any]]:
    refs = [r for r in known_tabs(grove, leaves) if r in wanted]
    if not refs:
        return []
    cited = cited_tabs(grove)
    attention = await stats.attention(user_id, set(refs))
    old = [(attention[r].last_focus, r) for r in refs
           if r not in cited and r in attention and attention[r].last_focus and now - attention[r].last_focus >= STALE_AFTER]
    if not old:
        return []
    return [{"kind": "stale", "tab_refs": [r for _, r in sorted(old)], "keep_ref": None,
             "reason": "No focus for 3 days or more and not used as evidence", "default_selected": False}]


async def distractions(grove: Mapping[str, Any], wanted: set[str], leaves: Mapping[str, Mapping[str, Any]],
                       user_id: UUID, stats: StatsSource) -> list[dict[str, Any]]:
    cited = cited_tabs(grove)
    candidates = [r for r in known_tabs(grove, leaves)
                  if r in wanted and r not in cited and leaves.get(r, {}).get("source_type") != "search"]
    if not candidates:
        return []
    attention = await stats.attention(user_id, set(candidates))
    out = []
    for ref in candidates:
        ms = attention[ref].active_ms if ref in attention else 0
        if ms < DISTRACTION_MS:
            out.append({"kind": "distraction", "tab_refs": [ref], "keep_ref": None,
                        "reason": f"{ms // 1000} s of focus, unrelated to any goal", "default_selected": False})
    return out


async def build_suggestions(user_id: UUID, tab_refs: Iterable[str], grove: Mapping[str, Any] | None, *, embed: Embed,
                            stats: StatsSource, new_id: Callable[[], str] | None = None,
                            now: datetime | None = None) -> dict[str, Any]:
    wanted = set(tab_refs)
    new_id = new_id or (lambda: str(uuid.uuid4()))
    found: list[dict[str, Any]] = []
    if grove:
        leaves = _leaves(grove)
        found += exact_duplicates(grove, wanted, leaves)
        # A tab already in an exact group is not suggested twice as redundant.
        taken = {frozenset(s["tab_refs"]) for s in found}
        found += await semantic_redundant(grove, wanted, leaves, embed, taken)
        found += await stale(grove, wanted, leaves, user_id, stats, now or reference_time(grove))
        found += await distractions(grove, wanted, leaves, user_id, stats)
    response = PruneResponse.model_validate({
        "suggestions": [{"id": f"pr_{new_id()}", **s} for s in found], "actions": ACTIONS, "note": NOTE})
    return response.model_dump(mode="json")


def _default_embed(user_id: UUID, pool: Any) -> Embed:
    async def embed(items: Sequence[tuple[str, str]]) -> Mapping[str, np.ndarray]:
        return (await embed_texts(user_id, "tab", list(items), pool)).vectors
    return embed


@router.post("/tabs/prune-suggestions", response_model=None)
async def prune_suggestions(body: PruneRequest, user_id: UUID = Depends(get_user_id)) -> Any:
    """Suggestions for the requested tabs from the user's last grove. An empty list when there is no grove yet."""
    pool = await db.get_pool()
    grove = await last_grove(pool, user_id) if pool is not None else None
    return JSONResponse(await build_suggestions(user_id, body.tab_refs, grove, embed=_default_embed(user_id, pool),
                                                stats=get_stats_source(pool)))
