import { prisma } from "@/lib/prisma"
import { computeIngredientLineCost } from "@/lib/recipe-cost"
import { batchCanonicalCosts } from "@/lib/canonical-cost-batch"
import type { CanonicalIngredientCost } from "@/lib/canonical-ingredients"

export type BatchRecipeCostResult = {
  totalCost: number
  partial: boolean
}

/**
 * Compute `{ totalCost, partial }` for every recipe on `accountId` in a
 * bounded number of queries — one `recipe.findMany` for the whole graph, plus
 * the batched canonical cost map.
 *
 * Use only for listing surfaces; mutation paths and single-recipe detail views
 * should stay on `computeRecipeCost` which returns the full line-by-line shape.
 */
export async function batchRecipeCosts(
  accountId: string,
  canonicalCostMap?: Map<string, CanonicalIngredientCost>
): Promise<Map<string, BatchRecipeCostResult>> {
  const [recipes, canonicalCosts] = await Promise.all([
    prisma.recipe.findMany({
      where: { accountId },
      select: {
        id: true,
        foodCostOverride: true,
        ingredients: {
          select: {
            quantity: true,
            unit: true,
            canonicalIngredientId: true,
            componentRecipeId: true,
          },
        },
      },
    }),
    canonicalCostMap ? Promise.resolve(canonicalCostMap) : batchCanonicalCosts(accountId),
  ])

  type RecipeRow = (typeof recipes)[number]
  const recipeById = new Map<string, RecipeRow>()
  for (const r of recipes) recipeById.set(r.id, r)

  // `null` in the memo (and as a walk() return value to its RECURSIVE caller)
  // is the cycle sentinel: it means "this subtree's walk touched a graph
  // cycle" as distinct from a normal, possibly-partial result. It is never
  // written to the OUTPUT map — the top-level loop below omits any recipeId
  // whose walk() returns it — matching computeRecipeCost/batchRecipeCosts in
  // recipe-cost.ts, which throws RecipeCycleError and lets it unwind through
  // every ancestor frame until the per-recipe try/catch drops that recipe
  // from the map entirely.
  type WalkResult = BatchRecipeCostResult | null
  const memo = new Map<string, WalkResult>()

  function walk(recipeId: string, stack: Set<string>): WalkResult {
    // `.has` (not a truthy check on `.get`) because a memoized cycle sentinel
    // is `null`, which a truthy check would treat as "not yet memoized" and
    // walk all over again outside the stack that made it a cycle.
    if (memo.has(recipeId)) return memo.get(recipeId) as WalkResult

    // Cycle — this is a listing path and we don't want to crash the whole
    // listing, so this doesn't throw. But cycles shouldn't exist (DB-side
    // checks should prevent them), so log loudly: the single-recipe path
    // throws RecipeCycleError, which is the canonical signal. Memoizing the
    // sentinel here (rather than a poisoned `{ totalCost: 0, partial: true }`)
    // matters because recipeId being cyclic is a fixed property of the graph
    // — true no matter which stack reaches it next — so it is safe, and
    // correct, to reuse for any later caller.
    if (stack.has(recipeId)) {
      console.warn(
        "[recipe-cost-batch] cycle detected at recipeId=%s (stack=%s) — omitting from result",
        recipeId,
        Array.from(stack).join(" -> ")
      )
      memo.set(recipeId, null)
      return null
    }

    const recipe = recipeById.get(recipeId)
    if (!recipe) {
      const missing: BatchRecipeCostResult = { totalCost: 0, partial: true }
      memo.set(recipeId, missing)
      return missing
    }

    stack.add(recipeId)

    let total = 0
    let partial = false

    for (const ing of recipe.ingredients) {
      if (ing.componentRecipeId) {
        const sub = walk(ing.componentRecipeId, stack)
        if (sub === null) {
          // A dependency's own subtree touched a cycle, so this recipe's
          // cost is undefined too — propagate the sentinel instead of
          // treating it as an ordinary partial line, same as an uncaught
          // RecipeCycleError unwinding through this frame in recipe-cost.ts.
          stack.delete(recipeId)
          memo.set(recipeId, null)
          return null
        }
        total += sub.totalCost * ing.quantity
        if (sub.partial) partial = true
        continue
      }

      if (ing.canonicalIngredientId) {
        const cost = canonicalCosts.get(ing.canonicalIngredientId)
        if (!cost) {
          partial = true
          continue
        }
        const { lineCost, qtyInCostUnit } = computeIngredientLineCost({
          ingredientQuantity: ing.quantity,
          ingredientUnit: ing.unit,
          costUnitCost: cost.unitCost,
          costUnit: cost.unit,
        })
        if (qtyInCostUnit == null) {
          partial = true
          continue
        }
        total += lineCost
        continue
      }

      // Neither FK set — guard.
      partial = true
    }

    if (total === 0 && recipe.foodCostOverride != null) {
      total = recipe.foodCostOverride
    }

    stack.delete(recipeId)
    const result: BatchRecipeCostResult = { totalCost: total, partial }
    memo.set(recipeId, result)
    return result
  }

  const out = new Map<string, BatchRecipeCostResult>()
  for (const r of recipes) {
    const result = walk(r.id, new Set())
    // Sentinel — this recipe's walk touched a cycle. Omit it from the output
    // map entirely rather than writing a $0/partial entry, so callers that do
    // `costByRecipe.get(recipeId)` (e.g. order-costs.ts) see it as absent,
    // the same "no cost" outcome every other page gets for a cyclic recipe.
    if (result !== null) out.set(r.id, result)
  }
  return out
}
