import { randomUUID } from "crypto"
import { prisma } from "@/lib/prisma"
import { startOfDayUTC } from "@/lib/date-utils"
import { getCanonicalIngredientCost } from "@/lib/canonical-ingredients"
import { computeRecipeCost, type RecipeCostResult } from "@/lib/recipe-cost"
import {
  CONTAINER_GROUP_CANONICALS,
  CONTAINER_GROUP_LABELS,
  PACKAGING_SCENARIO,
  addContainerCounts,
  emptyContainerCounts,
  isTakeawayFulfillmentMode,
  packOrderCostAware,
  type ContainerGroup,
} from "@/lib/container-packaging"
import { CogsStatus, Prisma } from "@/generated/prisma/client"

/** One day's modifier usage, aggregated by parent item name. */
export type ModifierUsage = {
  /** Extra dollars of COGS on this day attributable to modifiers on this item. */
  extraLineCost: number
  /** Did every modifier SKU have a mapped + costed recipe? If not, mark MISSING_COST. */
  missingMappings: boolean
  /** Running partial list of `(modifierName, uses)` for debugging / UI. */
  breakdown: Array<{ skuId: string; name: string; uses: number; unitCost: number | null }>
}

export type ComputedRow = {
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
  /** "invoice" | "manual" | "mixed" | "override" | null. See schema. */
  costSource: string | null
}

/**
 * Reduce the per-line costSource markers on a RecipeCostResult down to one
 * provenance label for the materialized row. Returns null when no usable
 * cost was produced (UNMAPPED or fully-missing).
 */
function summarizeCostSource(
  result: RecipeCostResult | null | undefined,
  hasBase: boolean
): string | null {
  if (!result || !hasBase) return null
  let sawInvoice = false
  let sawManual = false
  let sawAnyLineCost = false
  for (const line of result.lines) {
    if (line.lineCost > 0 || line.unitCost != null) sawAnyLineCost = true
    if (line.costSource === "invoice") sawInvoice = true
    if (line.costSource === "manual") sawManual = true
  }
  if (!sawAnyLineCost) {
    // total > 0 with no per-line costs means foodCostOverride was applied.
    return "override"
  }
  if (sawInvoice && sawManual) return "mixed"
  if (sawManual) return "manual"
  return "invoice"
}

type FoodMenuRow = {
  itemName: string
  category: string
  fpQuantitySold: number | null
  tpQuantitySold: number | null
  fpTotalSales: number | null
  tpTotalSales: number | null
}

type ContainerGroupCost = {
  unitCost: number | null
  partialCost: boolean
}

const DAILY_COGS_TRANSACTION_TIMEOUT_MS = 20_000

function containerUnitCostMap(
  costs: Record<ContainerGroup, ContainerGroupCost>
): Record<ContainerGroup, number | null> {
  return Object.fromEntries(
    (Object.keys(CONTAINER_GROUP_LABELS) as ContainerGroup[]).map((group) => [group, costs[group].unitCost])
  ) as Record<ContainerGroup, number | null>
}

/**
 * Compute and idempotently upsert DailyCogsItem rows for one (storeId, date).
 *
 * Three cross-cutting rules:
 *
 *  1. **Diagnostics are materialized** — sold items with no recipe mapping get
 *     UNMAPPED rows, and mapped items with no base cost get MISSING_COST rows.
 *     Both carry sales/qty so COGS coverage can be measured against all sales.
 *
 *  2. **Modifier cost is applied once** — Otter can report the same item under
 *     multiple categories on one day. Modifier COGS is bucketed by parent item,
 *     then allocated across same-item rows by sold quantity so it is not
 *     duplicated for each category row.
 *
 *  3. **No history wipes** — writes are upserts keyed on
 *     (storeId, date, itemName, category). The only delete is bounded to this
 *     exact (storeId, date) and only drops items that are no longer in the
 *     newly-computed set (Otter no longer reports them, or they fell out of
 *     the cutoff). It can never reach across days.
 */
