r"""Work Context scorecard (R-11): upload the five SAMPLE files through POST /api/work-context/upload with the
real model and score the answer against fixtures/sample_docs/EXPECTED.json.

    cd apps/api
    .venv\Scripts\python app\engine\scripts\wc_scorecard.py [runs]      (default 1)

Per item FOUND / PARTIAL / MISSING, plus the metrics the audit asked about: the next-action ranks against the key,
near-duplicate claims (same text in other words, per category) and the distinct document types the evidence cap sees.
Uses the test user ...00f2 (analysis_runs rows are deleted at the end; the script refuses any other user).
"""

from __future__ import annotations

import asyncio
import json
import sys
import uuid
from pathlib import Path

import asyncpg

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from fastapi.testclient import TestClient  # noqa: E402

from app.engine.carry import similar  # noqa: E402
from app.engine.fixtures import SAMPLE_DOCS_DIR  # noqa: E402
from app.engine.normalize import normalize_for_match as nm  # noqa: E402
from app.engine.schemas import WorkContextResponse  # noqa: E402
from app.engine.settings import get_settings  # noqa: E402
from app.engine.standalone import app  # noqa: E402

USER = uuid.UUID("00000000-0000-4000-8000-0000000000f2")
KEY = json.loads((SAMPLE_DOCS_DIR / "EXPECTED.json").read_text(encoding="utf-8"))
FILES = ["jira-CAM-142.md", "pr-418.md", "customer-note.md", "teams-transcript.vtt", "migration-doc.md"]
TEXT = {n: (SAMPLE_DOCS_DIR / n).read_text(encoding="utf-8") for n in FILES}
ACTION_WORDS = [("oauth", "callback"), ("cutover", "section", "rollback", "migration doc"), ("credential",)]
CATEGORIES = ("decisions", "blockers", "owners", "open_questions", "next_actions")


def overlap(a: str | None, b: str | None) -> bool:
    a, b = nm(a or "").lower(), nm(b or "").lower()
    return bool(a and b and (a in b or b in a))


def score(resp: dict) -> tuple[list[tuple[str, str, str]], dict]:
    out: list[tuple[str, str, str]] = []
    g = resp["goal"]
    if g["provenance"] == "sourced" and overlap(g["quote"], KEY["goal"]["quote"]):
        out.append(("goal", "FOUND", f"sourced, {g['source']}"))
    else:
        out.append(("goal", "PARTIAL" if "azure" in g["text"].lower() else "MISSING", f"{g['provenance']}: {g['text'][:60]}"))

    k = KEY["decisions"][0]
    d = next((x for x in resp["decisions"] if "function" in x["text"].lower()), None)
    if d is None:
        out.append(("decision Azure Functions", "MISSING", "-"))
    else:
        bad = [m for m, ok in (("provenance", d["provenance"] == "sourced"), ("timestamp", d["timestamp"] == k["timestamp"]),
                               ("speaker", d["speaker"] == k["speaker"]), ("quote", overlap(d["quote"], k["quote"]))) if not ok]
        out.append(("decision Azure Functions", "FOUND" if not bad else "PARTIAL",
                    f"{d['provenance']}, {d['timestamp']}, {d['speaker']}" + (f" (wrong: {bad})" if bad else "")))

    quotes = [KEY["blockers"][0]["quote"]] + [s["quote"] for s in KEY["blockers"][0]["supporting"]]
    blockers = [x for x in resp["blockers"] if "credential" in x["text"].lower()]
    if not blockers:
        out.append(("blocker credentials", "MISSING", "-"))
    else:
        b = max(blockers, key=lambda x: x["provenance"] == "sourced")
        ok = b["provenance"] == "sourced" and any(overlap(b["quote"], q) for q in quotes)
        out.append(("blocker credentials", "FOUND" if ok else "PARTIAL", f"{b['provenance']}, {b['source']}"))

    for o in KEY["owners"]:
        word = "credential" if "credential" in o["task"].lower() else "oauth"
        hit = next((x for x in resp["owners"] if x["person"].lower() == o["person"].lower() and word in x["task"].lower()), None)
        out.append((f"owner {o['person']}", "FOUND" if hit and hit["provenance"] == "sourced" else ("PARTIAL" if hit else "MISSING"),
                    hit["task"][:46] if hit else "-"))

    q = next((x for x in resp["open_questions"] if "session" in x["text"].lower()), None)
    out.append(("open question session state", "MISSING" if q is None else ("FOUND" if q["status"] == "open" and q["recurrence"] >= 2 else "PARTIAL"),
                "-" if q is None else f"{q['status']}, recurrence {q['recurrence']}"))

    ranks = []
    for i, (a, words) in enumerate(zip(KEY["next_actions"], ACTION_WORDS, strict=True), 1):
        hit = next((x for x in resp["next_actions"] if any(w in x["text"].lower() for w in words)), None)
        ranks.append(hit["rank"] if hit else None)
        out.append((f"next action {i}: {a['text'][:30]}", "MISSING" if hit is None else ("FOUND" if hit["rank"] == i else "PARTIAL"),
                    "-" if hit is None else f"rank {hit['rank']} (key {i})"))

    claims = [g] + [x for k_ in CATEGORIES for x in resp[k_]]
    blob = " ".join(x["text"] + " " + str(x.get("quote")) for x in claims).lower()
    for label, words in (("renewal/premium support", ("renewal", "premium support")), ("fire drill/meeting room", ("fire drill", "meeting room")),
                         ("flaky CI test", ("flaky", "cam-139")), ("employee SSO", ("employee sso",))):
        leaked = [w for w in words if w in blob]
        out.append((f"noise: {label}", "FOUND" if not leaked else "MISSING", "absent" if not leaked else f"present: {leaked}"))

    twins = 0
    for k_ in CATEGORIES:
        items = resp[k_]
        twins += sum(1 for i, x in enumerate(items) for y in items[:i] if similar(x["text"], y["text"]))
    verbatim = all(not c["quote"] or any(nm(c["quote"]) in nm(t) for t in TEXT.values()) for c in claims)
    metrics = {"ranks": ranks, "near_duplicate_pairs": twins, "claims": len(claims), "verbatim_quotes": verbatim,
               "provenance": {p: sum(c["provenance"] == p for c in claims) for p in ("sourced", "inferred", "hypothesis")},
               "confidences": sorted({c["confidence"] for c in claims if c["provenance"] == "inferred"})}
    return out, metrics


