// Shared "external signals" query helper for the External-Signals Strip.
//
// Joins three Postgres tables in one round-trip per (storeIds, dateRange):
//   storeWeatherSignal   (Open-Meteo, hourly per store)
//   storeEventSignal     (PredictHQ aggregates, daily per store)
//   storeEventDetailSignal (PredictHQ named events, per event per store)
//
// Worst-of-portfolio aggregation when storeIds.length > 1:
//   weather → max-severity WMO code across stores (per day)
//   events  → top-localRank event across stores (per day)
//   labor   → understaffed/overstaffed counts derived from the staffing forecast
//
// Labor pressure intentionally leans on the existing labor-staffing forecast
// rather than re-deriving from harri tables. The forecast is request-cached
// by the runtime so the cost is paid once even when both LaborStaffingCard
// and the Strip render in the same response.

import { prisma } from "@/lib/prisma"
import { maxSeverityCode } from "@/lib/weather-labels"
import { getLaborStaffingForecast } from "@/app/actions/forecasts/labor-staffing-actions"

export interface WeatherDay {
  date: string // YYYY-MM-DD
  topCode: number | null
}

export interface EventDay {
  date: string
  topEventTitle: string | null
  topEventAttendance: number | null
  topEventLocalRank: number | null
  topEventCategory: string | null
  totalImpact: number | null
  categoryCounts: {
    sports: number
    concerts: number
    festivals: number
    performingArts: number
    community: number
    conferences: number
    expos: number
  }
}

export type LaborPressure = "balanced" | "thin" | "heavy" | "missing"

export interface LaborDay {
  date: string
  pressure: LaborPressure
  understaffedStores: number // count of stores in this bucket on this day
}

export interface ExternalSignals {
  startDate: Date
  endDate: Date // exclusive
  weather: WeatherDay[]
  events: EventDay[]
  labor: LaborDay[]
  // Combined-severity score per day for the "watch this day" proofmark.
  // Storm = 3, high-impact event (localRank ≥ 80) = 2, thin labor = 1.
  watchScores: Map<string, number>
  hasAnyData: boolean
}

