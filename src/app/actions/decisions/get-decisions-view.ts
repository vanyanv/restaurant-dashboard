"use server"

import { ymdUTC as ymd } from "@/lib/date-utils"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/generated/prisma/client"
import { weekdayTargets, type SplhInput } from "@/lib/splh"
import { getCachedSession, resolveStoreContext } from "@/app/actions/forecasts/_shared"
import { getRevenueForecast } from "@/app/actions/forecasts/revenue-forecast-actions"
import { getOpenAnomalies } from "@/app/actions/forecasts/anomaly-actions"
import { getLaborStaffingForecast } from "@/app/actions/forecasts/labor-staffing-actions"
import { getFoodCostForecast } from "@/app/actions/forecasts/food-cost-forecast-actions"
import { getCashPositionForecast } from "@/app/actions/forecasts/cash-position-actions"
import { getLostSales } from "@/app/actions/forecasts/lost-sales-actions"
import { getMenuEngineering } from "@/app/actions/forecasts/menu-engineering-actions"
import { getOpportunities } from "@/app/actions/growth/opportunities-actions"
import { buildBriefing, type BriefingLine } from "@/app/actions/decisions/build-briefing"
import { bucketByMean, pctVsTrailing, trailingMean, type VolumeBucket } from "@/app/dashboard/(editorial)/decisions/lib/bucket-volume"
import {
  confidenceFromForecast,
  type DotCount,
} from "@/app/dashboard/(editorial)/decisions/lib/confidence"
import {
  deadlineFor,
  type DecisionDeadline,
} from "@/app/dashboard/(editorial)/decisions/lib/deadline"
import {
  combineEvaluations,
  type Scorecard,
} from "@/app/dashboard/(editorial)/decisions/lib/scorecard"
import { computeVitals, type Vitals } from "@/app/dashboard/(editorial)/decisions/lib/vitals"
import { buildVerdictFacts, verdictSources } from "@/app/dashboard/(editorial)/decisions/lib/verdict-copy"
import { getVerdictLine } from "@/app/actions/decisions/get-verdict"
import {
  computeLaborLane,
  type LaborLane,
} from "@/app/dashboard/(editorial)/decisions/lib/labor-lane"
import {
  OPERATING_HOURS,
  buildHourlyCoverage,
  type HourlyCoverage,
} from "@/app/dashboard/(editorial)/decisions/lib/hourly-coverage"
import {
  mergeAttributions,
  parseAttribution,
  type Attribution,
} from "@/app/dashboard/(editorial)/decisions/lib/attribution"
import {
  computeDecisionOutcome,
  type DecisionOutcome,
  type FrozenDay,
} from "@/app/dashboard/(editorial)/decisions/lib/decision-outcome"
import { bucketShiftHours } from "@/lib/harri-schedule"
import {
  stripJargon,
  translateConfidence,
  translateOpportunityType,
  weatherPhrase,
  eventPhrase,
} from "@/app/dashboard/(editorial)/decisions/lib/translate"
import type { OpportunityType, OpportunityConfidence } from "@/types/growth"

export interface DecisionDay {
  date: string // YYYY-MM-DD
  weekdayShort: string // MON, TUE
  monthDayShort: string // MAY 18
  bucket: VolumeBucket
  /**
   * The forecast in dollars, plus its 80% band. All three were already loaded
   * by `getRevenueForecast` and thrown away — the cell rendered the adjective
   * ("busy") and nothing an owner could order stock against.
   */
  predictedRevenue: number
  p10: number | null
  p90: number | null
  pctVsTrailing: number | null
  staffDelta: number | null
  /**
   * Why `staffDelta` is null, when there's a reason worth showing. The staffing
   * cell rendered a bare em-dash on all seven days, which reads as a broken
   * feature; the classifier actually knew the answer ("missing_schedule" —
   * Harri has published no schedule for that day).
   */
  staffNote: string | null
  /**
   * Scheduled hours from HarriShift against the hours this day's forecast
   * earns at typical weekday productivity. Replaces the +1/-1 staff arrow,
   * which read "no schedule" six days out of seven because its source table
   * has no forward rows.
   */
  labor: LaborLane
  /**
   * Demand per hour against the shifts posted for it. The lane says a day is
   * short; this says which stretch, which is what a manager actually posts.
   */
  hourly: HourlyCoverage
  /**
   * Why the model landed on this number — TreeSHAP, grouped for an operator.
   * Null until the nightly has written a waterfall for the day.
   */
  attribution: Attribution | null
  hasAnomaly: boolean
  anomalyHint: string | null
  weatherTone: "clear" | "rain" | "heat" | "cold" | "heavy_rain" | null
  weatherPhrase: string | null
  /** Day high/low in Celsius, for judging a hot day against its own week. */
  weatherHighC: number | null
  weatherLowC: number | null
  eventPhrase: string | null
  topEventTitle: string | null
  /** Events the signal provider ranked major. Zero on an ordinary day. */
  majorEventCount: number
  foodCostNote: string | null
}

