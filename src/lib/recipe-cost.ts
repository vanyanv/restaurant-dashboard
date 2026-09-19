import { prisma } from "@/lib/prisma"
import { getCanonicalIngredientCost } from "@/lib/canonical-ingredients"
import {
  canonicalizeUnit,
  convert,
  resolveYieldQuantity,
} from "@/lib/unit-conversion"

/**
 * THE recipe cost walk. One walk, two entry points.
 *
 * ## Why there is only one of it now
 *
 * There used to be four: this file's single-recipe walker, this file's
 * `batchRecipeCosts`, a third in `recipe-cost-batch.ts` exporting the SAME
 * NAME from a different path, and a fourth inlined in `previewRecipeCost` so
 * the editor could price an unsaved recipe. Which behaviour a page got was
 * decided by which module it happened to import, and they disagreed: one
 * flagged a recipe partial when the price-spike guard rejected an invoice
 * line and one had never heard of the guard; one reported `emptyWalk` so a
 * $0.00 override could be told apart from a real cost and one did not; a
 * missing component recipe was a harmless zero in one and a thrown error that
 * aborted the whole account's cost map in another.
 *
 * `prime-cost.ts` already argues this case — "it is the one number in the
 * product with a published ceiling behind it, so it cannot be two numbers."
 * Recipe cost carries the food line of the P&L and had four. So: `walk` below
 * is the only implementation, and the two entry points differ ONLY in how they
 * fetch — `computeRecipeCost` queries per recipe and per ingredient (and can
 * therefore honour `asOf` and `storeId`), `batchRecipeCosts` prefetches the
 * whole account into two maps and hands the walk a synchronous lookup. Neither
 * owns any arithmetic.
 *
 * ## The two numbers, and why both exist
 *
 * `batchCost` is what the lines add up to: one whole batch, as entered.
 * `totalCost` is `batchCost / servingSize` — the cost of ONE of whatever the
 * recipe yields, and the figure every consumer wants. `cogs-materializer.ts`
 * multiplies it by plates sold; `adapters/recipe.ts` prints it as "Cost per
 * serving"; the menu margin columns divide a sell price by it.
 *
 * Until 2026-09-19 there was only `totalCost`, and it was the BATCH — the
 * walk selected `servingSize` and never divided by it. Every recipe in this
 * account yields 1, so the figure was right by accident and the bug was
 * dormant. It was also armed: the moment a yield box shipped, the first
 * batch recipe an owner entered would have multiplied its own food cost by
 * its yield, silently, all the way into Gross Profit.
 *
 * Naming `totalCost` as the per-serving figure rather than adding a second
 * field is deliberate: it means every existing caller, including ones nobody
 * has looked at, becomes CORRECT for a batch recipe rather than quietly
 * wrong. A caller that genuinely wants the batch asks for `batchCost` by
 * name.
 */

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
  /**
   * Why this line could not be costed, when it could not. Null on a costed
   * line. This is here because "missing" used to cover three different
   * failures that want three different sentences on the page: an ingredient
   * nobody has priced, a unit that does not convert, and a sub-recipe whose
   * batch this line cannot be measured against.
   */
  missingReason?: "no-price" | "unit-mismatch" | "yield-mismatch" | "unresolved" | null
  /** How the unit cost was established (ingredient kind only; undefined for sub-recipes). */
  costSource?: "manual" | "invoice" | null
  /**
   * Usable fraction applied to this line (ingredient kind only). 1 means no
   * trim or cooking loss, which is every ingredient until somebody sets one.
   */
  yieldFactor?: number
  /**
   * For a component line: how much of the sub-recipe's own yield this line
   * draws, in the sub's yield unit. `2` against a batch of `128 fl oz` means
   * two fluid ounces, i.e. one sixty-fourth of it. Null when the line's unit
   * could not be reconciled with the batch's.
   */
  qtyInYieldUnit?: number | null
  /**
   * Component line only. True when the sub-recipe yields PORTIONS and this
   * line's unit is not a portion — "2 oz" of something counted in servings.
   * The quantity is counted as servings, which is exactly what the old walk
   * did with it, and this flag is what lets a page say the unit was not
   * believed rather than silently costing a measure as a count.
   */
  unitAssumed?: boolean
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
  /**
   * The cost of ONE of whatever this recipe yields — `batchCost / servingSize`.
   * This is the figure COGS multiplies by plates sold and every page prints.
   */
  totalCost: number
  /** What the lines add up to: one whole batch, as entered. */
  batchCost: number
  /** How many one batch makes. Always > 0 (DB CHECK). */
  servingSize: number
  /** The unit `servingSize` is in. Null = portions. */
  yieldUnit: string | null
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
  /**
   * Whether the recipe has any lines at all, which `emptyWalk` deliberately
   * does not tell you — a recipe whose every line failed to price also walks
   * to nothing. The recipes catalogue printed "No lines" on both, which is a
   * false sentence about the second one: it HAS lines, and they are the
   * problem. Read the two together.
   */
  hasLines: boolean
  /**
   * The recipe-level fallback was used because the walk is incomplete: it
   * produced no cost, or at least one line could not be priced. A complete
   * walk still wins, which preserves recipes imported from R365 with both a
   * reference cost and real ingredient lines. `computedCost` keeps the amount
   * established by the priced lines visible while `totalCost` is the safer
   * figure booked into COGS.
   */
  overrideApplied: boolean
  /** What the lines came to, before any override fallback. Per serving. */
  computedCost: number
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
 * and produce a line cost. Single source of truth for every caller.
 *
 * `yieldFactor` is the usable fraction of what gets bought — 0.8 means a fifth
 * of the lettuce is core and outer leaves. A recipe line states what lands on
 * the plate, so the cost is what has to be PURCHASED to put it there:
 * `qty × price ÷ yieldFactor`. It defaults to 1, which is every ingredient
 * until somebody sets one, so no existing figure moves.
 *
 * Returns `qtyInCostUnit: null` (and `lineCost: 0`) when the units can't be
 * reconciled — callers mark the line missing in that case.
 */
