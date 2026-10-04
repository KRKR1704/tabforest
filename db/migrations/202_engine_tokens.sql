-- 202_engine_tokens.sql
-- Owner: R (intelligence engine). Tokens per analysis run, for the per-user daily token budget
-- (BUILD_TASKS.md §4.9). Nullable: runs written before this column have no count.
-- Idempotent: ADD COLUMN IF NOT EXISTS only; safe to run twice. Never drops anything.

ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS tokens integer CHECK (tokens >= 0);
