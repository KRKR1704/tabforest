"""R-3 schema checks against Tiger Cloud (run only when DATABASE_URL is set).

- coverage: every persisted contract field has a column (or is listed as DERIVED / P-owned);
- round trip of the Backend Authentication tree, a vector nearest-neighbour query, CHECK
  constraints and a per-user delete, all inside ONE transaction that is rolled back;
- no rows left behind afterwards.
Run with -s to see the mapping table and the EXPLAIN output.
"""

import asyncio
import hashlib
import json
import random
import uuid

import asyncpg
import pytest

from app.engine.fixtures import load_contract
from app.engine.settings import get_settings

settings = get_settings()
pytestmark = pytest.mark.skipif(not settings.db_configured, reason="DATABASE_URL not set")

TEST_USER = uuid.UUID("00000000-0000-4000-8000-0000000000aa")
R_TABLES = ["suggested_actions", "unresolved_questions", "decisions", "user_notes", "cluster_tabs", "intent_branches",
            "research_insights", "intent_clusters", "memory_embeddings", "analysis_runs", "projects"]

# contract field -> "table.column" (checked), "DERIVED: ..." or "P: ..." (not R's table).
COVERAGE = [
    # grove.example.json, response level
    ("grove.run_id", "analysis_runs.run_id"),
    ("grove.generated_at", "analysis_runs.ts"),
    ("grove.hollow_count", "analysis_runs.hollow_count"),
    ("grove.degraded", "analysis_runs.degraded"),
    ("grove.banner_text", "DERIVED: from analysis_runs.degraded"),
    ("grove.sprouts / meadow / fog", "DERIVED: clustering at grow time; cached in analysis_runs.response"),
    ("grove.fireflies", "DERIVED: memory search at grow time; cached in analysis_runs.response"),
    # trees
    ("tree.project_id", "intent_clusters.project_id"),
    ("tree.name", "projects.name"),
    ("tree.is_existing_project_id", "intent_clusters.matched_existing"),
    ("tree.goal.id", "intent_clusters.goal_id"),
    ("tree.goal.text", "intent_clusters.goal"),
    ("tree.goal.provenance", "intent_clusters.goal_provenance"),
    ("tree.goal.confidence", "intent_clusters.goal_confidence"),
    ("tree.goal.evidence", "intent_clusters.goal_evidence"),
    ("tree.goal.user_note_id", "intent_clusters.goal_user_note_id"),
    ("claim.display_text (every claim)", "DERIVED: wording set by provenance (R-8)"),
    ("tree.attention_min", "DERIVED: P tab_attention_15m joined with cluster_tabs"),
    ("tree.days_since_active", "DERIVED: projects.last_active_at / P aggregates"),
    ("tree.canopy", "DERIVED: amber when days_since_active >= 3"),
    ("tree.fogged", "intent_clusters.fogged"),
    ("tree.direction", "intent_clusters.direction"),
    ("tree.hypotheses", "intent_clusters.hypotheses"),
    ("tree.vines", "intent_clusters.vines"),
    ("tree.query_families", "intent_clusters.query_families"),
    ("tree.important_tab_refs", "intent_clusters.important_tab_refs"),
    ("tree.shared_tab_refs", "DERIVED: tab_ref in two clusters of one run (cluster_tabs)"),
    ("branch.label", "intent_branches.label"),
    ("branch.status", "intent_branches.status"),
    ("branch order", "intent_branches.position"),
    ("leaf.tab_ref", "cluster_tabs.tab_ref"),
    ("leaf branch", "cluster_tabs.branch_id"),
    ("leaf.importance", "cluster_tabs.importance"),
    ("leaf.fallen", "cluster_tabs.fallen"),
    ("leaf order", "cluster_tabs.position"),
    ("leaf.title", "P: browser_events.title (latest OPEN/UPDATE), read through C11"),
    ("leaf.domain", "P: tabs.domain"),
    ("leaf.source_type", "P: tabs.source_type (R-written column, §4.5)"),
    ("leaf.dwell_min", "DERIVED: P tab_attention_15m"),
    ("leaf.is_open", "DERIVED: present in the grow request snapshot"),
    ("stone.id", "decisions.id"),
    ("stone.text", "decisions.text"),
    ("stone.provenance", "decisions.provenance"),
    ("stone.confidence", "decisions.confidence"),
    ("stone.evidence", "decisions.evidence"),
    ("stone.user_note_id", "decisions.user_note_id"),
    ("stone.quote", "decisions.quote"),
    ("stone.kind (carved/mossy)", "DERIVED: carved iff provenance stated or sourced"),
    ("mushroom.id", "unresolved_questions.id"),
    ("mushroom.text", "unresolved_questions.question"),
    ("mushroom.kind", "unresolved_questions.kind"),
    ("mushroom.provenance", "unresolved_questions.provenance"),
    ("mushroom.confidence", "unresolved_questions.confidence"),
    ("mushroom.evidence", "unresolved_questions.evidence"),
    ("mushroom.status", "unresolved_questions.status"),
    ("mushroom.answer", "unresolved_questions.answer"),
    ("mushroom.resolved_at", "unresolved_questions.resolved_at"),
    ("mushroom.recurrence", "unresolved_questions.recurrence"),
    ("next_action.id", "suggested_actions.id"),
    ("next_action.text", "suggested_actions.action"),
    ("next_action.unblocks", "suggested_actions.unblocks_question_id"),
    ("next_action.reason", "suggested_actions.reason"),
    ("next_action.provenance", "suggested_actions.provenance"),
    ("next_action.confidence", "suggested_actions.confidence"),
    ("next_action.evidence", "suggested_actions.evidence"),
    ("next_action.user_note_id (edited)", "suggested_actions.user_note_id"),
    # claims.example.json results
    ("claims: confirm", "decisions.confirmed_at"),
    ("claims: dismiss stone / question", "decisions.dismissed_at"),
    ("claims: dismiss question", "unresolved_questions.dismissed_at"),
    ("claims: dismiss action", "suggested_actions.status"),
    ("claims: dismiss hypothesis", "intent_clusters.hypotheses"),
    ("claims: resolve", "unresolved_questions.resolved_at"),
    ("assign.assigned_by / pinned", "cluster_tabs.assigned_by"),
    ("assign time", "cluster_tabs.assigned_at"),
    ("note.id", "user_notes.id"),
    ("note.kind", "user_notes.kind"),
    ("note.tab_ref", "user_notes.tab_ref"),
    ("note.text", "user_notes.text"),
    ("note.created_at", "user_notes.created_at"),
    ("note project", "user_notes.project_id"),
    # memory-search.example.json
    ("memory.project_id", "research_insights.project_id"),
    ("memory.project", "projects.name"),
    ("memory.date", "research_insights.period_end"),
    ("memory.similarity", "DERIVED: cosine distance on memory_embeddings.embedding at query time"),
    ("memory.attention_min", "DERIVED: P aggregates over research_insights.period_start..period_end"),
    ("memory.compared", "research_insights.compared"),
    ("memory.conclusion", "research_insights.conclusion"),
    ("memory.saved_context_id", "research_insights.saved_context_id"),
    ("embedding vector", "memory_embeddings.embedding"),
    ("embedding cache key", "memory_embeddings.content_hash"),
    ("embedding kind", "memory_embeddings.kind"),
    # work-context.example.json (saved results; document text is never stored)
    ("wc.run_id", "analysis_runs.run_id"),
    ("wc run kind", "analysis_runs.kind"),
    ("wc.documents / handoff_brief", "analysis_runs.response"),
    ("wc.project", "projects.name"),
    ("wc.goal.quote", "intent_clusters.goal_quote"),
    ("wc.goal.source", "intent_clusters.goal_source"),
    ("wc.goal.timestamp", "intent_clusters.goal_source_timestamp"),
    ("wc origin", "intent_clusters.origin"),
    ("wc.decisions[].source", "decisions.source"),
    ("wc.decisions[].timestamp", "decisions.source_timestamp"),
    ("wc.decisions[].speaker", "decisions.speaker"),
    ("wc.blockers[]", "unresolved_questions.kind"),
    ("wc.blockers[].quote", "unresolved_questions.quote"),
    ("wc.blockers[].source", "unresolved_questions.source"),
    ("wc.open_questions[].timestamp", "unresolved_questions.source_timestamp"),
    ("wc.owners[].person", "suggested_actions.owner"),
    ("wc.owners[].task", "suggested_actions.task"),
    ("wc owners vs actions", "suggested_actions.kind"),
    ("wc.next_actions[].rank", "suggested_actions.rank"),
    ("wc.next_actions[].unblocks", "suggested_actions.unblocks_question_id"),
    ("wc.next_actions[].quote", "suggested_actions.quote"),
    ("wc.next_actions[].source", "suggested_actions.source"),
    ("wc.next_actions[].timestamp", "suggested_actions.source_timestamp"),
    # analysis_runs metrics (R-8, §4.8)
    ("run.clusters", "analysis_runs.clusters"),
    ("run.model", "analysis_runs.model"),
    ("run.latency_ms", "analysis_runs.latency_ms"),
    ("run.downgraded_claims", "analysis_runs.downgraded_claims"),
    ("run.fallback_used", "analysis_runs.fallback_used"),
]