/** A decision the owner already made, and what has happened since. */
export interface DecisionRecord {
  storeId: string
  storeName: string | null
  opportunityType: OpportunityType
  title: string
  rawTitle: string
  state: "COMMITTED" | "DISMISSED"
  decidedAt: Date
  dismissReason: string | null
  predictedImpactUsdPerWeek: number
  /** Null for dismissals — nothing was done, so there is nothing to measure. */
  outcome: DecisionOutcome | null
}

export interface DecisionAction {
  id: string
  /** Needed to record a decision; opportunities can span stores on the
   *  portfolio view. */
  storeId: string
  category: string // "Pricing", "Menu mix", ...
  type: OpportunityType
  title: string
  /**
   * The generator's untouched title. `title` above is jargon-stripped for
   * display, and DecisionLog keys on (store, type, title) — sending the
   * stripped one would write a key that never matches on the way back.
   */
  rawTitle: string
  /** Impact normalised to one week, whatever horizon the generator used. */
  impactUsdPerWeek: number
  /**
   * The same figure's 10th-90th percentile range, normalised the same way.
   * Null when the underlying fit reported no standard error — showing a range
   * there would be precision the estimate does not have. Note the range covers
   * only the elasticity's uncertainty, so it is a floor on the true one.
   */
  impactRangeUsdPerWeek: { low: number; high: number } | null
  why: string
  /** Derived from the generator's own horizon, not a flat today+7. */
  deadline: DecisionDeadline
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
  /** Sum of the shown actions' weekly impact — the week's pot. */
  potUsdPerWeek: number
  /** Decisions already taken, newest first. The page's memory. */
  decisions: DecisionRecord[]
  /** The forecast's own track record. Null until the evaluator has run. */
  scorecard: Scorecard | null
  /** Briefing lines the verdict did NOT absorb — [0] is in the verdict. */
  briefing: BriefingLine[]
  /** The week read as four numbers — the strip under the verdict. */
  vitals: Vitals
  /**
   * The one sentence the page leads with. `model` is null when the
   * deterministic composer wrote it, which is a normal state, not an error.
   */
  verdict: { line: string; sources: string[]; model: string | null }
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

/**
 * Generators emit over different horizons — 1 day for reprice, 7 for the risk
 * types, 30 for menu engineering — and the card has always said "/wk". Normalise
 * rather than relabel; showing a 30-day figure as weekly is what produced
 * "+$10,839/wk" for a single slow-moving combo.
 */
function weeklyFactor(horizonDays: number | null | undefined): number {
  return 7 / Math.max(1, horizonDays ?? 7)
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
    cashResultRaw,
    lostSalesResultRaw,
    menuEngResultRaw,
    storeTargets,
    weatherRows,
    eventRows,
    shiftRows,
    hourlyForecastRows,
    ordersHistoryRows,
    splhHistoryRows,
    attributionRows,
    decisionRows,
    actualsRows,
    evaluationRows,
  ] = await Promise.all([
    getRevenueForecast({ storeId: input.storeId, horizonDays: 14 }),
    getOpenAnomalies({ storeId: input.storeId, limit: 50 }),
    getLaborStaffingForecast({ storeId: input.storeId, horizonDays: 7 }).catch(
      () => null,
    ),
    getFoodCostForecast({ storeId: input.storeId }).catch(() => null),
    getOpportunities({ storeId: input.storeId }).catch(() => null),
    // These three were passed to buildBriefing as `null`, which made the cash,
    // stockout and menu generators unreachable. They are independent of each
    // other and of the forecasts above, so they join the same fan-out rather
    // than adding a serial hop.
    getCashPositionForecast({ storeId: input.storeId, horizonDays: 14 }).catch(
      () => null,
    ),
    getLostSales({ storeId: input.storeId }).catch(() => null),
    getMenuEngineering({ storeId: input.storeId }).catch(() => null),
    // `cogsLine` has two branches and production could only ever reach the
    // target-less one, which reports a percentage and passes no judgment.
    // The target is per-store, so the portfolio view keeps the neutral branch.
    isAggregate
      ? Promise.resolve(null)
      : prisma.store
          .findUnique({
            where: { id: storeIds[0] },
            select: { targetCogsPct: true },
          })
          .catch(() => null),
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
    // Published shifts covering the forecast week. HarriShift runs ~2 weeks
    // ahead of today once the manager publishes; nothing else in the fan-out
    // reaches forward.
    prisma.harriShift.findMany({
      where: {
        storeId: { in: storeIds },
        // Back 60 days as well: the throughput rate behind "needed hours" is
        // the store's own orders per labor hour, and that needs history.
        date: { gte: addDays(today, -60), lte: addDays(today, 7) },
        status: { not: "DELETED" },
      },
      select: {
        date: true,
        minutes: true,
        isVirtual: true,
        startTime: true,
        endTime: true,
      },
    }).catch(() => []),
    // Hourly demand forecast for the week, newest generation only.
    prisma.forecastHourlyOrders.findMany({
      where: {
        storeId: { in: storeIds },
        forecastDate: { gte: today, lte: addDays(today, 7) },
      },
      orderBy: { generatedAt: "desc" },
      take: 24 * 8 * 4,
      select: {
        forecastDate: true,
        hourBucket: true,
        predictedOrders: true,
        generatedAt: true,
      },
    }).catch(() => []),
    // Orders actually taken, for the throughput denominator's other half.
    prisma.otterHourlySummary.groupBy({
      by: ["date"],
      where: {
        storeId: { in: storeIds },
        date: { gte: addDays(today, -60), lt: today },
      },
      _sum: { orderCount: true },
    }).catch(() => []),
    // Labor hours joined to net sales, for the per-weekday productivity median.
    // Same sources and grain as getSplhSeries: HarriPositionDaily.actualSeconds
    // and OtterHourlySummary.netSales, both LA-calendar daily.
    prisma.$queryRaw<Array<{ date: Date; hours: number | null; net: number | null }>>(
      Prisma.sql`
        SELECT h."date",
               SUM(h."actualSeconds") / 3600.0  AS hours,
               s.net                            AS net
          FROM "HarriPositionDaily" h
          LEFT JOIN (
            SELECT "storeId", "date", SUM("netSales") AS net
              FROM "OtterHourlySummary"
             WHERE "storeId" IN (${Prisma.join(storeIds)})
               AND "date" >= ${addDays(today, -120)}
               AND "date" < ${today}
             GROUP BY "storeId", "date"
          ) s ON s."storeId" = h."storeId" AND s."date" = h."date"
         WHERE h."storeId" IN (${Prisma.join(storeIds)})
           AND h."date" >= ${addDays(today, -120)}
           -- Today is always partial; one low sample would drag a weekday
           -- median that only has ~17 observations behind it.
           AND h."date" < ${today}
         GROUP BY h."date", s.net
      `,
    ).catch(() => []),
    // The forecast's own explanation. Read here rather than through
    // getRevenueForecast so that shared action keeps its shape; merging across
    // stores is sound because SHAP contributions are additive.
    prisma.forecastDailyRevenue.findMany({
      where: {
        storeId: { in: storeIds },
        hourBucket: 0,
        forecastDate: { gte: today, lte: addDays(today, 7) },
        attribution: { not: Prisma.DbNull },
      },
      orderBy: { generatedAt: "desc" },
      take: 8 * 4 * Math.max(1, storeIds.length),
      select: { storeId: true, forecastDate: true, attribution: true },
    }).catch(() => []),
    // What the owner already decided. The page's memory.
    prisma.decisionLog.findMany({
      where: { storeId: { in: storeIds } },
      orderBy: { decidedAt: "desc" },
      take: 50,
      select: {
        storeId: true,
        opportunityType: true,
        opportunityTitle: true,
        state: true,
        decidedAt: true,
        dismissReason: true,
        predictedImpactUsdPerWeek: true,
        frozenForecast: true,
        store: { select: { name: true } },
      },
    }).catch(() => []),
    // Actuals to judge those decisions against. A frozen forecast reaches at
    // most 14 days past the decision, so 60 days back covers every open one.
    prisma.otterDailySummary.groupBy({
      by: ["date"],
      where: {
        storeId: { in: storeIds },
        date: { gte: addDays(today, -60), lt: today },
      },
      _sum: { fpNetSales: true, tpNetSales: true },
    }).catch(() => []),
    // First reader of MlForecastEvaluation anywhere in src/. Ordered newest
    // first and deduped per store below — Prisma has no latest-per-group, and
    // the row count here is stores x model versions, not unbounded.
    prisma.mlForecastEvaluation.findMany({
      where: {
        storeId: { in: storeIds },
        target: "REVENUE",
        horizonDay: 0,
        sampleSize: { gt: 0 },
      },
      orderBy: { computedAt: "desc" },
      take: 50,
      select: {
        storeId: true,
        wape: true,
        baselineWape: true,
        intervalCoverage80: true,
        sampleSize: true,
      },
    }).catch(() => []),
  ])

