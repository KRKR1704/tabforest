r"""Evidence-quality report (R-8.1): 3 live grows on the demo snapshot, measured the same way
before and after a change, then compared side by side.

Run from apps/api:
    .venv\Scripts\python app\engine\scripts\evidence_report.py run before.json [user-uuid]
    .venv\Scripts\python app\engine\scripts\evidence_report.py compare before.json after.json
    .venv\Scripts\python app\engine\scripts\evidence_report.py tree after.json auth.json   (then print_grove.py)

`run` deletes the test user's rows in R's tables first (so every batch starts from the same
state: run 1 creates the projects, runs 2-3 match them) and again at the end. It refuses any
user outside the test range 00000000-0000-4000-8000-0000000000xx.
"""

import asyncio
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from uuid import UUID

import asyncpg

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from app.engine import db  # noqa: E402
from app.engine.aoai import AzureOpenAIClient  # noqa: E402
from app.engine.fixtures import load_demo_tabs  # noqa: E402
from app.engine.grove import GrowRun  # noqa: E402
from app.engine.persist import persist_run  # noqa: E402
from app.engine.settings import get_settings  # noqa: E402

DEMO = load_demo_tabs()
AUTH_TAB = "00000000-0000-4000-8000-000000000001"
TEST_USER = re.compile(r"^00000000-0000-4000-8000-0000000000[0-9a-f]{2}$")
R_TABLES = ("suggested_actions", "unresolved_questions", "decisions", "cluster_tabs", "intent_branches",
            "user_notes", "research_insights", "intent_clusters", "analysis_runs", "projects", "memory_embeddings")


async def clean(user: UUID) -> int:
    conn = await asyncpg.connect(get_settings().database_url.get_secret_value(), timeout=30)
    try:
        for t in R_TABLES:
            await conn.execute(f"DELETE FROM {t} WHERE user_id = $1", user)
        return sum([await conn.fetchval(f"SELECT count(*) FROM {t} WHERE user_id = $1", user) for t in R_TABLES])
    finally:
        await conn.close()


def leaves(tree: dict) -> list[str]:
    return [l["tab_ref"] for b in tree["branches"] for l in b["leaves"]]


def measure(run: GrowRun) -> dict:
    claims = [c for b in run.builds for c in b.claims]
    down = [c for c in claims if c.downgraded]
    trees = []
    for t in run.response["trees"]:
        trees.append({"name": t["name"], "fogged": t["fogged"], "goal": t["goal"]["provenance"],
                      "goal_refs": len(t["goal"]["evidence"]), "auth": AUTH_TAB in leaves(t)})
    auth = next(t for t in run.response["trees"] if AUTH_TAB in leaves(t))
    d = auth["direction"]
    return {"run_id": run.response["run_id"], "latency_ms": run.report.latency_ms, "llm_calls": run.report.llm_calls,
            "tokens": run.report.tokens, "claims": len(claims), "downgraded": len(down),
            "single_ref_downgrades": sum(len(c.evidence) == 1 for c in down),
            "downgrade_ref_counts": sorted(len(c.evidence) for c in down),
            "fogged_trees": sum(t["fogged"] for t in trees), "trees": trees,
            "auth_direction": {"provenance": d["provenance"], "refs": len(d["evidence"]),
                               "ref_kinds": sorted({e["ref_kind"] for e in d["evidence"]}),
                               "text": d["display_text"]} if d else None,
            "auth_hypotheses": len(auth["hypotheses"]),
            "auth_mushroom_kinds": [m["kind"] for m in auth["mushrooms"]],
            "auth_stones": [(s["kind"], s["provenance"], len(s["evidence"])) for s in auth["stones"]],
            "auth_tree": auth}


async def run_batch(user: UUID) -> list[dict]:
    snapshot_at = datetime.fromisoformat(DEMO["snapshot_at"].replace("Z", "+00:00"))
    out = []
    for _ in range(3):
        client, pool = AzureOpenAIClient(), await db.get_pool()
        try:
            run = GrowRun(user, DEMO["open_tabs"], 3, pool=pool, client=client, snapshot_at=snapshot_at,
                          persist=persist_run, model_name="chat")
            async for _ in run.stream():
                pass
            out.append(measure(run))
        finally:
            await db.close_pool()
            await client.aclose()
    return out


