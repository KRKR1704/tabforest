r"""Calibrate the semantic-redundancy threshold (audit fix 4) on fixtures/title_pairs.json.

Run from apps/api:
    .venv\Scripts\python app\engine\scripts\calibrate_redundancy.py

Embeds the tab titles exactly as the grove does ("{title} | {domain} | {source_type}", R-4 cache) under a calibration
user (rows deleted at the end) and measures the RAW cosine of every labeled pair. The rule only ever compares leaves of
the same leaf type, so only same-type pairs are scored: positives are the redundant pairs, negatives the related and
unrelated ones. Prints the cosine distribution per label, precision/recall/F1 per threshold, and the chosen threshold
(best F1; ties go to higher precision, then the higher threshold).
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from pathlib import Path
from uuid import UUID

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from app.engine import db  # noqa: E402
from app.engine.aoai import AzureOpenAIClient  # noqa: E402
from app.engine.embeddings import embed_tabs  # noqa: E402
from app.engine.fixtures import FIXTURES_DIR, _json  # noqa: E402
from app.engine.normalize import normalize_tab  # noqa: E402

CAL_USER = UUID("00000000-0000-4000-8000-0000000000f3")
NS = uuid.UUID("5d2c1e0a-7b4f-4a8e-9c3d-2f1e0d9c8b7a")


def load() -> dict:
    return _json(FIXTURES_DIR / "title_pairs.json")


def tab_ref(tab_id: str) -> str:
    return str(uuid.uuid5(NS, tab_id))


async def embed(tabs: list[dict]) -> dict[str, np.ndarray]:
    client, pool = AzureOpenAIClient(), await db.get_pool()
    try:
        normalized = [normalize_tab({"tab_ref": tab_ref(t["id"]), "domain": t["domain"], "title": t["title"]}) for t in tabs]
        vectors = (await embed_tabs(CAL_USER, normalized, pool, client=client)).vectors
        return {t["id"]: np.asarray(vectors[tab_ref(t["id"])], dtype=np.float64) for t in tabs}
    finally:
        if pool is not None:
            await pool.execute("DELETE FROM memory_embeddings WHERE user_id = $1", CAL_USER)
        await db.close_pool()
        await client.aclose()


def cosines(data: dict, vectors: dict[str, np.ndarray]) -> list[tuple[float, str, bool, str, str]]:
    """(cosine, label, same leaf type, title a, title b) for every pair."""
    tabs = {t["id"]: t for t in data["tabs"]}
    unit = {k: v / np.linalg.norm(v) for k, v in vectors.items()}
    return [(float(unit[p["a"]] @ unit[p["b"]]), p["label"], tabs[p["a"]]["leaf_type"] == tabs[p["b"]]["leaf_type"],
             tabs[p["a"]]["title"], tabs[p["b"]]["title"]) for p in data["pairs"]]


def scores(rows: list[tuple[float, str]], threshold: float) -> tuple[float, float, float, int, int]:
    tp = sum(c >= threshold and l == "redundant" for c, l in rows)
    fp = sum(c >= threshold and l != "redundant" for c, l in rows)
    fn = sum(c < threshold and l == "redundant" for c, l in rows)
    precision = tp / (tp + fp) if tp + fp else 1.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return precision, recall, f1, tp, fp


def choose(rows: list[tuple[float, str]]) -> float:
    grid = [round(0.40 + 0.01 * i, 2) for i in range(51)]  # 0.40 .. 0.90
    return max(grid, key=lambda t: (round(scores(rows, t)[2], 6), round(scores(rows, t)[0], 6), t))


def main() -> None:
    data = load()
    vectors = asyncio.run(embed(data["tabs"]))
    allrows = cosines(data, vectors)
    same = [(c, l) for c, l, ok, _, _ in allrows if ok]
    print(f"{len(data['tabs'])} tabs, {len(allrows)} labeled pairs, {len(same)} of the same leaf type (the only ones the rule compares)")
    print(f"\n{'label':<11}{'pairs':>6}{'min':>8}{'p10':>8}{'mean':>8}{'p90':>8}{'max':>8}   (same-type pairs, raw cosine)")
    for label in ("redundant", "related", "unrelated"):
        c = np.array([x for x, l in same if l == label])
        print(f"{label:<11}{len(c):>6}{c.min():>8.3f}{np.percentile(c, 10):>8.3f}{c.mean():>8.3f}{np.percentile(c, 90):>8.3f}{c.max():>8.3f}")
    chosen = choose(same)
    print(f"\n{'threshold':>10}{'precision':>11}{'recall':>8}{'F1':>7}{'TP':>5}{'FP':>5}")
    for t in sorted({0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, chosen}):
        p, r, f, tp, fp = scores(same, t)
        print(f"{t:>10.2f}{p:>11.3f}{r:>8.3f}{f:>7.3f}{tp:>5}{fp:>5}{'  <- chosen' if t == chosen else ''}")
    print(f"\nchosen threshold: {chosen:.2f}")
    above = sorted(((c, a, b) for c, l, ok, a, b in allrows if ok and l != "redundant" and c >= chosen), reverse=True)
    print(f"non-redundant same-type pairs at or above it: {len(above)}")
    for c, a, b in above[:6]:
        print(f"   {c:.3f}  {a[:46]!r} ~ {b[:46]!r}")
    below = sorted(((c, a, b) for c, l, ok, a, b in allrows if ok and l == "redundant" and c < chosen))
    print(f"redundant same-type pairs below it: {len(below)}")
    for c, a, b in below[:6]:
        print(f"   {c:.3f}  {a[:46]!r} ~ {b[:46]!r}")


if __name__ == "__main__":
    main()