  const revenueData = revenueResult && revenueResult.ok ? revenueResult.data : null
  const laborData =
    laborResultRaw && laborResultRaw.ok ? laborResultRaw.data : null
  const foodCostData =
    foodCostResultRaw && foodCostResultRaw.ok ? foodCostResultRaw.data : null
  const cashData = cashResultRaw && cashResultRaw.ok ? cashResultRaw.data : null
  const lostSalesData =
    lostSalesResultRaw && lostSalesResultRaw.ok ? lostSalesResultRaw.data : null
  const menuEngData =
    menuEngResultRaw && menuEngResultRaw.ok ? menuEngResultRaw.data : null
  const targetCogsPct = storeTargets?.targetCogsPct ?? null

  // Newest evaluation per store; the rest are older model versions.
  const latestPerStore = new Map<string, (typeof evaluationRows)[number]>()
  for (const row of evaluationRows) {
    if (!latestPerStore.has(row.storeId)) latestPerStore.set(row.storeId, row)
  }
  const scorecard = combineEvaluations([...latestPerStore.values()])
  const trailing7Mean = revenueData ? trailingMean(revenueData.days) : 0

  // Published hours and unfilled slots per day.
  const shiftsByDate = new Map<string, { hours: number; unfilled: number }>()
  for (const row of shiftRows) {
    const key = ymd(row.date)
    const cur = shiftsByDate.get(key) ?? { hours: 0, unfilled: 0 }
    cur.hours += row.minutes / 60
    if (row.isVirtual) cur.unfilled += 1
    shiftsByDate.set(key, cur)
  }