async function recomputeDailyCogsForDay(input: {
  storeId: string
  date: Date
  accountId: string
}): Promise<{ rowsUpserted: number; rowsDeleted: number }> {
  const { storeId, accountId } = input
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
      where: { accountId },
      select: { id: true, itemName: true },
    }),
  ])

  const mappingByName = new Map(mappings.map((m) => [m.otterItemName, m.recipeId]))
  const recipeByName = new Map(recipes.map((r) => [r.itemName.toLowerCase(), r.id]))

  const recipeCostCache = new Map<string, Promise<RecipeCostResult | null>>()

  function costFor(recipeId: string): Promise<RecipeCostResult | null> {
    const existing = recipeCostCache.get(recipeId)
    if (existing) return existing
    // Scope ingredient lookups to this store first so per-store COGS reflects
    // this store's actual vendor purchases. Falls back to cross-store latest
    // when this store hasn't bought the ingredient itself.
    const p = computeRecipeCost(recipeId, date, { storeId }).catch(() => null)
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
    // A mapped modifier whose recipe walks to $0 (no costed ingredients,
    // no foodCostOverride) leaves real dollars unaccounted for. Flag it
    // alongside unmapped SKUs so the parent item is marked partialCost
    // and the operator can see the gap. `result?.partial` covers the case
    // where the recipe has a positive total but some ingredients were
    // missing cost — propagate that too.
    if (!result || modCost <= 0 || result.partial) {
      bucket.missingMappings = true
    }
    if (modCost > 0) bucket.extraLineCost += modCost * uses
    bucket.breakdown.push({
      skuId: s.skuId ?? "(no sku)",
      name: s.name,
      uses,
      unitCost: modCost,
    })
  }

  const foodRows = await computeFoodCogsRows({
    storeId,
    date,
    menuRows,
    mappingByName,
    recipeByName,
    modifierUsageByItem,
    costFor,
  })
  const packagingRows = await computePackagingRowsForDay({
    storeId,
    accountId,
    date,
    dayEnd,
  })
  const rows = [...foodRows, ...packagingRows]

  // Idempotent write: replace this day's materialized rows by the
  // (storeId, date, itemName, category) unique key. The cleanup is scoped to
  // this exact (storeId, date) and only drops items that are no longer in the
  // new set — bounded to one day, so historical data cannot evaporate.
  // Run as a single transaction so a partial failure can't leave the day in a
  // mixed state (some new rows present, stale rows still around).
  const deleteResult = await replaceDailyCogsRowsForDay({
    storeId,
    date,
    rows,
  })

  return {
    rowsUpserted: rows.length,
    rowsDeleted: deleteResult,
  }
}

