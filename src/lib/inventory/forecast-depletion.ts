import { prisma } from "@/lib/prisma"
import {
  loadRecipeGraph,
  walkRecipeForIngredientSync,
  RecipeWalkCycleError,
  type RecipeGraph,
} from "./recipe-walk"

/**
 * Forecast-shaped depletion — the missing half of the reorder math.
 *
 * ## What was wrong with the number this replaces
 *
 * `computeDailyDepletionRate` returns a FLAT trailing mean: the last fourteen
 * days of theoretical usage divided by fourteen. `computeReorderRecommendation`
 * then divides on-hand by that scalar to get days of cover. Which means a
 * Rams-game Friday and a wet Tuesday consume stock at exactly the same rate,
 * and the one week of the year the kitchen is busiest is the week the cover
 * figure is most wrong — in the direction that runs the restaurant out.
 *
 * That is not a modelling gap. Every input for the correct number is already
 * on file and has been for months:
 *
 *   - `ForecastMenuItem` — daily predicted quantity per (store, item), with
 *     conformal P10/P90 and a MinTrace-reconciled variant, written nightly by
 *     `ml/run_nightly.py`.
 *   - `OtterItemMapping` — the item's recipe. (`otterItemSkuId` carries the
 *     Otter item NAME, not a synthetic sku; `food-cost-forecast-actions.ts`
 *     joins on exactly this pair and is the precedent copied here.)
 *   - `walkRecipeForIngredientSync` — the recipe forest exploded to canonical
 *     ingredients in recipe units, cycle-safe, against one preloaded graph.
 *
 * So this module is a JOIN, not a model. It asks the demand forecast the
 * question inventory needed answering all along: not "how much of this do we
 * get through on an average day", but "how much of this does *the week that is
 * actually coming* get through, day by day".
 *
 * ## Newest generation only
 *
 * `ForecastMenuItem` is append-only across model generations, the same trap
 * `newestGenerationPerDay` guards on the revenue side. Summing every row for a
 * date multiplies demand by however many times the nightly has run over it.
 * Deduped here on (store, sku, date) by `generatedAt`.
 *
 * ## Tenancy
 *
 * `accountId` is the boundary. The ingredient read filters on it directly and
 * the recipe graph is loaded for that account; `storeIds` must already have
 * been resolved through `resolveStoreContext` by the caller.
 */

/** One day of predicted consumption for one ingredient, in recipe units. */
export interface ForecastDepletionDay {
  /** ISO day, UTC. */
  date: string
  qty: number
}

