"use server"

import { startOfDayUTC as startOfDayUtc } from "@/lib/date-utils"
// F23 — New-item launch trajectory. We classify a menu item as "newly
// launched" when:
//
//   firstSale within the last `recentDays` days (default 60)
//   AND priorBaselineDays before that had 0 sales for the (storeId,
//       category, itemName, modifier=false) tuple.
//
// For each launch we surface the daily qty curve, 7-day rolling average,
// cumulative qty + revenue, and a 90-day projection. The projection is the
// trailing 7-day mean qty extended forward (no growth assumption — see
// caveats). 80% CI is ±1.28 × σ_daily / √7.
//
// Caveats baked in:
//   - V1 does NOT retrieve pgvector analogues. Shape is reserved (see
//     analogues field, always []) so the card and chat tool can opt into
//     it later without a contract change.
//   - "First appearance" is by (storeId, category, itemName) — modifiers
//     excluded — so a renamed item looks like a launch. Operator
//     interpretation required.
//   - Items launched fewer than 7 days ago get a trajectory but no
//     projection (insufficient signal for a 90-day extrapolation).

import { prisma } from "@/lib/prisma"
import { getCachedSession, resolveStoreContext } from "./_shared"

interface SessionUser {
  id: string
  accountId: string
}
interface SessionLike {
  user?: SessionUser | null
}

const DEFAULT_RECENT_DAYS = 60
const DEFAULT_PRIOR_BASELINE_DAYS = 90
const PROJECTION_HORIZON_DAYS = 90
const MIN_DAYS_FOR_PROJECTION = 7

export interface LaunchDailyPoint {
  date: Date
  daysSinceLaunch: number
  qty: number
  revenue: number
}

export interface LaunchProjection {
  meanDailyQtyTrailing7: number
  stdDailyQtyTrailing7: number
  projectedQty90d: number
  projectedQtyCI80Low: number
  projectedQtyCI80High: number
}

export interface LaunchTrajectory {
  storeId: string
  /** Populated in aggregate mode (multiple stores in scope). */
  storeName?: string
  category: string
  itemName: string
  firstSaleDate: Date
  daysSinceLaunch: number
  totalQty: number
  totalRevenue: number
  meanUnitPrice: number
  daily: LaunchDailyPoint[]
  projection: LaunchProjection | null
  /** Reserved for future pgvector lookup; always [] in v1. */
  analogues: { itemName: string; storeId: string; firstSaleDate: Date }[]
}

export interface LaunchTrajectoryData {
  windowStart: Date
  windowEnd: Date
  storeId: string | null
  storeName: string | null
  launches: LaunchTrajectory[]
}

export type GetLaunchTrajectoryResult =
  | { ok: true; data: LaunchTrajectoryData }
  | { ok: false; error: "store_not_in_account" | "no_data" }