export async function computeFoodCogsRows(input: {
  storeId: string
  date: Date
  menuRows: FoodMenuRow[]
  mappingByName: Map<string, string>
  recipeByName: Map<string, string>
  modifierUsageByItem: Map<string, ModifierUsage>
  costFor: (recipeId: string) => Promise<RecipeCostResult | null>
}): Promise<ComputedRow[]> {
  const {
    storeId,
    date,
    menuRows,
    mappingByName,
    recipeByName,
    modifierUsageByItem,
    costFor,
  } = input

  const itemTotals = new Map<string, { qty: number; rows: number }>()
  for (const row of menuRows) {
    const qty = (row.fpQuantitySold ?? 0) + (row.tpQuantitySold ?? 0)
    const total = itemTotals.get(row.itemName) ?? { qty: 0, rows: 0 }
    total.qty += qty
    total.rows++
    itemTotals.set(row.itemName, total)
  }

  return Promise.all(
    menuRows.map(async (row): Promise<ComputedRow> => {
      const qty = (row.fpQuantitySold ?? 0) + (row.tpQuantitySold ?? 0)
      const revenue = (row.fpTotalSales ?? 0) + (row.tpTotalSales ?? 0)

      const recipeId =
        mappingByName.get(row.itemName) ??
        recipeByName.get(row.itemName.toLowerCase()) ??
        null

      const mod = modifierUsageByItem.get(row.itemName)
      const totals = itemTotals.get(row.itemName)
      const modifierShare =
        totals && totals.qty > 0
          ? qty / totals.qty
          : totals && totals.rows > 0
            ? 1 / totals.rows
            : 0
      const modLineCost = (mod?.extraLineCost ?? 0) * modifierShare

      if (!recipeId) {
        return {
          storeId,
          date,
          itemName: row.itemName,
          category: row.category,
          recipeId: null,
          qtySold: qty,
          salesRevenue: revenue,
          unitCost: null,
          lineCost: 0,
          status: CogsStatus.UNMAPPED,
          partialCost: false,
          costSource: null,
        }
      }

      const result = await costFor(recipeId)
      const baseUnitCost = result?.totalCost ?? null
      const hasBase = baseUnitCost != null && baseUnitCost > 0
      const baseLineCost = hasBase ? baseUnitCost * qty : 0
      const totalLineCost = baseLineCost + modLineCost
      const blendedUnitCost =
        qty > 0 ? totalLineCost / qty : hasBase ? baseUnitCost : null
      const status = hasBase ? CogsStatus.COSTED : CogsStatus.MISSING_COST
      const partialCost =
        !hasBase || (result?.partial ?? false) || (mod?.missingMappings ?? false)
      const costSource = summarizeCostSource(result, hasBase)

      return {
        storeId,
        date,
        itemName: row.itemName,
        category: row.category,
        recipeId,
        qtySold: qty,
        salesRevenue: revenue,
        unitCost: blendedUnitCost,
        lineCost: totalLineCost,
        status,
        partialCost,
        costSource,
      }
    })
  )
}

async function computePackagingRowsForDay(input: {
  storeId: string
  accountId: string
  date: Date
  dayEnd: Date
}): Promise<ComputedRow[]> {
  const { storeId, accountId, date, dayEnd } = input

  const orders = await prisma.otterOrder.findMany({
    where: {
      storeId,
      referenceTimeLocal: { gte: date, lte: dayEnd },
    },
    select: {
      fulfillmentMode: true,
      items: {
        select: {
          name: true,
          quantity: true,
          subItems: {
            select: {
              name: true,
              quantity: true,
              subHeader: true,
            },
          },
        },
      },
    },
  })

  const costs = await getContainerGroupCosts(accountId, storeId, date)
  const unitCosts = containerUnitCostMap(costs)
  const counts = emptyContainerCounts()
  for (const order of orders) {
    if (!isTakeawayFulfillmentMode(order.fulfillmentMode)) continue
    const packed = packOrderCostAware(order, unitCosts, PACKAGING_SCENARIO)
    addContainerCounts(counts, packed.counts)
  }

  return (Object.keys(CONTAINER_GROUP_LABELS) as ContainerGroup[])
    .filter((group) => counts[group] > 0)
    .map((group): ComputedRow => {
      const qty = counts[group]
      const unitCost = costs[group].unitCost
      const hasCost = unitCost != null
      return {
        storeId,
        date,
        itemName: `Packaging - ${CONTAINER_GROUP_LABELS[group]}`,
        category: "Packaging",
        recipeId: null,
        qtySold: qty,
        salesRevenue: 0,
        unitCost,
        lineCost: hasCost ? unitCost * qty : 0,
        status: hasCost ? CogsStatus.COSTED : CogsStatus.MISSING_COST,
        partialCost: costs[group].partialCost || !hasCost,
        costSource: hasCost ? "invoice" : null,
      }
    })
}

