"use server"

import { ymdUTC as ymd } from "@/lib/date-utils"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getCachedSession, resolveStoreContext } from "@/app/actions/forecasts/_shared"
import { getRevenueForecast } from "@/app/actions/forecasts/revenue-forecast-actions"
import { getOpenAnomalies } from "@/app/actions/forecasts/anomaly-actions"
import { getLaborStaffingForecast } from "@/app/actions/forecasts/labor-staffing-actions"
import { getFoodCostForecast } from "@/app/actions/forecasts/food-cost-forecast-actions"
import { getOpportunities } from "@/app/actions/growth/opportunities-actions"
import { buildBriefing, type BriefingLine } from "@/app/dashboard/forecasts/lib/build-briefing"
import { bucketByMean, pctVsTrailing, trailingMean, type VolumeBucket } from "@/app/dashboard/decisions/lib/bucket-volume"
import {
  confidenceFromForecast,
  type DotCount,
} from "@/app/dashboard/decisions/lib/confidence"
import {
  stripJargon,
  translateConfidence,
  translateOpportunityType,
  weatherPhrase,
  eventPhrase,
} from "@/app/dashboard/decisions/lib/translate"
import type { OpportunityType, OpportunityConfidence } from "@/types/growth"

export interface DecisionDay {
  date: string // YYYY-MM-DD
  weekdayShort: string // MON, TUE
  monthDayShort: string // MAY 18
  bucket: VolumeBucket
  pctVsTrailing: number | null
  staffDelta: number | null
  hasAnomaly: boolean
  anomalyHint: string | null
  weatherTone: "clear" | "rain" | "heat" | "cold" | "heavy_rain" | null
  weatherPhrase: string | null
  eventPhrase: string | null
  topEventTitle: string | null
  foodCostNote: string | null
}

export interface DecisionAction {
  id: string
  category: string // "Pricing", "Menu mix", ...
  type: OpportunityType
  title: string
  impactUsdPerWeek: number
  why: string
  doByDate: string // ISO date YYYY-MM-DD
  dots: DotCount
  confidence: OpportunityConfidence
  evidence: { kind: string; ref: string; value: string }[]
}

export interface DecisionsView {
  asOf: string // ISO date
  storeName: string
  storeId: string | null
  isAggregate: boolean
  confidence: DotCount
  days: DecisionDay[]
  actions: DecisionAction[]
  briefing: BriefingLine[]
}

export type GetDecisionsViewResult =
  | { ok: true; data: DecisionsView }
  | { ok: false; error: "no_session" | "store_not_in_account" | "no_stores" }

const WEEKDAY = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
const MONTH = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]

function weekdayShort(d: Date): string {
  return WEEKDAY[d.getUTCDay()]!
}
function monthDayShort(d: Date): string {
  return `${MONTH[d.getUTCMonth()]} ${d.getUTCDate().toString().padStart(2, "0")}`
}

const CONFIDENCE_WEIGHT: Record<OpportunityConfidence, number> = {
  high: 1,
  medium: 0.7,
  low: 0.4,
}