  // Median $/labor-hour per weekday. A flat target would just redraw the volume
  // curve and condemn every Tuesday, so the comparison is like-for-like.
  const splhHistory: SplhInput[] = splhHistoryRows
    .filter((r) => Number(r.hours ?? 0) > 0 && Number(r.net ?? 0) > 0)
    .map((r) => ({
      date: ymd(r.date),
      netSales: Number(r.net ?? 0),
      laborHours: Number(r.hours ?? 0),
      laborCost: 0,
    }))
  const splhByWeekday = weekdayTargets(splhHistory)

  // Orders per labor hour, the store's own throughput. Numerator from orders
  // actually taken, denominator from shifts posted for those same completed
  // days — the same "typical, not optimal" benchmark the daily lane uses.
  const shiftHoursByDate = new Map<string, number>()
  for (const row of shiftRows) {
    const key = ymd(row.date)
    shiftHoursByDate.set(key, (shiftHoursByDate.get(key) ?? 0) + row.minutes / 60)
  }
  let histOrders = 0
  let histHours = 0
  for (const row of ordersHistoryRows) {
    const hours = shiftHoursByDate.get(ymd(row.date)) ?? 0
    const orders = row._sum.orderCount ?? 0
    if (hours <= 0 || orders <= 0) continue
    histOrders += orders
    histHours += hours
  }
  const ordersPerLaborHour = histHours > 0 ? histOrders / histHours : null

