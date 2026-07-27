// Session-free core of AI mapping-proposal generation. The "use server"
// wrapper in app/actions/mapping-proposal-actions.ts resolves the session;
// the post-sync cron (/api/cron/proposals) calls this directly per account.
//
// Pipeline: unmapped sold items (computeRecipeSuggestions) → drop items the
// high-confidence batch-confirm already handles → layer-0 normalized
// exact-name matches become MATCH proposals with no LLM call → the fuzzy
// remainder goes to the LLM → every returned name is re-resolved against the
// account's real recipes/ingredients before a PENDING row is stored. Nothing
// touches Recipe or OtterItemMapping until a human accepts.

import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { generateProposalDrafts } from "@/lib/proposal-llm"
import { computeRecipeSuggestions } from "@/lib/recipe-suggestions-core"
import { normalizeItemName } from "@/lib/item-name-normalize"

const DEFAULT_MAX_ITEMS = 10

// Register open-items ("096 a combo 2", "load 1 fry 949") come through with
// no category and one-off quantities. They are fake orders per the operator —
// mapping them would fabricate COGS — so they never reach the LLM or the
// review sheet. A real new item either has a menu category or crosses this
// volume threshold within the 30d window.
const FREE_TEXT_CATEGORY = "Uncategorized"
const FREE_TEXT_MAX_QTY = 2

function isRegisterFreeText(item: { category: string; qty30d: number }): boolean {
  return item.category === FREE_TEXT_CATEGORY && item.qty30d <= FREE_TEXT_MAX_QTY
}

/**
 * Cache revalidation is best-effort: it works from server actions and route
 * handlers, but throws outside a Next request scope (audit/backfill scripts).
 * Proposal creation must not fail because a cache couldn't be invalidated.
 */
function safeRevalidate(path: string): void {
  try {
    revalidatePath(path)
  } catch {
    // Outside the Next runtime — nothing to invalidate.
  }
}
// `model` value stamped on proposals resolved by normalized-name equality —
// no LLM call is spent on those.
const EXACT_NAME_MODEL = "exact-name-match"

export type ProposalComponent = {
  componentRecipeId?: string
  canonicalIngredientId?: string
  name: string
  quantity: number
  unit: string
}

export type ProposalPayload = {
  suggestedName?: string
  suggestedCategory?: string
  components: ProposalComponent[]
  reasoning: string
  confidence: number
}

export type GenerateProposalsResult =
  | { ok: true; created: number; skippedExisting: number }
  | { ok: false; error: "not_authenticated" | "no_data" | "store_not_in_account" }

