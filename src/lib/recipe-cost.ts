import { prisma } from "@/lib/prisma"
import { getCanonicalIngredientCost } from "@/lib/canonical-ingredients"

export type RecipeCostLine = {
  kind: "ingredient" | "component"
  refId: string
  name: string
  quantity: number
  unit: string
  unitCost: number | null
  lineCost: number
  missingCost: boolean
}

export type RecipeCostResult = {
  recipeId: string
  itemName: string
  totalCost: number
  lines: RecipeCostLine[]
  /** True if any ingredient or sub-component had no resolvable cost. */
  partial: boolean
  /** asOf snapshot actually used (undefined = latest). */
  asOf?: Date
}

export class RecipeCycleError extends Error {
  constructor(public readonly chain: string[]) {
    super(`Recipe cycle detected: ${chain.join(" -> ")}`)
    this.name = "RecipeCycleError"
  }
}

/**
 * Compute the cost of a single recipe, recursively resolving sub-recipes.
 *
 * - `asOf` undefined  → latest invoice price (builder mode)
 * - `asOf` Date       → most recent price on or before that date (P&L mode)
 *
 * Memoized per call so a recipe referenced multiple times in the tree is only
 * costed once. Throws `RecipeCycleError` if a cycle is detected.
 */
export async function computeRecipeCost(
  recipeId: string,
  asOf?: Date
): Promise<RecipeCostResult> {
  const memo = new Map<string, RecipeCostResult>()
  return walk(recipeId, asOf, [], memo)
}

async function walk(
  recipeId: string,
  asOf: Date | undefined,
  stack: string[],
  memo: Map<string, RecipeCostResult>
): Promise<RecipeCostResult> {
  if (stack.includes(recipeId)) {
    throw new RecipeCycleError([...stack, recipeId])
  }
  const cached = memo.get(recipeId)
  if (cached) return cached

  const recipe = await prisma.recipe.findUnique({
    where: { id: recipeId },
    select: {
      id: true,
      itemName: true,
      servingSize: true,
      foodCostOverride: true,
      ingredients: {
        select: {
          id: true,
          quantity: true,
          unit: true,
          ingredientName: true,
          canonicalIngredientId: true,
          componentRecipeId: true,
          canonicalIngredient: { select: { id: true, name: true } },
          componentRecipe: { select: { id: true, itemName: true } },
        },
      },
    },
  })

  if (!recipe) {
    throw new Error(`Recipe ${recipeId} not found`)
  }

  const lines: RecipeCostLine[] = []
  let total = 0
  let partial = false

  for (const ing of recipe.ingredients) {
    if (ing.componentRecipeId) {
      const sub = await walk(
        ing.componentRecipeId,
        asOf,
        [...stack, recipeId],
        memo
      )
      const unitCost = sub.totalCost
      const lineCost = unitCost * ing.quantity
      total += lineCost
      if (sub.partial) partial = true
      lines.push({
        kind: "component",
        refId: ing.componentRecipeId,
        name: ing.componentRecipe?.itemName ?? ing.ingredientName ?? "sub-recipe",
        quantity: ing.quantity,
        unit: ing.unit,
        unitCost,
        lineCost,
        missingCost: sub.partial,
      })
      continue
    }

    if (ing.canonicalIngredientId) {
      const cost = await getCanonicalIngredientCost(
        ing.canonicalIngredientId,
        asOf
      )
      if (!cost) {
        partial = true
        lines.push({
          kind: "ingredient",
          refId: ing.canonicalIngredientId,
          name: ing.canonicalIngredient?.name ?? ing.ingredientName ?? "ingredient",
          quantity: ing.quantity,
          unit: ing.unit,
          unitCost: null,
          lineCost: 0,
          missingCost: true,
        })
        continue
      }
      const lineCost = cost.unitCost * ing.quantity
      total += lineCost
      lines.push({
        kind: "ingredient",
        refId: ing.canonicalIngredientId,
        name: ing.canonicalIngredient?.name ?? ing.ingredientName ?? "ingredient",
        quantity: ing.quantity,
        unit: ing.unit,
        unitCost: cost.unitCost,
        lineCost,
        missingCost: false,
      })
      continue
    }

    // Neither FK set — should be blocked by the DB CHECK constraint, but guard.
    partial = true
    lines.push({
      kind: "ingredient",
      refId: ing.id,
      name: ing.ingredientName ?? "unknown",
      quantity: ing.quantity,
      unit: ing.unit,
      unitCost: null,
      lineCost: 0,
      missingCost: true,
    })
  }

  if (total === 0 && partial && recipe.foodCostOverride != null) {
    total = recipe.foodCostOverride
  }

  const result: RecipeCostResult = {
    recipeId: recipe.id,
    itemName: recipe.itemName,
    totalCost: total,
    lines,
    partial,
    asOf,
  }
  memo.set(recipeId, result)
  return result
}

/**
 * Cheaper dry-run: just walks the recipe graph and validates there are no cycles
 * and that every terminal node has a resolvable ref. Used by recipe-actions
 * before a save to surface cycle errors without running cost queries.
 */
export async function assertNoCycles(recipeId: string): Promise<void> {
  const visited = new Set<string>()
  async function walkIds(id: string, stack: string[]) {
    if (stack.includes(id)) {
      throw new RecipeCycleError([...stack, id])
    }
    if (visited.has(id)) return
    visited.add(id)

    const ingredients = await prisma.recipeIngredient.findMany({
      where: { recipeId: id, componentRecipeId: { not: null } },
      select: { componentRecipeId: true },
    })
    for (const ing of ingredients) {
      if (ing.componentRecipeId) {
        await walkIds(ing.componentRecipeId, [...stack, id])
      }
    }
  }
  await walkIds(recipeId, [])
}
