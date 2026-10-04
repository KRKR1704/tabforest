r"""Calibrate the query-family threshold (R-6) on fixtures/query_pairs.json.

Run from apps/api:
    .venv\Scripts\python app\engine\scripts\calibrate_queries.py

Embeds the queries with the R-4 cache under a calibration user (rows deleted at the end),
prints the raw cosine distribution per label, and chooses the threshold that maximizes F1 for
"rephrase" (same intent) against everything else; also reports the plan's 0.80.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from uuid import UUID

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from app.engine import db  # noqa: E402
from app.engine.aoai import AzureOpenAIClient  # noqa: E402
from app.engine.embeddings import embed_queries  # noqa: E402
from app.engine.fixtures import FIXTURES_DIR, _json  # noqa: E402

CAL_USER = UUID("00000000-0000-4000-8000-0000000000e1")


def load_pairs() -> dict:
    return _json(FIXTURES_DIR / "query_pairs.json")


async def embed(texts: list[str]) -> dict[str, np.ndarray]:
    client, pool = AzureOpenAIClient(), await db.get_pool()
    try:
        return (await embed_queries(CAL_USER, texts, pool, client=client)).vectors
    finally:
        if pool is not None:
            await pool.execute("DELETE FROM memory_embeddings WHERE user_id = $1", CAL_USER)
        await db.close_pool()
        await client.aclose()


def pair_cosines(data: dict, vectors: dict[str, np.ndarray]) -> list[tuple[float, str]]:
    def unit(v):
        return v / np.linalg.norm(v)
    texts = [q["text"] for q in data["queries"]]
    return [(float(unit(vectors[texts[p["a"]]]) @ unit(vectors[texts[p["b"]]])), p["label"]) for p in data["pairs"]]


def scores(cosines: list[tuple[float, str]], threshold: float) -> tuple[float, float, float]:
    tp = sum(c >= threshold and label == "rephrase" for c, label in cosines)
    fp = sum(c >= threshold and label != "rephrase" for c, label in cosines)
    fn = sum(c < threshold and label == "rephrase" for c, label in cosines)
    precision = tp / (tp + fp) if tp + fp else 1.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return precision, recall, f1


def choose(cosines: list[tuple[float, str]]) -> float:
    grid = [round(0.30 + 0.01 * i, 2) for i in range(61)]  # 0.30 .. 0.90
    return max(grid, key=lambda t: (scores(cosines, t)[2], scores(cosines, t)[0], t))


def main() -> None:
    data = load_pairs()
    vectors = asyncio.run(embed([q["text"] for q in data["queries"]]))
    cosines = pair_cosines(data, vectors)
    print(f"{len(data['queries'])} queries, {len(cosines)} pairs")
    print(f"{'label':<10}{'pairs':>6}{'min':>8}{'p10':>8}{'mean':>8}{'p90':>8}{'max':>8}")
    for label in ("rephrase", "related", "unrelated"):
        c = np.array([x for x, l in cosines if l == label])
        print(f"{label:<10}{len(c):>6}{c.min():>8.3f}{np.percentile(c, 10):>8.3f}{c.mean():>8.3f}"
              f"{np.percentile(c, 90):>8.3f}{c.max():>8.3f}")
    print(f"\n{'threshold':>10}{'precision':>11}{'recall':>8}{'F1':>7}")
    chosen = choose(cosines)
    for t in sorted({0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, chosen}):
        p, r, f = scores(cosines, t)
        mark = "  <- chosen" if t == chosen else ("  <- plan" if t == 0.80 else "")
        print(f"{t:>10.2f}{p:>11.3f}{r:>8.3f}{f:>7.3f}{mark}")
    related_above = sorted((c for c, l in cosines if l == "related" and c >= chosen), reverse=True)
    print(f"\nchosen threshold: {chosen:.2f}; related pairs at or above it: {len(related_above)} "
          f"{[round(c, 3) for c in related_above[:5]]}")


if __name__ == "__main__":
    main()