export async function generateMappingProposalsCore(
  scope: { accountId: string; ownerId: string | null },
  input: { storeId?: string; maxItems?: number }
): Promise<GenerateProposalsResult> {
  const maxItems = input.maxItems ?? DEFAULT_MAX_ITEMS

  const suggestions = await computeRecipeSuggestions({
    accountId: scope.accountId,
    storeId: input.storeId,
  })
  if (!suggestions.ok) {
    return {
      ok: false,
      error: suggestions.error === "store_not_in_account" ? "store_not_in_account" : "no_data",
    }
  }

  // Items whose top candidate is "high" go through the existing one-click
  // batch-confirm on /dashboard/recipes — no LLM needed for those.
  const needingHelp = suggestions.data.items.filter(
    (i) => i.candidates[0]?.confidence !== "high" && !isRegisterFreeText(i)
  )
  if (needingHelp.length === 0) return { ok: true, created: 0, skippedExisting: 0 }

  // PENDING → don't duplicate; REJECTED → a human already said no, don't
  // re-propose the same item forever.
  const existing = await prisma.recipeMappingProposal.findMany({
    where: {
      accountId: scope.accountId,
      otterItemName: { in: needingHelp.map((i) => i.itemName) },
      status: { in: ["PENDING", "REJECTED"] },
    },
    select: { otterItemName: true },
  })
  const existingNames = new Set(existing.map((p) => p.otterItemName))
  const eligible = needingHelp
    .filter((i) => !existingNames.has(i.itemName))
    .slice(0, maxItems)
  const skippedExisting = existing.length
  if (eligible.length === 0) return { ok: true, created: 0, skippedExisting }

  const [recipes, canonicals, confirmedMappings] = await Promise.all([
    prisma.recipe.findMany({
      where: { accountId: scope.accountId },
      select: { id: true, itemName: true, category: true },
    }),
    prisma.canonicalIngredient.findMany({
      where: { accountId: scope.accountId },
      select: { id: true, name: true },
    }),
    prisma.otterItemMapping.findMany({
      where: { store: { accountId: scope.accountId } },
      select: { otterItemName: true, recipe: { select: { itemName: true } } },
    }),
  ])
  const recipeByLower = new Map(recipes.map((r) => [r.itemName.toLowerCase(), r]))
  const canonicalByLower = new Map(canonicals.map((c) => [c.name.toLowerCase(), c]))

  // Normalized fallbacks tolerate punctuation/whitespace/case drift between
  // POS spellings, model echoes, and stored names. A normalized key claimed
  // by two different rows is ambiguous — mapped to null so nothing matches it.
  const recipeByNorm = new Map<string, (typeof recipes)[number] | null>()
  for (const r of recipes) {
    const key = normalizeItemName(r.itemName)
    recipeByNorm.set(key, recipeByNorm.has(key) ? null : r)
  }
  const canonicalByNorm = new Map<string, (typeof canonicals)[number] | null>()
  for (const c of canonicals) {
    const key = normalizeItemName(c.name)
    canonicalByNorm.set(key, canonicalByNorm.has(key) ? null : c)
  }
  const resolveRecipe = (name: string) =>
    recipeByLower.get(name.toLowerCase()) ?? recipeByNorm.get(normalizeItemName(name)) ?? undefined
  const resolveCanonical = (name: string) =>
    canonicalByLower.get(name.toLowerCase()) ??
    canonicalByNorm.get(normalizeItemName(name)) ??
    undefined

  // Layer 0 — free deterministic resolution: an item whose normalized name
  // equals exactly one recipe's is a MATCH proposal with no LLM call. The
  // human Accept click still gates the actual mapping write.
  let created = 0
  const needLlm: typeof eligible = []
  for (const item of eligible) {
    const exact = recipeByNorm.get(normalizeItemName(item.itemName))
    if (!exact) {
      needLlm.push(item)
      continue
    }
    const payload: ProposalPayload = {
      components: [],
      reasoning: "POS name matches this recipe exactly (ignoring punctuation and case).",
      confidence: 0.99,
    }
    try {
      await prisma.recipeMappingProposal.create({
        data: {
          accountId: scope.accountId,
          otterItemName: item.itemName,
          category: item.category,
          kind: "MATCH",
          proposedRecipeId: exact.id,
          payload,
          confidence: 0.99,
          model: EXACT_NAME_MODEL,
          status: "PENDING",
        },
      })
      created++
    } catch {
      // Partial unique index race — skip quietly.
    }
  }
  if (needLlm.length === 0) {
    safeRevalidate("/dashboard/recipes")
    return { ok: true, created, skippedExisting }
  }

  const eligibleByNorm = new Map(needLlm.map((i) => [normalizeItemName(i.itemName), i]))

  // House-pattern few-shot: confirmed mappings whose POS spelling differs
  // from the recipe name (identity pairs teach nothing), deduped across
  // stores, capped to keep the prompt small.
  const exampleByName = new Map<string, string>()
  for (const m of confirmedMappings) {
    if (!m.recipe) continue
    if (normalizeItemName(m.otterItemName) === normalizeItemName(m.recipe.itemName)) continue
    if (!exampleByName.has(m.otterItemName)) exampleByName.set(m.otterItemName, m.recipe.itemName)
  }
  const confirmedExamples = Array.from(exampleByName, ([itemName, recipeName]) => ({
    itemName,
    recipeName,
  })).slice(0, 40)

  const { drafts, model } = await generateProposalDrafts({
    items: needLlm.map((i) => ({
      itemName: i.itemName,
      category: i.category,
      qty30d: i.qty30d,
    })),
    recipeVocab: recipes.map((r) => ({ itemName: r.itemName, category: r.category })),
    ingredientVocab: canonicals.map((c) => c.name),
    confirmedExamples,
    storeId: input.storeId ?? null,
    userId: scope.ownerId,
  })

  for (const draft of drafts) {
    // Match the echo back to the real item leniently (models trim whitespace
    // and fold punctuation); anything unmatched is a hallucinated item.
    const item = eligibleByNorm.get(normalizeItemName(draft.itemName))
    if (!item) continue

    if (draft.kind === "MATCH") {
      const matched = draft.matchRecipeName
        ? resolveRecipe(draft.matchRecipeName)
        : undefined
      if (!matched) continue
      const payload: ProposalPayload = {
        components: [],
        reasoning: draft.reasoning,
        confidence: draft.confidence,
      }
      try {
        await prisma.recipeMappingProposal.create({
          data: {
            accountId: scope.accountId,
            otterItemName: item.itemName,
            category: item.category,
            kind: "MATCH",
            proposedRecipeId: matched.id,
            payload,
            confidence: draft.confidence,
            model,
            status: "PENDING",
          },
        })
        created++
      } catch {
        // Partial unique index: another PENDING row raced in. Skip quietly.
      }
      continue
    }

    // COMBO_DECOMPOSITION / NEW_RECIPE: resolve every component name against
    // the DB; drop what doesn't resolve and dock confidence for each drop.
    let confidence = draft.confidence
    const components: ProposalComponent[] = []
    for (const c of draft.components) {
      if (c.type === "recipe") {
        const recipe = resolveRecipe(c.name)
        if (!recipe) {
          confidence = Math.max(0, confidence - 0.1)
          continue
        }
        components.push({
          componentRecipeId: recipe.id,
          name: recipe.itemName,
          quantity: c.quantity,
          unit: c.unit,
        })
      } else {
        const canonical = resolveCanonical(c.name)
        if (!canonical) {
          confidence = Math.max(0, confidence - 0.1)
          continue
        }
        components.push({
          canonicalIngredientId: canonical.id,
          name: canonical.name,
          quantity: c.quantity,
          unit: c.unit,
        })
      }
    }
    if (components.length === 0) continue

    const payload: ProposalPayload = {
      suggestedName: draft.suggestedName ?? draft.itemName,
      suggestedCategory: draft.suggestedCategory ?? item.category,
      components,
      reasoning: draft.reasoning,
      confidence,
    }
    try {
      await prisma.recipeMappingProposal.create({
        data: {
          accountId: scope.accountId,
          otterItemName: item.itemName,
          category: item.category,
          kind: draft.kind,
          payload,
          confidence,
          model,
          status: "PENDING",
        },
      })
      created++
    } catch {
      // Partial unique index race — skip quietly.
    }
  }

  safeRevalidate("/dashboard/recipes")
  return { ok: true, created, skippedExisting }
}
