// Embedding-based (POS item → recipe) candidate ranking — the "v2" upgrade
// the Jaccard suggester in recipe-suggestion-actions.ts reserved for pgvector.
//
// Ranks existing RecipeEmbedding rows against precomputed MenuItemEmbedding
// rows by cosine similarity in a single SQL round-trip. No OpenAI call happens
// at request time; both embedding tables are populated offline by
// scripts/backfill-embeddings.ts. Items with no MenuItemEmbedding row yet
// (sold after the last backfill) are simply absent from the result — callers
// fall back to token-Jaccard for those.

import { prisma } from "@/lib/prisma"

export type EmbeddingCandidate = {
  recipeId: string
  recipeName: string
  category: string
  /** Cosine similarity in [-1, 1]; realistically ~[0.2, 0.9] for menu text. */
  similarity: number
}

const DEFAULT_MAX_CANDIDATES = 3

/**
 * For each sold item, return the top-N most similar recipes by embedding
 * cosine distance, keyed by the item's exact Otter name.
 *
 * The lateral join runs one top-N scan per matched MenuItemEmbedding row —
 * fine at menu scale (dozens of unmapped items × hundreds of recipes).
 */
export async function rankRecipeCandidatesForMenuItems(input: {
  accountId: string
  items: { storeId: string; itemName: string; category: string }[]
  maxCandidates?: number
}): Promise<Map<string, EmbeddingCandidate[]>> {
  const { accountId, items } = input
  const maxCandidates = input.maxCandidates ?? DEFAULT_MAX_CANDIDATES

  const result = new Map<string, EmbeddingCandidate[]>()
  if (items.length === 0) return result

  const itemNames = Array.from(new Set(items.map((i) => i.itemName)))

  const rows = await prisma.$queryRawUnsafe<
    Array<{
      menuItemName: string
      recipeId: string
      recipeName: string
      category: string
      similarity: number
    }>
  >(
    `SELECT m."itemName" AS "menuItemName",
            r."recipeId",
            r."itemName" AS "recipeName",
            r."category",
            r.similarity
       FROM "MenuItemEmbedding" m
       JOIN LATERAL (
         SELECT e."recipeId",
                e."itemName",
                e."category",
                (1 - (m.embedding <=> e.embedding))::float8 AS similarity
           FROM "RecipeEmbedding" e
          WHERE e."accountId" = $1
          ORDER BY m.embedding <=> e.embedding
          LIMIT $2
       ) r ON true
      WHERE m."accountId" = $1
        AND m."itemName" = ANY($3)`,
    accountId,
    maxCandidates,
    itemNames
  )

  for (const row of rows) {
    let list = result.get(row.menuItemName)
    if (!list) {
      list = []
      result.set(row.menuItemName, list)
    }
    list.push({
      recipeId: row.recipeId,
      recipeName: row.recipeName,
      category: row.category,
      similarity: row.similarity,
    })
  }
  for (const list of result.values()) {
    list.sort((a, b) => b.similarity - a.similarity)
  }
  return result
}