export async function getDecisionsView(input: {
  storeId?: string
} = {}): Promise<GetDecisionsViewResult> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return { ok: false, error: "no_session" }

  const cachedSession = await getCachedSession()
  const accountId = cachedSession?.user?.accountId
  if (!accountId) return { ok: false, error: "no_session" }

  const resolved = await resolveStoreContext(input.storeId, accountId)
  if (!resolved.ok) return { ok: false, error: "store_not_in_account" }
  const { storeIds, storeName, storeIdOut } = resolved.ctx
  if (storeIds.length === 0) return { ok: false, error: "no_stores" }

  const isAggregate = storeIdOut == null
  const today = new Date()
  const todayKey = ymd(today)

  const [
    revenueResult,
    anomaliesResult,
    laborResultRaw,
    foodCostResultRaw,
    opportunitiesResult,
    weatherRows,
    eventRows,
  ] = await Promise.all([
    getRevenueForecast({ storeId: input.storeId, horizonDays: 14 }),
    getOpenAnomalies({ storeId: input.storeId, limit: 50 }),
    getLaborStaffingForecast({ storeId: input.storeId, horizonDays: 7 }).catch(
      () => null,
    ),
    getFoodCostForecast({ storeId: input.storeId }).catch(() => null),
    getOpportunities({ storeId: input.storeId }).catch(() => null),
    prisma.storeWeatherSignal.findMany({
      where: {
        storeId: { in: storeIds },
        date: { gte: today, lte: addDays(today, 7) },
      },
      select: {
        date: true,
        temperatureC: true,
        precipitationMm: true,
      },
    }),
    prisma.storeEventSignal.findMany({
      where: {
        storeId: { in: storeIds },
        date: { gte: today, lte: addDays(today, 7) },
      },
      select: {
        date: true,
        topEventTitle: true,
        majorEventCount: true,
      },
    }),
  ])

  const revenueData = revenueResult && revenueResult.ok ? revenueResult.data : null
  const laborData =
    laborResultRaw && laborResultRaw.ok ? laborResultRaw.data : null
  const foodCostData =
    foodCostResultRaw && foodCostResultRaw.ok ? foodCostResultRaw.data : null
  const trailing7Mean = revenueData ? trailingMean(revenueData.days) : 0

  const next7 = revenueData?.days.slice(0, 7) ?? []
  const days: DecisionDay[] = next7.map((d) => {
    const key = ymd(d.date)
    const bucket = bucketByMean(d.predictedRevenue, trailing7Mean)
    const pct = pctVsTrailing(d.predictedRevenue, trailing7Mean)
    const weather = aggregateWeather(weatherRows, key)
    const event = aggregateEvents(eventRows, key)
    const anom = findAnomalyForDay(anomaliesResult, key)
    const staffDelta = computeStaffDelta(laborData, key)
    const foodCostNote = isAggregate ? null : foodCostNoteFor(foodCostData, key)

    return {
      date: key,
      weekdayShort: weekdayShort(d.date),
      monthDayShort: monthDayShort(d.date),
      bucket,
      pctVsTrailing: pct,
      staffDelta,
      hasAnomaly: !!anom,
      anomalyHint: anom,
      weatherTone: weather.tone,
      weatherPhrase: weather.phrase,
      eventPhrase: event.phrase,
      topEventTitle: event.title,
      foodCostNote,
    }
  })

  const briefing: BriefingLine[] = revenueData
    ? buildBriefing({
        revenue: revenueData,
        cash: null,
        foodCost: foodCostData,
        targetCogsPct: null,
        anomalies:
          anomaliesResult && anomaliesResult.ok ? anomaliesResult.data : null,
        lostSales: null,
        menuEngineering: null,
        isAggregate,
      })
    : []

  const sanitizedBriefing: BriefingLine[] = briefing.map((line) => ({
    ...line,
    chunks: line.chunks.map((c) =>
      c.kind === "text" ? { ...c, value: stripJargon(c.value) } : c,
    ),
  }))

  const actions: DecisionAction[] = buildActionCards(
    opportunitiesResult,
    todayKey,
  )

  const overallConfidence: DotCount = confidenceFromForecast(
    revenueData,
    next7[0]?.forecastSource ?? null,
  )

  return {
    ok: true,
    data: {
      asOf: todayKey,
      storeName,
      storeId: storeIdOut,
      isAggregate,
      confidence: overallConfidence,
      days,
      actions,
      briefing: sanitizedBriefing,
    },
  }
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setUTCDate(out.getUTCDate() + n)
  return out
}

function aggregateWeather(
  rows: Array<{
    date: Date
    temperatureC: number | null
    precipitationMm: number | null
  }>,
  dayKey: string,
): { tone: DecisionDay["weatherTone"]; phrase: string | null } {
  const dayRows = rows.filter((r) => ymd(r.date) === dayKey)
  if (dayRows.length === 0) return { tone: null, phrase: null }
  const temps = dayRows.map((r) => r.temperatureC).filter((v): v is number => v != null)
  const precips = dayRows.map((r) => r.precipitationMm ?? 0)
  const maxTempC = temps.length > 0 ? Math.max(...temps) : null
  const minTempC = temps.length > 0 ? Math.min(...temps) : null
  const totalPrecipMm = precips.reduce((s, p) => s + p, 0)
  const phrase = weatherPhrase({ maxTempC, minTempC, totalPrecipMm })
  let tone: DecisionDay["weatherTone"] = "clear"
  if (totalPrecipMm >= 5) tone = "heavy_rain"
  else if (totalPrecipMm >= 2) tone = "rain"
  else if (maxTempC != null && maxTempC >= 32) tone = "heat"
  else if (minTempC != null && minTempC <= 2) tone = "cold"
  return { tone, phrase }
}

