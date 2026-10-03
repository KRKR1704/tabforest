"""Loaders for the engine's own fixtures and for the shared contracts/ examples."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

FIXTURES_DIR = Path(__file__).resolve().parent
SAMPLE_DOCS_DIR = FIXTURES_DIR / "sample_docs"
CONTRACTS_DIR = FIXTURES_DIR.parents[4] / "contracts"


def _json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache
def load_demo_tabs() -> dict[str, Any]:
    """The 28-tab open snapshot (§4.2 format): {about, snapshot_at, open_tabs}."""
    return _json(FIXTURES_DIR / "demo_tabs.json")


@lru_cache
def load_events() -> dict[str, Any]:
    """Events for the demo tabs as R reads them from P's table (C11), incl. session_id."""
    return _json(FIXTURES_DIR / "events_2h.json")


@lru_cache
def load_user_notes() -> list[dict[str, Any]]:
    return _json(FIXTURES_DIR / "user_notes.json")["notes"]


def load_sample_doc(name: str) -> str:
    return (SAMPLE_DOCS_DIR / name).read_text(encoding="utf-8")


def load_expected() -> dict[str, Any]:
    """Answer key for the SAMPLE enterprise docs (R-11)."""
    return _json(SAMPLE_DOCS_DIR / "EXPECTED.json")


def list_contracts() -> list[str]:
    return sorted(p.name for p in CONTRACTS_DIR.iterdir() if p.suffix in (".json", ".ndjson"))


def load_contract(name: str) -> Any:
    """A contracts/ example by file name. NDJSON files return a list of parsed lines."""
    path = CONTRACTS_DIR / name
    if path.suffix == ".ndjson":
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    return _json(path)
