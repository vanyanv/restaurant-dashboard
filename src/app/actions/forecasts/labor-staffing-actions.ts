"use server"

// Hourly labor optimization. Deterministic projection from existing
// ForecastDailyRevenue × historical OtterHourlySummary share, no new ML
// pipeline needed.
//
// 1. Pull next-7-day daily revenue forecast (latest generation per date).
// 2. Compute the mean avg-ticket over the trailing 28 days from
//    OtterDailySummary so we can convert predicted revenue → predicted
//    daily orders.
// 3. From OtterHourlySummary, compute the typical share of daily orders
//    that each (weekday, hour) bucket sees. This is the demand SHAPE.
// 4. Apply share × predicted daily orders → predicted orders per hour.
// 5. Recommended staff = max(MIN_STAFF, ceil(predicted_orders / COVERS_PER_STAFF)).
//
// Constants are constants for v1; promote to Store columns when the
// operator asks to tune per-store.

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

interface SessionUser {
  id: string
  accountId: string
}
interface SessionLike {
  user?: SessionUser | null
}

/** Each staff member can cover roughly this many orders per hour at peak. */
export const COVERS_PER_STAFF_HOUR = 12
/** Floor for recommended staffing during open hours. */
export const MIN_STAFF = 2
/** Trailing window for both avg-ticket and hourly-share computations. */
const HISTORY_DAYS = 28
/** Default forward horizon. */
const DEFAULT_HORIZON_DAYS = 7

export interface LaborStaffingHour {
  hour: number
  predictedOrders: number
  recommendedStaff: number
}

export interface LaborStaffingDay {
  date: Date
  weekday: number
  predictedRevenue: number | null
  predictedOrders: number
  totalLaborHours: number
  hours: LaborStaffingHour[]
}

export interface LaborStaffingData {
  storeId: string
  storeName: string
  generatedAt: Date | null
  meanAvgTicket: number
  coversPerStaffHour: number
  minStaff: number
  days: LaborStaffingDay[]
  totalForecastLaborHours: number
}

export type GetLaborStaffingResult =
  | { ok: true; data: LaborStaffingData }
  | { ok: false; error: "store_not_in_account" }
  | { ok: false; error: "insufficient_history" }

