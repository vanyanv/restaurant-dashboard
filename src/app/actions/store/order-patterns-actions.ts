"use server"

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { todayInLA, startOfDayLA, endOfDayLA } from "@/lib/dashboard-utils"
import { getStores } from "./crud-actions"
import { logger } from "@/lib/logger"

type HourlyComparisonPeriod =
  import("@/types/analytics").HourlyComparisonPeriod

const HOUR_LABELS = [
  "12 AM", "1 AM", "2 AM", "3 AM", "4 AM", "5 AM",
  "6 AM", "7 AM", "8 AM", "9 AM", "10 AM", "11 AM",
  "12 PM", "1 PM", "2 PM", "3 PM", "4 PM", "5 PM",
  "6 PM", "7 PM", "8 PM", "9 PM", "10 PM", "11 PM",
]

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function emptyHourly(): import("@/types/analytics").HourlyOrderPoint[] {
  return Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    label: HOUR_LABELS[i],
    orderCount: 0,
    totalSales: 0,
    avgOrderCount: 0,
    avgTotalSales: 0,
  }))
}

async function getHourlyOrderDistribution(
  storeIds: string[],
  rangeStart: Date,
  rangeEnd: Date
): Promise<import("@/types/analytics").HourlyOrderPoint[]> {
  const { queryMetrics, buildCustomerOrdersBody } = await import("@/lib/otter")

  const otterStores = await prisma.otterStore.findMany({
    where: { storeId: { in: storeIds } },
    select: { otterStoreId: true },
  })

  const hourly = emptyHourly()
  if (otterStores.length === 0) return hourly

  const otterIds = otterStores.map((s) => s.otterStoreId)
  const body = buildCustomerOrdersBody(otterIds, rangeStart, rangeEnd)

  try {
    const rows = await queryMetrics(body)

    for (const row of rows) {
      const epochMs = row.reference_time_local_without_tz as number | null
      if (epochMs == null) continue

      const hour = new Date(epochMs).getUTCHours()
      if (hour >= 0 && hour < 24) {
        hourly[hour].orderCount += 1
        hourly[hour].totalSales += (row.net_sales as number) ?? 0
      }
    }

    for (const h of hourly) {
      h.totalSales = Math.round(h.totalSales * 100) / 100
    }

    return hourly
  } catch (error) {
    logger.error("Failed to fetch hourly order data from Otter:", error)
    return hourly
  }
}

function getCurrentLAHour(): number {
  return parseInt(
    new Date().toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "numeric",
      hour12: false,
    })
  )
}

function laDateMinusDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00Z")
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

interface PeriodSpec {
  currentDates: string[]
  comparisonGroups: string[][]
  hourCutoff: number | null
  weekdayLabel: string
}

function derivePeriodSpec(
  period: HourlyComparisonPeriod
): PeriodSpec {
  const today = todayInLA()
  const todayDow = new Date(today + "T12:00:00Z").getUTCDay()
  const currentLAHour = getCurrentLAHour()

  if (period === "today") {
    return {
      currentDates: [today],
      comparisonGroups: [7, 14, 21, 28].map((n) => [laDateMinusDays(today, n)]),
      hourCutoff: currentLAHour,
      weekdayLabel: DAY_NAMES[todayDow],
    }
  }

  if (period === "yesterday") {
    const yday = laDateMinusDays(today, 1)
    const ydayDow = new Date(yday + "T12:00:00Z").getUTCDay()
    return {
      currentDates: [yday],
      comparisonGroups: [7, 14, 21, 28].map((n) => [laDateMinusDays(yday, n)]),
      hourCutoff: null,
      weekdayLabel: DAY_NAMES[ydayDow],
    }
  }

  const daysSinceMonday = (todayDow + 6) % 7

  if (period === "this-week") {
    const monday = laDateMinusDays(today, daysSinceMonday)
    const currentDates = Array.from({ length: daysSinceMonday + 1 }, (_, i) =>
      laDateMinusDays(monday, -i)
    )
    const comparisonGroups = [1, 2, 3, 4].map((wk) =>
      currentDates.map((d) => laDateMinusDays(d, wk * 7))
    )
    return {
      currentDates,
      comparisonGroups,
      hourCutoff: currentLAHour,
      weekdayLabel:
        currentDates.length === 1
          ? DAY_NAMES[1]
          : `Mon–${DAY_NAMES[todayDow]}`,
    }
  }

  const lastMonday = laDateMinusDays(today, daysSinceMonday + 7)
  const currentDates = Array.from({ length: 7 }, (_, i) =>
    laDateMinusDays(lastMonday, -i)
  )
  const comparisonGroups = [1, 2, 3, 4].map((wk) =>
    currentDates.map((d) => laDateMinusDays(d, wk * 7))
  )
  return {
    currentDates,
    comparisonGroups,
    hourCutoff: null,
    weekdayLabel: "last week",
  }
}

