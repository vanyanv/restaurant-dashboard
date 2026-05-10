"use server"

import { getServerSession } from "next-auth"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

async function requireOwnerStore(storeId: string) {
  const session = await getServerSession(authOptions)
  if (!session?.user) throw new Error("Unauthorized")
  if (!hasOwnerAccess(session.user.role)) throw new Error("Forbidden")
  const store = await prisma.store.findFirst({
    where: { id: storeId, accountId: session.user.accountId },
    select: { id: true, name: true, fixedMonthlyLabor: true },
  })
  if (!store) throw new Error("Store not found")
  return store
}

export type HarriDailyRow = {
  date: string // YYYY-MM-DD
  actualCost: number | null
  forecastCost: number | null
  variance: number | null
  variancePct: number | null
  alertCount: number
}

export async function getHarriDailyLabor(
  storeId: string,
  startDate: Date,
  endDate: Date
): Promise<HarriDailyRow[]> {
  await requireOwnerStore(storeId)

  const [daily, alerts] = await Promise.all([
    prisma.harriDailyLabor.findMany({
      where: { storeId, date: { gte: startDate, lte: endDate } },
      orderBy: { date: "asc" },
    }),
    prisma.harriTimekeepingAlert.groupBy({
      by: ["date"],
      where: { storeId, date: { gte: startDate, lte: endDate } },
      _count: { _all: true },
    }),
  ])

  const alertMap = new Map<string, number>()
  for (const a of alerts) alertMap.set(a.date.toISOString().slice(0, 10), a._count._all)

  return daily.map((d) => {
    const variance =
      d.actualCost != null && d.forecastCost != null ? d.actualCost - d.forecastCost : null
    const variancePct =
      d.actualCost != null && d.forecastCost != null && d.forecastCost !== 0
        ? variance! / d.forecastCost
        : null
    return {
      date: d.date.toISOString().slice(0, 10),
      actualCost: d.actualCost,
      forecastCost: d.forecastCost,
      variance,
      variancePct,
      alertCount: alertMap.get(d.date.toISOString().slice(0, 10)) ?? 0,
    }
  })
}

export type HarriAlertRow = {
  id: string
  date: string
  employeeId: number
  userId: number
  positionName: string | null
  alertCode: string
  alertTime: string // ISO
  timeDiffSec: number | null
  missedClockAt: string | null
  firstName: string | null
  lastName: string | null
}

export async function getHarriAlerts(
  storeId: string,
  startDate: Date,
  endDate: Date
): Promise<HarriAlertRow[]> {
  await requireOwnerStore(storeId)

  const rows = await prisma.harriTimekeepingAlert.findMany({
    where: { storeId, date: { gte: startDate, lte: endDate } },
    orderBy: [{ date: "desc" }, { alertTime: "desc" }],
    take: 500,
  })

  const userIds = [...new Set(rows.map((r) => r.userId))]
  // Defensive — guards against the dev server holding a pre-migration client
  // and against a brand-new install where `prisma db push` hasn't been run
  // yet. In either case we degrade to `user #N` rather than 500'ing the page.
  let directory: { userId: number; firstName: string | null; lastName: string | null }[] = []
  if (userIds.length > 0 && prisma.harriEmployee) {
    try {
      directory = await prisma.harriEmployee.findMany({
        where: { storeId, userId: { in: userIds } },
        select: { userId: true, firstName: true, lastName: true },
      })
    } catch {
      directory = []
    }
  }
  const dirMap = new Map(directory.map((e) => [e.userId, e]))

  return rows.map((r) => {
    const dir = dirMap.get(r.userId)
    return {
      id: r.id,
      date: r.date.toISOString().slice(0, 10),
      employeeId: r.employeeId,
      userId: r.userId,
      positionName: r.positionName,
      alertCode: r.alertCode,
      alertTime: r.alertTime.toISOString(),
      timeDiffSec: r.timeDiffSec,
      missedClockAt: r.missedClockAt?.toISOString() ?? null,
      firstName: dir?.firstName ?? null,
      lastName: dir?.lastName ?? null,
    }
  })
}

