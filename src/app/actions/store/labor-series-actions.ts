"use server"

import { getServerSession } from "next-auth"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export interface DailyLaborPoint {
  /** YYYY-MM-DD in store-local terms, matching `DailyTrend.date`. */
  date: string
  /** Labor dollars posted for that day, summed across the account's stores. */
  actualCost: number
  /** Harri's own forecast for the same day. Null when it was never posted. */
  forecastCost: number | null
}

/**
 * Trailing daily labor cost, account-wide.
 *
 * `HarriDailyLabor` is already daily-grain and carries both the actual and the
 * forecast, so the overview's labor sparkline needs no new sync — only a read.
 * Paired with `DailyTrend.netRevenue` on the same dates it yields a daily labor
 * share, which is what the rail's Labor cell actually plots.
 *
 * Excludes today. Labor posts in lumps through service, so the current day's
 * cost is always understated and would draw a cliff at the right edge — the
 * same reason `getRevenueTrendData` drops it.
 */
export async function getDailyLaborSeries(options?: {
  days?: number
}): Promise<DailyLaborPoint[]> {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user || !hasOwnerAccess(session.user.role)) return []

    const days = options?.days ?? 14

    // `date` is a @db.Date column, so it is stored midnight-UTC per calendar
    // day. Bound it the same way rather than with local timestamps, which
    // would shift the window by a day for half the year.
    const today = new Date()
    const end = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
    )
    end.setUTCDate(end.getUTCDate() - 1)
    const start = new Date(end)
    start.setUTCDate(start.getUTCDate() - (days - 1))

    const rows = await prisma.harriDailyLabor.findMany({
      where: {
        store: { accountId: session.user.accountId, isActive: true },
        date: { gte: start, lte: end },
      },
      select: { date: true, actualCost: true, forecastCost: true },
      orderBy: { date: "asc" },
    })

    const byDate = new Map<string, { actualCost: number; forecastCost: number | null }>()
    for (const r of rows) {
      const key = r.date.toISOString().slice(0, 10)
      const acc = byDate.get(key) ?? { actualCost: 0, forecastCost: null }
      acc.actualCost += r.actualCost ?? 0
      if (r.forecastCost != null) {
        acc.forecastCost = (acc.forecastCost ?? 0) + r.forecastCost
      }
      byDate.set(key, acc)
    }

    return [...byDate.entries()]
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date))
  } catch (error) {
    console.error("Get daily labor series error:", error)
    return []
  }
}
