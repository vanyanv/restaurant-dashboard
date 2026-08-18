"use server"

import { getServerSession } from "next-auth"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/generated/prisma/client"
import {
  buildSplhSeries,
  buildSplhSeriesRolling,
  rollToWeeks,
  blendedHourlyRate,
  type SplhInput,
  type SplhPoint,
} from "@/lib/splh"

/** Days shown as bars in the day view. */
const DAY_WINDOW = 14
/** Weeks shown as bars in the week view. */
const WEEK_WINDOW = 12
/**
 * Trailing history used to derive weekday targets. Long enough that one odd
 * week can't move the median, short enough to track a real trend.
 */
const TARGET_HISTORY_DAYS = 56
/** Trailing weeks a week bar is scored against. */
const ROLLING_WEEKS = 8

export interface SplhSeries {
  storeId: string
  storeName: string
  points: SplhPoint[]
  /** Blended $/hr across the history window — the units for variance dollars. */
  blendedRate: number | null
  /** Days in the window that have BOTH sales and labor hours. */
  daysCovered: number
  /** Days in the window with sales but no labor hours. */
  daysMissingHours: number
}

type JoinedRow = { date: Date; net: number | null; hours: number | null; cost: number | null }

/**
 * SPLH for the owner's stores. Labor hours come from HarriPositionDaily
 * (`actualSeconds`), sales from OtterHourlySummary — both are LA-calendar
 * daily grain, so they join on (storeId, date) directly.
 *
 * Returns one series per store that has any labor hours at all; stores still
 * in construction have no Harri rows and are omitted rather than rendered as
 * an empty axis.
 */
export async function getSplhSeries(
  granularity: "day" | "week" = "day"
): Promise<SplhSeries[]> {
  const session = await getServerSession(authOptions)
  if (!session || !hasOwnerAccess(session.user.role)) return []

  const windowDays =
    granularity === "week" ? WEEK_WINDOW * 7 : DAY_WINDOW
  const lookbackDays = windowDays + TARGET_HISTORY_DAYS

  const since = new Date()
  since.setUTCHours(0, 0, 0, 0)
  since.setUTCDate(since.getUTCDate() - lookbackDays)

  const stores = await prisma.store.findMany({
    where: { accountId: session.user.accountId, isActive: true },
    select: { id: true, name: true },
  })
  if (stores.length === 0) return []

  const storeIds = stores.map((s) => s.id)

  // One pass: labor hours + cost per (store, day) joined to net sales.
  // OtterHourlySummary is the sales side because it is already LA-calendar
  // bucketed; its netSales reconciles with OtterDailySummary to ~0.1%.
  const rows = await prisma.$queryRaw<Array<JoinedRow & { storeId: string }>>(Prisma.sql`
    SELECT h."storeId",
           h."date",
           SUM(h."actualSeconds") / 3600.0            AS hours,
           SUM(COALESCE(h."totalLabor", 0))           AS cost,
           s.net                                      AS net
      FROM "HarriPositionDaily" h
      LEFT JOIN (
        SELECT "storeId", "date", SUM("netSales") AS net
          FROM "OtterHourlySummary"
         WHERE "storeId" IN (${Prisma.join(storeIds)}) AND "date" >= ${since}
         GROUP BY "storeId", "date"
      ) s ON s."storeId" = h."storeId" AND s."date" = h."date"
     WHERE h."storeId" IN (${Prisma.join(storeIds)}) AND h."date" >= ${since}
     GROUP BY h."storeId", h."date", s.net
     ORDER BY h."date" ASC
  `)

  const byStore = new Map<string, SplhInput[]>()
  for (const r of rows) {
    const list = byStore.get(r.storeId) ?? []
    list.push({
      date: r.date.toISOString().slice(0, 10),
      netSales: Number(r.net ?? 0),
      laborHours: Number(r.hours ?? 0),
      laborCost: Number(r.cost ?? 0),
    })
    byStore.set(r.storeId, list)
  }

  const out: SplhSeries[] = []
  for (const store of stores) {
    const all = byStore.get(store.id)
    if (!all || all.length === 0) continue

    const daily = all

    let points: SplhPoint[]
    if (granularity === "week") {
      // Weeks roll against the 8 weeks before each one, so the line tracks a
      // store that improves instead of pinning it to a stale block.
      const weeks = rollToWeeks(daily, { dropPartial: true })
      points = buildSplhSeriesRolling(weeks, WEEK_WINDOW, ROLLING_WEEKS, {
        weekly: true,
      })
    } else {
      // Days compare against the median for the SAME weekday — a flat target
      // would just redraw the volume curve and condemn every Tuesday.
      const shown = daily.slice(-DAY_WINDOW)
      const firstShown = shown[0]?.date ?? ""
      const history = daily.filter((r) => r.date < firstShown)
      points = buildSplhSeries(shown, history.length > 0 ? history : daily)
    }

    out.push({
      storeId: store.id,
      storeName: store.name,
      points,
      blendedRate: blendedHourlyRate(daily),
      daysCovered: daily.filter((r) => r.laborHours > 0 && r.netSales > 0).length,
      daysMissingHours: daily.filter((r) => r.laborHours <= 0 && r.netSales > 0).length,
    })
  }

  return out
}
