// Session-free core of the recipe-suggestion computation (F28). The
// "use server" wrapper in app/actions/forecasts/recipe-suggestion-actions.ts
// resolves the session and delegates here; the proposals cron calls this
// directly with an accountId. Read-only: proposes candidates, never writes
// a mapping.
//
// Similarity is pgvector cosine over precomputed MenuItemEmbedding ×
// RecipeEmbedding rows, with token-Jaccard as fallback for items sold after
// the last embedding backfill. Same return shape either way.
//
// Confidence bands (the two scores cluster differently):
//   Jaccard:  ≥ 0.75 "high" · ≥ 0.50 "medium" · ≥ 0.25 "low"
//   Cosine:   capped at "medium" (≥ 0.50) · ≥ 0.35 "low" (floor) — the
//   2026-07-26 eval showed cosine "high" would batch-confirm wrong matches.

import { startOfDayUTC as startOfDayUtc } from "@/lib/date-utils"
import { prisma } from "@/lib/prisma"
import { rankRecipeCandidatesForMenuItems } from "@/lib/recipe-similarity"

const DEFAULT_LOOKBACK_DAYS = 30
const MIN_SIMILARITY_TO_SUGGEST = 0.25
const MAX_CANDIDATES = 3

// Calibrated 2026-07-26 via `cogs-flow.ts --suggest-eval` on Hollywood's 55
// embedded mapped items: top-1 hit rate 67.3%, and top-1 MISSES score up to
// 0.752 cosine ("2 Sliders and Fries" → "1 Slider Combo"). Cosine cannot
// separate right from plausible-but-wrong here, so the embedding path is
// capped at "medium" — it must never feed the confidence==="high" one-click
// batch-confirm. Re-run the eval before introducing an embedding "high" band;
// the bar is ≥ 90% top-1.
const EMBEDDING_MIN_TO_SUGGEST = 0.35
const EMBEDDING_MEDIUM = 0.5

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "with",
  "and",
  "or",
  "of",
  "for",
  "to",
  "in",
  "on",
  "at",
  "&",
])

export type RecipeSuggestionConfidence = "high" | "medium" | "low"

export interface RecipeCandidate {
  recipeId: string
  recipeName: string
  category: string
  similarity: number
  confidence: RecipeSuggestionConfidence
  ingredientCount: number
}

export interface UnmappedItem {
  storeId: string
  itemName: string
  category: string
  qty30d: number
  candidates: RecipeCandidate[]
}

export interface RecipeSuggestionData {
  storeId: string | null
  storeName: string | null
  windowStart: Date
  windowEnd: Date
  items: UnmappedItem[]
}

export type GetRecipeSuggestionResult =
  | { ok: true; data: RecipeSuggestionData }
  | { ok: false; error: "store_not_in_account" | "no_data" }