async function getHourlyOrderDistributionWithComparison(
  storeIds: string[],
  period: HourlyComparisonPeriod
): Promise<{
  hourly: import("@/types/analytics").HourlyOrderPoint[]
  hourlyComparison:
    | import("@/types/analytics").OrderPatternsHourlyComparison
    | null
}> {
  const { queryMetrics, buildCustomerOrdersBody } = await import("@/lib/otter")
  const spec = derivePeriodSpec(period)

  const hourly = emptyHourly()

  const otterStores = await prisma.otterStore.findMany({
    where: { storeId: { in: storeIds } },
    select: { otterStoreId: true },
  })
  if (otterStores.length === 0) {
    return { hourly, hourlyComparison: null }
  }
  const otterIds = otterStores.map((s) => s.otterStoreId)

  const allComparisonDates = spec.comparisonGroups.flat()
  const earliestComparison = allComparisonDates.reduce(
    (min, d) => (d < min ? d : min),
    allComparisonDates[0] ?? spec.currentDates[0]
  )
  const latestCurrent = spec.currentDates[spec.currentDates.length - 1]
  const queryStart = startOfDayLA(earliestComparison)
  const queryEnd = endOfDayLA(latestCurrent)

  const body = buildCustomerOrdersBody(otterIds, queryStart, queryEnd) as Record<
    string,
    unknown
  >
  body.limit = 50000

  let rows: Awaited<ReturnType<typeof queryMetrics>>
  try {
    rows = await queryMetrics(body)
  } catch (error) {
    logger.error(
      "Failed to fetch hourly order data with comparison from Otter:",
      error
    )
    return { hourly, hourlyComparison: null }
  }

  const currentDateSet = new Set(spec.currentDates)
  const comparisonDateSet = new Set(allComparisonDates)
  const comparisonDateToGroup = new Map<string, number>()
  spec.comparisonGroups.forEach((group, gi) => {
    for (const d of group) comparisonDateToGroup.set(d, gi)
  })

  const currentByHour = Array.from({ length: 24 }, () => ({ count: 0, sales: 0 }))
  const comparisonByHour = Array.from({ length: 24 }, () => ({ count: 0, sales: 0 }))

  const groupTotals = spec.comparisonGroups.map(() => 0)
  let currentTotal = 0

  const lastCurrentDate = spec.currentDates[spec.currentDates.length - 1]
  const comparisonLastDayPerGroup = spec.comparisonGroups.map(
    (group) => group[group.length - 1]
  )
  const isComparisonLastDay = (date: string): boolean =>
    comparisonLastDayPerGroup.includes(date)

  for (const row of rows) {
    const epochMs = row.reference_time_local_without_tz as number | null
    if (epochMs == null) continue
    const d = new Date(epochMs)
    const hour = d.getUTCHours()
    if (hour < 0 || hour >= 24) continue
    const dateStr = d.toISOString().slice(0, 10)
    const sales = (row.net_sales as number) ?? 0

    if (currentDateSet.has(dateStr)) {
      currentByHour[hour].count += 1
      currentByHour[hour].sales += sales

      if (
        spec.hourCutoff == null ||
        dateStr !== lastCurrentDate ||
        hour <= spec.hourCutoff
      ) {
        currentTotal += 1
      }
    } else if (comparisonDateSet.has(dateStr)) {
      comparisonByHour[hour].count += 1
      comparisonByHour[hour].sales += sales

      if (
        spec.hourCutoff == null ||
        !isComparisonLastDay(dateStr) ||
        hour <= spec.hourCutoff
      ) {
        const gi = comparisonDateToGroup.get(dateStr)
        if (gi != null) groupTotals[gi] += 1
      }
    }
  }

  const currentInstances = spec.currentDates.length
  const baselineInstances = allComparisonDates.length

  for (let h = 0; h < 24; h++) {
    hourly[h].orderCount =
      currentInstances > 0
        ? Math.round((currentByHour[h].count / currentInstances) * 10) / 10
        : 0
    hourly[h].totalSales =
      currentInstances > 0
        ? Math.round((currentByHour[h].sales / currentInstances) * 100) / 100
        : 0
    hourly[h].avgOrderCount =
      baselineInstances > 0
        ? Math.round((comparisonByHour[h].count / baselineInstances) * 10) / 10
        : 0
    hourly[h].avgTotalSales =
      baselineInstances > 0
        ? Math.round((comparisonByHour[h].sales / baselineInstances) * 100) /
          100
        : 0
  }

  if (currentInstances === 1) {
    for (let h = 0; h < 24; h++) {
      hourly[h].orderCount = currentByHour[h].count
    }
  }

  const baselineWeeks = groupTotals.filter((t) => t > 0).length
  const baselineTotal =
    baselineWeeks > 0
      ? groupTotals.reduce((a, b) => a + b, 0) / spec.comparisonGroups.length
      : 0
  const pacePct =
    baselineTotal > 0 ? ((currentTotal - baselineTotal) / baselineTotal) * 100 : null

  return {
    hourly,
    hourlyComparison: {
      period,
      currentTotal,
      baselineTotal: Math.round(baselineTotal * 10) / 10,
      pacePct: pacePct == null ? null : Math.round(pacePct * 10) / 10,
      baselineWeeks,
      weekdayLabel: spec.weekdayLabel,
    },
  }
}