async function getContainerGroupCosts(
  accountId: string,
  storeId: string,
  asOf: Date
): Promise<Record<ContainerGroup, ContainerGroupCost>> {
  const allNames = Object.values(CONTAINER_GROUP_CANONICALS).flat()
  const canonicals = await prisma.canonicalIngredient.findMany({
    where: { accountId, name: { in: allNames } },
    select: { id: true, name: true },
  })
  const canonicalByName = new Map(canonicals.map((c) => [c.name, c.id]))

  // Within a group, canonicals (e.g. medium_6x6 = "hinged" + "bagged") are
  // interchangeable SKUs. Average their per-canonical latest costs unweighted —
  // we don't know which SKU was used per order, and weighting by trailing
  // purchase volume would re-introduce the lag this code path exists to remove.
  const entries = await Promise.all(
    (Object.keys(CONTAINER_GROUP_CANONICALS) as ContainerGroup[]).map(async (group) => {
      const names = CONTAINER_GROUP_CANONICALS[group]
      let totalCost = 0
      let foundCount = 0
      for (const name of names) {
        const id = canonicalByName.get(name)
        if (!id) continue
        const cost = await getCanonicalIngredientCost(id, asOf, { storeId })
        if (cost?.unitCost != null) {
          totalCost += cost.unitCost
          foundCount++
        }
      }
      return [
        group,
        {
          unitCost: foundCount > 0 ? totalCost / foundCount : null,
          partialCost: foundCount < names.length,
        },
      ] as const
    })
  )

  return Object.fromEntries(entries) as Record<ContainerGroup, ContainerGroupCost>
}

async function recomputeDailyPackagingCogsForDay(input: {
  storeId: string
  date: Date
  accountId: string
}): Promise<{ rowsUpserted: number; rowsDeleted: number; lineCost: number }> {
  const { storeId, accountId } = input
  const date = startOfDayUTC(input.date)
  const dayEnd = new Date(date)
  dayEnd.setUTCHours(23, 59, 59, 999)

  const rows = await computePackagingRowsForDay({
    storeId,
    accountId,
    date,
    dayEnd,
  })

  const deleteResult = await replaceDailyCogsRowsForDay({
    storeId,
    date,
    rows,
    category: "Packaging",
  })

  return {
    rowsUpserted: rows.length,
    rowsDeleted: deleteResult,
    lineCost: rows.reduce((sum, row) => sum + row.lineCost, 0),
  }
}

export async function recomputePackagingCogsForRange(input: {
  storeId: string
  startDate: Date
  endDate: Date
  accountId: string
}): Promise<{ daysProcessed: number; rowsUpserted: number; rowsDeleted: number; lineCost: number }> {
  const start = startOfDayUTC(input.startDate)
  const end = startOfDayUTC(input.endDate)

  let daysProcessed = 0
  let rowsUpserted = 0
  let rowsDeleted = 0
  let lineCost = 0

  for (
    let cursor = new Date(start);
    cursor.getTime() <= end.getTime();
    cursor = addDaysUTC(cursor, 1)
  ) {
    const result = await recomputeDailyPackagingCogsForDay({
      storeId: input.storeId,
      date: cursor,
      accountId: input.accountId,
    })
    daysProcessed++
    rowsUpserted += result.rowsUpserted
    rowsDeleted += result.rowsDeleted
    lineCost += result.lineCost
  }

  return { daysProcessed, rowsUpserted, rowsDeleted, lineCost }
}

/**
 * Recompute every day in [startDate, endDate] for one store. Days are
 * independent because writes are bounded to a single (storeId, date), so
 * callers can opt into capped concurrency for one-shot backfills.
 */
export async function recomputeDailyCogsForRange(input: {
  storeId: string
  startDate: Date
  endDate: Date
  accountId: string
  dayConcurrency?: number
}): Promise<{ daysProcessed: number; rowsUpserted: number; rowsDeleted: number }> {
  const start = startOfDayUTC(input.startDate)
  const end = startOfDayUTC(input.endDate)
  const dayConcurrency = normalizeConcurrency(input.dayConcurrency, 1)

  const dates: Date[] = []
  for (
    let cursor = new Date(start);
    cursor.getTime() <= end.getTime();
    cursor = addDaysUTC(cursor, 1)
  ) {
    dates.push(new Date(cursor))
  }

  const results = await mapWithConcurrency(dates, dayConcurrency, (date) =>
    recomputeDailyCogsForDay({
      storeId: input.storeId,
      date,
      accountId: input.accountId,
    })
  )

  return {
    daysProcessed: dates.length,
    rowsUpserted: results.reduce((sum, result) => sum + result.rowsUpserted, 0),
    rowsDeleted: results.reduce((sum, result) => sum + result.rowsDeleted, 0),
  }
}