def uid(prefixed: str) -> uuid.UUID:
    return uuid.UUID(prefixed.split("_", 1)[1])


async def connect() -> asyncpg.Connection:
    conn = await asyncpg.connect(settings.database_url.get_secret_value(), timeout=30)
    await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")
    return conn


async def count_rows(conn: asyncpg.Connection) -> dict[str, int]:
    return {t: await conn.fetchval(f"SELECT count(*) FROM {t} WHERE user_id = $1", TEST_USER) for t in R_TABLES}


def test_contract_field_coverage() -> None:
    async def columns() -> set[str]:
        conn = await connect()
        try:
            rows = await conn.fetch("SELECT table_name, column_name FROM information_schema.columns "
                                    "WHERE table_schema = 'public' AND table_name = ANY($1::text[])", R_TABLES)
        finally:
            await conn.close()
        return {f"{r['table_name']}.{r['column_name']}" for r in rows}

    existing = asyncio.run(columns())
    missing = [(field, target) for field, target in COVERAGE
               if not target.startswith(("DERIVED", "P:")) and target not in existing]
    print(f"\n{'contract field':<38} -> table.column / source")
    print("-" * 110)
    for field, target in COVERAGE:
        print(f"{field:<38} -> {target}")
    stored = sum(1 for _, t in COVERAGE if not t.startswith(("DERIVED", "P:")))
    print(f"\n{stored} stored in R columns, {sum(t.startswith('DERIVED') for _, t in COVERAGE)} derived, "
          f"{sum(t.startswith('P:') for _, t in COVERAGE)} in P's tables; missing columns: {missing or 'none'}")
    assert not missing


