import { prisma } from "@/lib/prisma"
import { canonicalizeUnit, convert } from "@/lib/unit-conversion"

export class RecipeWalkCycleError extends Error {
  constructor(public readonly chain: string[]) {
    super(`Recipe cycle detected: ${chain.join(" -> ")}`)
    this.name = "RecipeWalkCycleError"
  }
}

/**
 * Returns how much of `targetIngredientId` is consumed per serving of `recipeId`,
 * expressed in `targetUnit`. Walks sub-recipes recursively; multiplies their
 * per-serving contribution by the sub-recipe's line quantity.
 *
 * Returns 0 when no matching ingredient is found or when matches exist only in
 * units we can't reconcile to `targetUnit` — callers that care about the
 * difference should track conversion-failure stats separately.
 */
export async function walkRecipeForIngredient(
  recipeId: string,
  targetIngredientId: string,
  targetUnit: string
): Promise<number> {
  const memo = new Map<string, number>()
  return walk(recipeId, targetIngredientId, targetUnit, [], memo)
}

async function walk(
  recipeId: string,
  targetIngredientId: string,
  targetUnit: string,
  stack: string[],
  memo: Map<string, number>
): Promise<number> {
  if (stack.includes(recipeId)) {
    throw new RecipeWalkCycleError([...stack, recipeId])
  }
  const cached = memo.get(recipeId)
  if (cached !== undefined) return cached

  const recipe = await prisma.recipe.findUnique({
    where: { id: recipeId },
    select: {
      ingredients: {
        select: {
          quantity: true,
          unit: true,
          canonicalIngredientId: true,
          componentRecipeId: true,
        },
      },
    },
  })
  if (!recipe) {
    memo.set(recipeId, 0)
    return 0
  }

  let total = 0
  for (const ing of recipe.ingredients) {
    if (ing.canonicalIngredientId === targetIngredientId) {
      const qty = convertQty(ing.quantity, ing.unit, targetUnit)
      if (qty != null) total += qty
      continue
    }
    if (ing.componentRecipeId) {
      const subQty = await walk(
        ing.componentRecipeId,
        targetIngredientId,
        targetUnit,
        [...stack, recipeId],
        memo
      )
      total += subQty * ing.quantity
    }
  }
  memo.set(recipeId, total)
  return total
}

function convertQty(qty: number, fromUnit: string, toUnit: string): number | null {
  const a = canonicalizeUnit(fromUnit)
  const b = canonicalizeUnit(toUnit)
  if (a && b && a === b) return qty
  if (a && b) return convert(qty, fromUnit, toUnit)
  return fromUnit.trim().toLowerCase() === toUnit.trim().toLowerCase() ? qty : null
}
