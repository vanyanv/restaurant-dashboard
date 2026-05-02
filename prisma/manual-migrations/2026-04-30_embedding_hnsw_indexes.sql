-- Ensure every chat embedding corpus has an HNSW cosine index.
-- Target: $DATABASE_URL2 (chat / vector branch).
--
-- Run one statement at a time or outside a transaction if using
-- CONCURRENTLY. These are idempotent and safe to re-run.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "InvoiceLineEmbedding_embedding_hnsw"
  ON "InvoiceLineEmbedding"
  USING hnsw (embedding vector_cosine_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "MenuItemEmbedding_embedding_hnsw"
  ON "MenuItemEmbedding"
  USING hnsw (embedding vector_cosine_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "RecipeEmbedding_embedding_hnsw"
  ON "RecipeEmbedding"
  USING hnsw (embedding vector_cosine_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "CanonicalIngredientEmbedding_embedding_hnsw"
  ON "CanonicalIngredientEmbedding"
  USING hnsw (embedding vector_cosine_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "PnlNarrativeEmbedding_embedding_hnsw"
  ON "PnlNarrativeEmbedding"
  USING hnsw (embedding vector_cosine_ops);
