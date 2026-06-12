"use server"

import { startOfDayUTC as startOfDay, ymdUTC as ymd } from "@/lib/date-utils"
// Hourly labor optimization. Prefer the nightly BUSY_HOURS ML forecast
// (ForecastHourlyOrders). Fall back to the deterministic daily-revenue ×
// historical hourly-share projection when the hourly ML generation is absent.
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

import { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import { getCachedSession, resolveStoreContext } from "./_shared"

import {
  COVERS_PER_STAFF_HOUR,
  MIN_STAFF,
} from "./labor-staffing-constants"
/** Trailing window for both avg-ticket and hourly-share computations. */
const HISTORY_DAYS = 28
/** Default forward horizon. */
const DEFAULT_HORIZON_DAYS = 7

type EventSignalRow = {
  date: Date
  hospitalityImpact: number | null
  hospitalitySpend: number | null
  attendance: number | null
  eventCount: number
  sportsCount: number
  concertsCount: number
  festivalsCount: number
  performingArtsCount: number
  communityCount: number
  conferencesCount: number
  exposCount: number
  topEventTitle?: string | null
  topEventCategory?: string | null
  topEventRank?: number | null
  topEventLocalRank?: number | null
  topEventAttendance?: number | null
  topEventDistanceMiles?: number | null
  majorEventCount?: number
  highLocalRankEventCount?: number
}

export interface LaborStaffingHour {
  hour: number
  predictedOrders: number
  p10: number | null
  p90: number | null
  recommendedStaff: number
  source: "ml" | "fallback"
  drivers: ExternalDemandDriver[]
}

export type StaffingRisk = "balanced" | "understaffed" | "overstaffed" | "missing_schedule"

export interface ExternalDemandDriver {
  kind: "weather" | "event"
  label: string
  severity: "low" | "medium" | "high"
}

export interface LaborStaffingDay {
  date: Date
  weekday: number
  predictedRevenue: number | null
  predictedOrders: number
  totalLaborHours: number
  demandSource: "ml" | "fallback"
  scheduledLaborCost: number | null
  expectedLaborCostPerOrder: number | null
  staffingRisk: StaffingRisk | null
  drivers: ExternalDemandDriver[]
  hours: LaborStaffingHour[]
}

export interface LaborStaffingData {
  /** Null when aggregating across all stores. */
  storeId: string | null
  storeName: string
  generatedAt: Date | null
  meanAvgTicket: number
  coversPerStaffHour: number
  minStaff: number
  forecastSource: "ml" | "fallback" | "mixed"
  days: LaborStaffingDay[]
  totalForecastLaborHours: number
  /** Last 7 days of actual vs forecast labor cost from Harri (LiveWire).
   *  Empty array when no Harri brand mapping is configured for the store(s). */
  harriActuals: HarriActualRow[]
}

export interface HarriActualRow {
  date: string // YYYY-MM-DD
  actualUsd: number | null
  forecastUsd: number | null
}

export type GetLaborStaffingResult =
  | { ok: true; data: LaborStaffingData }
  | { ok: false; error: "store_not_in_account" }
  | { ok: false; error: "insufficient_history" }

export async function getLaborStaffingForecast(input: {
  storeId?: string
  horizonDays?: number
  asOf?: Date
}): Promise<GetLaborStaffingResult | null> {
  const session = await getCachedSession()
  const user = session?.user ?? null
  if (!user) return null

  const resolved = await resolveStoreContext(input.storeId, user.accountId)
  if (!resolved.ok) return resolved
  const { storeIds, storeName, storeIdOut } = resolved.ctx

  const horizonDays = input.horizonDays ?? DEFAULT_HORIZON_DAYS
  const asOf = input.asOf ?? new Date()
  const today = startOfDay(asOf)
  const historyStart = new Date(today)
  historyStart.setUTCDate(historyStart.getUTCDate() - HISTORY_DAYS)
  const horizonEnd = new Date(today)
  horizonEnd.setUTCDate(horizonEnd.getUTCDate() + horizonDays)

  const [
    hourlyForecastRows,
    revenueRows,
    hourlyRows,
    dailyRows,
    harriLaborRows,
    weatherRows,
    eventRows,
  ] = await Promise.all([
    prisma.forecastHourlyOrders.findMany({
      where: {
        storeId: { in: storeIds },
        forecastDate: { gte: today, lt: horizonEnd },
      },
      select: {
        storeId: true,
        forecastDate: true,
        hourBucket: true,
        predictedOrders: true,
        p10: true,
        p90: true,
        generatedAt: true,
      },
    }),
    prisma.forecastDailyRevenue.findMany({
      where: {
        storeId: { in: storeIds },
        hourBucket: 0,
        forecastDate: { gte: today, lt: horizonEnd },
      },
      select: {
        storeId: true,
        forecastDate: true,
        predictedRevenue: true,
        generatedAt: true,
      },
    }),
    prisma.otterHourlySummary.findMany({
      where: {
        storeId: { in: storeIds },
        date: { gte: historyStart, lt: today },
      },
      select: { date: true, hour: true, orderCount: true },
    }),
    prisma.otterDailySummary.groupBy({
      by: ["date"],
      where: {
        storeId: { in: storeIds },
        date: { gte: historyStart, lt: today },
      },
      _sum: {
        fpNetSales: true,
        tpNetSales: true,
        fpOrderCount: true,
        tpOrderCount: true,
      },
    }),
    prisma.harriDailyLabor.findMany({
      where: {
        storeId: { in: storeIds },
        date: { gte: historyStart, lt: horizonEnd },
      },
      orderBy: { date: "asc" },
      select: { date: true, actualCost: true, forecastCost: true },
    }),
    prisma.storeWeatherSignal.findMany({
      where: {
        storeId: { in: storeIds },
        date: { gte: today, lt: horizonEnd },
      },
      select: {
        date: true,
        hour: true,
        precipitationMm: true,
        precipitationProbabilityPct: true,
        temperatureC: true,
        apparentTemperatureC: true,
        windSpeedKph: true,
        weatherCode: true,
      },
    }),
    loadEventSignalRows(storeIds, today, horizonEnd),
  ])

  if (hourlyForecastRows.length === 0 && (hourlyRows.length === 0 || dailyRows.length === 0)) {
    return { ok: false, error: "insufficient_history" }
  }

  type HourlyForecastRow = (typeof hourlyForecastRows)[number]
  const latestHourlyPerStoreDateHour = new Map<string, HourlyForecastRow>()
  let latestHourlyGen: Date | null = null
  for (const r of hourlyForecastRows) {
    const key = `${r.storeId}|${ymd(r.forecastDate as Date)}|${r.hourBucket}`
    const existing = latestHourlyPerStoreDateHour.get(key)
    if (!existing || r.generatedAt > existing.generatedAt) {
      latestHourlyPerStoreDateHour.set(key, r)
    }
    if (!latestHourlyGen || r.generatedAt > latestHourlyGen) latestHourlyGen = r.generatedAt
  }
  type AggregatedHourlyForecast = {
    predictedOrders: number
    p10: number | null
    p90: number | null
    generatedAt: Date
  }
  const latestHourly = new Map<string, AggregatedHourlyForecast>()
  for (const r of latestHourlyPerStoreDateHour.values()) {
    const key = `${ymd(r.forecastDate as Date)}|${r.hourBucket}`
    const cur = latestHourly.get(key)
    latestHourly.set(key, {
      predictedOrders: (cur?.predictedOrders ?? 0) + (r.predictedOrders ?? 0),
      p10: sumNullable(cur?.p10 ?? null, r.p10),
      p90: sumNullable(cur?.p90 ?? null, r.p90),
      generatedAt:
        cur && cur.generatedAt > r.generatedAt ? cur.generatedAt : r.generatedAt,
    })
  }

  // Latest generation per (storeId, forecast date), then sum predictedRevenue
  // across stores per date so aggregate-mode staffing is portfolio-scaled.
  type RevRow = (typeof revenueRows)[number]
  const latestPerStoreDate = new Map<string, RevRow>()
  let latestGen: Date | null = null
  for (const r of revenueRows) {
    const key = `${r.storeId}|${ymd(r.forecastDate as Date)}`
    const existing = latestPerStoreDate.get(key)
    if (!existing || r.generatedAt > existing.generatedAt) {
      latestPerStoreDate.set(key, r)
    }
    if (!latestGen || r.generatedAt > latestGen) latestGen = r.generatedAt
  }
  const latestRevenue = new Map<string, { predictedRevenue: number }>()
  for (const r of latestPerStoreDate.values()) {
    const k = ymd(r.forecastDate as Date)
    const cur = latestRevenue.get(k)
    if (!cur) latestRevenue.set(k, { predictedRevenue: r.predictedRevenue ?? 0 })
    else cur.predictedRevenue += r.predictedRevenue ?? 0
  }

  // Mean avg ticket over the history window
  let totalRevenue = 0
  let totalOrders = 0
  for (const d of dailyRows) {
    totalRevenue += (d._sum.fpNetSales ?? 0) + (d._sum.tpNetSales ?? 0)
    totalOrders += (d._sum.fpOrderCount ?? 0) + (d._sum.tpOrderCount ?? 0)
  }
  const meanAvgTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0
  const fallbackAvailable = meanAvgTicket > 0 && hourlyRows.length > 0 && dailyRows.length > 0
  if (!latestHourlyGen && !fallbackAvailable) {
    return { ok: false, error: "insufficient_history" }
  }

  // Build (weekday, hour) → mean orderCount, then normalize to share
  const { meanByKey, dayTotalByWeekday } = buildHistoricalHourlyShape(hourlyRows)
  const harriByDate = aggregateHarriLabor(harriLaborRows)
  const baselineLaborCostPerOrder = computeHistoricalLaborCostPerOrder(dailyRows, harriByDate)
  const externalDrivers = buildExternalDrivers(weatherRows, eventRows)

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
    const mlHoursForDay = Array.from({ length: 24 }, (_, h) => latestHourly.get(`${revKey}|${h}`))
    const hasMlDay = mlHoursForDay.some(Boolean)
    const fallbackPredictedOrders =
      predictedRevenue && meanAvgTicket > 0 ? predictedRevenue / meanAvgTicket : 0

    const dayTotal = dayTotalByWeekday.get(weekday) ?? 0
    const hours: LaborStaffingHour[] = []
    let totalLaborHours = 0
    let predictedOrders = 0
    for (let h = 0; h < 24; h++) {
      const meanForBucket = meanByKey.get(`${weekday}|${h}`) ?? 0
      const share = dayTotal > 0 ? meanForBucket / dayTotal : 0
      const mlHour = mlHoursForDay[h] ?? null
      const predictedHourlyOrders = mlHour
        ? mlHour.predictedOrders
        : fallbackPredictedOrders * share
      predictedOrders += predictedHourlyOrders
      // Only staff hours that historically had any orders.
      const recommendedStaff =
        predictedHourlyOrders > 0 || meanForBucket > 0
          ? Math.max(MIN_STAFF, Math.ceil(predictedHourlyOrders / COVERS_PER_STAFF_HOUR))
          : 0
      hours.push({
        hour: h,
        predictedOrders: predictedHourlyOrders,
        p10: mlHour?.p10 ?? null,
        p90: mlHour?.p90 ?? null,
        recommendedStaff,
        source: mlHour ? "ml" : "fallback",
        drivers: externalDrivers.byDateHour.get(`${revKey}|${h}`) ?? [],
      })
      totalLaborHours += recommendedStaff
    }
    const harri = harriByDate.get(revKey) ?? { actualUsd: null, forecastUsd: null }
    const expectedLaborCostPerOrder =
      harri.forecastUsd != null && predictedOrders > 0
        ? harri.forecastUsd / predictedOrders
        : null
    totalLaborHoursAcrossDays += totalLaborHours
    days.push({
      date: dayDate,
      weekday,
      predictedRevenue,
      predictedOrders,
      totalLaborHours,
      demandSource: hasMlDay ? "ml" : "fallback",
      scheduledLaborCost: harri.forecastUsd,
      expectedLaborCostPerOrder,
      staffingRisk: classifyStaffingRisk(
        expectedLaborCostPerOrder,
        baselineLaborCostPerOrder,
        predictedOrders,
        harri.forecastUsd,
      ),
      drivers: externalDrivers.byDate.get(revKey) ?? [],
      hours,
    })
  }

  // Last 7 days of Harri actual vs forecast labor cost (USD). Used by the
  // labor-staffing-card to overlay actuals on the staffing forecast.
  const harriEnd = new Date(today)
  harriEnd.setUTCDate(harriEnd.getUTCDate() - 1)
  const harriStart = new Date(harriEnd)
  harriStart.setUTCDate(harriStart.getUTCDate() - 6)
  const harriActuals: HarriActualRow[] = []
  for (let cursor = new Date(harriStart); cursor <= harriEnd; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const key = cursor.toISOString().slice(0, 10)
    const v = harriByDate.get(key) ?? { actualUsd: null, forecastUsd: null }
    harriActuals.push({ date: key, actualUsd: v.actualUsd, forecastUsd: v.forecastUsd })
  }

  return {
    ok: true,
    data: {
      storeId: storeIdOut,
      storeName,
      generatedAt: latestHourlyGen ?? latestGen,
      meanAvgTicket,
      coversPerStaffHour: COVERS_PER_STAFF_HOUR,
      minStaff: MIN_STAFF,
      forecastSource: summarizeForecastSource(days),
      days,
      totalForecastLaborHours: totalLaborHoursAcrossDays,
      harriActuals,
    },
  }
}

