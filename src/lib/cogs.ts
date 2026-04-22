import { prisma } from "@/lib/prisma"
import { computeRecipeCost } from "@/lib/recipe-cost"
import { canonicalizeUnit, convert } from "@/lib/unit-conversion"
import { getCanonicalIngredientCost } from "@/lib/canonical-ingredients"

/** Internal: end-exclusive Prisma where for a date window. */
function dateWindow(storeId: string, startDate: Date, endDate: Date) {
  return { storeId, date: { gte: startDate, lt: endDate } }
}

/** Internal: prior-equivalent window (same span, immediately before). */
function priorWindow(startDate: Date, endDate: Date) {
  const span = endDate.getTime() - startDate.getTime()
  const priorEnd = new Date(startDate.getTime())
  const priorStart = new Date(startDate.getTime() - span)
  return { priorStart, priorEnd }
}

/** Internal: collapses a list of DailyCogsItem to ($cogs, $revenue, %). */
async function rollup(where: { storeId: string; date: { gte: Date; lt: Date } }) {
  const agg = await prisma.dailyCogsItem.aggregate({
    where,
    _sum: { lineCost: true, salesRevenue: true },
  })
  const cogsDollars = agg._sum.lineCost ?? 0
  const revenueDollars = agg._sum.salesRevenue ?? 0
  const cogsPct = revenueDollars > 0 ? (cogsDollars / revenueDollars) * 100 : 0
  return { cogsDollars, revenueDollars, cogsPct }
}

export interface CogsKpis {
  cogsPct: number
  cogsDollars: number
  revenueDollars: number
  /** Percentage-points difference vs the prior-equivalent period. Null if prior had no revenue. */
  deltaVsPriorPp: number | null
  /** Percentage-points difference vs Store.targetCogsPct. Null if no target set. */
  deltaVsTargetPp: number | null
  targetCogsPct: number | null
}

export async function getCogsKpis(
  storeId: string,
  startDate: Date,
  endDate: Date
): Promise<CogsKpis> {
  const { priorStart, priorEnd } = priorWindow(startDate, endDate)
  const [current, store, prior] = await Promise.all([
    rollup(dateWindow(storeId, startDate, endDate)),
    prisma.store.findUnique({
      where: { id: storeId },
      select: { targetCogsPct: true },
    }),
    rollup(dateWindow(storeId, priorStart, priorEnd)),
  ])

  const deltaVsPriorPp =
    prior.revenueDollars > 0 ? current.cogsPct - prior.cogsPct : null
  const targetCogsPct = store?.targetCogsPct ?? null
  const deltaVsTargetPp =
    targetCogsPct != null ? current.cogsPct - targetCogsPct : null

  return {
    cogsPct: current.cogsPct,
    cogsDollars: current.cogsDollars,
    revenueDollars: current.revenueDollars,
    deltaVsPriorPp,
    deltaVsTargetPp,
    targetCogsPct,
  }
}

export type Granularity = "daily" | "weekly" | "monthly"

export interface CogsTrendBucket {
  /** ISO date string at the start of the bucket (local midnight, store TZ irrelevant for v1). */
  bucket: string
  cogsDollars: number
  revenueDollars: number
  cogsPct: number
}

/**
 * Returns one row per bucket in [startDate, endDate). Empty buckets are
 * present with 0/0/0 so the chart line is continuous.
 */