def expected_tree(tree: dict) -> dict:
    """The persisted part of a grove tree, ids without prefixes."""
    claim = lambda c, *keys: tuple(c[k] for k in keys)  # noqa: E731
    return {
        "project": (uid(tree["project_id"]), tree["name"]),
        "goal": (uid(tree["goal"]["id"]),) + claim(tree["goal"], "text", "provenance", "confidence", "evidence"),
        "direction": tree["direction"], "hypotheses": tree["hypotheses"], "vines": tree["vines"],
        "query_families": tree["query_families"], "fogged": tree["fogged"],
        "important": [uuid.UUID(r) for r in tree["important_tab_refs"]],
        "branches": [(b["label"], b["status"], [(uuid.UUID(l["tab_ref"]), l["importance"], l["fallen"])
                                                for l in b["leaves"]]) for b in tree["branches"]],
        "stones": [(uid(s["id"]), s["text"], s["provenance"], s["confidence"], s["evidence"],
                    uid(s["user_note_id"]) if s["user_note_id"] else None, s["quote"], s["kind"])
                   for s in tree["stones"]],
        "mushrooms": [(uid(m["id"]), m["text"], m["kind"], m["provenance"], m["confidence"], m["evidence"],
                       m["status"], m["answer"], m["resolved_at"], m["recurrence"]) for m in tree["mushrooms"]],
        "actions": [(uid(a["id"]), a["text"], uid(a["unblocks"]), a["reason"], a["provenance"], a["confidence"],
                     a["evidence"]) for a in tree["next_actions"]],
    }