const HORIZON_DAYS_DEFAULT = 7

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function startOfTodayUtc(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

function eachDay(start: Date, days: number): Date[] {
  const out: Date[] = []
  for (let i = 0; i < days; i++) {
    out.push(new Date(start.getTime() + i * 86_400_000))
  }
  return out
}

export async function getExternalSignals(
  storeIds: string[],
  options?: { horizonDays?: number; storeId?: string | undefined },
): Promise<ExternalSignals> {
  const horizonDays = options?.horizonDays ?? HORIZON_DAYS_DEFAULT
  const today = startOfTodayUtc()
  const horizonEnd = new Date(today.getTime() + horizonDays * 86_400_000)
  const days = eachDay(today, horizonDays)

  if (storeIds.length === 0) {
    return emptyResult(today, horizonEnd, days)
  }

  const [weatherRows, eventRows, eventDetailRows, laborResult] = await Promise.all([
    prisma.storeWeatherSignal.findMany({
      where: {
        storeId: { in: storeIds },
        date: { gte: today, lt: horizonEnd },
      },
      select: { storeId: true, date: true, weatherCode: true },
    }),
    prisma.storeEventSignal.findMany({
      where: {
        storeId: { in: storeIds },
        date: { gte: today, lt: horizonEnd },
      },
      select: {
        storeId: true,
        date: true,
        hospitalityImpact: true,
        sportsCount: true,
        concertsCount: true,
        festivalsCount: true,
        performingArtsCount: true,
        communityCount: true,
        conferencesCount: true,
        exposCount: true,
      },
    }),
    prisma.storeEventDetailSignal.findMany({
      where: {
        storeId: { in: storeIds },
        date: { gte: today, lt: horizonEnd },
      },
      orderBy: [{ date: "asc" }, { localRank: "desc" }],
      select: {
        storeId: true,
        date: true,
        title: true,
        category: true,
        attendance: true,
        localRank: true,
      },
    }),
    getLaborStaffingForecast({ storeId: options?.storeId }).catch(() => null),
  ])

  // ─── Weather: max-severity WMO code per day across storeIds × hours ───
  const weatherByDay = new Map<string, number[]>()
  for (const row of weatherRows) {
    const key = ymd(row.date as Date)
    if (!weatherByDay.has(key)) weatherByDay.set(key, [])
    if (row.weatherCode != null) weatherByDay.get(key)!.push(row.weatherCode)
  }
  const weather: WeatherDay[] = days.map((d) => ({
    date: ymd(d),
    topCode: maxSeverityCode(weatherByDay.get(ymd(d)) ?? []),
  }))

  // ─── Events: top by localRank (across stores), category-counts summed ───
  type DetailRow = (typeof eventDetailRows)[number]
  const topEventByDay = new Map<string, DetailRow>()
  for (const row of eventDetailRows) {
    const key = ymd(row.date as Date)
    const existing = topEventByDay.get(key)
    const rank = row.localRank ?? -1
    const existingRank = existing?.localRank ?? -1
    if (!existing || rank > existingRank) {
      topEventByDay.set(key, row)
    }
  }
  const aggByDay = new Map<
    string,
    {
      impact: number | null
      sports: number
      concerts: number
      festivals: number
      performingArts: number
      community: number
      conferences: number
      expos: number
    }
  >()
  for (const row of eventRows) {
    const key = ymd(row.date as Date)
    const cur = aggByDay.get(key) ?? {
      impact: null as number | null,
      sports: 0,
      concerts: 0,
      festivals: 0,
      performingArts: 0,
      community: 0,
      conferences: 0,
      expos: 0,
    }
    if (row.hospitalityImpact != null) {
      cur.impact = (cur.impact ?? 0) + row.hospitalityImpact
    }
    cur.sports += row.sportsCount
    cur.concerts += row.concertsCount
    cur.festivals += row.festivalsCount
    cur.performingArts += row.performingArtsCount
    cur.community += row.communityCount
    cur.conferences += row.conferencesCount
    cur.expos += row.exposCount
    aggByDay.set(key, cur)
  }
  const events: EventDay[] = days.map((d) => {
    const key = ymd(d)
    const top = topEventByDay.get(key)
    const agg = aggByDay.get(key)
    return {
      date: key,
      topEventTitle: top?.title ?? null,
      topEventAttendance: top?.attendance ?? null,
      topEventLocalRank: top?.localRank ?? null,
      topEventCategory: top?.category ?? null,
      totalImpact: agg?.impact ?? null,
      categoryCounts: {
        sports: agg?.sports ?? 0,
        concerts: agg?.concerts ?? 0,
        festivals: agg?.festivals ?? 0,
        performingArts: agg?.performingArts ?? 0,
        community: agg?.community ?? 0,
        conferences: agg?.conferences ?? 0,
        expos: agg?.expos ?? 0,
      },
    }
  })

  // ─── Labor: derive pressure from the staffing forecast ───
  const laborPressureByDay = new Map<string, LaborPressure>()
  if (laborResult?.ok) {
    for (const day of laborResult.data.days) {
      const key = ymd(new Date(day.date))
      const risk = day.staffingRisk
      laborPressureByDay.set(
        key,
        risk === "understaffed"
          ? "thin"
          : risk === "overstaffed"
            ? "heavy"
            : risk === "missing_schedule"
              ? "missing"
              : "balanced",
      )
    }
  }
  const labor: LaborDay[] = days.map((d) => {
    const key = ymd(d)
    const pressure = laborPressureByDay.get(key) ?? "missing"
    // V1 single-store equivalence — multi-store understaffed-count is a v2 concern.
    const understaffedStores = pressure === "thin" ? storeIds.length : 0
    return { date: key, pressure, understaffedStores }
  })

  // ─── Watch-score per day (storm 3 + high-impact event 2 + thin labor 1) ───
  const watchScores = new Map<string, number>()
  for (const d of days) {
    const key = ymd(d)
    let score = 0
    const w = weather.find((x) => x.date === key)
    const e = events.find((x) => x.date === key)
    const l = labor.find((x) => x.date === key)
    if (w?.topCode != null) {
      const code = w.topCode
      if (code === 95 || code === 96 || code === 99 || code === 56 || code === 57 || code === 66 || code === 67) {
        score += 3
      }
    }
    if (e?.topEventLocalRank != null && e.topEventLocalRank >= 80) score += 2
    if (l?.pressure === "thin" || l?.pressure === "missing") score += 1
    watchScores.set(key, score)
  }

  const hasAnyData =
    weatherRows.length > 0 || eventRows.length > 0 || eventDetailRows.length > 0

  return {
    startDate: today,
    endDate: horizonEnd,
    weather,
    events,
    labor,
    watchScores,
    hasAnyData,
  }
}

function emptyResult(start: Date, end: Date, days: Date[]): ExternalSignals {
  const empty = (date: Date) => ymd(date)
  return {
    startDate: start,
    endDate: end,
    weather: days.map((d) => ({ date: empty(d), topCode: null })),
    events: days.map((d) => ({
      date: empty(d),
      topEventTitle: null,
      topEventAttendance: null,
      topEventLocalRank: null,
      topEventCategory: null,
      totalImpact: null,
      categoryCounts: {
        sports: 0,
        concerts: 0,
        festivals: 0,
        performingArts: 0,
        community: 0,
        conferences: 0,
        expos: 0,
      },
    })),
    labor: days.map((d) => ({ date: empty(d), pressure: "missing" as const, understaffedStores: 0 })),
    watchScores: new Map(),
    hasAnyData: false,
  }
}
