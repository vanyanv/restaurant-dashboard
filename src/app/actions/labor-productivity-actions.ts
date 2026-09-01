"use server"

import { getServerSession } from "next-auth"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getAccountStoreRows } from "@/lib/account-stores"
import { Prisma } from "@/generated/prisma/client"
import { bucketShiftHours } from "@/lib/harri-schedule"
import {
  buildScorecard,
  scorecardTargets,
  scorecardTotals,
  type ScorecardInput,
  type ScorecardRow,
  type ScorecardTotals,
} from "@/lib/labor-scorecard"
import {
  computeClockDrift,
  rankLeaks,
  worstDay,
  worstHourBlock,
  type ClockDrift,
  type Leak,
} from "@/lib/labor-leaks"

/** Trailing days used to set the weekday SPLH targets the week is scored against. */
const TARGET_HISTORY_DAYS = 56

export interface StaffingHour {
  hour: number
  staffedHours: number
  netSales: number
  orderCount: number
  splh: number | null
}

export interface PositionMixRow {
  positionCode: string
  positionName: string
  categoryName: string | null
  hours: number
  cost: number
  shareOfHours: number
}

export interface LaborProductivity {
  scorecard: ScorecardRow[]
  totals: ScorecardTotals
  staffing: StaffingHour[]
  positions: PositionMixRow[]
  blendedRate: number | null
  /** True once HarriShift has any rows for the window — the curve needs them. */
  hasScheduleData: boolean
  drift: ClockDrift
  /** Ranked by dollars. Empty when the week has nothing to answer for. */
  leaks: Leak[]
}

/**
 * Everything the labor page needs beyond raw cost: the day scorecard, the
 * hour-of-day staffing curve, and the position mix.
 *
 * `storeId` omitted aggregates every store the account owns.
 */