async def insert_tree(conn: asyncpg.Connection, grove: dict, tree: dict, note: dict) -> uuid.UUID:
    run_id, project_id, cluster_id = uid(grove["run_id"]), uid(tree["project_id"]), uuid.uuid4()
    await conn.execute("INSERT INTO analysis_runs (run_id, user_id, ts, clusters, hollow_count, degraded) "
                       "VALUES ($1, $2, $3::text::timestamptz, $4, $5, $6)", run_id, TEST_USER,
                       grove["generated_at"], len(grove["trees"]), grove["hollow_count"], grove["degraded"])
    await conn.execute("INSERT INTO projects (id, user_id, name, last_active_at) VALUES ($1, $2, $3, now())",
                       project_id, TEST_USER, tree["name"])
    g = tree["goal"]
    await conn.execute(
        "INSERT INTO intent_clusters (id, user_id, project_id, analysis_run_id, matched_existing, goal_id, goal, "
        "goal_provenance, goal_confidence, goal_evidence, direction, hypotheses, vines, query_families, "
        "important_tab_refs, fogged) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
        cluster_id, TEST_USER, project_id, run_id, tree["is_existing_project_id"] is not None, uid(g["id"]),
        g["text"], g["provenance"], g["confidence"], g["evidence"], tree["direction"], tree["hypotheses"],
        tree["vines"], tree["query_families"], [uuid.UUID(r) for r in tree["important_tab_refs"]], tree["fogged"])
    for bpos, b in enumerate(tree["branches"]):
        branch_id = await conn.fetchval("INSERT INTO intent_branches (user_id, cluster_id, label, status, position) "
                                        "VALUES ($1,$2,$3,$4,$5) RETURNING id", TEST_USER, cluster_id, b["label"],
                                        b["status"], bpos)
        for lpos, l in enumerate(b["leaves"]):
            await conn.execute("INSERT INTO cluster_tabs (user_id, cluster_id, branch_id, tab_ref, importance, "
                               "fallen, position) VALUES ($1,$2,$3,$4,$5,$6,$7)", TEST_USER, cluster_id, branch_id,
                               uuid.UUID(l["tab_ref"]), l["importance"], l["fallen"], lpos)
    await conn.execute("INSERT INTO user_notes (id, user_id, project_id, cluster_id, kind, text, created_at) "
                       "VALUES ($1,$2,$3,$4,$5,$6,$7::text::timestamptz)", uid(note["id"]), TEST_USER, project_id,
                       cluster_id, note["kind"], note["text"], note["created_at"])
    for s in tree["stones"]:
        await conn.execute("INSERT INTO decisions (id, user_id, cluster_id, text, provenance, confidence, evidence, "
                           "user_note_id, quote) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", uid(s["id"]), TEST_USER,
                           cluster_id, s["text"], s["provenance"], s["confidence"], s["evidence"],
                           uid(s["user_note_id"]) if s["user_note_id"] else None, s["quote"])
    for m in tree["mushrooms"]:
        await conn.execute("INSERT INTO unresolved_questions (id, user_id, cluster_id, question, kind, provenance, "
                           "confidence, evidence, status, answer, resolved_at, recurrence) VALUES "
                           "($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::text::timestamptz,$12)", uid(m["id"]), TEST_USER,
                           cluster_id, m["text"], m["kind"], m["provenance"], m["confidence"], m["evidence"],
                           m["status"], m["answer"], m["resolved_at"], m["recurrence"])
    for a in tree["next_actions"]:
        await conn.execute("INSERT INTO suggested_actions (id, user_id, cluster_id, action, reason, "
                           "unblocks_question_id, provenance, confidence, evidence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
                           uid(a["id"]), TEST_USER, cluster_id, a["text"], a["reason"], uid(a["unblocks"]),
                           a["provenance"], a["confidence"], a["evidence"])
    return cluster_id


