import { prisma } from "@/lib/prisma"
import { computeIngredientLineCost } from "@/lib/recipe-cost"
import { batchCanonicalCosts } from "@/lib/canonical-cost-batch"
import type { CanonicalIngredientCost } from "@/lib/canonical-ingredients"

export type BatchRecipeCostResult = {
  totalCost: number
  partial: boolean
}

/**
 * Compute `{ totalCost, partial }` for every recipe owned by `ownerId` in a
 * bounded number of queries — one `recipe.findMany` for the whole graph, plus
 * the batched canonical cost map.
 *
 * Use only for listing surfaces; mutation paths and single-recipe detail views
 * should stay on `computeRecipeCost` which returns the full line-by-line shape.
 */
export async function batchRecipeCosts(
  ownerId: string,
  canonicalCostMap?: Map<string, CanonicalIngredientCost>
): Promise<Map<string, BatchRecipeCostResult>> {
  const [recipes, canonicalCosts] = await Promise.all([
    prisma.recipe.findMany({
      where: { ownerId },
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
    canonicalCostMap ? Promise.resolve(canonicalCostMap) : batchCanonicalCosts(ownerId),
  ])

  type RecipeRow = (typeof recipes)[number]
  const recipeById = new Map<string, RecipeRow>()
  for (const r of recipes) recipeById.set(r.id, r)

  const memo = new Map<string, BatchRecipeCostResult>()

  function walk(recipeId: string, stack: Set<string>): BatchRecipeCostResult {
    const memoed = memo.get(recipeId)
    if (memoed) return memoed

    // Cycle — bail out as partial rather than throwing; this is a listing path.
    if (stack.has(recipeId)) {
      const cycleResult: BatchRecipeCostResult = { totalCost: 0, partial: true }
      memo.set(recipeId, cycleResult)
      return cycleResult
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
    out.set(r.id, walk(r.id, new Set()))
  }
  return out
}