def print_runs(label: str, runs: list[dict]) -> None:
    print(f"\n=== {label}")
    for i, r in enumerate(runs, 1):
        print(f"run {i} {r['run_id']}: downgraded {r['downgraded']}/{r['claims']} claims, single-ref downgrades "
              f"{r['single_ref_downgrades']} (ref counts {r['downgrade_ref_counts']}), fogged trees "
              f"{r['fogged_trees']}/{len(r['trees'])}, latency {r['latency_ms']} ms, tokens {r['tokens']}")
        for t in r["trees"]:
            print(f"     {'*' if t['auth'] else ' '} {t['name'][:40]:<40} goal {t['goal']:<10} {t['goal_refs']} refs"
                  f"{'  FOGGED' if t['fogged'] else ''}")
        d = r["auth_direction"]
        print(f"       Backend Auth direction: {'none' if not d else f'''{d['provenance']}, {d['refs']} refs {d['ref_kinds']}: {d['text']}'''}")
        print(f"       Backend Auth mushrooms {r['auth_mushroom_kinds']}, stones {r['auth_stones']}, "
              f"hypotheses {r['auth_hypotheses']}")


def compare(before: list[dict], after: list[dict]) -> None:
    def col(runs, fn):
        return " / ".join(str(fn(r)) for r in runs)

    def direction(r):
        d = r["auth_direction"]
        return "none" if not d else f"{d['provenance'][:3]}:{d['refs']}"
    rows = [("downgrades per run", lambda r: r["downgraded"]),
            ("claims per run", lambda r: r["claims"]),
            ("single-ref downgrades", lambda r: r["single_ref_downgrades"]),
            ("fogged trees (of 5)", lambda r: r["fogged_trees"]),
            ("goals inferred (of 5)", lambda r: sum(t["goal"] == "inferred" for t in r["trees"])),
            ("mean goal refs", lambda r: round(sum(t["goal_refs"] for t in r["trees"]) / len(r["trees"]), 1)),
            ("Auth direction (prov:refs)", direction),
            ("Auth mushroom kinds", lambda r: ",".join(k.replace("unresolved_comparison", "unres_cmp")
                                                       .replace("repeated_search", "rep_search")
                                                       for k in r["auth_mushroom_kinds"]) or "-"),
            ("Auth stones (kind,prov,refs)", lambda r: ",".join(f"{k[0]}{p[:3]}{n}" for k, p, n in r["auth_stones"]) or "-"),
            ("latency ms", lambda r: r["latency_ms"]),
            ("tokens", lambda r: r["tokens"])]
    print(f"\n{'metric (run 1 / 2 / 3)':<30}{'BEFORE':<40}AFTER")
    for name, fn in rows:
        print(f"{name:<30}{col(before, fn):<40}{col(after, fn)}")
    total = lambda runs, k: sum(r[k] for r in runs)  # noqa: E731
    print(f"\n{'totals':<30}{'BEFORE':<40}AFTER")
    for k in ("downgraded", "single_ref_downgrades", "fogged_trees"):
        print(f"{k:<30}{total(before, k):<40}{total(after, k)}")


def main() -> None:
    if sys.argv[1] == "tree":  # the Backend Auth tree of the last run in a saved report
        runs = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
        Path(sys.argv[3]).write_text(json.dumps({"run_id": runs[-1]["run_id"], "generated_at": None, "hollow_count": 3,
                                                 "degraded": False, "banner_text": None, "trees": [runs[-1]["auth_tree"]],
                                                 "sprouts": [], "meadow": [], "fog": [], "fireflies": []}), encoding="utf-8")
        return
    if sys.argv[1] == "compare":
        before, after = (json.loads(Path(p).read_text(encoding="utf-8")) for p in sys.argv[2:4])
        print_runs("BEFORE", before)
        print_runs("AFTER", after)
        compare(before, after)
        return
    out = Path(sys.argv[2])
    user = sys.argv[3] if len(sys.argv) > 3 else "00000000-0000-4000-8000-0000000000dd"
    if not TEST_USER.match(user):
        raise SystemExit("refusing: not a test user")
    print("rows left before:", asyncio.run(clean(UUID(user))))
    runs = asyncio.run(run_batch(UUID(user)))
    out.write_text(json.dumps(runs, indent=1), encoding="utf-8")
    print_runs(out.stem, runs)
    print("rows left after cleanup:", asyncio.run(clean(UUID(user))))


if __name__ == "__main__":
    main()