export async function getLaborProductivity(
  weekStart: Date,
  weekEnd: Date,
  storeId?: string
): Promise<LaborProductivity | null> {
  const session = await getServerSession(authOptions)
  if (!session || !hasOwnerAccess(session.user.role)) return null

  // The one store query a request makes — `@/lib/account-stores` — with this
  // caller's own `isActive` filter applied over it.
  const stores = (await getAccountStoreRows(session.user.accountId)).filter(
    (s) => s.isActive && (storeId ? s.id === storeId : true),
  )
  if (stores.length === 0) return null
  const storeIds = stores.map((s) => s.id)

  const historyStart = new Date(weekStart)
  historyStart.setUTCDate(historyStart.getUTCDate() - TARGET_HISTORY_DAYS)

  type DayRow = {
    date: Date
    net: number | null
    hours: number | null
    cost: number | null
  }

  // Daily hours + cost + sales, from historyStart through the shown week so a
  // single query serves both the targets and the scorecard.
  const [dayRows, shifts, alerts, positions, hourly] = await Promise.all([
    prisma.$queryRaw<DayRow[]>(Prisma.sql`
      SELECT p."date",
             SUM(p."actualSeconds") / 3600.0  AS hours,
             SUM(COALESCE(p."totalLabor", 0)) AS cost,
             s.net                            AS net
        FROM "HarriPositionDaily" p
        LEFT JOIN (
          SELECT "storeId", "date", SUM("netSales") AS net
            FROM "OtterHourlySummary"
           WHERE "storeId" IN (${Prisma.join(storeIds)})
             AND "date" >= ${historyStart} AND "date" <= ${weekEnd}
           GROUP BY "storeId", "date"
        ) s ON s."storeId" = p."storeId" AND s."date" = p."date"
       WHERE p."storeId" IN (${Prisma.join(storeIds)})
         AND p."date" >= ${historyStart} AND p."date" <= ${weekEnd}
       GROUP BY p."date", s.net
       ORDER BY p."date" ASC
    `),
    prisma.harriShift.findMany({
      where: {
        storeId: { in: storeIds },
        date: { gte: weekStart, lte: weekEnd },
        isVirtual: false,
      },
      select: { date: true, startTime: true, endTime: true, minutes: true },
    }),
    prisma.harriTimekeepingAlert.findMany({
      where: { storeId: { in: storeIds }, date: { gte: weekStart, lte: weekEnd } },
      select: { date: true, alertCode: true, timeDiffSec: true, userId: true },
    }),
    prisma.harriPositionDaily.groupBy({
      by: ["positionCode", "positionName", "categoryName"],
      where: { storeId: { in: storeIds }, date: { gte: weekStart, lte: weekEnd } },
      _sum: { actualSeconds: true, totalLabor: true },
    }),
    prisma.otterHourlySummary.findMany({
      where: { storeId: { in: storeIds }, date: { gte: weekStart, lte: weekEnd } },
      select: { hour: true, netSales: true, orderCount: true },
    }),
  ])

  const ymd = (d: Date) => d.toISOString().slice(0, 10)

  const alertMap = new Map<string, number>()
  for (const a of alerts) {
    const k = ymd(a.date)
    alertMap.set(k, (alertMap.get(k) ?? 0) + 1)
  }

  // Resolve the punch-drift contributors to names so the leak names a person
  // rather than a Harri user id.
  const driftUserIds = [...new Set(alerts.map((a) => a.userId))]
  const employees =
    driftUserIds.length > 0
      ? await prisma.harriEmployee.findMany({
          where: { storeId: { in: storeIds }, userId: { in: driftUserIds } },
          select: { userId: true, firstName: true, lastName: true },
        })
      : []
  const nameByUser = new Map(
    employees.map((e) => [e.userId, [e.firstName, e.lastName].filter(Boolean).join(" ")])
  )

  // Scheduled hours per day, from the shift spans.
  const scheduledByDay = new Map<string, number>()
  for (const s of shifts) {
    const key = ymd(s.date)
    scheduledByDay.set(key, (scheduledByDay.get(key) ?? 0) + s.minutes / 60)
  }

  const weekStartIso = ymd(weekStart)
  const weekEndIso = ymd(weekEnd)

  const allDays: ScorecardInput[] = dayRows.map((r) => ({
    date: ymd(r.date),
    netSales: Number(r.net ?? 0),
    actualHours: Number(r.hours ?? 0),
    scheduledHours: scheduledByDay.get(ymd(r.date)) ?? 0,
    laborCost: Number(r.cost ?? 0),
    alertCount: alertMap.get(ymd(r.date)) ?? 0,
  }))

  const history = allDays.filter((d) => d.date < weekStartIso)
  const shown = allDays.filter((d) => d.date >= weekStartIso && d.date <= weekEndIso)

  const targets = scorecardTargets(history.length > 0 ? history : allDays)
  const totalCost = (history.length > 0 ? history : allDays).reduce((a, d) => a + d.laborCost, 0)
  const totalHours = (history.length > 0 ? history : allDays).reduce((a, d) => a + d.actualHours, 0)
  const blendedRate = totalHours > 0 ? totalCost / totalHours : null

  const scorecard = buildScorecard(shown, targets, blendedRate)

  // Hour-of-day curve: scheduled headcount-hours against the sales they covered.
  const buckets = bucketShiftHours(shifts)
  const staffedByHour = new Array(24).fill(0)
  for (const [, arr] of buckets) {
    for (let h = 0; h < 24; h++) staffedByHour[h] += arr[h]
  }
  const salesByHour = new Array(24).fill(0)
  const ordersByHour = new Array(24).fill(0)
  for (const r of hourly) {
    salesByHour[r.hour] += r.netSales
    ordersByHour[r.hour] += r.orderCount
  }

  const staffing: StaffingHour[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    staffedHours: staffedByHour[hour],
    netSales: salesByHour[hour],
    orderCount: ordersByHour[hour],
    splh: staffedByHour[hour] > 0 ? salesByHour[hour] / staffedByHour[hour] : null,
  })).filter((h) => h.staffedHours > 0.01 || h.netSales > 0)

  const positionHours = positions.map((p) => ({
    positionCode: p.positionCode,
    positionName: p.positionName ?? p.positionCode,
    categoryName: p.categoryName,
    hours: (p._sum.actualSeconds ?? 0) / 3600,
    cost: p._sum.totalLabor ?? 0,
  }))
  const positionTotal = positionHours.reduce((a, p) => a + p.hours, 0)

  const drift = computeClockDrift(
    alerts.map((a) => ({
      alertCode: a.alertCode,
      timeDiffSec: a.timeDiffSec,
      userId: a.userId,
      employeeName: nameByUser.get(a.userId) ?? null,
    })),
    blendedRate
  )

  const totals = scorecardTotals(scorecard)

  return {
    scorecard,
    totals,
    drift,
    leaks: rankLeaks({
      drift,
      block: worstHourBlock(staffing, blendedRate),
      day: worstDay(scorecard),
    }),
    staffing,
    positions: positionHours
      .map((p) => ({ ...p, shareOfHours: positionTotal > 0 ? p.hours / positionTotal : 0 }))
      .sort((a, b) => b.hours - a.hours),
    blendedRate,
    hasScheduleData: shifts.length > 0,
  }
}
