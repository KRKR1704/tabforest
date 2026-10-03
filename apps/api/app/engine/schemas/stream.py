"""POST /api/grove/grow?stream=1 NDJSON lines (BUILD_TASKS.md §4.7,
contracts/grove.stream.example.ndjson): clusters -> tree x n -> done."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field, TypeAdapter

from .common import Strict
from .grove import Firefly, FogItem, Sprout, Tree


class Cluster(Strict):
    """Deterministic cluster, sent before any model call; the name is the top shared title terms."""

    project_id: str
    name: str
    tab_refs: list[str]
    attention_min: int
    days_since_active: int
    canopy: Literal["green", "amber"]


class ClustersLine(Strict):
    type: Literal["clusters"]
    run_id: str
    hollow_count: int
    clusters: list[Cluster]
    sprouts: list[Sprout]
    meadow: list[str]
    fog: list[FogItem]


class TreeLine(Tree):
    type: Literal["tree"]


class DoneLine(Strict):
    type: Literal["done"]
    run_id: str
    degraded: bool
    fireflies: list[Firefly]


StreamLine = Annotated[ClustersLine | TreeLine | DoneLine, Field(discriminator="type")]
stream_line_adapter: TypeAdapter[ClustersLine | TreeLine | DoneLine] = TypeAdapter(StreamLine)
