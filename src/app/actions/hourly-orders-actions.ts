"use server"

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import {
  derivePeriodSpec,
  bucketHourlyRows,
  emptyHourly,
  type AggregateHourlyRow,
} from "@/lib/hourly-orders"
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
): Promise<{
  hourly: HourlyOrderPoint[]
  hourlyComparison: OrderPatternsHourlyComparison | null
} | null> {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return null

    const spec = derivePeriodSpec(period)

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

    // Single Prisma query covering the union window.
    const rows = await prisma.otterHourlySummary.findMany({
      where: {
        ...(storeId ? { storeId } : {}),
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
