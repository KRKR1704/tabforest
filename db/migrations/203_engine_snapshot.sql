-- 203_engine_snapshot.sql
-- Owner: R (intelligence engine). The redacted open-tab snapshot (BUILD_TASKS.md §4.2) a grow ran on,
-- {"snapshot_at": ..., "open_tabs": [...]}: titles are already redacted on the device and are the
-- same ones stored in analysis_runs.response. POST /api/projects/{id}/analyze reads it to re-run one
-- project. Nullable: runs written before this column have no snapshot.
-- Idempotent: ADD COLUMN IF NOT EXISTS only; safe to run twice. Never drops anything.

ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS snapshot jsonb;