export async function getLaunchTrajectory(input: {
  storeId?: string
  recentDays?: number
  asOf?: Date
}): Promise<GetLaunchTrajectoryResult | null> {
  const session = await getCachedSession()
  const user = session?.user ?? null
  if (!user) return null

  const recentDays = input.recentDays ?? DEFAULT_RECENT_DAYS
  const asOf = input.asOf ?? new Date()
  const windowEnd = startOfDayUtc(asOf)
  const windowStart = new Date(windowEnd)
  windowStart.setUTCDate(windowStart.getUTCDate() - recentDays)
  const baselineStart = new Date(windowStart)
  baselineStart.setUTCDate(
    baselineStart.getUTCDate() - DEFAULT_PRIOR_BASELINE_DAYS,
  )

  const resolved = await resolveStoreContext(input.storeId, user.accountId)
  if (!resolved.ok) return resolved
  const { storeName, storeNameById, storeIdOut: storeId } = resolved.ctx

  // Pull all rows in [baselineStart, windowEnd] so we can verify a clean
  // pre-launch zero baseline in one query.
  const rows = await prisma.otterMenuItem.findMany({
    where: {
      ...(storeId ? { storeId } : { store: { accountId: user.accountId } }),
      isModifier: false,
      date: { gte: baselineStart, lte: windowEnd },
    },
    select: {
      storeId: true,
      date: true,
      category: true,
      itemName: true,
      fpQuantitySold: true,
      tpQuantitySold: true,
      fpTotalSales: true,
      tpTotalSales: true,
    },
  })

  if (rows.length === 0) return { ok: false, error: "no_data" }

  // Group by (storeId, category, itemName)
  type Key = string
  const keyOf = (r: { storeId: string; category: string; itemName: string }) =>
    `${r.storeId}${r.category}${r.itemName}`

  const byKey = new Map<
    Key,
    {
      storeId: string
      category: string
      itemName: string
      points: { date: Date; qty: number; revenue: number }[]
    }
  >()
  for (const r of rows) {
    const key = keyOf(r)
    const qty = (r.fpQuantitySold ?? 0) + (r.tpQuantitySold ?? 0)
    const revenue = (r.fpTotalSales ?? 0) + (r.tpTotalSales ?? 0)
    if (qty <= 0 && revenue <= 0) continue
    const bucket = byKey.get(key) ?? {
      storeId: r.storeId,
      category: r.category,
      itemName: r.itemName,
      points: [],
    }
    bucket.points.push({ date: r.date as Date, qty, revenue })
    byKey.set(key, bucket)
  }

  const launches: LaunchTrajectory[] = []
  for (const bucket of byKey.values()) {
    bucket.points.sort((a, b) => a.date.getTime() - b.date.getTime())
    const firstSale = bucket.points[0].date
    if (firstSale < windowStart) continue // not new — first sale predates window
    if (firstSale > windowEnd) continue

    const daysSinceLaunch =
      Math.floor((windowEnd.getTime() - firstSale.getTime()) / 86_400_000) + 1

    const daily: LaunchDailyPoint[] = bucket.points.map((p) => ({
      date: p.date,
      daysSinceLaunch:
        Math.floor((p.date.getTime() - firstSale.getTime()) / 86_400_000) + 1,
      qty: p.qty,
      revenue: p.revenue,
    }))

    const totalQty = daily.reduce((s, d) => s + d.qty, 0)
    const totalRevenue = daily.reduce((s, d) => s + d.revenue, 0)
    const meanUnitPrice = totalQty > 0 ? totalRevenue / totalQty : 0

    let projection: LaunchProjection | null = null
    if (daysSinceLaunch >= MIN_DAYS_FOR_PROJECTION) {
      const trailing = daily.slice(-7).map((d) => d.qty)
      const meanQ = mean(trailing)
      const stdQ = trailing.length > 1 ? stdSample(trailing) : 0
      const projectedQty = meanQ * PROJECTION_HORIZON_DAYS
      const ciHalf =
        1.28 * (stdQ / Math.sqrt(trailing.length)) * PROJECTION_HORIZON_DAYS
      projection = {
        meanDailyQtyTrailing7: meanQ,
        stdDailyQtyTrailing7: stdQ,
        projectedQty90d: projectedQty,
        projectedQtyCI80Low: Math.max(0, projectedQty - ciHalf),
        projectedQtyCI80High: projectedQty + ciHalf,
      }
    }

    launches.push({
      storeId: bucket.storeId,
      ...(storeId == null && storeNameById.has(bucket.storeId)
        ? { storeName: storeNameById.get(bucket.storeId)! }
        : {}),
      category: bucket.category,
      itemName: bucket.itemName,
      firstSaleDate: firstSale,
      daysSinceLaunch,
      totalQty,
      totalRevenue,
      meanUnitPrice,
      daily,
      projection,
      analogues: [],
    })
  }

  // Sort by total revenue desc — operator wants the launches that matter.
  launches.sort((a, b) => b.totalRevenue - a.totalRevenue)

  return {
    ok: true,
    data: {
      windowStart,
      windowEnd,
      storeId,
      storeName,
      launches,
    },
  }
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function stdSample(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  const variance = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)
  return Math.sqrt(variance)
}

