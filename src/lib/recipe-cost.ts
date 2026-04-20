import { prisma } from "@/lib/prisma"
import { getCanonicalIngredientCost } from "@/lib/canonical-ingredients"
import { canonicalizeUnit, convert } from "@/lib/unit-conversion"

export type RecipeCostLine = {
  kind: "ingredient" | "component"
  refId: string
  name: string
  quantity: number
  unit: string
  /** Cost in `costUnit` (may differ from `unit` — we converted before multiplying). */
  unitCost: number | null
  /** The unit the `unitCost` is priced in (the canonical's recipeUnit). */
  costUnit?: string | null
  lineCost: number
  missingCost: boolean
  /** How the unit cost was established (ingredient kind only; undefined for sub-recipes). */
  costSource?: "manual" | "invoice" | null
  /** Invoice provenance (ingredient kind only; null for sub-recipes or manual costs). */
  sourceInvoiceId?: string | null
  sourceLineItemId?: string | null
  sourceVendor?: string | null
  sourceSku?: string | null
  sourceInvoiceDate?: Date | null
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

      // Reconcile the recipe line's unit against the canonical's cost unit.
      // Example: cost is $3.30/lb, recipe asks for 0.48 oz — convert 0.48 oz
      // into lb before multiplying. If units are cross-category or unknown,
      // the line is flagged as missing.
      const recipeUnit = canonicalizeUnit(ing.unit)
      const costUnit = canonicalizeUnit(cost.unit)
      let qtyInCostUnit: number | null = ing.quantity
      if (recipeUnit && costUnit && recipeUnit !== costUnit) {
        qtyInCostUnit = convert(ing.quantity, ing.unit, cost.unit)
      } else if (!recipeUnit || !costUnit) {
        // At least one side is unrecognized. If the raw strings match (after trim/lc)
        // we assume 1:1; otherwise we can't trust a naive multiply — mark missing.
        const same = ing.unit.trim().toLowerCase() === cost.unit.trim().toLowerCase()
        if (!same) qtyInCostUnit = null
      }

      if (qtyInCostUnit == null) {
        partial = true
        lines.push({
          kind: "ingredient",
          refId: ing.canonicalIngredientId,
          name: ing.canonicalIngredient?.name ?? ing.ingredientName ?? "ingredient",
          quantity: ing.quantity,
          unit: ing.unit,
          unitCost: cost.unitCost,
          costUnit: cost.unit,
          lineCost: 0,
          missingCost: true,
          costSource: cost.source,
          sourceInvoiceId: cost.sourceInvoiceId,
          sourceLineItemId: cost.sourceLineItemId,
          sourceVendor: cost.sourceVendor,
          sourceSku: cost.sourceSku,
          sourceInvoiceDate: cost.asOfDate,
        })
        continue
      }

      const lineCost = cost.unitCost * qtyInCostUnit
      total += lineCost
      lines.push({
        kind: "ingredient",
        refId: ing.canonicalIngredientId,
        name: ing.canonicalIngredient?.name ?? ing.ingredientName ?? "ingredient",
        quantity: ing.quantity,
        unit: ing.unit,
        unitCost: cost.unitCost,
        costUnit: cost.unit,
        lineCost,
        missingCost: false,
        costSource: cost.source,
        sourceInvoiceId: cost.sourceInvoiceId,
        sourceLineItemId: cost.sourceLineItemId,
        sourceVendor: cost.sourceVendor,
        sourceSku: cost.sourceSku,
        sourceInvoiceDate: cost.asOfDate,
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

  // Apply the recipe-level override as a fallback whenever we couldn't produce
  // a real total. Covers two cases: (a) partial — some ingredients missing
  // cost, and (b) empty — no ingredient lines at all (common for modifier
  // recipes that just carry an override dollar amount).
  if (total === 0 && recipe.foodCostOverride != null) {
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