export async function getOrderPatterns(
  storeId?: string,
  options?: {
    days?: number
    startDate?: string
    endDate?: string
    period?: HourlyComparisonPeriod
  }
): Promise<import("@/types/analytics").OrderPatternsData | null> {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return null

    const stores = await getStores()
    if (stores.length === 0) return null

    const storeIds = storeId ? [storeId] : stores.map((s) => s.id)

    const days = options?.days ?? 30
    let rangeStart: Date
    let rangeEnd: Date

    if (options?.period) {
      const today = todayInLA()
      rangeEnd = endOfDayLA(today)
      const start = startOfDayLA(today)
      start.setDate(start.getDate() - 35)
      rangeStart = start
    } else if (options?.startDate && options?.endDate) {
      rangeStart = new Date(options.startDate + "T00:00:00Z")
      rangeEnd = new Date(options.endDate + "T23:59:59.999Z")
    } else {
      const today = todayInLA()
      rangeEnd = endOfDayLA(today)
      if (days === 1) {
        rangeStart = startOfDayLA(today)
      } else if (days === -1) {
        const yday = startOfDayLA(today)
        yday.setDate(yday.getDate() - 1)
        rangeStart = yday
        rangeEnd = new Date(yday.getTime() + 24 * 60 * 60 * 1000 - 1)
      } else {
        const start = startOfDayLA(today)
        start.setDate(start.getDate() - days)
        rangeStart = start
      }
    }

    const hourlyPromise = options?.period
      ? getHourlyOrderDistributionWithComparison(storeIds, options.period)
      : getHourlyOrderDistribution(storeIds, rangeStart, rangeEnd).then(
          (hourly) => ({ hourly, hourlyComparison: null })
        )

    const [hourlyResult, summaries] = await Promise.all([
      hourlyPromise,
      prisma.otterDailySummary.findMany({
        where: {
          storeId: { in: storeIds },
          date: { gte: rangeStart, lte: rangeEnd },
        },
        select: {
          date: true,
          platform: true,
          fpOrderCount: true,
          tpOrderCount: true,
          fpGrossSales: true,
          tpGrossSales: true,
        },
        orderBy: { date: "asc" },
      }),
    ])

    const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    const dayBuckets = Array.from({ length: 7 }, () => ({
      orderCount: 0,
      totalSales: 0,
      dayOccurrences: new Set<string>(),
    }))

    for (const row of summaries) {
      const d = new Date(row.date)
      const dow = d.getUTCDay()
      const dateKey = d.toISOString().slice(0, 10)
      dayBuckets[dow].orderCount += (row.fpOrderCount ?? 0) + (row.tpOrderCount ?? 0)
      dayBuckets[dow].totalSales += (row.fpGrossSales ?? 0) + (row.tpGrossSales ?? 0)
      dayBuckets[dow].dayOccurrences.add(dateKey)
    }

    const byDayOfWeek = dayBuckets.map((b, i) => ({
      day: i,
      label: DAY_LABELS[i],
      orderCount: b.orderCount,
      totalSales: Math.round(b.totalSales * 100) / 100,
      avgOrders: b.dayOccurrences.size > 0
        ? Math.round(b.orderCount / b.dayOccurrences.size)
        : 0,
    }))

    const monthMap = new Map<string, { orderCount: number; totalSales: number }>()

    for (const row of summaries) {
      const d = new Date(row.date)
      const monthKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
      const entry = monthMap.get(monthKey) ?? { orderCount: 0, totalSales: 0 }
      entry.orderCount += (row.fpOrderCount ?? 0) + (row.tpOrderCount ?? 0)
      entry.totalSales += (row.fpGrossSales ?? 0) + (row.tpGrossSales ?? 0)
      monthMap.set(monthKey, entry)
    }

    const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    const byMonth = Array.from(monthMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => {
        const [year, month] = key.split("-")
        return {
          month: key,
          label: `${MONTH_NAMES[parseInt(month) - 1]} ${year}`,
          orderCount: val.orderCount,
          totalSales: Math.round(val.totalSales * 100) / 100,
        }
      })

    return {
      hourly: hourlyResult.hourly,
      hourlyComparison: hourlyResult.hourlyComparison,
      byDayOfWeek,
      byMonth,
    }
  } catch (error) {
    logger.error("Get order patterns error:", error)
    return null
  }
}
