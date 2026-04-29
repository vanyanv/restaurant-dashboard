-- Migration: chat layer + pgvector
-- Date: 2026-04-28
--
-- Summary:
--   1. Enable the `vector` extension (pgvector) so the embedding columns on
--      InvoiceLineEmbedding / MenuItemEmbedding can use `vector(1536)`.
--   2. The five chat-layer tables themselves (Conversation, Message,
--      ToolCall, InvoiceLineEmbedding, MenuItemEmbedding) are created by
--      `npx prisma db push` from prisma/schema.prisma — same as every other
--      table in this codebase. This file documents the pgvector extension
--      enable (which db push needs *before* it can create the Unsupported
--      vector columns) and the HNSW indexes (which Prisma cannot generate).
--
-- Apply order:
--   1. psql -f this-file.sql                       (CREATE EXTENSION half)
--   2. npx prisma db push                          (creates the 5 tables)
--   3. psql -c "the HNSW index DDL below"          (or re-run this file —
--                                                   `IF NOT EXISTS` makes the
--                                                   first half a no-op)

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

COMMIT;

-- ---------------------------------------------------------------------------
-- HNSW indexes — must be applied AFTER `npx prisma db push` has created the
-- two embedding tables. Cosine similarity is the right metric for OpenAI
-- text-embedding-3-small (the embeddings are L2-normalized).
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS "InvoiceLineEmbedding_embedding_hnsw"
  ON "InvoiceLineEmbedding"
  USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS "MenuItemEmbedding_embedding_hnsw"
  ON "MenuItemEmbedding"
  USING hnsw (embedding vector_cosine_ops);
