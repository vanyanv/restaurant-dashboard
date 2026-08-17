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

export interface RecipeLine {
  quantity: number
  unit: string
  canonicalIngredientId: string | null
  componentRecipeId: string | null
}

/** Every recipe's lines, keyed by recipe id — see `loadRecipeGraph`. */
export type RecipeGraph = Map<string, RecipeLine[]>

/**
 * Load the whole recipe forest for an account in one query.
 *
 * The per-node `findUnique` in `walk` is fine for a single lookup but becomes
 * quadratic when the dashboard walks every recipe for every ingredient. Sixty
 * recipes fit comfortably in memory, so the batched readers hoist this once and
 * traverse with `walkRecipeForIngredientSync`.
 */
export async function loadRecipeGraph(accountId: string): Promise<RecipeGraph> {
  const recipes = await prisma.recipe.findMany({
    where: { accountId },
    select: {
      id: true,
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
  return new Map(recipes.map((r) => [r.id, r.ingredients]))
}

/**
 * Same traversal as `walkRecipeForIngredient`, against a preloaded graph.
 *
 * A recipe missing from the graph resolves to 0, matching the async version's
 * behaviour when `findUnique` returns null.
 */
export function walkRecipeForIngredientSync(
  graph: RecipeGraph,
  recipeId: string,
  targetIngredientId: string,
  targetUnit: string
): number {
  return walkSync(graph, recipeId, targetIngredientId, targetUnit, [], new Map())
}

function walkSync(
  graph: RecipeGraph,
  recipeId: string,
  targetIngredientId: string,
  targetUnit: string,
  stack: string[],
  memo: Map<string, number>
): number {
  if (stack.includes(recipeId)) {
    throw new RecipeWalkCycleError([...stack, recipeId])
  }
  const cached = memo.get(recipeId)
  if (cached !== undefined) return cached

  const lines = graph.get(recipeId)
  if (!lines) {
    memo.set(recipeId, 0)
    return 0
  }

  let total = 0
  for (const ing of lines) {
    if (ing.canonicalIngredientId === targetIngredientId) {
      const qty = convertQty(ing.quantity, ing.unit, targetUnit)
      if (qty != null) total += qty
      continue
    }
    if (ing.componentRecipeId) {
      const subQty = walkSync(
        graph,
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