async def _sql(fn):
    c = await asyncpg.connect(get_settings().database_url.get_secret_value(), timeout=30)
    try:
        return await fn(c)
    finally:
        await c.close()


async def _clean(c) -> int:
    await c.execute("DELETE FROM analysis_runs WHERE user_id = $1", USER)
    return await c.fetchval("SELECT count(*) FROM analysis_runs WHERE user_id = $1", USER)


def main() -> None:
    runs = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    print("rows left before:", asyncio.run(_sql(_clean)))
    tally_all = []
    with TestClient(app) as c:
        for n in range(1, runs + 1):
            r = c.post("/api/work-context/upload", headers={"X-Dev-User": str(USER)},
                       files=[("files[]", (f, TEXT[f].encode("utf-8"), "application/octet-stream")) for f in FILES])
            assert r.status_code == 200, r.text
            resp = r.json()
            WorkContextResponse.model_validate(resp)
            rows, m = score(resp)
            tally = {v: sum(1 for _, x, _ in rows if x == v) for v in ("FOUND", "PARTIAL", "MISSING")}
            tally_all.append(tally)
            print(f"\n=== run {n}: {r.status_code} in {r.elapsed.total_seconds():.1f}s | FOUND {tally['FOUND']} PARTIAL {tally['PARTIAL']} "
                  f"MISSING {tally['MISSING']} | next-action ranks vs key [1,2,3]: {m['ranks']} | near-duplicate pairs: {m['near_duplicate_pairs']} "
                  f"| claims {m['claims']} {m['provenance']} | inferred confidences {m['confidences']} | quotes verbatim: {m['verbatim_quotes']}")
            for item, verdict, why in rows:
                print(f"  {verdict:<8} {item:<42} {why}")
            print("  next actions as ranked:", [f"{a['rank']}. {a['text'][:56]}" for a in resp["next_actions"]])
            print("  brief, 'Blocked:' line:", next((l[:170] for l in resp["handoff_brief"].splitlines() if l.startswith("Blocked")), "-"))
    print("\nrows left after cleanup:", asyncio.run(_sql(_clean)))


if __name__ == "__main__":
    main()
