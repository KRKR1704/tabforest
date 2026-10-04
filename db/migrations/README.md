# db/migrations

Plain SQL migrations for Tiger Cloud, numbered by owner (BUILD_TASKS.md §1, §16): `1xx_*.sql` are P's, `2xx_*.sql` are R's. There are no foreign keys across lanes, so either owner's files can run first. P's `db/migrate.sh` runs them all.

R's files (idempotent: `IF NOT EXISTS` only, safe to run twice):

| File | Contents |
|---|---|
| `200_engine_core.sql` | `projects`, `analysis_runs` (normal table), `intent_clusters`, `intent_branches`, `cluster_tabs`, `decisions`, `unresolved_questions`, `suggested_actions`, `user_notes`, `research_insights` |
| `201_engine_memory.sql` | `memory_embeddings` (`vector(1536)`, DiskANN cosine index, `(user_id, kind)` index); needs the `vector` and `vectorscale` extensions |

R can apply only its own files with `apps/api/app/engine/scripts/apply_r_migrations.py` (run from `apps/api`).