function addDaysUTC(d: Date, n: number): Date {
  const r = new Date(d)
  r.setUTCDate(r.getUTCDate() + n)
  return r
}

function normalizeConcurrency(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value == null) return fallback
  return Math.max(1, Math.floor(value))
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  let firstError: unknown = null
  const workerCount = Math.min(normalizeConcurrency(concurrency, 1), items.length)

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        if (firstError != null) return
        const currentIndex = nextIndex
        nextIndex++
        if (currentIndex >= items.length) return
        try {
          results[currentIndex] = await worker(items[currentIndex])
        } catch (err) {
          firstError ??= err
          return
        }
      }
    })
  )

  if (firstError != null) throw firstError
  return results
}

async function replaceDailyCogsRowsForDay(input: {
  storeId: string
  date: Date
  rows: ComputedRow[]
  category?: string
}): Promise<number> {
  const { storeId, date, rows, category } = input
  const computedAt = new Date()
  const categoryClause =
    category == null
      ? Prisma.empty
      : Prisma.sql`AND d."category" = ${category}`
  const staleRowsClause =
    rows.length === 0
      ? Prisma.empty
      : Prisma.sql`
          AND NOT EXISTS (
            SELECT 1
            FROM (VALUES ${Prisma.join(
              rows.map((r) => Prisma.sql`(${r.itemName}, ${r.category})`)
            )}) AS keep("itemName", "category")
            WHERE keep."itemName" = d."itemName"
              AND keep."category" = d."category"
          )
        `

  return prisma.$transaction(
    async (tx) => {
      if (rows.length > 0) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "DailyCogsItem" (
            "id",
            "storeId",
            "date",
            "itemName",
            "category",
            "recipeId",
            "qtySold",
            "salesRevenue",
            "unitCost",
            "lineCost",
            "status",
            "partialCost",
            "costSource",
            "computedAt"
          )
          VALUES ${Prisma.join(rows.map((r) => dailyCogsRowSql(r, computedAt)))}
          ON CONFLICT ("storeId", "date", "itemName", "category")
          DO UPDATE SET
            "recipeId" = EXCLUDED."recipeId",
            "qtySold" = EXCLUDED."qtySold",
            "salesRevenue" = EXCLUDED."salesRevenue",
            "unitCost" = EXCLUDED."unitCost",
            "lineCost" = EXCLUDED."lineCost",
            "status" = EXCLUDED."status",
            "partialCost" = EXCLUDED."partialCost",
            "costSource" = EXCLUDED."costSource",
            "computedAt" = EXCLUDED."computedAt"
        `)
      }

      return tx.$executeRaw(Prisma.sql`
        DELETE FROM "DailyCogsItem" d
        WHERE d."storeId" = ${storeId}
          AND d."date" = ${date}
          ${categoryClause}
          ${staleRowsClause}
      `)
    },
    { timeout: DAILY_COGS_TRANSACTION_TIMEOUT_MS, maxWait: 10_000 }
  )
}

function dailyCogsRowSql(row: ComputedRow, computedAt: Date): Prisma.Sql {
  return Prisma.sql`(
    ${randomUUID()},
    ${row.storeId},
    ${row.date},
    ${row.itemName},
    ${row.category},
    ${row.recipeId},
    ${row.qtySold},
    ${row.salesRevenue},
    ${row.unitCost},
    ${row.lineCost},
    ${row.status}::"CogsStatus",
    ${row.partialCost},
    ${row.costSource},
    ${computedAt}
  )`
}