export type HarriWeeklyRow = {
  weekStart: string // YYYY-MM-DD (Mon)
  totalActual: number
  totalForecast: number
  variance: number
  variancePct: number
  daysWithData: number
}

/**
 * Returns the last `weeks` ISO-weeks ending on the Monday containing `endMonday`.
 * Each row is one Mon-Sun bucket. Missing days are simply absent from the sum.
 */
export async function getHarriTrend(
  storeId: string,
  endMonday: Date,
  weeks: number
): Promise<HarriWeeklyRow[]> {
  await requireOwnerStore(storeId)
  return computeWeeklyTrend(
    await prisma.harriDailyLabor.findMany({
      where: {
        storeId,
        date: {
          gte: trendStart(endMonday, weeks),
          lte: trendEnd(endMonday),
        },
      },
      orderBy: { date: "asc" },
    }),
    endMonday,
    weeks
  )
}

/**
 * Same shape as `getHarriTrend` but aggregated across every store the
 * caller's account owns. Powers the all-stores week trend chart.
 */
export async function getHarriTrendAllStores(
  endMonday: Date,
  weeks: number
): Promise<HarriWeeklyRow[]> {
  const session = await getServerSession(authOptions)
  if (!session?.user) throw new Error("Unauthorized")
  if (!hasOwnerAccess(session.user.role)) throw new Error("Forbidden")

  return computeWeeklyTrend(
    await prisma.harriDailyLabor.findMany({
      where: {
        store: { accountId: session.user.accountId, isActive: true },
        date: {
          gte: trendStart(endMonday, weeks),
          lte: trendEnd(endMonday),
        },
      },
      orderBy: { date: "asc" },
    }),
    endMonday,
    weeks
  )
}

function trendStart(endMonday: Date, weeks: number): Date {
  const d = new Date(endMonday)
  d.setUTCDate(d.getUTCDate() - 7 * (weeks - 1))
  return d
}
function trendEnd(endMonday: Date): Date {
  const d = new Date(endMonday)
  d.setUTCDate(d.getUTCDate() + 6) // include Sunday
  return d
}

function computeWeeklyTrend(
  daily: { date: Date; actualCost: number | null; forecastCost: number | null }[],
  endMonday: Date,
  weeks: number
): HarriWeeklyRow[] {
  const start = trendStart(endMonday, weeks)

  // Pre-seed all weeks (including ones with no data) so the chart renders gaps.
  const weekKeys: string[] = []
  for (let i = 0; i < weeks; i++) {
    const m = new Date(start)
    m.setUTCDate(m.getUTCDate() + 7 * i)
    weekKeys.push(m.toISOString().slice(0, 10))
  }

  const acc = new Map<string, { totalActual: number; totalForecast: number; daysWithData: number }>()
  for (const k of weekKeys) acc.set(k, { totalActual: 0, totalForecast: 0, daysWithData: 0 })

  for (const d of daily) {
    const m = new Date(d.date)
    const dow = m.getUTCDay()
    const offset = dow === 0 ? -6 : 1 - dow
    m.setUTCDate(m.getUTCDate() + offset)
    const key = m.toISOString().slice(0, 10)
    const cur = acc.get(key)
    if (!cur) continue
    if (d.actualCost != null) {
      cur.totalActual += d.actualCost
      cur.daysWithData += 1
    }
    if (d.forecastCost != null) cur.totalForecast += d.forecastCost
  }

  return weekKeys.map((weekStart) => {
    const w = acc.get(weekStart)!
    return {
      weekStart,
      totalActual: w.totalActual,
      totalForecast: w.totalForecast,
      variance: w.totalActual - w.totalForecast,
      variancePct: w.totalForecast === 0 ? 0 : (w.totalActual - w.totalForecast) / w.totalForecast,
      daysWithData: w.daysWithData,
    }
  })
}

/**
 * Per-store week summary used by the all-stores ranking panel. One row per
 * store the caller owns; a store without a HarriBrand mapping or without
 * any data in the window still appears with `hasBrand: false` / zeroes.
 */
