"use server"

// F28 — Auto-completing recipe builder. For every OtterMenuItem the
// operator hasn't yet mapped to a Recipe, surface the top-N most-similar
// existing recipes from the same account as candidate completions. The
// operator confirms or rejects via the existing recipe-mapping UI; this
// action is read-only and only proposes — it never writes a mapping.
//
// Similarity is token-Jaccard over normalized name tokens (lowercased,
// punctuation stripped, English stopwords removed). Cheap, deterministic,
// and explainable. pgvector cosine similarity on Recipe embeddings is
// reserved as v2 — same return shape so swapping in won't break callers.
//
// Confidence band:
//   ≥ 0.75 → "high"   (operator almost certainly accepts as-is)
//   ≥ 0.50 → "medium" (probably right, may need tweaks)
//   ≥ 0.25 → "low"    (worth glancing at; expect to edit)
//
// Items with no candidate above 0.25 return an empty `candidates` array —
// operator gets visibility into the gap without a misleading suggestion.

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

interface SessionUser {
  id: string
  accountId: string
}
interface SessionLike {
  user?: SessionUser | null
}

const DEFAULT_LOOKBACK_DAYS = 30
const MIN_SIMILARITY_TO_SUGGEST = 0.25
const MAX_CANDIDATES = 3

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

export async function getRecipeSuggestions(input: {
  storeId?: string
  lookbackDays?: number
  asOf?: Date
}): Promise<GetRecipeSuggestionResult | null> {
  const session = (await getServerSession(authOptions)) as SessionLike | null
  const user = session?.user ?? null
  if (!user) return null

  const lookbackDays = input.lookbackDays ?? DEFAULT_LOOKBACK_DAYS
  const asOf = input.asOf ?? new Date()
  const windowEnd = startOfDayUtc(asOf)
  const windowStart = new Date(windowEnd)
  windowStart.setUTCDate(windowStart.getUTCDate() - lookbackDays)

  let storeId: string | null = null
  let storeName: string | null = null
  if (input.storeId) {
    const store = await prisma.store.findFirst({
      where: { id: input.storeId, accountId: user.accountId },
      select: { id: true, name: true },
    })
    if (!store) return { ok: false, error: "store_not_in_account" }
    storeId = store.id
    storeName = store.name
  }

  // Recipes available in the account
  const recipes = await prisma.recipe.findMany({
    where: { accountId: user.accountId },
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
      ...(storeId ? { storeId } : { store: { accountId: user.accountId } }),
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
    where: storeId
      ? { storeId }
      : { store: { accountId: user.accountId } },
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

  const unmappedItems: UnmappedItem[] = []
  for (const a of agg.values()) {
    if (mapped.has(mappedKey(a.storeId, a.itemName))) continue
    if (a.qty <= 0) continue

    const itemTokens = tokenize(a.itemName)
    const ranked = recipeTokens
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

function startOfDayUtc(d: Date): Date {
  const out = new Date(d)
  out.setUTCHours(0, 0, 0, 0)
  return out
}
