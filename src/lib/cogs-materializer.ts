import { prisma } from "@/lib/prisma"
import { computeRecipeCost, type RecipeCostResult } from "@/lib/recipe-cost"
import { CogsStatus } from "@/generated/prisma/client"

/** One day's modifier usage, aggregated by parent item name. */
type ModifierUsage = {
  /** Extra dollars of COGS on this day attributable to modifiers on this item. */
  extraLineCost: number
  /** Did every modifier SKU have a mapped + costed recipe? If not, mark MISSING_COST. */
  missingMappings: boolean
  /** Running partial list of `(modifierName, uses)` for debugging / UI. */
  breakdown: Array<{ skuId: string; name: string; uses: number; unitCost: number | null }>
}

type ComputedRow = {
  storeId: string
  date: Date
  itemName: string
  category: string
  recipeId: string | null
  qtySold: number
  salesRevenue: number
  unitCost: number | null
  lineCost: number
  status: CogsStatus
  partialCost: boolean
}

/**
 * Compute and idempotently upsert DailyCogsItem rows for one (storeId, date).
 *
 * Two cross-cutting rules:
 *
 *  1. **Cost-knowable cutoff** — an item only gets a row when we can actually
 *     cost it as-of `date`. Items with no recipe mapping (UNMAPPED) and items
 *     whose recipe resolves to no cost on or before `date` (no matched invoice
 *     yet, no manual cost, no override) are skipped entirely. This stops the
 *     dashboard from showing $0 placeholder rows for the pre-invoice era.
 *
 *  2. **No history wipes** — writes are upserts keyed on
 *     (storeId, date, itemName, category). The only delete is bounded to this
 *     exact (storeId, date) and only drops items that are no longer in the
 *     newly-computed set (Otter no longer reports them, or they fell out of
 *     the cutoff). It can never reach across days.
 */
