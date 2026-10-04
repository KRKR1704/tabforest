r"""Calibrate the research-memory search threshold (R-12) on fixtures/memory_set.json.

Run from apps/api:
    .venv\Scripts\python app\engine\scripts\calibrate_memory.py

Embeds the insight summaries (kind 'insight') and the queries (kind 'query') with the R-4 cache under a calibration user
(rows deleted at the end) and measures the RAW cosine of every query against every insight. Search returns the best
insight when its score reaches the threshold, so the decision is per query: a RELEVANT query is a true positive when its
best insight is one of its relevant ones and the score reaches the threshold; a related-but-different or unrelated query
that still gets a hit, or a relevant query whose best insight is the wrong one, is a false positive. Prints the
distribution, precision/recall/F1 per threshold for plain cosine and for the hybrid score
(cosine + alpha * share of the query's content terms that the summary contains), and the chosen threshold.
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
from app.engine.carry import claim_terms  # noqa: E402
from app.engine.embeddings import embed_queries, embed_texts  # noqa: E402
from app.engine.fixtures import FIXTURES_DIR, _json  # noqa: E402

CAL_USER = UUID("00000000-0000-4000-8000-0000000000f6")
HYBRID_ALPHAS = (0.05, 0.10, 0.15, 0.20, 0.30, 0.40)
HYBRID_ADOPT_GAIN = 0.05  # adopt the hybrid only if it beats plain cosine by at least this much F1


def load() -> dict:
    return _json(FIXTURES_DIR / "memory_set.json")


async def embed(data: dict) -> tuple[dict[str, np.ndarray], dict[str, np.ndarray]]:
    client, pool = AzureOpenAIClient(), await db.get_pool()
    try:
        ins = (await embed_texts(CAL_USER, "insight", [(i["id"], i["summary"]) for i in data["insights"]], pool,
                                 client=client)).vectors
        qs = (await embed_queries(CAL_USER, [q["text"] for q in data["queries"]], pool, client=client)).vectors
        return ({k: np.asarray(v, dtype=np.float64) for k, v in ins.items()},
                {k: np.asarray(v, dtype=np.float64) for k, v in qs.items()})
    finally:
        if pool is not None:
            await pool.execute("DELETE FROM memory_embeddings WHERE user_id = $1", CAL_USER)
        await db.close_pool()
        await client.aclose()


def coverage(query: str, summary: str) -> float:
    q = claim_terms(query)
    return len(q & claim_terms(summary)) / len(q) if q else 0.0


def scores(data: dict, ins: dict, qs: dict) -> list[dict]:
    """Per query: its label, relevant ids, and for every insight the cosine and the keyword coverage."""
    unit = {k: v / np.linalg.norm(v) for k, v in {**{("i", k): v for k, v in ins.items()}}.items()}
    summaries = {i["id"]: i["summary"] for i in data["insights"]}
    out = []
    for q in data["queries"]:
        qv = qs[q["text"]] / np.linalg.norm(qs[q["text"]])
        out.append({**q, "cos": {i: float(qv @ unit[("i", i)]) for i in summaries},
                    "cov": {i: coverage(q["text"], s) for i, s in summaries.items()}})
    return out


def evaluate(rows: list[dict], threshold: float, alpha: float = 0.0) -> tuple[float, float, float, int, int]:
    """precision, recall, F1, TP, FP at a threshold, for score = cosine + alpha * coverage."""
    tp = fp = 0
    n_rel = sum(r["label"] == "relevant" for r in rows)
    for r in rows:
        score = {i: r["cos"][i] + alpha * r["cov"][i] for i in r["cos"]}
        best = max(score, key=score.get)
        if score[best] < threshold:
            continue
        if r["label"] == "relevant" and best in r["relevant"]:
            tp += 1
        else:
            fp += 1
    precision = tp / (tp + fp) if tp + fp else 1.0
    recall = tp / n_rel if n_rel else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return precision, recall, f1, tp, fp


def choose(rows: list[dict], alpha: float = 0.0) -> float:
    grid = [round(0.10 + 0.01 * i, 2) for i in range(90)]  # 0.10 .. 0.99
    return max(grid, key=lambda t: (round(evaluate(rows, t, alpha)[2], 6), round(evaluate(rows, t, alpha)[0], 6), t))


def main() -> None:
    data = load()
    ins, qs = asyncio.run(embed(data))
    rows = scores(data, ins, qs)
    print(f"{len(data['insights'])} insights, {len(rows)} queries "
          f"({sum(r['label'] == 'relevant' for r in rows)} relevant, {sum(r['label'] == 'related' for r in rows)} related, "
          f"{sum(r['label'] == 'unrelated' for r in rows)} unrelated)")
    print(f"\n{'raw cosine':<34}{'n':>4}{'min':>8}{'p10':>8}{'mean':>8}{'p90':>8}{'max':>8}")
    groups = {
        "relevant query -> its insight": [max(r["cos"][i] for i in r["relevant"]) for r in rows if r["label"] == "relevant"],
        "related query -> best insight": [max(r["cos"].values()) for r in rows if r["label"] == "related"],
        "unrelated query -> best insight": [max(r["cos"].values()) for r in rows if r["label"] == "unrelated"],
    }
    for name, xs in groups.items():
        a = np.array(xs)
        print(f"{name:<34}{len(a):>4}{a.min():>8.3f}{np.percentile(a, 10):>8.3f}{a.mean():>8.3f}{np.percentile(a, 90):>8.3f}{a.max():>8.3f}")
    wrong = [r["text"] for r in rows if r["label"] == "relevant" and max(r["cos"], key=r["cos"].get) not in r["relevant"]]
    print(f"relevant queries whose best insight is the wrong one: {len(wrong)} {wrong}")

    best_cos = choose(rows)
    print(f"\n{'threshold':>10}{'precision':>11}{'recall':>8}{'F1':>7}{'TP':>5}{'FP':>5}   (plain cosine)")
    for t in sorted({0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.78, best_cos}):
        p, r, f, tp, fp = evaluate(rows, t)
        print(f"{t:>10.2f}{p:>11.3f}{r:>8.3f}{f:>7.3f}{tp:>5}{fp:>5}{'  <- chosen (best F1)' if t == best_cos else ('  <- the plan' if t == 0.78 else '')}")
    p, r, f_cos, tp, fp = evaluate(rows, best_cos)
    print(f"\nplain cosine: threshold {best_cos:.2f}: precision {p:.3f} recall {r:.3f} F1 {f_cos:.3f}")

    print(f"\n{'alpha':>6}{'best T':>8}{'precision':>11}{'recall':>8}{'F1':>7}   (hybrid = cosine + alpha x keyword coverage)")
    best_h = (f_cos, 0.0, best_cos)
    for alpha in HYBRID_ALPHAS:
        t = choose(rows, alpha)
        p, r, f, *_ = evaluate(rows, t, alpha)
        print(f"{alpha:>6.2f}{t:>8.2f}{p:>11.3f}{r:>8.3f}{f:>7.3f}")
        if f > best_h[0]:
            best_h = (f, alpha, t)
    gain = best_h[0] - f_cos
    verdict = (f"adopt the hybrid (alpha {best_h[1]}, threshold {best_h[2]:.2f})" if gain >= HYBRID_ADOPT_GAIN
               else f"keep plain cosine (the best hybrid gains only {gain:+.3f} F1, below {HYBRID_ADOPT_GAIN})")
    print(f"\nhybrid verdict: {verdict}")
    errors = []
    for r in rows:
        best = max(r["cos"], key=r["cos"].get)
        s = r["cos"][best]
        hit = s >= best_cos
        ok = (r["label"] == "relevant" and hit and best in r["relevant"]) or (r["label"] != "relevant" and not hit)
        if not ok:
            errors.append((s, r["label"], r["text"], best))
    print(f"\nqueries decided wrongly at {best_cos:.2f} ({len(errors)}):")
    for s, label, text, best in sorted(errors, reverse=True):
        print(f"   {s:.3f}  {label:<9} {text!r} -> {best}")


if __name__ == "__main__":
    main()