export async function getCogsTrend(
  storeId: string,
  startDate: Date,
  endDate: Date,
  granularity: Granularity
): Promise<CogsTrendBucket[]> {
  const rows = await prisma.dailyCogsItem.findMany({
    where: dateWindow(storeId, startDate, endDate),
    select: { date: true, lineCost: true, salesRevenue: true },
    orderBy: { date: "asc" },
  })

  // Bucket key = ISO date string at the start of the bucket.
  const bucketKeyOf = (d: Date) => {
    const dt = new Date(d)
    if (granularity === "daily") {
      // Already a day.
    } else if (granularity === "weekly") {
      // Snap to Monday (ISO week start).
      const dow = (dt.getDay() + 6) % 7 // 0 = Mon
      dt.setDate(dt.getDate() - dow)
    } else {
      // monthly
      dt.setDate(1)
    }
    dt.setHours(0, 0, 0, 0)
    return dt.toISOString().slice(0, 10)
  }

  const map = new Map<string, { cogs: number; rev: number }>()

  // Pre-fill every bucket in range so the chart has continuous x-values.
  const cursor = new Date(startDate)
  cursor.setHours(0, 0, 0, 0)
  while (cursor < endDate) {
    map.set(bucketKeyOf(cursor), { cogs: 0, rev: 0 })
    if (granularity === "daily") cursor.setDate(cursor.getDate() + 1)
    else if (granularity === "weekly") cursor.setDate(cursor.getDate() + 7)
    else cursor.setFullYear(cursor.getFullYear(), cursor.getMonth() + 1, 1)
  }

  for (const r of rows) {
    const k = bucketKeyOf(r.date)
    const cur = map.get(k) ?? { cogs: 0, rev: 0 }
    cur.cogs += r.lineCost
    cur.rev += r.salesRevenue
    map.set(k, cur)
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([bucket, v]) => ({
      bucket,
      cogsDollars: v.cogs,
      revenueDollars: v.rev,
      cogsPct: v.rev > 0 ? (v.cogs / v.rev) * 100 : 0,
    }))
}

export interface CategoryBreakdown {
  category: string
  cogsDollars: number
  pctOfCogs: number
}

export async function getCostByCategory(
  storeId: string,
  startDate: Date,
  endDate: Date
): Promise<CategoryBreakdown[]> {
  const rows = await prisma.dailyCogsItem.groupBy({
    by: ["category"],
    where: dateWindow(storeId, startDate, endDate),
    _sum: { lineCost: true },
  })
  const total = rows.reduce((acc, r) => acc + (r._sum.lineCost ?? 0), 0)
  return rows
    .map((r) => ({
      category: r.category || "(uncategorized)",
      cogsDollars: r._sum.lineCost ?? 0,
      pctOfCogs: total > 0 ? ((r._sum.lineCost ?? 0) / total) * 100 : 0,
    }))
    .sort((a, b) => b.cogsDollars - a.cogsDollars)
}

export interface WorstMarginRow {
  itemName: string
  recipeId: string | null
  unitsSold: number
  revenue: number
  foodCostDollars: number
  /** Food cost % of revenue. Items with revenue=0 are excluded. */
  foodCostPct: number
}

export async function getWorstMarginItems(
  storeId: string,
  startDate: Date,
  endDate: Date,
  limit: number
): Promise<WorstMarginRow[]> {
  const rows = await prisma.dailyCogsItem.groupBy({
    by: ["itemName", "recipeId"],
    where: dateWindow(storeId, startDate, endDate),
    _sum: { qtySold: true, salesRevenue: true, lineCost: true },
  })
  return rows
    .map((r) => {
      const revenue = r._sum.salesRevenue ?? 0
      const cost = r._sum.lineCost ?? 0
      return {
        itemName: r.itemName,
        recipeId: r.recipeId,
        unitsSold: r._sum.qtySold ?? 0,
        revenue,
        foodCostDollars: cost,
        foodCostPct: revenue > 0 ? (cost / revenue) * 100 : 0,
      }
    })
    .filter((r) => r.revenue > 0) // hide zero-revenue noise
    .sort((a, b) => b.foodCostPct - a.foodCostPct)
    .slice(0, limit)
}

export interface DataQualityCounts {
  costed: number
  unmapped: number
  missingCost: number
}

export async function getDataQualityCounts(
  storeId: string,
  startDate: Date,
  endDate: Date
): Promise<DataQualityCounts> {
  const rows = await prisma.dailyCogsItem.groupBy({
    by: ["status"],
    where: dateWindow(storeId, startDate, endDate),
    _count: { _all: true },
  })
  const by = (s: "COSTED" | "UNMAPPED" | "MISSING_COST") =>
    rows.find((r) => r.status === s)?._count?._all ?? 0
  return {
    costed: by("COSTED"),
    unmapped: by("UNMAPPED"),
    missingCost: by("MISSING_COST"),
  }
}

