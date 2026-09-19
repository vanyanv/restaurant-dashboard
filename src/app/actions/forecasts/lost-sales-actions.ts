"use server"

import { startOfDayUTC as startOfDay, ymdUTC as ymd } from "@/lib/date-utils"
// F18 — Lost-sale detection. An item is "86'd" when it sold consistently for
// weeks and then drops to zero for ≥ minGapDays consecutive days. We treat
// every gap window as lost revenue priced at:
//
//   lost_revenue = baseline_daily_qty × gap_days × mean_unit_price
//
// Source: OtterMenuItem (already aggregated daily, FP+TP). Modifiers excluded.
//
// The series is built over the days the STORE TRADED, not over the calendar.
// `OtterMenuItem` has no row for an item that sold nothing, so a missing day
// is indistinguishable from a zero day — and a day with no rows AT ALL is a
// day the store was shut or Otter did not sync. Filling those with qty 0, the
// way this used to, made a two-day closure or a two-day sync outage look like
// a simultaneous stock-out of EVERY item on the menu, each priced at its own
// baseline and summed into `totalEstimatedLost`. `minGapDays` is 2, so two
// quiet days was all it took, and the window that ends at `startOfDay(asOf)`
// always included a today with nothing posted yet. A day on which some other
// item sold is the only evidence that this one COULD have sold, so only those
// days are in the series; `gapDays` therefore counts trading days missed,
// which is the multiplier `baselineDailyQty` is per.
//
// What we are NOT doing here:
//  - Distinguishing 86'd-by-store vs delisted: a permanent menu removal also
//    looks like a long zero run. We mitigate by capping gaps at 14 days max
//    AND only flagging items whose pre-gap baseline was strong (≥ minBaselineQty).
//  - Detecting partial-day stock-outs (we only have day grain).

import { prisma } from "@/lib/prisma"
import { tradingDayKey, tradingDaysIn } from "@/lib/trading-days"
import { getCachedSession, resolveStoreContext } from "./_shared"

const DEFAULT_LOOKBACK_DAYS = 60
const DEFAULT_BASELINE_DAYS = 14
const DEFAULT_MIN_BASELINE_QTY = 3
const DEFAULT_MIN_GAP_DAYS = 2
const DEFAULT_MAX_GAP_DAYS = 14

export interface LostSaleEvent {
  itemName: string
  category: string
  storeId: string
  /** Populated when the action runs in aggregate mode (multiple stores). */
  storeName?: string
  gapStart: Date
  gapEnd: Date
  gapDays: number
  baselineDailyQty: number
  meanUnitPrice: number
  estimatedLostRevenue: number
}

export interface LostSalesData {
  storeId: string | null
  storeName: string | null
  windowStart: Date
  windowEnd: Date
  events: LostSaleEvent[]
  totalEstimatedLost: number
}

export type GetLostSalesResult =
  | { ok: true; data: LostSalesData }
  | { ok: false; error: "store_not_in_account" }

export async function getLostSales(input: {
  storeId?: string
  lookbackDays?: number
  baselineDays?: number
  minBaselineQty?: number
  minGapDays?: number
  maxGapDays?: number
  asOf?: Date
}): Promise<GetLostSalesResult | null> {
  const session = await getCachedSession()
  const user = session?.user ?? null
  if (!user) return null

  const resolved = await resolveStoreContext(input.storeId, user.accountId)
  if (!resolved.ok) return resolved
  const { storeIds, storeName, storeNameById } = resolved.ctx

  const lookback = input.lookbackDays ?? DEFAULT_LOOKBACK_DAYS
  const baselineDays = input.baselineDays ?? DEFAULT_BASELINE_DAYS
  const minBaselineQty = input.minBaselineQty ?? DEFAULT_MIN_BASELINE_QTY
  const minGapDays = input.minGapDays ?? DEFAULT_MIN_GAP_DAYS
  const maxGapDays = input.maxGapDays ?? DEFAULT_MAX_GAP_DAYS
  const asOf = input.asOf ?? new Date()
  const windowEnd = startOfDay(asOf)
  const windowStart = new Date(windowEnd)
  windowStart.setUTCDate(windowStart.getUTCDate() - lookback)

  // No orderBy — the [storeId, date] index doesn't cover [storeId, itemName, date],
  // so adding a sort here forces a seq scan + in-memory sort on Hollywood-sized
  // tables (60 days × hundreds of items). The grouping pass below doesn't
  // depend on row order.
  const rows = await prisma.otterMenuItem.findMany({
    where: {
      storeId: { in: storeIds },
      isModifier: false,
      date: { gte: windowStart, lte: windowEnd },
    },
    select: {
      storeId: true,
      itemName: true,
      category: true,
      date: true,
      fpQuantitySold: true,
      tpQuantitySold: true,
      fpTotalSales: true,
      tpTotalSales: true,
    },
  })

  type SeriesKey = string // `${storeId}|${itemName}`
  type DailyPoint = { dateKey: string; qty: number; sales: number; category: string }
  const series = new Map<SeriesKey, DailyPoint[]>()
  /** storeId -> the days that store has ANY menu-item row for. See the header. */
  const tradedDays = new Map<string, Set<string>>()
  for (const r of rows) {
    const key = `${r.storeId}|${r.itemName}`
    const list = series.get(key) ?? []
    const qty = (r.fpQuantitySold ?? 0) + (r.tpQuantitySold ?? 0)
    const sales = (r.fpTotalSales ?? 0) + (r.tpTotalSales ?? 0)
    const dateKey = tradingDayKey(r.date as Date)
    list.push({ dateKey, qty, sales, category: r.category })
    series.set(key, list)
    const traded = tradedDays.get(r.storeId) ?? new Set<string>()
    traded.add(dateKey)
    tradedDays.set(r.storeId, traded)
  }

  const events: LostSaleEvent[] = []
  let totalEstimatedLost = 0

  for (const [key, points] of series) {
    const [storeId, itemName] = key.split("|") as [string, string]
    const category = points[0]?.category ?? ""

    // One entry per day THIS STORE traded, qty 0 on a trading day with no row
    // for this item — that zero is the stock-out signal. A day the store did
    // not trade is absent entirely rather than zero.
    const filled = fillDailyGaps(points, tradedDays.get(storeId) ?? new Set())

    for (const event of detectGaps({
      filled,
      baselineDays,
      minBaselineQty,
      minGapDays,
      maxGapDays,
    })) {
      const lostRevenue =
        event.baselineDailyQty * event.gapDays * event.meanUnitPrice
      events.push({
        storeId,
        ...(storeIds.length > 1 && storeNameById.has(storeId)
          ? { storeName: storeNameById.get(storeId)! }
          : {}),
        itemName,
        category,
        gapStart: new Date(`${event.gapStartKey}T00:00:00.000Z`),
        gapEnd: new Date(`${event.gapEndKey}T00:00:00.000Z`),
        gapDays: event.gapDays,
        baselineDailyQty: event.baselineDailyQty,
        meanUnitPrice: event.meanUnitPrice,
        estimatedLostRevenue: lostRevenue,
      })
      totalEstimatedLost += lostRevenue
    }
  }

  events.sort((a, b) => b.estimatedLostRevenue - a.estimatedLostRevenue)

  return {
    ok: true,
    data: {
      storeId: input.storeId ?? null,
      storeName,
      windowStart,
      windowEnd,
      events,
      totalEstimatedLost,
    },
  }
}