async def read_tree(conn: asyncpg.Connection, cluster_id: uuid.UUID) -> dict:
    c = await conn.fetchrow("SELECT c.*, p.name FROM intent_clusters c JOIN projects p ON p.id = c.project_id "
                            "WHERE c.id = $1 AND c.user_id = $2", cluster_id, TEST_USER)
    branches = []
    for b in await conn.fetch("SELECT id, label, status FROM intent_branches WHERE cluster_id = $1 AND user_id = $2 "
                              "ORDER BY position", cluster_id, TEST_USER):
        leaves = await conn.fetch("SELECT tab_ref, importance, fallen FROM cluster_tabs WHERE branch_id = $1 "
                                  "AND user_id = $2 ORDER BY position", b["id"], TEST_USER)
        branches.append((b["label"], b["status"], [(l["tab_ref"], l["importance"], l["fallen"]) for l in leaves]))
    stones = [(r["id"], r["text"], r["provenance"], r["confidence"], r["evidence"], r["user_note_id"], r["quote"],
               "carved" if r["provenance"] in ("stated", "sourced") else "mossy")
              for r in await conn.fetch("SELECT * FROM decisions WHERE cluster_id = $1 AND user_id = $2 "
                                        "ORDER BY created_at, id", cluster_id, TEST_USER)]
    stones.sort(key=lambda s: s[0])
    mushrooms = [(r["id"], r["question"], r["kind"], r["provenance"], r["confidence"], r["evidence"], r["status"],
                  r["answer"], r["resolved_at"], r["recurrence"])
                 for r in await conn.fetch("SELECT * FROM unresolved_questions WHERE cluster_id = $1 AND user_id = $2",
                                           cluster_id, TEST_USER)]
    actions = [(r["id"], r["action"], r["unblocks_question_id"], r["reason"], r["provenance"], r["confidence"],
                r["evidence"]) for r in await conn.fetch("SELECT * FROM suggested_actions WHERE cluster_id = $1 "
                                                         "AND user_id = $2", cluster_id, TEST_USER)]
    return {
        "project": (c["project_id"], c["name"]),
        "goal": (c["goal_id"], c["goal"], c["goal_provenance"], c["goal_confidence"], c["goal_evidence"]),
        "direction": c["direction"], "hypotheses": c["hypotheses"], "vines": c["vines"],
        "query_families": c["query_families"], "fogged": c["fogged"], "important": list(c["important_tab_refs"]),
        "branches": branches, "stones": stones, "mushrooms": mushrooms, "actions": actions,
    }


def random_vector(rng: random.Random) -> list[float]:
    return [rng.uniform(-1, 1) for _ in range(1536)]


def vec(values: list[float]) -> str:
    return "[" + ",".join(f"{v:.6f}" for v in values) + "]"