export interface IngredientCostDriver {
  canonicalIngredientId: string
  name: string
  /** Total theoretical $ across the period for this ingredient. */
  theoreticalDollars: number
  /** % of total period COGS represented by this ingredient. */
  pctOfCogs: number
  /** Latest known unit cost (asOf endDate). */
  latestUnitCost: number | null
  /** Unit cost as-of (startDate - 1ms) for the ▲▼ trend glyph. */
  priorUnitCost: number | null
  costUnit: string | null
}

/**
 * Decompose period sales into ingredient-level theoretical usage and dollars.
 *
 * Approach (on-the-fly, no new materialization):
 *   1. Group DailyCogsItem rows by recipeId (only COSTED + recipeId set).
 *   2. For each recipe, walk RecipeIngredient → CanonicalIngredient (via the
 *      same recipe-cost.ts machinery) and produce ingredient-level qty.
 *   3. Multiply qty × ingredient.unitCost (asOf endDate) → theoretical $.
 *   4. Aggregate by canonicalIngredientId.
 *
 * Sub-recipes are flattened: when a recipe has a componentRecipe, we recurse
 * via the same cost helpers so the canonical ingredients deep inside roll up.
 *
 * NOTE: returns `[]` if the period has no costed sales.
 */
export async function getTopCostDriverIngredients(
  storeId: string,
  startDate: Date,
  endDate: Date,
  limit: number
): Promise<IngredientCostDriver[]> {
  // 1. Pull COSTED rows with a recipe in the period; group by recipeId
  //    summing units sold (across all dates in the period).
  const grouped = await prisma.dailyCogsItem.groupBy({
    by: ["recipeId"],
    where: {
      ...dateWindow(storeId, startDate, endDate),
      status: "COSTED",
      recipeId: { not: null },
    },
    _sum: { qtySold: true, lineCost: true },
  })

  if (grouped.length === 0) return []

  // Denominator = total COGS dollars in the period (across all statuses).
  // Using only COSTED-with-recipe rows would inflate ingredient %s when some
  // dishes are unmapped or override-costed.
  const totalAgg = await prisma.dailyCogsItem.aggregate({
    where: dateWindow(storeId, startDate, endDate),
    _sum: { lineCost: true },
  })
  const totalCogs = totalAgg._sum.lineCost ?? 0
  if (totalCogs <= 0) return []

  // asOf for ingredient costs = the last second of the period so we use
  // prices in effect across the period (matches recipe-cost.ts P&L convention).
  const asOf = new Date(endDate.getTime() - 1)
  const priorAsOf = new Date(startDate.getTime() - 1)

  // 2. For each recipe, compute its cost breakdown once (memoized inside
  //    computeRecipeCost). We rebuild the per-ingredient theoretical qty
  //    by scaling the cost-line's quantity by the period's qtySold.
  type Acc = {
    name: string
    theoreticalDollars: number
    costUnit: string | null
  }
  const byIng = new Map<string, Acc>()

  for (const g of grouped) {
    if (!g.recipeId || !g._sum.qtySold) continue
    const qtySold = g._sum.qtySold
    const cost = await computeRecipeCost(g.recipeId, asOf)

    // Walk only ingredient lines (sub-recipes are already flattened into the
    // tree by computeRecipeCost — but its `lines` array preserves the top
    // level. We need a deep walk: re-read the recipe tree's leaf canonicals).
    // Simplest correct approach: pull all RecipeIngredient rows for this
    // recipe transitively (sub-recipes too) and multiply their canonical
    // contribution by qtySold.
    const leaves = await flattenRecipeToCanonicals(g.recipeId, asOf)
    for (const leaf of leaves) {
      const lineUnitCost = leaf.unitCost ?? 0 // missing → 0 contribution
      const dollars = qtySold * leaf.qtyPerServing * lineUnitCost
      if (dollars <= 0) continue
      const prev = byIng.get(leaf.canonicalIngredientId) ?? {
        name: leaf.name,
        theoreticalDollars: 0,
        costUnit: leaf.costUnit,
      }
      prev.theoreticalDollars += dollars
      byIng.set(leaf.canonicalIngredientId, prev)
    }

    // computeRecipeCost throws RecipeCycleError on a cycle — call it for
    // that side effect. Its returned cost is unused (we recompute via the
    // flatten walk so we get per-leaf rather than per-recipe figures).
    void cost
  }

  // 3. Resolve latest+prior unit cost per canonical (for the ▲▼ glyph).
  const ids = Array.from(byIng.keys())
  const [latestCosts, priorCosts] = await Promise.all([
    Promise.all(ids.map((id) => getCanonicalIngredientCost(id, asOf))),
    Promise.all(ids.map((id) => getCanonicalIngredientCost(id, priorAsOf))),
  ])

  const out: IngredientCostDriver[] = ids.map((id, i) => {
    const acc = byIng.get(id)!
    return {
      canonicalIngredientId: id,
      name: acc.name,
      theoreticalDollars: acc.theoreticalDollars,
      pctOfCogs:
        totalCogs > 0 ? (acc.theoreticalDollars / totalCogs) * 100 : 0,
      latestUnitCost: latestCosts[i]?.unitCost ?? null,
      priorUnitCost: priorCosts[i]?.unitCost ?? null,
      costUnit: acc.costUnit,
    }
  })

  return out
    .sort((a, b) => b.theoreticalDollars - a.theoreticalDollars)
    .slice(0, limit)
}