export async function recomputeDailyCogsForDay(input: {
  storeId: string
  date: Date
  ownerId: string
}): Promise<{ rowsUpserted: number; rowsDeleted: number }> {
  const { storeId, ownerId } = input
  const date = startOfDayUTC(input.date)

  const dayEnd = new Date(date)
  dayEnd.setUTCHours(23, 59, 59, 999)

  const [menuRows, mappings, recipes] = await Promise.all([
    prisma.otterMenuItem.findMany({
      where: {
        storeId,
        isModifier: false,
        date: { gte: date, lte: dayEnd },
      },
      select: {
        date: true,
        itemName: true,
        category: true,
        fpQuantitySold: true,
        tpQuantitySold: true,
        fpTotalSales: true,
        tpTotalSales: true,
      },
    }),
    prisma.otterItemMapping.findMany({
      where: { storeId },
      select: { otterItemName: true, recipeId: true },
    }),
    prisma.recipe.findMany({
      where: { ownerId },
      select: { id: true, itemName: true },
    }),
  ])

  const mappingByName = new Map(mappings.map((m) => [m.otterItemName, m.recipeId]))
  const recipeByName = new Map(recipes.map((r) => [r.itemName.toLowerCase(), r.id]))

  const recipeCostCache = new Map<string, Promise<RecipeCostResult | null>>()

  function costFor(recipeId: string): Promise<RecipeCostResult | null> {
    const existing = recipeCostCache.get(recipeId)
    if (existing) return existing
    const p = computeRecipeCost(recipeId, date).catch(() => null)
    recipeCostCache.set(recipeId, p)
    return p
  }

  // ── Modifier usage aggregation ─────────────────────────────────────────
  // For the day, walk every OtterOrderSubItem and bucket by parent item name.
  // uses = subItem.quantity × orderItem.quantity (e.g. "2× burger + 1× add cheese"
  // = 2 cheese uses). Then look up each skuId in OtterSubItemMapping and add
  // modifierRecipeCost × uses to that item's extra cost.
  const modifierUsageByItem = new Map<string, ModifierUsage>()
  const [subItems, subMappings] = await Promise.all([
    prisma.otterOrderSubItem.findMany({
      where: {
        orderItem: {
          order: {
            storeId,
            referenceTimeLocal: { gte: date, lte: dayEnd },
          },
        },
      },
      select: {
        skuId: true,
        name: true,
        quantity: true,
        orderItem: {
          select: { name: true, quantity: true },
        },
      },
    }),
    prisma.otterSubItemMapping.findMany({
      where: { storeId },
      select: { skuId: true, recipeId: true },
    }),
  ])
  const subRecipeBySku = new Map(subMappings.map((m) => [m.skuId, m.recipeId]))

  for (const s of subItems) {
    if (!s.orderItem?.name) continue
    const itemName = s.orderItem.name
    const uses = (s.quantity ?? 1) * (s.orderItem.quantity ?? 1)
    if (!isFinite(uses) || uses <= 0) continue

    let bucket = modifierUsageByItem.get(itemName)
    if (!bucket) {
      bucket = { extraLineCost: 0, missingMappings: false, breakdown: [] }
      modifierUsageByItem.set(itemName, bucket)
    }

    const modRecipeId = s.skuId ? subRecipeBySku.get(s.skuId) : undefined
    if (!modRecipeId) {
      bucket.missingMappings = true
      bucket.breakdown.push({
        skuId: s.skuId ?? "(no sku)",
        name: s.name,
        uses,
        unitCost: null,
      })
      continue
    }
    const result = await costFor(modRecipeId)
    const modCost = result?.totalCost ?? 0
    if (modCost > 0) bucket.extraLineCost += modCost * uses
    bucket.breakdown.push({
      skuId: s.skuId ?? "(no sku)",
      name: s.name,
      uses,
      unitCost: modCost,
    })
  }

  const computed = await Promise.all(
    menuRows.map(async (row): Promise<ComputedRow | null> => {
      const qty = (row.fpQuantitySold ?? 0) + (row.tpQuantitySold ?? 0)
      const revenue = (row.fpTotalSales ?? 0) + (row.tpTotalSales ?? 0)

      const recipeId =
        mappingByName.get(row.itemName) ??
        recipeByName.get(row.itemName.toLowerCase()) ??
        null

      const mod = modifierUsageByItem.get(row.itemName)
      const modLineCost = mod?.extraLineCost ?? 0

      // Cutoff: no recipe mapping → no row. UNMAPPED items live in OtterMenuItem;
      // we don't pollute DailyCogsItem with placeholder $0 rows.
      if (!recipeId) return null

      const result = await costFor(recipeId)
      const baseUnitCost = result?.totalCost ?? null
      const hasBase = baseUnitCost != null && baseUnitCost > 0

      // Cutoff: recipe knowable but no cost as-of this date (no matched invoice,
      // no manual cost, no foodCostOverride) AND no modifier cost either → skip.
      if (!hasBase && modLineCost === 0) return null

      const baseLineCost = hasBase ? baseUnitCost! * qty : 0
      const totalLineCost = baseLineCost + modLineCost
      const blendedUnitCost = qty > 0 ? totalLineCost / qty : baseUnitCost
      const status = hasBase ? CogsStatus.COSTED : CogsStatus.MISSING_COST
      const partialCost = (result?.partial ?? false) || (mod?.missingMappings ?? false)

      return {
        storeId,
        date,
        itemName: row.itemName,
        category: row.category,
        recipeId,
        qtySold: qty,
        salesRevenue: revenue,
        unitCost: hasBase ? blendedUnitCost : null,
        lineCost: totalLineCost,
        status,
        partialCost,
      }
    })
  )

  const rows = computed.filter((r): r is ComputedRow => r !== null)

  // Idempotent write: upsert each row by the (storeId, date, itemName, category)
  // unique key. The companion deleteMany is scoped to this exact (storeId, date)
  // and only drops items that are no longer in the new set — bounded to one day,
  // can never reach across days, so historical data cannot evaporate.
  const deletePredicate =
    rows.length > 0
      ? {
          storeId,
          date,
          NOT: {
            OR: rows.map((r) => ({
              itemName: r.itemName,
              category: r.category,
            })),
          },
        }
      : { storeId, date }

  const ops = [
    ...rows.map((r) =>
      prisma.dailyCogsItem.upsert({
        where: {
          storeId_date_itemName_category: {
            storeId: r.storeId,
            date: r.date,
            itemName: r.itemName,
            category: r.category,
          },
        },
        create: r,
        update: {
          recipeId: r.recipeId,
          qtySold: r.qtySold,
          salesRevenue: r.salesRevenue,
          unitCost: r.unitCost,
          lineCost: r.lineCost,
          status: r.status,
          partialCost: r.partialCost,
          computedAt: new Date(),
        },
      })
    ),
    prisma.dailyCogsItem.deleteMany({ where: deletePredicate }),
  ]

  // Run as a single transaction so a partial failure can't leave the day in a
  // mixed state (some new rows present, stale rows still around).
  const results = await prisma.$transaction(ops)
  const deleteResult = results[results.length - 1] as { count: number }

  return {
    rowsUpserted: rows.length,
    rowsDeleted: deleteResult.count,
  }
}

/**
 * Recompute every day in [startDate, endDate] for one store. Iterates
 * sequentially per day so `recomputeDailyCogsForDay`'s in-memory cache
 * stays scoped; cross-day reuse is small (different `asOf` per day).
 */
export async function recomputeDailyCogsForRange(input: {
  storeId: string
  startDate: Date
  endDate: Date
  ownerId: string
}): Promise<{ daysProcessed: number; rowsUpserted: number; rowsDeleted: number }> {
  const start = startOfDayUTC(input.startDate)
  const end = startOfDayUTC(input.endDate)

  let daysProcessed = 0
  let rowsUpserted = 0
  let rowsDeleted = 0

  for (
    let cursor = new Date(start);
    cursor.getTime() <= end.getTime();
    cursor = addDaysUTC(cursor, 1)
  ) {
    const result = await recomputeDailyCogsForDay({
      storeId: input.storeId,
      date: cursor,
      ownerId: input.ownerId,
    })
    daysProcessed++
    rowsUpserted += result.rowsUpserted
    rowsDeleted += result.rowsDeleted
  }

  return { daysProcessed, rowsUpserted, rowsDeleted }
}

function startOfDayUTC(d: Date): Date {
  const n = new Date(d)
  n.setUTCHours(0, 0, 0, 0)
  return n
}

function addDaysUTC(d: Date, n: number): Date {
  const r = new Date(d)
  r.setUTCDate(r.getUTCDate() + n)
  return r
}