export type HarriStoreWeekRow = {
  storeId: string
  storeName: string
  brandId: number | null
  hasBrand: boolean
  actualCost: number
  forecastCost: number
  variance: number
  variancePct: number | null
  daysWithData: number
  alertCount: number
}

export async function getHarriStoresWeek(
  weekStart: Date,
  weekEnd: Date
): Promise<HarriStoreWeekRow[]> {
  const session = await getServerSession(authOptions)
  if (!session?.user) throw new Error("Unauthorized")
  if (!hasOwnerAccess(session.user.role)) throw new Error("Forbidden")

  const [stores, brands, daily, alerts] = await Promise.all([
    prisma.store.findMany({
      where: { accountId: session.user.accountId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.harriBrand.findMany({
      where: { active: true, store: { accountId: session.user.accountId } },
      select: { storeId: true, brandId: true },
    }),
    prisma.harriDailyLabor.findMany({
      where: {
        date: { gte: weekStart, lte: weekEnd },
        store: { accountId: session.user.accountId, isActive: true },
      },
      select: { storeId: true, actualCost: true, forecastCost: true },
    }),
    prisma.harriTimekeepingAlert.groupBy({
      by: ["storeId"],
      where: {
        date: { gte: weekStart, lte: weekEnd },
        store: { accountId: session.user.accountId, isActive: true },
      },
      _count: { _all: true },
    }),
  ])

  const brandMap = new Map(brands.map((b) => [b.storeId, b.brandId]))
  const alertMap = new Map(alerts.map((a) => [a.storeId, a._count._all]))

  type Acc = { actual: number; forecast: number; days: number }
  const dailyMap = new Map<string, Acc>()
  for (const d of daily) {
    const cur = dailyMap.get(d.storeId) ?? { actual: 0, forecast: 0, days: 0 }
    if (d.actualCost != null) {
      cur.actual += d.actualCost
      cur.days += 1
    }
    if (d.forecastCost != null) cur.forecast += d.forecastCost
    dailyMap.set(d.storeId, cur)
  }

  return stores.map((s) => {
    const acc = dailyMap.get(s.id)
    const actual = acc?.actual ?? 0
    const forecast = acc?.forecast ?? 0
    return {
      storeId: s.id,
      storeName: s.name,
      brandId: brandMap.get(s.id) ?? null,
      hasBrand: brandMap.has(s.id),
      actualCost: actual,
      forecastCost: forecast,
      variance: actual - forecast,
      variancePct: forecast === 0 ? null : (actual - forecast) / forecast,
      daysWithData: acc?.days ?? 0,
      alertCount: alertMap.get(s.id) ?? 0,
    }
  })
}


export async function getHarriWeeklySummary(
  storeId: string,
  startDate: Date,
  endDate: Date
): Promise<HarriWeeklyRow[]> {
  await requireOwnerStore(storeId)

  const daily = await prisma.harriDailyLabor.findMany({
    where: { storeId, date: { gte: startDate, lte: endDate } },
    orderBy: { date: "asc" },
  })

  // Group by ISO week (Mon-start).
  const weeks = new Map<
    string,
    { totalActual: number; totalForecast: number; daysWithData: number }
  >()
  for (const d of daily) {
    const monday = new Date(d.date)
    const dow = monday.getUTCDay() // 0=Sun
    const offset = dow === 0 ? -6 : 1 - dow
    monday.setUTCDate(monday.getUTCDate() + offset)
    const key = monday.toISOString().slice(0, 10)
    const cur = weeks.get(key) ?? { totalActual: 0, totalForecast: 0, daysWithData: 0 }
    if (d.actualCost != null) {
      cur.totalActual += d.actualCost
      cur.daysWithData += 1
    }
    if (d.forecastCost != null) cur.totalForecast += d.forecastCost
    weeks.set(key, cur)
  }

  return [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, w]) => ({
      weekStart,
      totalActual: w.totalActual,
      totalForecast: w.totalForecast,
      variance: w.totalActual - w.totalForecast,
      variancePct: w.totalForecast === 0 ? 0 : (w.totalActual - w.totalForecast) / w.totalForecast,
      daysWithData: w.daysWithData,
    }))
}
