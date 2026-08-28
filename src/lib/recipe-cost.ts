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
  /**
   * True when NO line produced any cost — either the recipe has no ingredient
   * lines at all, or every line it has costed to nothing.
   *
   * This is not the same as `partial`, and the difference is the whole point.
   * `partial` means "some of this total is missing"; a recipe with zero lines
   * never enters the loop, so nothing is ever marked missing and `partial`
   * stays FALSE. The walk then falls through to `foodCostOverride` and
   * returns a confident-looking number.
   *
   * "The Reverse Bun" is a sellable slider with no lines and an override of
   * $0.00. It returns `totalCost: 0, partial: false` — a plate that reports,
   * with no reservation attached, that it costs nothing to make. It sold 546
   * for $4,324 in ninety days. Anything ranking or judging a plate cost has to
   * be able to tell that apart from a cost that was actually computed.
   */
  emptyWalk: boolean
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
 * Deduped log of unit-conversion failures, keyed by the (from → to) pair.
 * Logs once per unique pair per process to avoid spam during batch costing.
 * Surfaces the top offenders in Vercel logs so "N recipes fail from 'head' to
 * 'oz'" is greppable.
 */
const loggedConversionFailures = new Set<string>()

/**
 * Reconcile a recipe-line's quantity/unit against the canonical cost's unit
 * and produce a line cost. Single source of truth for both the single-recipe
 * walker and the batched loader.
 *
 * Returns `qtyInCostUnit: null` (and `lineCost: 0`) when the units can't be
 * reconciled — callers should mark the line as missing in that case.
 */
export function computeIngredientLineCost(args: {
  ingredientQuantity: number
  ingredientUnit: string
  costUnitCost: number
  costUnit: string
}): { lineCost: number; qtyInCostUnit: number | null } {
  const { ingredientQuantity, ingredientUnit, costUnitCost, costUnit } = args
  const recipeUnit = canonicalizeUnit(ingredientUnit)
  const normalizedCostUnit = canonicalizeUnit(costUnit)
  let qtyInCostUnit: number | null = ingredientQuantity
  if (recipeUnit && normalizedCostUnit && recipeUnit !== normalizedCostUnit) {
    qtyInCostUnit = convert(ingredientQuantity, ingredientUnit, costUnit)
  } else if (!recipeUnit || !normalizedCostUnit) {
    const same =
      ingredientUnit.trim().toLowerCase() === costUnit.trim().toLowerCase()
    if (!same) qtyInCostUnit = null
  }
  if (qtyInCostUnit == null) {
    const key = `${ingredientUnit.trim().toLowerCase()}→${costUnit.trim().toLowerCase()}`
    if (!loggedConversionFailures.has(key)) {
      loggedConversionFailures.add(key)
      console.warn("[recipe-cost] unit conversion failed — line costed as $0", {
        ingredientUnit,
        costUnit,
        canonicalizedIngredientUnit: recipeUnit,
        canonicalizedCostUnit: normalizedCostUnit,
      })
    }
    return { lineCost: 0, qtyInCostUnit: null }
  }
  return { lineCost: costUnitCost * qtyInCostUnit, qtyInCostUnit }
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
  asOf?: Date,
  options?: { storeId?: string }
): Promise<RecipeCostResult> {
  const memo = new Map<string, RecipeCostResult>()
  return walk(recipeId, asOf, [], memo, options?.storeId)
}

async function walk(
  recipeId: string,
  asOf: Date | undefined,
  stack: string[],
  memo: Map<string, RecipeCostResult>,
  storeId?: string
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
        memo,
        storeId
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
        asOf,
        storeId ? { storeId } : undefined
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

      const { lineCost, qtyInCostUnit } = computeIngredientLineCost({
        ingredientQuantity: ing.quantity,
        ingredientUnit: ing.unit,
        costUnitCost: cost.unitCost,
        costUnit: cost.unit,
      })

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

      // The cost guard rejected an implausible price spike on the newest
      // invoice line and fell back to an older one. The cost we used is the
      // trusted fallback, but flag the recipe so the bad source line surfaces
      // in the COGS data-quality panel for review.
      if (cost.costGuardTriggered) partial = true

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
  const walkedToNothing = total === 0
  if (total === 0 && recipe.foodCostOverride != null) {
    total = recipe.foodCostOverride
  }

  const result: RecipeCostResult = {
    recipeId: recipe.id,
    itemName: recipe.itemName,
    totalCost: total,
    lines,
    partial,
    // Recorded BEFORE the override fallback above could disguise it. A recipe
    // with no lines and a $0.00 override is indistinguishable from a costed
    // one by the time this object is read, unless the fact is carried out.
    emptyWalk: walkedToNothing,
    asOf,
  }
  memo.set(recipeId, result)
  return result
}

/**
 * Cheaper dry-run: just walks the recipe graph and validates there are no cycles
 * and that every terminal node has a resolvable ref. Used by recipe-actions
 * before a save to surface cycle errors without running cost queries.
 *
 * Pass the transaction client when calling inside a transaction — the walk
 * must see the uncommitted ingredient writes, and a cycle then rolls the
 * whole save back instead of needing a compensating delete.
 */