async function loadEventSignalRows(
  storeIds: string[],
  startDate: Date,
  endDate: Date,
): Promise<EventSignalRow[]> {
  if (storeIds.length === 0) return []
  try {
    return await prisma.$queryRaw<EventSignalRow[]>(Prisma.sql`
      SELECT
        date,
        "hospitalityImpact",
        "hospitalitySpend",
        attendance,
        "eventCount",
        "sportsCount",
        "concertsCount",
        "festivalsCount",
        "performingArtsCount",
        "communityCount",
        "conferencesCount",
        "exposCount",
        "topEventTitle",
        "topEventCategory",
        "topEventRank",
        "topEventLocalRank",
        "topEventAttendance",
        "topEventDistanceMiles",
        "majorEventCount",
        "highLocalRankEventCount"
      FROM "StoreEventSignal"
      WHERE "storeId" IN (${Prisma.join(storeIds)})
        AND date >= ${startDate}
        AND date < ${endDate}
    `)
  } catch (error) {
    if (!isUndefinedColumnError(error)) throw error
    return prisma.$queryRaw<EventSignalRow[]>(Prisma.sql`
      SELECT
        date,
        "hospitalityImpact",
        "hospitalitySpend",
        attendance,
        "eventCount",
        "sportsCount",
        "concertsCount",
        "festivalsCount",
        "performingArtsCount",
        "communityCount",
        "conferencesCount",
        "exposCount",
        NULL::text AS "topEventTitle",
        NULL::text AS "topEventCategory",
        NULL::double precision AS "topEventRank",
        NULL::double precision AS "topEventLocalRank",
        NULL::double precision AS "topEventAttendance",
        NULL::double precision AS "topEventDistanceMiles",
        0::integer AS "majorEventCount",
        0::integer AS "highLocalRankEventCount"
      FROM "StoreEventSignal"
      WHERE "storeId" IN (${Prisma.join(storeIds)})
        AND date >= ${startDate}
        AND date < ${endDate}
    `)
  }
}

function isUndefinedColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const candidate = error as { code?: string; message?: string }
  return candidate.code === "42703" || candidate.message?.includes("does not exist") === true
}

function sumNullable(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null
  return (a ?? 0) + (b ?? 0)
}

function buildHistoricalHourlyShape(
  hourlyRows: { date: Date; hour: number; orderCount: number }[],
): {
  meanByKey: Map<string, number>
  dayTotalByWeekday: Map<number, number>
} {
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
  const dayTotalByWeekday = new Map<number, number>()
  for (const [k, mean] of meanByKey) {
    const wd = Number(k.split("|")[0])
    dayTotalByWeekday.set(wd, (dayTotalByWeekday.get(wd) ?? 0) + mean)
  }
  return { meanByKey, dayTotalByWeekday }
}

function aggregateHarriLabor(
  rows: { date: Date; actualCost: number | null; forecastCost: number | null }[],
): Map<string, { actualUsd: number | null; forecastUsd: number | null }> {
  const byDate = new Map<string, { actualUsd: number | null; forecastUsd: number | null }>()
  for (const r of rows) {
    const key = ymd(r.date)
    const cur = byDate.get(key) ?? { actualUsd: null, forecastUsd: null }
    if (r.actualCost != null) cur.actualUsd = (cur.actualUsd ?? 0) + r.actualCost
    if (r.forecastCost != null) cur.forecastUsd = (cur.forecastUsd ?? 0) + r.forecastCost
    byDate.set(key, cur)
  }
  return byDate
}