  // Newest generation only — the query is ordered desc, so first wins.
  const hourlyByDate = new Map<string, Map<number, number>>()
  const seenGeneration = new Map<string, number>()
  for (const row of hourlyForecastRows) {
    const key = ymd(row.forecastDate)
    const stamp = row.generatedAt.getTime()
    const kept = seenGeneration.get(key)
    if (kept == null) seenGeneration.set(key, stamp)
    else if (stamp !== kept) continue
    const byHour = hourlyByDate.get(key) ?? new Map<number, number>()
    byHour.set(row.hourBucket, row.predictedOrders)
    hourlyByDate.set(key, byHour)
  }

  // Shift minutes spread across the clock hours they actually cover. Overnight
  // shifts land on the next date key, which is why hours 0-1 of the following
  // morning are read back for the trading day that opened before midnight.
  const staffedByDate = bucketShiftHours(shiftRows)

  // Newest generation per (store, date); rows arrive newest-first.
  const attributionByDate = new Map<string, Attribution[]>()
  const seenStoreDate = new Set<string>()
  for (const row of attributionRows) {
    const key = ymd(row.forecastDate)
    const dedupe = `${row.storeId}|${key}`
    if (seenStoreDate.has(dedupe)) continue
    seenStoreDate.add(dedupe)
    const parsed = parseAttribution(row.attribution)
    if (!parsed) continue
    attributionByDate.set(key, [...(attributionByDate.get(key) ?? []), parsed])
  }

  const next7 = revenueData?.days.slice(0, 7) ?? []
  const days: DecisionDay[] = next7.map((d) => {
    const key = ymd(d.date)
    const bucket = bucketByMean(d.predictedRevenue, trailing7Mean)
    const pct = pctVsTrailing(d.predictedRevenue, trailing7Mean)
    const weather = aggregateWeather(weatherRows, key)
    const event = aggregateEvents(eventRows, key)
    const anom = findAnomalyForDay(anomaliesResult, key)
    const staffDelta = computeStaffDelta(laborData, key)
    const staffNote = computeStaffNote(laborData, key)
    const foodCostNote = isAggregate ? null : foodCostNoteFor(foodCostData, key)
    const shifts = shiftsByDate.get(key) ?? { hours: 0, unfilled: 0 }
    const nextKey = ymd(addDays(d.date, 1))
    const hourly = buildHourlyCoverage(
      OPERATING_HOURS.map((hour) => {
        // Hours 0 and 1 belong to the trading day that opened the morning
        // before, so they are read from the following calendar date.
        const srcKey = hour <= 1 ? nextKey : key
        return {
          hour,
          predictedOrders: hourlyByDate.get(srcKey)?.get(hour) ?? 0,
          staffedHours: staffedByDate.get(srcKey)?.[hour] ?? 0,
        }
      }),
      ordersPerLaborHour,
    )
    const attribution = mergeAttributions(attributionByDate.get(key) ?? [])
    const labor = computeLaborLane({
      forecastRevenue: d.predictedRevenue,
      scheduledHours: shifts.hours,
      targetSplh: splhByWeekday[d.date.getUTCDay()] ?? null,
      unfilledSlots: shifts.unfilled,
    })

    return {
      date: key,
      weekdayShort: weekdayShort(d.date),
      monthDayShort: monthDayShort(d.date),
      bucket,
      predictedRevenue: d.predictedRevenue,
      p10: d.p10,
      p90: d.p90,
      pctVsTrailing: pct,
      staffDelta,
      staffNote,
      labor,
      hourly,
      attribution,
      hasAnomaly: !!anom,
      anomalyHint: anom,
      weatherTone: weather.tone,
      weatherPhrase: weather.phrase,
      weatherHighC: weather.highC,
      weatherLowC: weather.lowC,
      eventPhrase: event.phrase,
      topEventTitle: event.title,
      majorEventCount: event.majorCount,
      foodCostNote,
    }
  })