function aggregateEvents(
  rows: Array<{
    date: Date
    topEventTitle: string | null
    majorEventCount: number
  }>,
  dayKey: string,
): { phrase: string | null; title: string | null } {
  const dayRows = rows.filter((r) => ymd(r.date) === dayKey)
  if (dayRows.length === 0) return { phrase: null, title: null }
  const sorted = [...dayRows].sort(
    (a, b) => (b.majorEventCount ?? 0) - (a.majorEventCount ?? 0),
  )
  const top = sorted[0]
  if (!top) return { phrase: null, title: null }
  return {
    phrase: eventPhrase({
      topEventTitle: top.topEventTitle,
      majorEventCount: top.majorEventCount,
    }),
    title: top.topEventTitle,
  }
}

type AnomalyResult = Awaited<ReturnType<typeof getOpenAnomalies>>

function findAnomalyForDay(
  result: AnomalyResult,
  dayKey: string,
): string | null {
  if (!result || !result.ok) return null
  const events = result.data.events
  const match = events.find((e) => ymd(new Date(e.occurredOn)) === dayKey)
  if (!match) return null
  const label =
    match.target === "REVENUE"
      ? "unusual revenue"
      : match.target === "MENU_ITEM"
        ? "item demand spike"
        : match.target === "INGREDIENT"
          ? "ingredient usage spike"
          : match.target === "LABOR"
            ? "labor variance"
            : "refunds spike"
  return label
}

type LaborData = NonNullable<
  Extract<Awaited<ReturnType<typeof getLaborStaffingForecast>>, { ok: true }>
>["data"]

/** Map per-day staffingRisk → +1 / 0 / -1 / null staff arrow. */
function computeStaffDelta(
  data: LaborData | null,
  dayKey: string,
): number | null {
  if (!data) return null
  const day = data.days.find((d) => ymd(d.date) === dayKey)
  if (!day || day.staffingRisk == null) return null
  if (day.staffingRisk === "understaffed") return 1
  if (day.staffingRisk === "overstaffed") return -1
  if (day.staffingRisk === "balanced") return 0
  return null
}

type FoodCostData = NonNullable<
  Extract<Awaited<ReturnType<typeof getFoodCostForecast>>, { ok: true }>
>["data"]

function foodCostNoteFor(data: FoodCostData | null, _dayKey: string): string | null {
  if (!data) return null
  const blended = data.blendedFoodCostPct
  if (blended == null) return null
  // No target plumbed through to this action; describe direction relative to 30%
  // as a generic anchor. The full target-aware version lives on the dev view.
  const generalTarget = 0.3
  const diff = blended - generalTarget
  if (Math.abs(diff) < 0.005) return "food cost on track"
  return diff > 0
    ? `food cost ${(diff * 100).toFixed(1)}pp over typical`
    : `food cost ${(Math.abs(diff) * 100).toFixed(1)}pp under typical`
}

type OpportunitiesResult = Awaited<ReturnType<typeof getOpportunities>>

function buildActionCards(
  result: OpportunitiesResult,
  todayKey: string,
): DecisionAction[] {
  if (!result || !result.ok || result.opportunities.length === 0) return []
  const today = new Date(`${todayKey}T00:00:00Z`)
  const doBy = new Date(today)
  doBy.setUTCDate(doBy.getUTCDate() + 7)
  const doByKey = ymd(doBy)

  const ranked = result.opportunities
    .map((o) => {
      const cw = CONFIDENCE_WEIGHT[o.confidence] ?? 0.5
      const score = o.estimatedDollarImpact * cw
      return { o, score }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)

  return ranked.map(({ o }) => ({
    id: o.id,
    category: translateOpportunityType(o.opportunityType),
    type: o.opportunityType,
    title: stripJargon(o.title),
    impactUsdPerWeek: o.estimatedDollarImpact,
    why: stripJargon(o.suggestedAction || ""),
    doByDate: doByKey,
    dots: translateConfidence(o.confidence),
    confidence: o.confidence,
    evidence: o.evidence.map((e) => ({
      kind: e.kind,
      ref: e.ref,
      value: String(e.value),
    })),
  }))
}