function computeHistoricalLaborCostPerOrder(
  dailyRows: {
    date: Date
    _sum: {
      fpOrderCount: number | null
      tpOrderCount: number | null
    }
  }[],
  harriByDate: Map<string, { actualUsd: number | null; forecastUsd: number | null }>,
): number | null {
  let laborCost = 0
  let orderCount = 0
  for (const d of dailyRows) {
    const key = ymd(d.date)
    const harri = harriByDate.get(key)
    if (harri?.actualUsd == null) continue
    const orders = (d._sum.fpOrderCount ?? 0) + (d._sum.tpOrderCount ?? 0)
    if (orders <= 0) continue
    laborCost += harri.actualUsd
    orderCount += orders
  }
  return orderCount > 0 ? laborCost / orderCount : null
}

function classifyStaffingRisk(
  expectedLaborCostPerOrder: number | null,
  baselineLaborCostPerOrder: number | null,
  predictedOrders: number,
  scheduledLaborCost: number | null,
): StaffingRisk | null {
  if (predictedOrders <= 0) return null
  if (scheduledLaborCost == null) return "missing_schedule"
  if (expectedLaborCostPerOrder == null || baselineLaborCostPerOrder == null) return null
  if (expectedLaborCostPerOrder < baselineLaborCostPerOrder * 0.75) return "understaffed"
  if (expectedLaborCostPerOrder > baselineLaborCostPerOrder * 1.25) return "overstaffed"
  return "balanced"
}

