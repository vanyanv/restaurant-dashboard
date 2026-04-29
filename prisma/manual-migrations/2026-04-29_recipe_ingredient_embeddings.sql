-- Migration: recipe + canonical-ingredient embeddings (HNSW)
-- Date: 2026-04-29
--
-- Summary:
--   Adds HNSW cosine indexes on the two new pgvector tables
--   (RecipeEmbedding, CanonicalIngredientEmbedding). The tables themselves
--   are created by `npx prisma db push` from prisma/schema.prisma — same
--   pattern as the 2026-04-28 migration. pgvector is already enabled.
--
-- Apply order:
--   1. npx prisma db push                    (creates the 2 tables)
--   2. psql -f this-file.sql                 (HNSW index DDL)

CREATE INDEX IF NOT EXISTS "RecipeEmbedding_embedding_hnsw"
  ON "RecipeEmbedding"
  USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS "CanonicalIngredientEmbedding_embedding_hnsw"
  ON "CanonicalIngredientEmbedding"
  USING hnsw (embedding vector_cosine_ops);