export function computeIngredientLineCost(args: {
  ingredientQuantity: number
  ingredientUnit: string
  costUnitCost: number
  costUnit: string
  /** Usable fraction, in (0, 1]. Anything else is ignored and treated as 1. */
  yieldFactor?: number
}): { lineCost: number; qtyInCostUnit: number | null } {
  const { ingredientQuantity, ingredientUnit, costUnitCost, costUnit } = args
  const yieldFactor =
    args.yieldFactor != null && isFinite(args.yieldFactor) && args.yieldFactor > 0 && args.yieldFactor <= 1
      ? args.yieldFactor
      : 1
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
  return { lineCost: (costUnitCost * qtyInCostUnit) / yieldFactor, qtyInCostUnit }
}

/* -- the walk --------------------------------------------------------- */

/** One recipe as the walk needs it, however it was fetched. */
export type RecipeRowForCost = {
  id: string
  itemName: string
  servingSize: number
  yieldUnit: string | null
  foodCostOverride: number | null
  ingredients: Array<{
    id: string
    quantity: number
    unit: string
    ingredientName: string | null
    canonicalIngredientId: string | null
    componentRecipeId: string | null
    canonicalIngredient: { id: string; name: string } | null
    componentRecipe: { id: string; itemName: string } | null
  }>
}

/** What the walk needs to resolve an ingredient's price. */
type ResolvedCost = {
  unitCost: number
  unit: string
  source: "manual" | "invoice"
  asOfDate: Date
  sourceInvoiceId: string | null
  sourceLineItemId: string | null
  sourceVendor: string | null
  sourceSku: string | null
  costGuardTriggered?: boolean
  yieldFactor?: number
}

type WalkIO = {
  loadRecipe: (recipeId: string) => Promise<RecipeRowForCost | null> | RecipeRowForCost | null
  resolveCost: (canonicalIngredientId: string) => Promise<ResolvedCost | null> | ResolvedCost | null
  asOf?: Date
}

/** The `select` both fetch paths use, so neither can drift from the other. */
export const RECIPE_COST_SELECT = {
  id: true,
  itemName: true,
  servingSize: true,
  yieldUnit: true,
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
} as const