export async function getLaborStaffingForecast(input: {
  storeId: string
  horizonDays?: number
  asOf?: Date
}): Promise<GetLaborStaffingResult | null> {
  const session = (await getServerSession(authOptions)) as SessionLike | null
  const user = session?.user ?? null
  if (!user) return null

  const store = await prisma.store.findUnique({
    where: { id: input.storeId },
    select: { id: true, name: true, accountId: true },
  })
  if (!store || store.accountId !== user.accountId) {
    return { ok: false, error: "store_not_in_account" }
  }

  const horizonDays = input.horizonDays ?? DEFAULT_HORIZON_DAYS
  const asOf = input.asOf ?? new Date()
  const today = startOfDay(asOf)
  const historyStart = new Date(today)
  historyStart.setUTCDate(historyStart.getUTCDate() - HISTORY_DAYS)
  const horizonEnd = new Date(today)
  horizonEnd.setUTCDate(horizonEnd.getUTCDate() + horizonDays)

  const [revenueRows, hourlyRows, dailyRows] = await Promise.all([
    prisma.forecastDailyRevenue.findMany({
      where: {
        storeId: input.storeId,
        hourBucket: 0,
        forecastDate: { gte: today, lt: horizonEnd },
      },
      orderBy: [{ forecastDate: "asc" }, { generatedAt: "desc" }],
      select: {
        forecastDate: true,
        predictedRevenue: true,
        generatedAt: true,
      },
    }),
    prisma.otterHourlySummary.findMany({
      where: {
        storeId: input.storeId,
        date: { gte: historyStart, lt: today },
      },
      select: { date: true, hour: true, orderCount: true },
    }),
    prisma.otterDailySummary.groupBy({
      by: ["date"],
      where: {
        storeId: input.storeId,
        date: { gte: historyStart, lt: today },
      },
      _sum: {
        fpNetSales: true,
        tpNetSales: true,
        fpOrderCount: true,
        tpOrderCount: true,
      },
    }),
  ])

  if (hourlyRows.length === 0 || dailyRows.length === 0) {
    return { ok: false, error: "insufficient_history" }
  }

  // Latest generation per forecast date
  type RevRow = (typeof revenueRows)[number]
  const latestRevenue = new Map<string, RevRow>()
  let latestGen: Date | null = null
  for (const r of revenueRows) {
    const key = ymd(r.forecastDate as Date)
    const existing = latestRevenue.get(key)
    if (!existing || r.generatedAt > existing.generatedAt) latestRevenue.set(key, r)
    if (!latestGen || r.generatedAt > latestGen) latestGen = r.generatedAt
  }

  // Mean avg ticket over the history window
  let totalRevenue = 0
  let totalOrders = 0
  for (const d of dailyRows) {
    totalRevenue += (d._sum.fpNetSales ?? 0) + (d._sum.tpNetSales ?? 0)
    totalOrders += (d._sum.fpOrderCount ?? 0) + (d._sum.tpOrderCount ?? 0)
  }
  const meanAvgTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0
  if (meanAvgTicket <= 0) {
    return { ok: false, error: "insufficient_history" }
  }

  // Build (weekday, hour) → mean orderCount, then normalize to share
  const sumByKey = new Map<string, number>()
  const countByKey = new Map<string, number>()
  for (const r of hourlyRows) {
    const wd = (r.date as Date).getUTCDay()
    const key = `${wd}|${r.hour}`
    sumByKey.set(key, (sumByKey.get(key) ?? 0) + r.orderCount)
    countByKey.set(key, (countByKey.get(key) ?? 0) + 1)
  }
  const meanByKey = new Map<string, number>()
  for (const [k, sum] of sumByKey) {
    const n = countByKey.get(k) ?? 1
    meanByKey.set(k, sum / n)
  }
  // Day total per weekday for normalization
  const dayTotalByWeekday = new Map<number, number>()
  for (const [k, mean] of meanByKey) {
    const wd = Number(k.split("|")[0])
    dayTotalByWeekday.set(wd, (dayTotalByWeekday.get(wd) ?? 0) + mean)
  }

  // For each forecast day, build hourly staffing
  const days: LaborStaffingDay[] = []
  let totalLaborHoursAcrossDays = 0

  for (let offset = 0; offset < horizonDays; offset++) {
    const dayDate = new Date(today)
    dayDate.setUTCDate(dayDate.getUTCDate() + offset)
    const weekday = dayDate.getUTCDay()
    const revKey = ymd(dayDate)
    const revRow = latestRevenue.get(revKey) ?? null
    const predictedRevenue = revRow?.predictedRevenue ?? null
    const predictedOrders =
      predictedRevenue && meanAvgTicket > 0 ? predictedRevenue / meanAvgTicket : 0

    const dayTotal = dayTotalByWeekday.get(weekday) ?? 0
    const hours: LaborStaffingHour[] = []
    let totalLaborHours = 0
    for (let h = 0; h < 24; h++) {
      const meanForBucket = meanByKey.get(`${weekday}|${h}`) ?? 0
      const share = dayTotal > 0 ? meanForBucket / dayTotal : 0
      const predictedHourlyOrders = predictedOrders * share
      // Only staff hours that historically had any orders.
      const recommendedStaff =
        meanForBucket > 0
          ? Math.max(MIN_STAFF, Math.ceil(predictedHourlyOrders / COVERS_PER_STAFF_HOUR))
          : 0
      hours.push({
        hour: h,
        predictedOrders: predictedHourlyOrders,
        recommendedStaff,
      })
      totalLaborHours += recommendedStaff
    }
    totalLaborHoursAcrossDays += totalLaborHours
    days.push({
      date: dayDate,
      weekday,
      predictedRevenue,
      predictedOrders,
      totalLaborHours,
      hours,
    })
  }

  return {
    ok: true,
    data: {
      storeId: store.id,
      storeName: store.name,
      generatedAt: latestGen,
      meanAvgTicket,
      coversPerStaffHour: COVERS_PER_STAFF_HOUR,
      minStaff: MIN_STAFF,
      days,
      totalForecastLaborHours: totalLaborHoursAcrossDays,
    },
  }
}

function startOfDay(d: Date): Date {
  // UTC-consistent so the day key matches forecast rows (which use @db.Date,
  // i.e. UTC midnight) regardless of the runner's local timezone.
  const out = new Date(d)
  out.setUTCHours(0, 0, 0, 0)
  return out
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}
