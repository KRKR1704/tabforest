r"""Three grow runs back to back on the demo snapshot, with the run report the API does not return:
latency, LLM calls, tokens, and every downgraded claim with the validator's reasons; then p50.

    cd apps/api
    .venv\Scripts\python app\engine\scripts\grow_report.py [user-uuid]

After run 1 it adds the user note "Not using OAuth providers for v1" to the Backend Authentication
project that run 1 created (as a user would in the UI), so runs 2-3 show whether a stated stone is
carved from a real note. Rows of the user are NOT deleted; the live tests clean user …00cc.
"""

import asyncio
import statistics
import sys
from datetime import datetime
from pathlib import Path
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from app.engine import db  # noqa: E402
from app.engine.aoai import AzureOpenAIClient  # noqa: E402
from app.engine.fixtures import load_demo_tabs  # noqa: E402
from app.engine.grove import GrowRun  # noqa: E402
from app.engine.persist import persist_run  # noqa: E402

DEMO = load_demo_tabs()
NOTE = "Not using OAuth providers for v1"


async def main(user: UUID) -> None:
    snapshot_at = datetime.fromisoformat(DEMO["snapshot_at"].replace("Z", "+00:00"))
    latencies = []
    for i in (1, 2, 3):
        client, pool = AzureOpenAIClient(), await db.get_pool()
        try:
            run = GrowRun(user, DEMO["open_tabs"], 3, pool=pool, client=client, snapshot_at=snapshot_at,
                          persist=persist_run, model_name="chat")
            async for _ in run.stream():
                pass
            r = run.report
            names = {b.cluster_id: b.tree["name"] for b in run.builds}
            latencies.append(r.latency_ms)
            print(f"\n--- run {i}: {run.response['run_id']}  latency_ms={r.latency_ms}  llm_calls={r.llm_calls}  "
                  f"tokens={r.tokens}  downgraded_claims={len(r.downgrades)}  fallbacks={r.fallbacks or 0}")
            for d in r.downgrades:
                print(f"    {names[d['cluster']]:<38} {d['kind']:<9} {d['from']} -> {d['to']}  "
                      f"(model {d['model_confidence']:.2f}, final {d['confidence']:.2f}): {'; '.join(d['reasons'])}")
            auth = next(b for b in run.builds if "00000000-0000-4000-8000-000000000001" in
                        [l["tab_ref"] for br in b.tree["branches"] for l in br["leaves"]])
            print(f"    Backend Auth tree: project {auth.tree['project_id']}, existing={auth.tree['is_existing_project_id']}, "
                  f"stones={[(s['kind'], s['provenance'], s['display_text']) for s in auth.tree['stones']]}")
            if i == 1:
                await pool.execute("INSERT INTO user_notes (user_id, project_id, kind, text) VALUES ($1, $2, 'decision', $3)",
                                   user, UUID(auth.project_id), NOTE)
                print(f"    + user note added to project p_{auth.project_id}: {NOTE!r}")
        finally:
            await db.close_pool()
            await client.aclose()
    print(f"\nlatency_ms per run: {latencies}  p50: {statistics.median(latencies):.0f} ms")


if __name__ == "__main__":
    asyncio.run(main(UUID(sys.argv[1] if len(sys.argv) > 1 else "00000000-0000-4000-8000-0000000000cc")))