/** Internal: flatten a recipe (with sub-recipes) into leaf canonical contributions. */
interface CanonicalLeaf {
  canonicalIngredientId: string
  name: string
  /** Quantity contributed *per serving* of the top-level recipe, expressed
   *  in the canonical ingredient's costUnit (already converted). */
  qtyPerServing: number
  unitCost: number | null
  costUnit: string | null
}

async function flattenRecipeToCanonicals(
  recipeId: string,
  asOf: Date | undefined,
  multiplier = 1,
  visited: Set<string> = new Set()
): Promise<CanonicalLeaf[]> {
  if (visited.has(recipeId)) return [] // cycle guard (should be impossible in DB)
  visited.add(recipeId)

  const recipe = await prisma.recipe.findUnique({
    where: { id: recipeId },
    select: {
      ingredients: {
        select: {
          quantity: true,
          unit: true,
          canonicalIngredientId: true,
          componentRecipeId: true,
          canonicalIngredient: { select: { id: true, name: true } },
        },
      },
    },
  })
  if (!recipe) return []

  const leaves: CanonicalLeaf[] = []
  for (const ing of recipe.ingredients) {
    if (ing.componentRecipeId) {
      const sub = await flattenRecipeToCanonicals(
        ing.componentRecipeId,
        asOf,
        multiplier * ing.quantity,
        new Set(visited)
      )
      leaves.push(...sub)
      continue
    }
    if (!ing.canonicalIngredientId || !ing.canonicalIngredient) continue

    // Convert this line's quantity to the canonical's costUnit, mirroring
    // the math in recipe-cost.ts.
    const cost = await getCanonicalIngredientCost(ing.canonicalIngredientId, asOf)
    let qtyInCostUnit: number | null = ing.quantity
    if (cost) {
      const recipeUnit = canonicalizeUnit(ing.unit)
      const costUnit = canonicalizeUnit(cost.unit)
      if (recipeUnit && costUnit && recipeUnit !== costUnit) {
        qtyInCostUnit = convert(ing.quantity, ing.unit, cost.unit)
      } else if (!recipeUnit || !costUnit) {
        const same =
          ing.unit.trim().toLowerCase() === cost.unit.trim().toLowerCase()
        if (!same) qtyInCostUnit = null
      }
    }

    leaves.push({
      canonicalIngredientId: ing.canonicalIngredientId,
      name: ing.canonicalIngredient.name,
      qtyPerServing: (qtyInCostUnit ?? 0) * multiplier,
      unitCost: cost?.unitCost ?? null,
      costUnit: cost?.unit ?? null,
    })
  }
  return leaves
}