function summarizeForecastSource(days: LaborStaffingDay[]): "ml" | "fallback" | "mixed" {
  const hasMl = days.some((d) => d.demandSource === "ml")
  const hasFallback = days.some((d) => d.demandSource === "fallback")
  if (hasMl && hasFallback) return "mixed"
  return hasMl ? "ml" : "fallback"
}

function buildExternalDrivers(
  weatherRows: {
    date: Date
    hour: number
    precipitationMm: number | null
    precipitationProbabilityPct: number | null
    temperatureC: number | null
    apparentTemperatureC: number | null
    windSpeedKph: number | null
    weatherCode: number | null
  }[],
  eventRows: {
    date: Date
    hospitalityImpact: number | null
    hospitalitySpend: number | null
    attendance: number | null
    eventCount: number
    sportsCount: number
    concertsCount: number
    festivalsCount: number
    performingArtsCount: number
    communityCount: number
    conferencesCount: number
    exposCount: number
    topEventTitle?: string | null
    topEventCategory?: string | null
    topEventRank?: number | null
    topEventLocalRank?: number | null
    topEventAttendance?: number | null
    topEventDistanceMiles?: number | null
    majorEventCount?: number
    highLocalRankEventCount?: number
  }[],
): {
  byDate: Map<string, ExternalDemandDriver[]>
  byDateHour: Map<string, ExternalDemandDriver[]>
} {
  const byDate = new Map<string, ExternalDemandDriver[]>()
  const byDateHour = new Map<string, ExternalDemandDriver[]>()

  for (const row of weatherRows) {
    const dayKey = ymd(row.date)
    const hourKey = `${dayKey}|${row.hour}`
    const hourDrivers: ExternalDemandDriver[] = []
    const precip = row.precipitationMm ?? 0
    const precipProb = row.precipitationProbabilityPct ?? 0
    const tempC = row.apparentTemperatureC ?? row.temperatureC ?? null
    if (precip >= 2 || precipProb >= 60) {
      hourDrivers.push({
        kind: "weather",
        label: precip >= 6 || precipProb >= 80 ? "heavy rain" : "rain demand",
        severity: precip >= 6 || precipProb >= 80 ? "high" : "medium",
      })
    }
    if (tempC != null && tempC >= 31) {
      hourDrivers.push({
        kind: "weather",
        label: "heat pressure",
        severity: tempC >= 35 ? "high" : "medium",
      })
    }
    if ([95, 96, 99].includes(row.weatherCode ?? -1)) {
      hourDrivers.push({ kind: "weather", label: "storm risk", severity: "high" })
    }
    if (hourDrivers.length > 0) {
      byDateHour.set(hourKey, dedupeDrivers([...(byDateHour.get(hourKey) ?? []), ...hourDrivers]))
      byDate.set(dayKey, dedupeDrivers([...(byDate.get(dayKey) ?? []), ...hourDrivers]))
    }
  }

  for (const row of eventRows) {
    const dayKey = ymd(row.date)
    const drivers: ExternalDemandDriver[] = []
    const categoryLabel = strongestEventCategory(row)
    const impact = row.hospitalityImpact ?? 0
    const spend = row.hospitalitySpend ?? 0
    const attendance = row.attendance ?? 0
    const topAttendance = row.topEventAttendance ?? 0
    const topLocalRank = row.topEventLocalRank ?? 0
    const topRank = row.topEventRank ?? 0
    if (impact > 0 || spend > 0 || attendance > 0 || row.eventCount > 0 || topLocalRank > 0 || topRank > 0) {
      drivers.push({
        kind: "event",
        label: row.topEventTitle
          ? `${row.topEventTitle} nearby`
          : categoryLabel
          ? `${categoryLabel} nearby`
          : row.eventCount > 1
            ? `${row.eventCount} nearby events`
            : "nearby event",
        severity:
          topLocalRank >= 80 || topRank >= 80 || topAttendance >= 10000 || impact >= 3 || spend >= 5000 || attendance >= 5000
            ? "high"
            : topLocalRank >= 60 || topRank >= 60 || topAttendance >= 1000 || impact >= 1 || spend >= 1000 || attendance >= 1000
              ? "medium"
              : "low",
      })
    }
    if (drivers.length > 0) {
      byDate.set(dayKey, dedupeDrivers([...(byDate.get(dayKey) ?? []), ...drivers]))
    }
  }

  return { byDate, byDateHour }
}

function strongestEventCategory(row: {
  sportsCount: number
  concertsCount: number
  festivalsCount: number
  performingArtsCount: number
  communityCount: number
  conferencesCount: number
  exposCount: number
}): string | null {
  const categories = [
    ["sports", row.sportsCount],
    ["concert", row.concertsCount],
    ["festival", row.festivalsCount],
    ["performing arts", row.performingArtsCount],
    ["community", row.communityCount],
    ["conference", row.conferencesCount],
    ["expo", row.exposCount],
  ] as const
  const top = [...categories].sort((a, b) => b[1] - a[1])[0]
  return top && top[1] > 0 ? top[0] : null
}

function dedupeDrivers(drivers: ExternalDemandDriver[]): ExternalDemandDriver[] {
  const byKey = new Map<string, ExternalDemandDriver>()
  const score = { low: 1, medium: 2, high: 3 }
  for (const driver of drivers) {
    const existing = byKey.get(`${driver.kind}|${driver.label}`)
    if (!existing || score[driver.severity] > score[existing.severity]) {
      byKey.set(`${driver.kind}|${driver.label}`, driver)
    }
  }
  return [...byKey.values()].slice(0, 4)
}