export async function assertNoCycles(
  recipeId: string,
  db: Pick<typeof prisma, "recipeIngredient"> = prisma
): Promise<void> {
  const visited = new Set<string>()
  async function walkIds(id: string, stack: string[]) {
    if (stack.includes(id)) {
      throw new RecipeCycleError([...stack, id])
    }
    if (visited.has(id)) return
    visited.add(id)

    const ingredients = await db.recipeIngredient.findMany({
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

/**
 * Cost MANY recipes at once.
 *
 * `computeRecipeCost` memoizes within a single call, which is right for the
 * builder — one recipe, its sub-recipes costed once each. It is the wrong
 * shape for a listing: sixty separate calls each open their own memo, so
 * `Straight Cut Fries` (a component of eight other recipes) is fetched and
 * priced nine times, and every canonical cost is looked up again on every
 * walk. Measured on this account's 60 recipes: **6.1s in parallel, 66.4s
 * serially.** No page section can be built on that.
 *
 * This does the same walk against two prefetched maps — every recipe with its
 * lines in one query, every canonical cost in `batchCanonicalCosts`' three —
 * and shares ONE memo across the whole set. The per-line arithmetic is
 * `computeIngredientLineCost`, the same function the single-recipe walker
 * calls, so a figure here cannot disagree with a figure on the builder.
 *
 * `asOf` is deliberately NOT a parameter. `batchCanonicalCosts` prices at the
 * latest invoice, which is builder semantics; a historical walk needs the
 * as-of provenance query per ingredient and belongs in `computeRecipeCost`.
 * Taking an `asOf` here and quietly ignoring it would be worse than not
 * offering it.
 */
export async function batchRecipeCosts(
  accountId: string
): Promise<Map<string, RecipeCostResult>> {
  const { batchCanonicalCosts } = await import("@/lib/canonical-cost-batch")

  const [recipes, costs] = await Promise.all([
    prisma.recipe.findMany({
      where: { accountId },
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
    }),
    batchCanonicalCosts(accountId),
  ])

  const byId = new Map(recipes.map((r) => [r.id, r]))
  const memo = new Map<string, RecipeCostResult>()

  const walkOne = (recipeId: string, stack: string[]): RecipeCostResult => {
    const cached = memo.get(recipeId)
    if (cached) return cached
    if (stack.includes(recipeId)) throw new RecipeCycleError([...stack, recipeId])

    const recipe = byId.get(recipeId)
    if (!recipe) throw new Error(`Recipe ${recipeId} not found`)

    const lines: RecipeCostLine[] = []
    let total = 0
    let partial = false

    for (const ing of recipe.ingredients) {
      if (ing.componentRecipeId) {
        const sub = walkOne(ing.componentRecipeId, [...stack, recipeId])
        const lineCost = sub.totalCost * ing.quantity
        total += lineCost
        if (sub.partial) partial = true
        lines.push({
          kind: "component",
          refId: ing.componentRecipeId,
          name: ing.componentRecipe?.itemName ?? ing.ingredientName ?? "sub-recipe",
          quantity: ing.quantity,
          unit: ing.unit,
          unitCost: sub.totalCost,
          lineCost,
          missingCost: sub.partial,
        })
        continue
      }

      const cost = ing.canonicalIngredientId ? costs.get(ing.canonicalIngredientId) : undefined
      const name = ing.canonicalIngredient?.name ?? ing.ingredientName ?? "ingredient"
      const refId = ing.canonicalIngredientId ?? ing.id

      if (!cost) {
        partial = true
        lines.push({
          kind: "ingredient",
          refId,
          name,
          quantity: ing.quantity,
          unit: ing.unit,
          unitCost: null,
          lineCost: 0,
          missingCost: true,
        })
        continue
      }

      const { lineCost, qtyInCostUnit } = computeIngredientLineCost({
        ingredientQuantity: ing.quantity,
        ingredientUnit: ing.unit,
        costUnitCost: cost.unitCost,
        costUnit: cost.unit,
      })
      if (qtyInCostUnit == null || cost.costGuardTriggered) partial = true
      if (qtyInCostUnit != null) total += lineCost

      lines.push({
        kind: "ingredient",
        refId,
        name,
        quantity: ing.quantity,
        unit: ing.unit,
        unitCost: cost.unitCost,
        costUnit: cost.unit,
        lineCost: qtyInCostUnit == null ? 0 : lineCost,
        missingCost: qtyInCostUnit == null,
        costSource: cost.source,
        sourceInvoiceId: cost.sourceInvoiceId,
        sourceLineItemId: cost.sourceLineItemId,
        sourceVendor: cost.sourceVendor,
        sourceSku: cost.sourceSku,
        sourceInvoiceDate: cost.asOfDate,
      })
    }

    const walkedToNothing = total === 0
    if (total === 0 && recipe.foodCostOverride != null) total = recipe.foodCostOverride

    const result: RecipeCostResult = {
      recipeId: recipe.id,
      itemName: recipe.itemName,
      totalCost: total,
      lines,
      partial,
      emptyWalk: walkedToNothing,
    }
    memo.set(recipeId, result)
    return result
  }

  for (const r of recipes) {
    // A cycle is a property of one subtree, not of the account. Costing the
    // other 59 recipes is more useful than refusing to cost any of them, so
    // the bad one is left out of the map and its callers see "no cost".
    try {
      walkOne(r.id, [])
    } catch (error) {
      if (error instanceof RecipeCycleError) {
        console.warn(`[recipe-cost] cycle, recipe skipped: ${error.chain.join(" -> ")}`)
        continue
      }
      throw error
    }
  }

  return memo
}
