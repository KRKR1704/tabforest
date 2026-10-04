-- 201_engine_memory.sql
-- Owner: R (intelligence engine). Embedding cache (R-4) and research memory vectors (R-12).
-- Depends on extensions: vector + vectorscale only (installed in PRE-P2; not created here).
-- Idempotent: CREATE ... IF NOT EXISTS only; safe to run twice. Never drops anything.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')
       OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vectorscale') THEN
        RAISE EXCEPTION '201_engine_memory.sql needs the vector and vectorscale extensions (PRE-P2)';
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS memory_embeddings (
    id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid         NOT NULL,
    kind          text         NOT NULL CHECK (kind IN ('insight', 'context', 'tab', 'query')),
    source_id     text         NOT NULL,  -- tab_ref, insight id, saved context id or query family id
    content_hash  text         NOT NULL CHECK (length(content_hash) = 64),  -- SHA-256 hex of the embedded string
    embedding     vector(1536) NOT NULL,
    created_at    timestamptz  NOT NULL DEFAULT now(),
    -- Unique per user: the cache never crosses users, and a conflict reveals nothing about another user.
    CONSTRAINT memory_embeddings_user_content_hash_key UNIQUE (user_id, content_hash)
);
CREATE INDEX IF NOT EXISTS memory_embeddings_user_kind_idx ON memory_embeddings (user_id, kind);
CREATE INDEX IF NOT EXISTS memory_embeddings_embedding_diskann_idx
    ON memory_embeddings USING diskann (embedding vector_cosine_ops);
