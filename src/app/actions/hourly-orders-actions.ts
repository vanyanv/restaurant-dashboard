"use server"

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import {
  derivePeriodSpec,
  deriveRangeSpec,
  bucketHourlyRows,
  emptyHourly,
  type AggregateHourlyRow,
  type PeriodSpec,
} from "@/lib/hourly-orders"
import type { DashboardRange } from "@/lib/dashboard-utils"
import type {
  HourlyComparisonPeriod,
  HourlyOrderPoint,
  OrderPatternsHourlyComparison,
} from "@/types/analytics"

/**
 * Fast read path for the dashboard "Service by the hour" card.
 * Reads from the precomputed `OtterHourlySummary` table (refreshed hourly by
 * the cron) — no live Otter calls.
 */
export async function getHourlyOrderPatterns(
  storeId: string | undefined,
  period: HourlyComparisonPeriod
): Promise<HourlyPatternsResult | null> {
  return readHourlyPatterns(storeId, derivePeriodSpec(period), period)
}

/**
 * Same read path, but for the range the dashboard's date picker is on rather
 * than one of the four fixed periods. Overview calls this so the pace lines
 * under the hero figures follow the selected range instead of only rendering
 * on "today".
 */
export async function getHourlyPatternsForRange(
  range: DashboardRange,
  storeId?: string
): Promise<HourlyPatternsResult | null> {
  return readHourlyPatterns(storeId, deriveRangeSpec(range), "range")
}

type HourlyPatternsResult = {
  hourly: HourlyOrderPoint[]
  hourlyComparison: OrderPatternsHourlyComparison | null
}

async function readHourlyPatterns(
  storeId: string | undefined,
  spec: PeriodSpec,
  period: HourlyComparisonPeriod
): Promise<HourlyPatternsResult | null> {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return null

    const allComparisonDates = spec.comparisonGroups.flat()
    const allDates = [...spec.currentDates, ...allComparisonDates]
    const earliest = allDates.reduce(
      (min, d) => (d < min ? d : min),
      allDates[0]
    )
    const latest = allDates.reduce(
      (max, d) => (d > max ? d : max),
      allDates[0]
    )
    const earliestDate = new Date(earliest + "T00:00:00.000Z")
    const latestDate = new Date(latest + "T00:00:00.000Z")

    // Single Prisma query covering the union window — every (date, hour) row
    // for the current dates AND all four comparison groups, which is why
    // `bucketHourlyRows` can publish each baseline week's own count for an
    // hour (`groupOrderCounts`) and not just their mean. Always scope to the
    // caller's account so a foreign storeId can't read another tenant's sales.
    const rows = await prisma.otterHourlySummary.findMany({
      where: {
        ...(storeId ? { storeId } : {}),
        store: { accountId: session.user.accountId },
        date: { gte: earliestDate, lte: latestDate },
      },
      select: {
        date: true,
        hour: true,
        orderCount: true,
        netSales: true,
      },
    })

    // Sum across stores (when storeId is undefined) per (date, hour) before bucketing.
    const aggregated = new Map<string, AggregateHourlyRow>()
    for (const row of rows) {
      const dateStr = row.date.toISOString().slice(0, 10)
      const key = `${dateStr}|${row.hour}`
      const existing = aggregated.get(key)
      if (existing) {
        existing.orderCount += row.orderCount
        existing.netSales += row.netSales
      } else {
        aggregated.set(key, {
          date: dateStr,
          hour: row.hour,
          orderCount: row.orderCount,
          netSales: row.netSales,
        })
      }
    }

    return bucketHourlyRows({
      rows: [...aggregated.values()],
      spec,
      period,
    })
  } catch (error) {
    console.error("Get hourly order patterns error:", error)
    return { hourly: emptyHourly(), hourlyComparison: null }
  }
}
