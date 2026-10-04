"""Switch classification at query time (BUILD_TASKS §4.6, SPEC §8.5).

Ingest stores only facts (previous_tab_ref, is_tab_switch). Whether a switch also changed intent
depends on R's clusters, which change when the user reassigns a leaf, so it is decided here, on
read, from the current cluster membership (C12). A tab with no cluster is "unassigned": never
guessed from its domain.
"""

from __future__ import annotations

from collections.abc import Mapping, Set
from uuid import UUID

SAME = "same"            # a tab switch only
INTENT = "intent"
UNASSIGNED = "unassigned"

Membership = Mapping[UUID, Set[UUID]]   # tab_ref -> cluster ids


def session_kind(prev: UUID, cur: UUID, clusters_of: Membership) -> str:
    """A switch inside a session: intent when the two tabs share no cluster (X11)."""
    a, b = clusters_of.get(prev), clusters_of.get(cur)
    if not a or not b:
        return UNASSIGNED
    return SAME if a & b else INTENT


def project_kind(other: UUID, project_clusters: Set[UUID], clusters_of: Membership) -> str:
    """A switch that enters or leaves a project's tabs, seen from that project: the other tab is
    unassigned, in the project too (same), or in a cluster that is not the project's (intent)."""
    theirs = clusters_of.get(other)
    if not theirs:
        return UNASSIGNED
    return SAME if theirs & project_clusters else INTENT