export interface ForecastDepletionResult {
  ingredientId: string
  recipeUnit: string
  /** Ordered from the window's first day forward. One entry per day asked for. */
  days: ForecastDepletionDay[]
  /** Σ days[].qty. */
  totalQty: number
  /** totalQty / days.length — the flat rate this window IMPLIES, for comparison. */
  meanPerDay: number
  /**
   * True when at least one forecast row could not be exploded: no recipe
   * mapping for the item, or a cycle in the recipe graph. The figure is then a
   * floor rather than an estimate, and a caller that shows it should say so.
   */
  partial: boolean
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Predicted consumption per ingredient per day over a forward window.
 *
 * Returns a map keyed by ingredient id. An ingredient with no forecast demand
 * still gets an entry — a row of zeroes and `totalQty: 0` — because "nothing
 * predicted" and "not asked about" are different answers and the caller has to
 * be able to tell them apart.
 */
export async function computeForecastShapedDepletion(input: {
  accountId: string
  storeIds: string[]
  ingredientIds: string[]
  /** First day of the window, inclusive. Truncated to a UTC day. */
  from: Date
  /** How many days forward, inclusive of `from`. */
  days: number
}): Promise<Map<string, ForecastDepletionResult>> {
  const out = new Map<string, ForecastDepletionResult>()
  if (input.ingredientIds.length === 0 || input.storeIds.length === 0 || input.days <= 0) {
    return out
  }

  const start = new Date(Date.UTC(
    input.from.getUTCFullYear(),
    input.from.getUTCMonth(),
    input.from.getUTCDate(),
  ))
  const end = new Date(start.getTime() + input.days * MS_PER_DAY)
  const dayKeys: string[] = []
  for (let i = 0; i < input.days; i++) {
    dayKeys.push(ymd(new Date(start.getTime() + i * MS_PER_DAY)))
  }

  const [ingredients, forecastRows, mappings, graph] = await Promise.all([
    prisma.canonicalIngredient.findMany({
      // The tenancy boundary. An ingredient id from a query string reaches
      // this function untrusted; filtering on `accountId` is what makes the
      // id safe rather than the caller's promise about where it came from.
      where: { accountId: input.accountId, id: { in: input.ingredientIds } },
      select: { id: true, recipeUnit: true },
    }),
    prisma.forecastMenuItem.findMany({
      where: {
        storeId: { in: input.storeIds },
        forecastDate: { gte: start, lt: end },
      },
      select: {
        storeId: true,
        otterItemSkuId: true,
        forecastDate: true,
        predictedQty: true,
        generatedAt: true,
      },
    }),
    prisma.otterItemMapping.findMany({
      where: { storeId: { in: input.storeIds } },
      select: { storeId: true, otterItemName: true, recipeId: true },
    }),
    loadRecipeGraph(input.accountId),
  ])

  for (const ing of ingredients) {
    out.set(ing.id, {
      ingredientId: ing.id,
      recipeUnit: ing.recipeUnit ?? "",
      days: dayKeys.map((date) => ({ date, qty: 0 })),
      totalQty: 0,
      meanPerDay: 0,
      partial: false,
    })
  }
  if (out.size === 0) return out

  // Newest generation per (store, sku, date). See the file note.
  type Row = (typeof forecastRows)[number]
  const newest = new Map<string, Row>()
  for (const r of forecastRows) {
    const key = `${r.storeId}|${r.otterItemSkuId}|${ymd(r.forecastDate)}`
    const prior = newest.get(key)
    if (!prior || r.generatedAt > prior.generatedAt) newest.set(key, r)
  }

  // Per-store, because the same Otter item name can map to different recipes
  // in different kitchens.
  const recipeByStoreItem = new Map<string, string>()
  for (const m of mappings) {
    recipeByStoreItem.set(`${m.storeId}|${m.otterItemName}`, m.recipeId)
  }

  const dayIndex = new Map(dayKeys.map((k, i) => [k, i]))
  const perServing = new Map<string, number>()

  for (const row of newest.values()) {
    const idx = dayIndex.get(ymd(row.forecastDate))
    if (idx === undefined) continue
    const recipeId = row.otterItemSkuId
      ? recipeByStoreItem.get(`${row.storeId}|${row.otterItemSkuId}`)
      : undefined
    if (!recipeId) {
      // An unmapped item is demand we cannot explode. Every ingredient's
      // figure is a floor while one exists, so all of them are marked.
      for (const r of out.values()) r.partial = true
      continue
    }
    for (const result of out.values()) {
      const cacheKey = `${recipeId}|${result.ingredientId}`
      let per = perServing.get(cacheKey)
      if (per === undefined) {
        per = walkSafe(graph, recipeId, result.ingredientId, result.recipeUnit, result)
        perServing.set(cacheKey, per)
      }
      if (per === 0) continue
      result.days[idx].qty += per * row.predictedQty
    }
  }

  for (const result of out.values()) {
    result.totalQty = result.days.reduce((s, d) => s + d.qty, 0)
    result.meanPerDay = result.totalQty / result.days.length
  }
  return out
}

/** A cycle is a data defect, not a crash: the ingredient reports partial. */
function walkSafe(
  graph: RecipeGraph,
  recipeId: string,
  ingredientId: string,
  recipeUnit: string,
  result: ForecastDepletionResult,
): number {
  try {
    return walkRecipeForIngredientSync(graph, recipeId, ingredientId, recipeUnit)
  } catch (e) {
    if (e instanceof RecipeWalkCycleError) {
      result.partial = true
      return 0
    }
    throw e
  }
}

export interface CoverFromSeries {
  /**
   * Days of cover, fractional. `null` when the series consumes nothing at all
   * and no tail rate is known — an ingredient nothing on the menu uses has no
   * cover figure, and printing "∞ days" would be a claim about the future.
   */
  coverDays: number | null
  /** True when on-hand survives the whole forecast window and the tail is an extrapolation. */
  beyondHorizon: boolean
}

/**
 * Days of cover against a DAY-BY-DAY demand series rather than a scalar rate.
 *
 * This is the whole point of the module: the same on-hand quantity buys fewer
 * days when the busy days come first. Stock is drawn down day by day and the
 * crossing is interpolated inside the day it happens, so an ingredient that
 * runs out at lunch on the fourth day reads 3.4 days, not 4.
 *
 * Past the end of the forecast horizon there is nothing left to shape the
 * demand with, so the remainder is extrapolated at `tailRate` — normally the
 * window's own mean. That part is flagged: it is the old flat assumption, and
 * a caller that draws a marker for it should draw it differently.
 */
export function coverDaysFromSeries(
  onHand: number,
  series: number[],
  tailRate: number,
): CoverFromSeries {
  if (onHand <= 0) return { coverDays: 0, beyondHorizon: false }

  let remaining = onHand
  for (let i = 0; i < series.length; i++) {
    const demand = series[i]
    if (demand <= 0) continue
    if (remaining <= demand) {
      // Interpolate inside the day. `remaining / demand` is the fraction of
      // that day's trade the stock covers.
      return { coverDays: i + remaining / demand, beyondHorizon: false }
    }
    remaining -= demand
  }

  if (tailRate <= 0) return { coverDays: null, beyondHorizon: true }
  return { coverDays: series.length + remaining / tailRate, beyondHorizon: true }
}
