-- 100_schema_migrations.sql
-- Owner: P. db/migrate.py records every applied file here (X10), so `db/migrate.sh` can run all of
-- db/migrations (P's 1xx, then R's 2xx) and skip what is already applied. migrate.py also creates
-- this table before reading it; the file keeps the table visible in the migration list.
-- Idempotent: IF NOT EXISTS only.

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     text        PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now()
);