interface FilledPoint {
  dateKey: string
  qty: number
  sales: number
}

/**
 * The item's series over the store's TRADING days, in date order.
 *
 * `tradedDayKeys` is every day the store has a menu-item row for, any item.
 * Walking the calendar instead — which is what this did until 2026-09-19 —
 * puts a qty-0 entry on days the store was shut and days Otter did not sync,
 * and `detectGaps` cannot tell those from a real 86.
 */
function fillDailyGaps(
  points: { dateKey: string; qty: number; sales: number }[],
  tradedDayKeys: Set<string>,
): FilledPoint[] {
  const byKey = new Map(points.map((p) => [p.dateKey, p]))
  return tradingDaysIn(tradedDayKeys).map((k) => {
    const p = byKey.get(k)
    return { dateKey: k, qty: p?.qty ?? 0, sales: p?.sales ?? 0 }
  })
}

function detectGaps(args: {
  filled: FilledPoint[]
  baselineDays: number
  minBaselineQty: number
  minGapDays: number
  maxGapDays: number
}): {
  gapStartKey: string
  gapEndKey: string
  gapDays: number
  baselineDailyQty: number
  meanUnitPrice: number
}[] {
  const { filled, baselineDays, minBaselineQty, minGapDays, maxGapDays } = args
  const out: ReturnType<typeof detectGaps> = []

  let i = 0
  while (i < filled.length) {
    if (filled[i].qty > 0) {
      i += 1
      continue
    }
    // Find run of zero-qty days starting at i
    let j = i
    while (j < filled.length && filled[j].qty === 0) j += 1
    const runDays = j - i

    // Skip the leading run that anchors at windowStart with no prior baseline
    if (i === 0) {
      i = j
      continue
    }

    // Compute baseline over up to `baselineDays` TRADING days before i
    // (non-zero only counts; we want the average daily volume on days the item
    // was selling).
    const lookbackStart = Math.max(0, i - baselineDays)
    const window = filled.slice(lookbackStart, i)
    const nonZero = window.filter((p) => p.qty > 0)
    if (nonZero.length === 0) {
      i = j
      continue
    }
    const baselineDailyQty =
      nonZero.reduce((s, p) => s + p.qty, 0) / nonZero.length
    if (baselineDailyQty < minBaselineQty) {
      i = j
      continue
    }
    if (runDays < minGapDays) {
      i = j
      continue
    }
    // Cap how many of the gap days we attribute to a stock-out vs delist.
    const gapDays = Math.min(runDays, maxGapDays)

    const totalRevenue = nonZero.reduce((s, p) => s + p.sales, 0)
    const totalQty = nonZero.reduce((s, p) => s + p.qty, 0)
    const meanUnitPrice = totalQty > 0 ? totalRevenue / totalQty : 0
    if (meanUnitPrice <= 0) {
      i = j
      continue
    }

    out.push({
      gapStartKey: filled[i].dateKey,
      gapEndKey: filled[i + gapDays - 1].dateKey,
      gapDays,
      baselineDailyQty,
      meanUnitPrice,
    })
    i = j
  }
  return out
}