export async function computeRecipeSuggestions(input: {
  accountId: string
  storeId?: string
  lookbackDays?: number
  asOf?: Date
}): Promise<GetRecipeSuggestionResult> {
  const { accountId } = input
  const lookbackDays = input.lookbackDays ?? DEFAULT_LOOKBACK_DAYS
  const asOf = input.asOf ?? new Date()
  const windowEnd = startOfDayUtc(asOf)
  const windowStart = new Date(windowEnd)
  windowStart.setUTCDate(windowStart.getUTCDate() - lookbackDays)

  let storeId: string | null = null
  let storeName: string | null = null
  if (input.storeId) {
    const store = await prisma.store.findFirst({
      where: { id: input.storeId, accountId },
      select: { id: true, name: true },
    })
    if (!store) return { ok: false, error: "store_not_in_account" }
    storeId = store.id
    storeName = store.name
  }

  // Recipes available in the account
  const recipes = await prisma.recipe.findMany({
    where: { accountId },
    select: {
      id: true,
      itemName: true,
      category: true,
      _count: { select: { ingredients: true } },
    },
  })

  // OtterMenuItem rollups in the window — modifiers excluded
  const items = await prisma.otterMenuItem.findMany({
    where: {
      ...(storeId ? { storeId } : { store: { accountId } }),
      isModifier: false,
      date: { gte: windowStart, lte: windowEnd },
    },
    select: {
      storeId: true,
      itemName: true,
      category: true,
      fpQuantitySold: true,
      tpQuantitySold: true,
    },
  })

  if (items.length === 0) return { ok: false, error: "no_data" }

  // Existing mappings → set of (storeId, itemName)
  const mappings = await prisma.otterItemMapping.findMany({
    where: storeId ? { storeId } : { store: { accountId } },
    select: { storeId: true, otterItemName: true },
  })
  const mappedKey = (s: string, n: string) => `${s}::${n}`
  const mapped = new Set(
    mappings.map((m) => mappedKey(m.storeId, m.otterItemName)),
  )

  // Aggregate item rows by (storeId, itemName, category) → total qty
  const aggKey = (s: string, n: string, c: string) => `${s}::${c}::${n}`
  const agg = new Map<
    string,
    { storeId: string; itemName: string; category: string; qty: number }
  >()
  for (const r of items) {
    const key = aggKey(r.storeId, r.itemName, r.category)
    const bucket = agg.get(key) ?? {
      storeId: r.storeId,
      itemName: r.itemName,
      category: r.category,
      qty: 0,
    }
    bucket.qty += (r.fpQuantitySold ?? 0) + (r.tpQuantitySold ?? 0)
    agg.set(key, bucket)
  }

  const recipeTokens = recipes.map((r) => ({
    id: r.id,
    name: r.itemName,
    category: r.category,
    ingredientCount: r._count.ingredients,
    tokens: tokenize(r.itemName),
  }))
  const ingredientCountByRecipeId = new Map(
    recipes.map((r) => [r.id, r._count.ingredients]),
  )

  const unmappedAgg = Array.from(agg.values()).filter(
    (a) => !mapped.has(mappedKey(a.storeId, a.itemName)) && a.qty > 0,
  )

  // Embedding-first: one pgvector round-trip for every unmapped item that
  // already has a MenuItemEmbedding row. Items missing from the map fall
  // back to Jaccard below.
  const embeddingCandidates = await rankRecipeCandidatesForMenuItems({
    accountId,
    items: unmappedAgg.map((a) => ({
      storeId: a.storeId,
      itemName: a.itemName,
      category: a.category,
    })),
    maxCandidates: MAX_CANDIDATES,
  }).catch(() => new Map<string, never>())

  const unmappedItems: UnmappedItem[] = []
  for (const a of unmappedAgg) {
    const embedded = embeddingCandidates.get(a.itemName)
    let ranked: RecipeCandidate[]
    if (embedded && embedded.length > 0) {
      ranked = embedded
        .filter((c) => c.similarity >= EMBEDDING_MIN_TO_SUGGEST)
        .slice(0, MAX_CANDIDATES)
        .map<RecipeCandidate>((c) => ({
          recipeId: c.recipeId,
          recipeName: c.recipeName,
          category: c.category,
          similarity: c.similarity,
          confidence: embeddingConfidenceFor(c.similarity),
          ingredientCount: ingredientCountByRecipeId.get(c.recipeId) ?? 0,
        }))
    } else {
      const itemTokens = tokenize(a.itemName)
      ranked = recipeTokens
        .map((r) => {
          const sim = jaccard(itemTokens, r.tokens)
          return { recipe: r, sim }
        })
        .filter((c) => c.sim >= MIN_SIMILARITY_TO_SUGGEST)
        .sort((x, y) => y.sim - x.sim)
        .slice(0, MAX_CANDIDATES)
        .map<RecipeCandidate>((c) => ({
          recipeId: c.recipe.id,
          recipeName: c.recipe.name,
          category: c.recipe.category,
          similarity: c.sim,
          confidence: confidenceFor(c.sim),
          ingredientCount: c.recipe.ingredientCount,
        }))
    }

    unmappedItems.push({
      storeId: a.storeId,
      itemName: a.itemName,
      category: a.category,
      qty30d: a.qty,
      candidates: ranked,
    })
  }

  // Highest-velocity unmapped items first — that's where the operator
  // gets the most accuracy uplift per minute spent confirming.
  unmappedItems.sort((a, b) => b.qty30d - a.qty30d)

  return {
    ok: true,
    data: {
      storeId,
      storeName,
      windowStart,
      windowEnd,
      items: unmappedItems,
    },
  }
}

function tokenize(name: string): Set<string> {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (cleaned.length === 0) return new Set()
  const tokens = cleaned.split(" ").filter((t) => t.length > 1 && !STOPWORDS.has(t))
  return new Set(tokens)
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let intersection = 0
  for (const t of a) if (b.has(t)) intersection++
  const union = a.size + b.size - intersection
  return union > 0 ? intersection / union : 0
}

function confidenceFor(sim: number): RecipeSuggestionConfidence {
  if (sim >= 0.75) return "high"
  if (sim >= 0.5) return "medium"
  return "low"
}

function embeddingConfidenceFor(sim: number): RecipeSuggestionConfidence {
  // Deliberately never "high" — see the calibration note on the constants.
  if (sim >= EMBEDDING_MEDIUM) return "medium"
  return "low"
}