  const briefing: BriefingLine[] = revenueData
    ? buildBriefing({
        revenue: revenueData,
        cash: cashData,
        foodCost: foodCostData,
        targetCogsPct,
        anomalies:
          anomaliesResult && anomaliesResult.ok ? anomaliesResult.data : null,
        lostSales: lostSalesData,
        menuEngineering: menuEngData,
        isAggregate,
      })
    : []

  const sanitizedBriefing: BriefingLine[] = briefing.map((line) => ({
    ...line,
    chunks: line.chunks.map((c) =>
      c.kind === "text" ? { ...c, value: stripJargon(c.value) } : c,
    ),
  }))

  // Revenue actually taken, keyed by day, for the counterfactual comparison.
  const actualByDate = new Map<string, number>()
  for (const row of actualsRows) {
    const key = ymd(row.date)
    const taken = (row._sum.fpNetSales ?? 0) + (row._sum.tpNetSales ?? 0)
    actualByDate.set(key, (actualByDate.get(key) ?? 0) + taken)
  }

  const decisions: DecisionRecord[] = decisionRows.map((d) => ({
    storeId: d.storeId,
    storeName: isAggregate ? (d.store?.name ?? null) : null,
    opportunityType: d.opportunityType as OpportunityType,
    title: stripJargon(d.opportunityTitle),
    rawTitle: d.opportunityTitle,
    state: d.state as "COMMITTED" | "DISMISSED",
    decidedAt: d.decidedAt,
    dismissReason: d.dismissReason,
    predictedImpactUsdPerWeek: d.predictedImpactUsdPerWeek,
    // Only a commitment has an effect to measure, and only if the forecast at
    // that moment was captured.
    outcome:
      d.state === "COMMITTED"
        ? computeDecisionOutcome(parseFrozen(d.frozenForecast), actualByDate)
        : null,
  }))

  // An opportunity already decided leaves the open ledger; it lives on as a
  // record below rather than being offered again every morning.
  const decided = new Set(
    decisionRows.map((d) => `${d.storeId}|${d.opportunityType}|${d.opportunityTitle}`),
  )

  const actions: DecisionAction[] = buildActionCards(
    opportunitiesResult,
    todayKey,
    decided,
  )

  const overallConfidence: DotCount = confidenceFromForecast(
    revenueData,
    next7[0]?.forecastSource ?? null,
  )

  const potUsdPerWeek = actions.reduce((sum, a) => sum + a.impactUsdPerWeek, 0)

  // Act I. The page used to open with three panels at equal weight and leave
  // the owner to add seven day cells in their head; hierarchy is now
  // verdict -> week -> actions (design principle #1).
  const vitals = computeVitals({ days, scorecard })

  // buildBriefing orders by detection priority (cash floor first), so [0] is
  // the most urgent thing it found. The verdict absorbs it and the list below
  // renders the remainder, so the page never says the same thing twice.
  const topBriefing =
    sanitizedBriefing.length > 0
      ? sanitizedBriefing[0].chunks.map((c) => c.value).join("")
      : null

  const verdictFacts = buildVerdictFacts({
    storeName,
    isAggregate,
    days,
    vitals,
    actions,
    potUsdPerWeek,
    topBriefing,
  })
  const verdict = await getVerdictLine({
    facts: verdictFacts,
    storeId: storeIdOut,
    asOf: todayKey,
    userId: session.user.id ?? null,
  })

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
      potUsdPerWeek,
      decisions,
      scorecard,
      briefing: sanitizedBriefing.slice(1),
      vitals,
      verdict: { ...verdict, sources: verdictSources(verdictFacts) },
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
): {
  tone: DecisionDay["weatherTone"]
  phrase: string | null
  highC: number | null
  lowC: number | null
} {
  const dayRows = rows.filter((r) => ymd(r.date) === dayKey)
  if (dayRows.length === 0) return { tone: null, phrase: null, highC: null, lowC: null }
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
  // The temperatures travel with the tone because "hot" is only worth a chip
  // relative to the week around it — an LA August is hot every day.
  return { tone, phrase, highC: maxTempC, lowC: minTempC }
}