def test_round_trip_vectors_checks_and_delete_in_one_rolled_back_transaction() -> None:
    grove = load_contract("grove.example.json")
    tree = grove["trees"][0]
    assert tree["name"] == "Backend Authentication"
    from app.engine.fixtures import load_user_notes
    note = load_user_notes()[0]

    async def run() -> dict:
        conn = await connect()
        report: dict = {}
        try:
            report["before"] = await count_rows(conn)
            tx = conn.transaction()
            await tx.start()
            try:
                # 1. Round trip of the Backend Authentication tree.
                cluster_id = await insert_tree(conn, grove, tree, note)
                expected = expected_tree(tree)
                actual = await read_tree(conn, cluster_id)
                expected["stones"].sort(key=lambda s: s[0])
                report["round_trip_diff"] = {k: (expected[k], actual[k]) for k in expected if expected[k] != actual[k]}
                n = await conn.fetchrow("SELECT id, text FROM user_notes WHERE id = $1 AND user_id = $2",
                                        uid(note["id"]), TEST_USER)
                report["note_ok"] = (n["id"], n["text"]) == (uid(note["id"]), note["text"])

                # 2. Vectors: 50 random + 1 known; cosine nearest neighbour filtered by user_id.
                rng = random.Random(42)
                rows = [(TEST_USER, "tab", f"random-{i}", hashlib.sha256(f"r{i}".encode()).hexdigest(),
                         vec(random_vector(rng))) for i in range(50)]
                known = random_vector(rng)
                rows.append((TEST_USER, "insight", "known", hashlib.sha256(b"known").hexdigest(), vec(known)))
                await conn.executemany("INSERT INTO memory_embeddings (user_id, kind, source_id, content_hash, "
                                       "embedding) VALUES ($1,$2,$3,$4,$5::vector)", rows)
                probe = vec([v + rng.uniform(-0.01, 0.01) for v in known])
                query = ("SELECT source_id, embedding <=> $2::vector AS distance FROM memory_embeddings "
                         "WHERE user_id = $1 ORDER BY embedding <=> $2::vector LIMIT 3")
                report["nearest"] = [(r["source_id"], round(r["distance"], 6))
                                     for r in await conn.fetch(query, TEST_USER, probe)]
                report["explain"] = [r[0] for r in await conn.fetch("EXPLAIN " + query, TEST_USER, probe)]

                # 3. CHECK constraints reject a bad provenance and a bad status (savepoints).
                report["checks"] = []
                for sql, args in [
                    ("INSERT INTO decisions (user_id, cluster_id, text, provenance, confidence) "
                     "VALUES ($1,$2,'x','certain',0.5)", (TEST_USER, cluster_id)),
                    ("INSERT INTO unresolved_questions (user_id, cluster_id, question, provenance, confidence, status) "
                     "VALUES ($1,$2,'x','inferred',0.7,'pending')", (TEST_USER, cluster_id)),
                ]:
                    try:
                        async with conn.transaction():
                            await conn.execute(sql, *args)
                        report["checks"].append("ACCEPTED (bad)")
                    except asyncpg.CheckViolationError as exc:
                        report["checks"].append(f"rejected: {exc.constraint_name}")

                # 4. Per-user delete across all R tables (P-11 depends on it).
                report["inserted"] = await count_rows(conn)
                for table in R_TABLES:
                    await conn.execute(f"DELETE FROM {table} WHERE user_id = $1", TEST_USER)
                report["after_delete"] = await count_rows(conn)
            finally:
                await tx.rollback()
            # 5. Nothing left behind.
            report["after_rollback"] = await count_rows(conn)
        finally:
            await conn.close()
        return report

    r = asyncio.run(run())
    print("\nround trip differences:", r["round_trip_diff"] or "none", "| user note:", r["note_ok"])
    print("rows inserted per table:", {k: v for k, v in r["inserted"].items() if v})
    print("nearest neighbours:", r["nearest"])
    print("EXPLAIN:")
    for line in r["explain"]:
        print("   ", line if len(line) <= 140 else line[:100] + f" ...[{len(line) - 100} chars of vector literal]")
    print("diskann index used:", any("diskann" in l for l in r["explain"]))
    print("CHECK results:", r["checks"])
    print("rows after per-user delete:", r["after_delete"])
    print("rows after rollback:", r["after_rollback"])

    assert r["before"] == dict.fromkeys(R_TABLES, 0)
    assert r["round_trip_diff"] == {} and r["note_ok"]
    assert r["nearest"][0][0] == "known"
    assert all(c.startswith("rejected") for c in r["checks"])
    assert all(r["inserted"][t] > 0 for t in ("projects", "intent_clusters", "intent_branches", "cluster_tabs",
                                               "decisions", "unresolved_questions", "suggested_actions",
                                               "user_notes", "memory_embeddings", "analysis_runs"))
    assert r["after_delete"] == dict.fromkeys(R_TABLES, 0)
    assert r["after_rollback"] == dict.fromkeys(R_TABLES, 0)