async function walk(
  recipeId: string,
  io: WalkIO,
  stack: string[],
  memo: Map<string, RecipeCostResult>,
  /** True for a recipe reached as somebody's component, false for the one asked for. */
  asComponent: boolean
): Promise<RecipeCostResult | null> {
  if (stack.includes(recipeId)) {
    throw new RecipeCycleError([...stack, recipeId])
  }
  const cached = memo.get(recipeId)
  if (cached) return cached

  const recipe = await io.loadRecipe(recipeId)
  if (!recipe) {
    // A recipe asked for by name that does not exist is the caller's error and
    // throws, as it always has. A COMPONENT that has gone missing is a broken
    // line on an otherwise fine recipe, and costing the other fifty-nine
    // recipes beats refusing to cost any of them — which is what the second
    // batch implementation used to do here, by throwing a plain Error that no
    // per-recipe catch was looking for.
    if (!asComponent) throw new Error(`Recipe ${recipeId} not found`)
    return null
  }

  const lines: RecipeCostLine[] = []
  let batch = 0
  let partial = false

  for (const ing of recipe.ingredients) {
    if (ing.componentRecipeId) {
      const sub = await walk(ing.componentRecipeId, io, [...stack, recipeId], memo, true)
      const name = ing.componentRecipe?.itemName ?? ing.ingredientName ?? "sub-recipe"

      if (!sub) {
        partial = true
        lines.push({
          kind: "component",
          refId: ing.componentRecipeId,
          name,
          quantity: ing.quantity,
          unit: ing.unit,
          unitCost: null,
          lineCost: 0,
          missingCost: true,
          missingReason: "unresolved",
          qtyInYieldUnit: null,
        })
        continue
      }

      /*
       * THE LINE THAT USED TO COST TWO WHOLE BATCHES.
       *
       * This was `sub.totalCost * ing.quantity`, with `ing.unit` stored,
       * displayed, and never read. A burger carrying "2 oz of house sauce"
       * was charged two entire batches of house sauce — $60.00 against a
       * true $0.47 on a $30 gallon — and `partial` stayed false, so every
       * page reported the plate as fully costed.
       *
       * `resolveYieldQuantity` turns the line into the batch's own unit:
       * 2 oz of a 128 fl oz batch is 2, and `sub.totalCost` is now the cost
       * of one fl oz. A line that cannot be expressed in the batch's unit is
       * REFUSED rather than guessed at, because both available guesses —
       * charge the whole batch, or charge nothing — are worse than a line
       * the page can point at.
       */
      const resolved = resolveYieldQuantity({
        quantity: ing.quantity,
        unit: ing.unit,
        yieldUnit: sub.yieldUnit,
      })

      /*
       * A RECIPE THAT YIELDS PORTIONS HAS NO MEASURE TO REFUSE AGAINST.
       *
       * `yieldUnit` is a new column and every row in every existing account
       * is NULL, which means portions. Refusing a line reading "2 oz" against
       * one would take a figure that is WRONG today and make it $0.00
       * tomorrow — the same understatement this change exists to remove,
       * arriving as a migration with no backfill. The old walk ignored the
       * unit entirely and multiplied the sub-recipe's cost by the quantity,
       * so counting the quantity as servings is exactly what those lines
       * cost today, and nothing moves the day this ships.
       *
       * The unit is not thereby believed. `unitAssumed` travels out so the
       * page can say the line is being counted rather than measured, and the
       * fix is one field away: give the sub-recipe a yield unit and the line
       * converts properly. A MEASURED batch is a different case — nothing in
       * any account has one yet, so refusing there breaks nothing and stops
       * the $60 line from ever being entered again.
       */
      const countedAsServings = resolved == null && !sub.yieldUnit
      const qtyInYieldUnit = countedAsServings ? ing.quantity : resolved

      if (qtyInYieldUnit == null) {
        partial = true
        lines.push({
          kind: "component",
          refId: ing.componentRecipeId,
          name,
          quantity: ing.quantity,
          unit: ing.unit,
          unitCost: sub.totalCost,
          costUnit: sub.yieldUnit,
          lineCost: 0,
          missingCost: true,
          missingReason: "yield-mismatch",
          qtyInYieldUnit: null,
        })
        continue
      }

      const lineCost = sub.totalCost * qtyInYieldUnit
      batch += lineCost
      if (sub.partial) partial = true
      lines.push({
        kind: "component",
        refId: ing.componentRecipeId,
        name,
        quantity: ing.quantity,
        unit: ing.unit,
        unitCost: sub.totalCost,
        costUnit: sub.yieldUnit,
        lineCost,
        missingCost: sub.partial,
        missingReason: sub.partial ? "no-price" : null,
        qtyInYieldUnit,
        unitAssumed: countedAsServings,
      })
      continue
    }

    if (ing.canonicalIngredientId) {
      const cost = await io.resolveCost(ing.canonicalIngredientId)
      const name = ing.canonicalIngredient?.name ?? ing.ingredientName ?? "ingredient"

      if (!cost) {
        partial = true
        lines.push({
          kind: "ingredient",
          refId: ing.canonicalIngredientId,
          name,
          quantity: ing.quantity,
          unit: ing.unit,
          unitCost: null,
          lineCost: 0,
          missingCost: true,
          missingReason: "no-price",
        })
        continue
      }

      const yieldFactor = cost.yieldFactor ?? 1
      const { lineCost, qtyInCostUnit } = computeIngredientLineCost({
        ingredientQuantity: ing.quantity,
        ingredientUnit: ing.unit,
        costUnitCost: cost.unitCost,
        costUnit: cost.unit,
        yieldFactor,
      })

      const provenance = {
        costSource: cost.source,
        sourceInvoiceId: cost.sourceInvoiceId,
        sourceLineItemId: cost.sourceLineItemId,
        sourceVendor: cost.sourceVendor,
        sourceSku: cost.sourceSku,
        sourceInvoiceDate: cost.asOfDate,
      }

      if (qtyInCostUnit == null) {
        partial = true
        lines.push({
          kind: "ingredient",
          refId: ing.canonicalIngredientId,
          name,
          quantity: ing.quantity,
          unit: ing.unit,
          unitCost: cost.unitCost,
          costUnit: cost.unit,
          lineCost: 0,
          missingCost: true,
          missingReason: "unit-mismatch",
          yieldFactor,
          ...provenance,
        })
        continue
      }

      // The cost guard rejected an implausible price spike on the newest
      // invoice line and fell back to an older one. The cost we used is the
      // trusted fallback, but flag the recipe so the bad source line surfaces
      // in the COGS data-quality panel for review.
      if (cost.costGuardTriggered) partial = true

      batch += lineCost
      lines.push({
        kind: "ingredient",
        refId: ing.canonicalIngredientId,
        name,
        quantity: ing.quantity,
        unit: ing.unit,
        unitCost: cost.unitCost,
        costUnit: cost.unit,
        lineCost,
        missingCost: false,
        missingReason: null,
        yieldFactor,
        ...provenance,
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
      missingReason: "unresolved",
    })
  }

  // Apply the recipe-level value as a fallback whenever the walk is incomplete.
  // A partially priced recipe has only established a known minimum; booking it
  // as the whole plate cost understates COGS. `partial` is intentionally not
  // the condition here because it also marks a price-spike guard that DID find
  // and use a trusted historical price. Missing lines are the decisive signal.
  const walkedToNothing = batch === 0
  const hasMissingLines = lines.some((line) => line.missingCost)
  const overrideApplied =
    (walkedToNothing || hasMissingLines) && recipe.foodCostOverride != null
  const computedBatch = batch
  if (overrideApplied) batch = recipe.foodCostOverride as number

  // `servingSize` carries a DB CHECK for > 0, but a walk that divides by a
  // number it did not validate is one bad row away from Infinity landing in
  // the P&L. Clamp rather than trust.
  const servingSize =
    isFinite(recipe.servingSize) && recipe.servingSize > 0 ? recipe.servingSize : 1

  const result: RecipeCostResult = {
    recipeId: recipe.id,
    itemName: recipe.itemName,
    totalCost: batch / servingSize,
    batchCost: batch,
    servingSize,
    yieldUnit: recipe.yieldUnit,
    lines,
    partial,
    // Recorded BEFORE the override fallback above could disguise it. A recipe
    // with no lines and a $0.00 override is indistinguishable from a costed
    // one by the time this object is read, unless the fact is carried out.
    emptyWalk: walkedToNothing,
    hasLines: recipe.ingredients.length > 0,
    overrideApplied,
    computedCost: computedBatch / servingSize,
    asOf: io.asOf,
  }
  memo.set(recipeId, result)
  return result
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
  const result = await walk(
    recipeId,
    {
      asOf,
      loadRecipe: (id) =>
        prisma.recipe.findUnique({ where: { id }, select: RECIPE_COST_SELECT }),
      resolveCost: (id) =>
        getCanonicalIngredientCost(id, asOf, options?.storeId ? { storeId: options.storeId } : undefined),
    },
    [],
    memo,
    false
  )
  // `asComponent: false` means a missing recipe threw rather than returning
  // null, so this cannot be null. The assertion says why rather than casting.
  if (!result) throw new Error(`Recipe ${recipeId} not found`)
  return result
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
 * This runs the SAME `walk` against two prefetched maps — every recipe with
 * its lines in one query, every canonical cost in `batchCanonicalCosts`' three
 * — and shares ONE memo across the whole set. Not "the same arithmetic": the
 * same function. A figure here cannot disagree with a figure on the builder,
 * because there is nothing here that could disagree.
 *
 * `asOf` is deliberately NOT a parameter. `batchCanonicalCosts` prices at the
 * latest invoice, which is builder semantics; a historical walk needs the
 * as-of provenance query per ingredient and belongs in `computeRecipeCost`.
 * Taking an `asOf` here and quietly ignoring it would be worse than not
 * offering it.
 */
export async function batchRecipeCosts(
  accountId: string,
  canonicalCostMap?: Map<string, ResolvedCost>
): Promise<Map<string, RecipeCostResult>> {
  const { batchCanonicalCosts } = await import("@/lib/canonical-cost-batch")

  const [recipes, costs] = await Promise.all([
    prisma.recipe.findMany({ where: { accountId }, select: RECIPE_COST_SELECT }),
    canonicalCostMap ? Promise.resolve(canonicalCostMap) : batchCanonicalCosts(accountId),
  ])

  const byId = new Map(recipes.map((r) => [r.id, r]))
  const memo = new Map<string, RecipeCostResult>()
  const io: WalkIO = {
    loadRecipe: (id) => byId.get(id) ?? null,
    resolveCost: (id) => costs.get(id) ?? null,
  }

  for (const r of recipes) {
    // A cycle is a property of one subtree, not of the account. Costing the
    // other 59 recipes is more useful than refusing to cost any of them, so
    // the bad one is left out of the map and its callers see "no cost".
    try {
      await walk(r.id, io, [], memo, false)
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

/**
 * Cost a recipe that has not been saved — the editor's live figure.
 *
 * Built out of the same `walk` by handing it an in-memory row for the draft
 * and the database for everything the draft points at. The fourth
 * implementation this replaces did not apply the override fallback and did not
 * flag the price-spike guard, so the number under an owner's cursor could
 * differ from the number they got after pressing Save.
 */
export async function previewRecipeCost(input: {
  itemName?: string
  servingSize?: number
  yieldUnit?: string | null
  foodCostOverride?: number | null
  ingredients: Array<{
    canonicalIngredientId?: string | null
    componentRecipeId?: string | null
    quantity: number
    unit: string
    ingredientName?: string | null
  }>
}): Promise<RecipeCostResult> {
  const DRAFT = "__draft__"
  const draft: RecipeRowForCost = {
    id: DRAFT,
    itemName: input.itemName ?? "",
    servingSize: input.servingSize ?? 1,
    yieldUnit: input.yieldUnit ?? null,
    foodCostOverride: input.foodCostOverride ?? null,
    ingredients: input.ingredients.map((ing, i) => ({
      id: `draft:${i}`,
      quantity: ing.quantity,
      unit: ing.unit,
      ingredientName: ing.ingredientName ?? null,
      canonicalIngredientId: ing.canonicalIngredientId ?? null,
      componentRecipeId: ing.componentRecipeId ?? null,
      canonicalIngredient: null,
      componentRecipe: null,
    })),
  }

  const memo = new Map<string, RecipeCostResult>()
  const result = await walk(
    DRAFT,
    {
      loadRecipe: (id) =>
        id === DRAFT
          ? draft
          : prisma.recipe.findUnique({ where: { id }, select: RECIPE_COST_SELECT }),
      resolveCost: (id) => getCanonicalIngredientCost(id),
    },
    [],
    memo,
    false
  )
  if (!result) throw new Error("Draft recipe could not be costed")
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