function aggregateEvents(
  rows: Array<{
    date: Date
    topEventTitle: string | null
    majorEventCount: number
  }>,
  dayKey: string,
): { phrase: string | null; title: string | null; majorCount: number } {
  const dayRows = rows.filter((r) => ymd(r.date) === dayKey)
  if (dayRows.length === 0) return { phrase: null, title: null, majorCount: 0 }
  const sorted = [...dayRows].sort(
    (a, b) => (b.majorEventCount ?? 0) - (a.majorEventCount ?? 0),
  )
  const top = sorted[0]
  if (!top) return { phrase: null, title: null, majorCount: 0 }
  return {
    phrase: eventPhrase({
      topEventTitle: top.topEventTitle,
      majorEventCount: top.majorEventCount,
    }),
    title: top.topEventTitle,
    // A title exists on almost every day; a *major* count is what makes the
    // day different from the six around it.
    majorCount: top.majorEventCount ?? 0,
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

/**
 * Short reason for an absent staffing arrow, so the cell can explain itself
 * rather than showing a bare em-dash seven days running.
 */
function computeStaffNote(data: LaborData | null, dayKey: string): string | null {
  if (!data) return "no forecast"
  const day = data.days.find((d) => ymd(d.date) === dayKey)
  if (!day) return "no forecast"
  if (day.staffingRisk === "missing_schedule") return "no schedule"
  if (day.staffingRisk == null) return "no schedule"
  return null
}

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

/** Re-validate the frozen counterfactual coming back out of a Json column. */
function parseFrozen(raw: unknown): FrozenDay[] {
  if (!Array.isArray(raw)) return []
  const out: FrozenDay[] = []
  for (const entry of raw) {
    if (entry == null || typeof entry !== "object") continue
    const r = entry as Record<string, unknown>
    if (typeof r.date !== "string" || typeof r.predicted !== "number") continue
    out.push({
      date: r.date,
      predicted: r.predicted,
      p10: typeof r.p10 === "number" ? r.p10 : null,
      p90: typeof r.p90 === "number" ? r.p90 : null,
    })
  }
  return out
}

function buildActionCards(
  result: OpportunitiesResult,
  todayKey: string,
  decided: Set<string>,
): DecisionAction[] {
  if (!result || !result.ok || result.opportunities.length === 0) return []

  const ranked = result.opportunities
    .filter((o) => !decided.has(`${o.storeId}|${o.opportunityType}|${o.title}`))
    .map((o) => {
      const weekly = weeklyFactor(o.horizonDays)
      // Rank on the measured downside where the generator produced one: a wide,
      // speculative $900 should not outrank a tight, dependable $700. The
      // confidence weight is the older, coarser proxy for the same idea, so it
      // still applies to opportunities whose fit reported no standard error —
      // otherwise an estimate would be promoted merely for lacking error bars.
      const score =
        o.impactP25 != null
          ? o.impactP25 * weekly
          : o.estimatedDollarImpact * weekly * (CONFIDENCE_WEIGHT[o.confidence] ?? 0.5)
      return { o, score }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)

  return ranked.map(({ o }) => ({
    id: o.id,
    storeId: o.storeId,
    category: translateOpportunityType(o.opportunityType),
    type: o.opportunityType,
    title: stripJargon(o.title),
    rawTitle: o.title,
    // Generators emit over different horizons (1 day for reprice, 7 for the
    // risk types, 30 for menu engineering). The card has always said "/wk", so
    // normalise rather than relabel — a 30-day figure shown as weekly is what
    // produced "+$10,839/wk" for a single slow-moving combo.
    impactUsdPerWeek: o.estimatedDollarImpact * weeklyFactor(o.horizonDays),
    impactRangeUsdPerWeek:
      o.impactP10 != null && o.impactP90 != null
        ? {
            low: o.impactP10 * weeklyFactor(o.horizonDays),
            high: o.impactP90 * weeklyFactor(o.horizonDays),
          }
        : null,
    why: stripJargon(o.suggestedAction || ""),
    deadline: deadlineFor(o.horizonDays, todayKey),
    dots: translateConfidence(o.confidence),
    confidence: o.confidence,
    evidence: o.evidence.map((e) => ({
      kind: e.kind,
      ref: e.ref,
      value: String(e.value),
    })),
  }))
}
