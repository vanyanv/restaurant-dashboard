// Phase 5 / F14 — expose the ML forecast + anomaly read path to the chat
// model so Claude can ground answers in concrete predictions instead of
// just summarising history.
//
// Each tool:
//   - resolves store ids through assertOwnerOwnsStores (no model-trust)
//   - keeps the latest generation per (storeId, target, date)
//   - returns plain rows the model can rewrite into prose

import { z } from "zod"
import { resolveStoreIds, storeIdsSchema, ymd } from "./_shared"
import type { ChatTool } from "./types"
import { getFoodCostForecast } from "@/app/actions/forecasts/food-cost-forecast-actions"
import { getMenuItemElasticity } from "@/app/actions/forecasts/elasticity-actions"
import { getLaborStaffingForecast } from "@/app/actions/forecasts/labor-staffing-actions"
import { getMenuEngineering } from "@/app/actions/forecasts/menu-engineering-actions"
import { getLostSales } from "@/app/actions/forecasts/lost-sales-actions"
import { getCashPositionForecast } from "@/app/actions/forecasts/cash-position-actions"

// ---------------------------------------------------------------------------
// getRevenueForecast (chat tool)
// ---------------------------------------------------------------------------

const revenueParams = z
  .object({
    storeIds: storeIdsSchema,
    horizonDays: z
      .number()
      .int()
      .min(1)
      .max(28)
      .optional()
      .default(14)
      .describe("Days ahead to return. The pipeline currently writes 14d horizons."),
  })
  .strict()

export type RevenueForecastChatRow = {
  storeId: string
  date: string
  predictedRevenue: number
  p10: number | null
  p90: number | null
  modelVersion: string
  generatedAt: string
}

export const getRevenueForecast: ChatTool<typeof revenueParams, RevenueForecastChatRow[]> = {
  name: "getRevenueForecast",
  description:
    "Returns the latest daily revenue forecast for an owner-scoped slice of stores. Source: ForecastDailyRevenue, written by the nightly ML pipeline (XGBoost). p10/p90 are the 80% prediction-interval bounds. Empty when the pipeline has not run yet.",
  parameters: revenueParams,
  async execute(args, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    const horizon = args.horizonDays ?? 14
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const horizonEnd = new Date(today)
    horizonEnd.setDate(horizonEnd.getDate() + horizon)

    const rows = await ctx.prisma.forecastDailyRevenue.findMany({
      where: {
        storeId: { in: storeIds },
        hourBucket: 0,
        forecastDate: { gte: today, lt: horizonEnd },
      },
      orderBy: [
        { storeId: "asc" },
        { forecastDate: "asc" },
        { generatedAt: "desc" },
      ],
      select: {
        storeId: true,
        forecastDate: true,
        predictedRevenue: true,
        p10: true,
        p90: true,
        modelVersion: true,
        generatedAt: true,
      },
    })

    // Latest generation per (storeId, forecastDate)
    const latest = new Map<string, (typeof rows)[number]>()
    for (const r of rows) {
      const key = `${r.storeId}|${ymd(r.forecastDate as Date)}`
      const existing = latest.get(key)
      if (!existing || r.generatedAt > existing.generatedAt) latest.set(key, r)
    }

    return Array.from(latest.values())
      .sort((a, b) => {
        if (a.storeId !== b.storeId) return a.storeId.localeCompare(b.storeId)
        return (a.forecastDate as Date).getTime() - (b.forecastDate as Date).getTime()
      })
      .map((r) => ({
        storeId: r.storeId,
        date: ymd(r.forecastDate as Date),
        predictedRevenue: r.predictedRevenue,
        p10: r.p10,
        p90: r.p90,
        modelVersion: r.modelVersion,
        generatedAt: r.generatedAt.toISOString(),
      }))
  },
}

// ---------------------------------------------------------------------------
// getMenuItemForecast (chat tool)
// ---------------------------------------------------------------------------

const menuItemParams = z
  .object({
    storeIds: storeIdsSchema,
    horizonDays: z.number().int().min(1).max(14).optional().default(7),
    topN: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .default(15)
      .describe("Cap on items returned per store, sorted by total predicted demand."),
  })
  .strict()

export type MenuItemForecastChatRow = {
  storeId: string
  itemSkuId: string
  totalPredicted: number
  dailyAverage: number
  days: { date: string; predictedQty: number; p10: number | null; p90: number | null }[]
}

export const getMenuItemForecast: ChatTool<typeof menuItemParams, MenuItemForecastChatRow[]> = {
  name: "getMenuItemForecast",
  description:
    "Returns the latest per-item demand forecast for an owner-scoped slice of stores. otterItemSkuId is the stable per-store identifier (currently the Otter item name). Returns the top-N items per store by total predicted demand.",
  parameters: menuItemParams,
  async execute(args, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    const horizon = args.horizonDays ?? 7
    const topN = args.topN ?? 15
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const horizonEnd = new Date(today)
    horizonEnd.setDate(horizonEnd.getDate() + horizon)

    const rows = await ctx.prisma.forecastMenuItem.findMany({
      where: {
        storeId: { in: storeIds },
        forecastDate: { gte: today, lt: horizonEnd },
      },
      orderBy: [
        { storeId: "asc" },
        { otterItemSkuId: "asc" },
        { forecastDate: "asc" },
        { generatedAt: "desc" },
      ],
      select: {
        storeId: true,
        otterItemSkuId: true,
        forecastDate: true,
        predictedQty: true,
        p10: true,
        p90: true,
        generatedAt: true,
      },
    })

    // Latest generation per (storeId, sku, date)
    const latest = new Map<string, (typeof rows)[number]>()
    for (const r of rows) {
      const key = `${r.storeId}|${r.otterItemSkuId}|${ymd(r.forecastDate as Date)}`
      const existing = latest.get(key)
      if (!existing || r.generatedAt > existing.generatedAt) latest.set(key, r)
    }

    // Bucket by (storeId, sku)
    type Bucket = MenuItemForecastChatRow
    const buckets = new Map<string, Bucket>()
    for (const r of latest.values()) {
      const key = `${r.storeId}|${r.otterItemSkuId}`
      let bucket = buckets.get(key)
      if (!bucket) {
        bucket = {
          storeId: r.storeId,
          itemSkuId: r.otterItemSkuId,
          totalPredicted: 0,
          dailyAverage: 0,
          days: [],
        }
        buckets.set(key, bucket)
      }
      bucket.days.push({
        date: ymd(r.forecastDate as Date),
        predictedQty: r.predictedQty,
        p10: r.p10,
        p90: r.p90,
      })
      bucket.totalPredicted += r.predictedQty
    }

    for (const b of buckets.values()) {
      b.days.sort((a, b2) => a.date.localeCompare(b2.date))
      b.dailyAverage = b.totalPredicted / Math.max(1, b.days.length)
    }

    // Top-N per store by total predicted
    const byStore = new Map<string, Bucket[]>()
    for (const b of buckets.values()) {
      const list = byStore.get(b.storeId) ?? []
      list.push(b)
      byStore.set(b.storeId, list)
    }

    const out: MenuItemForecastChatRow[] = []
    for (const list of byStore.values()) {
      list.sort((a, b) => b.totalPredicted - a.totalPredicted)
      out.push(...list.slice(0, topN))
    }
    return out.sort((a, b) => {
      if (a.storeId !== b.storeId) return a.storeId.localeCompare(b.storeId)
      return b.totalPredicted - a.totalPredicted
    })
  },
}

// ---------------------------------------------------------------------------
// getOpenAnomalies (chat tool)
// ---------------------------------------------------------------------------

const anomaliesParams = z
  .object({
    storeIds: storeIdsSchema,
    limit: z.number().int().min(1).max(100).optional().default(25),
    sinceDays: z
      .number()
      .int()
      .min(1)
      .max(60)
      .optional()
      .default(14)
      .describe("How far back to look. Anomalies older than this are usually stale."),
  })
  .strict()

export type AnomalyChatRow = {
  storeId: string
  target: string
  targetId: string | null
  occurredOn: string
  residual: number
  zScore: number | null
  method: string
  detectedAt: string
}

// ---------------------------------------------------------------------------
// getFoodCostForecast (chat tool)
// ---------------------------------------------------------------------------

const foodCostParams = z
  .object({
    storeId: z
      .string()
      .min(1)
      .describe(
        "Store id to project food cost % for. Resolve from listStores first; this tool is per-store, not multi-store.",
      ),
    horizonDays: z.number().int().min(1).max(14).optional().default(7),
  })
  .strict()

export type FoodCostForecastChatRow = {
  date: string
  predictedRevenue: number | null
  predictedFoodCost: number
  foodCostPct: number | null
  pctP10: number | null
  pctP90: number | null
  unmappedItemCount: number
}

export type FoodCostForecastChatResult = {
  storeId: string
  generatedAt: string | null
  blendedFoodCostPct: number | null
  totalPredictedRevenue: number
  totalPredictedFoodCost: number
  days: FoodCostForecastChatRow[]
}

export const getFoodCostForecastTool: ChatTool<
  typeof foodCostParams,
  FoodCostForecastChatResult | { ok: false; error: string }
> = {
  name: "getFoodCostForecast",
  description:
    "Joins the daily revenue forecast and per-item demand forecast against recipe costs to project food cost % over the next 7-14 days for ONE store. blendedFoodCostPct is the horizon-wide weighted percent. unmappedItemCount > 0 flags items in the demand forecast with no OtterItemMapping (those are excluded from the food cost number — surface as a caveat in the prose).",
  parameters: foodCostParams,
  async execute(args, ctx) {
    // Reuse the auth-checked server action so cross-account access stays
    // impossible. Caller still holds the session via getServerSession; the
    // chat route has already verified hasOwnerAccess.
    const result = await getFoodCostForecast({
      storeId: args.storeId,
      horizonDays: args.horizonDays,
    })
    if (!result) return { ok: false, error: "no_session" }
    if (!result.ok) return { ok: false, error: result.error }
    const d = result.data
    return {
      storeId: d.storeId,
      generatedAt: d.generatedAt ? d.generatedAt.toISOString() : null,
      blendedFoodCostPct: d.blendedFoodCostPct,
      totalPredictedRevenue: d.totalPredictedRevenue,
      totalPredictedFoodCost: d.totalPredictedFoodCost,
      days: d.days.map((row) => ({
        date: ymd(row.date),
        predictedRevenue: row.predictedRevenue,
        predictedFoodCost: row.predictedFoodCost,
        foodCostPct: row.foodCostPct,
        pctP10: row.pctP10,
        pctP90: row.pctP90,
        unmappedItemCount: row.unmappedItemCount,
      })),
    }
    // Note: ctx is unused — getFoodCostForecast does its own session lookup.
    void ctx
  },
}

// ---------------------------------------------------------------------------
// getMenuItemElasticity (chat tool)
// ---------------------------------------------------------------------------

const elasticityParams = z
  .object({
    storeId: z.string().min(1),
    minConfidence: z
      .enum(["low", "medium", "high"])
      .optional()
      .default("low")
      .describe("Filter out fits below this confidence band."),
    limit: z.number().int().min(1).max(50).optional().default(20),
  })
  .strict()

export type ElasticityChatRow = {
  itemSkuId: string
  elasticity: number
  meanPrice: number
  meanQty: number
  fitR2: number
  pricePointCount: number
  sampleSize: number
  confidence: "low" | "medium" | "high" | "no_signal"
  pctVolumeChangeAt10PctHike: number
}

const CONFIDENCE_RANK = { low: 1, medium: 2, high: 3 } as const

export const getMenuItemElasticityTool: ChatTool<
  typeof elasticityParams,
  ElasticityChatRow[] | { ok: false; error: string }
> = {
  name: "getMenuItemElasticity",
  description:
    "Returns per-item price elasticity for ONE store, fitted nightly via OLS log(qty) ~ log(price) + weekday dummies. Negative coefficients are the norm; -1.0 is unit elastic. pctVolumeChangeAt10PctHike applies the elasticity to a hypothetical 10% price hike. Skip rows with confidence='no_signal' (constant price or positive coefficient).",
  parameters: elasticityParams,
  async execute(args, ctx) {
    const result = await getMenuItemElasticity({ storeId: args.storeId })
    if (!result) return { ok: false, error: "no_session" }
    if (!result.ok) return { ok: false, error: result.error }
    const minRank = CONFIDENCE_RANK[args.minConfidence ?? "low"]
    const filtered = result.data.rows.filter((r) => {
      if (r.confidence === "no_signal") return false
      return CONFIDENCE_RANK[r.confidence] >= minRank
    })
    void ctx
    return filtered.slice(0, args.limit ?? 20).map((r) => ({
      itemSkuId: r.otterItemSkuId,
      elasticity: r.elasticity,
      meanPrice: r.meanPrice,
      meanQty: r.meanQty,
      fitR2: r.fitR2,
      pricePointCount: r.pricePointCount,
      sampleSize: r.sampleSize,
      confidence: r.confidence,
      pctVolumeChangeAt10PctHike: r.pctVolumeChangeAt10PctHike,
    }))
  },
}

// ---------------------------------------------------------------------------
// getLaborStaffingForecast (chat tool)
// ---------------------------------------------------------------------------

const laborParams = z
  .object({
    storeId: z.string().min(1),
    horizonDays: z.number().int().min(1).max(14).optional().default(7),
  })
  .strict()

export type LaborStaffingChatDay = {
  date: string
  weekday: number
  predictedRevenue: number | null
  predictedOrders: number
  totalLaborHours: number
  /** Compact "openHour-closeHour:staff" segments collapsed for prose. */
  hourlyStaff: { hour: number; staff: number; predictedOrders: number }[]
}

export type LaborStaffingChatResult = {
  storeId: string
  meanAvgTicket: number
  coversPerStaffHour: number
  minStaff: number
  totalLaborHours: number
  days: LaborStaffingChatDay[]
}

export const getLaborStaffingForecastTool: ChatTool<
  typeof laborParams,
  LaborStaffingChatResult | { ok: false; error: string }
> = {
  name: "getLaborStaffingForecast",
  description:
    "Recommended staff per hour for the next 7-14 days at ONE store. Computed deterministically from the daily revenue forecast × historical hour-of-day order share × a constant covers-per-staff-per-hour budget. Returns total labor-hours per day + the per-hour staffing matrix. Closed hours (no historical orders) get staff=0; open hours respect a minStaff floor. Note in prose: 'these are budgeted staff-hours, not actual hours' — this product does not see time-clock data.",
  parameters: laborParams,
  async execute(args, ctx) {
    const result = await getLaborStaffingForecast({
      storeId: args.storeId,
      horizonDays: args.horizonDays,
    })
    if (!result) return { ok: false, error: "no_session" }
    if (!result.ok) return { ok: false, error: result.error }
    void ctx
    const d = result.data
    return {
      storeId: d.storeId,
      meanAvgTicket: d.meanAvgTicket,
      coversPerStaffHour: d.coversPerStaffHour,
      minStaff: d.minStaff,
      totalLaborHours: d.totalForecastLaborHours,
      days: d.days.map((day) => ({
        date: day.date.toISOString().slice(0, 10),
        weekday: day.weekday,
        predictedRevenue: day.predictedRevenue,
        predictedOrders: day.predictedOrders,
        totalLaborHours: day.totalLaborHours,
        // Drop closed hours from the chat payload — saves tokens, makes the
        // model less likely to recite a 24-row hour table verbatim.
        hourlyStaff: day.hours
          .filter((h) => h.recommendedStaff > 0)
          .map((h) => ({
            hour: h.hour,
            staff: h.recommendedStaff,
            predictedOrders: h.predictedOrders,
          })),
      })),
    }
  },
}

// ---------------------------------------------------------------------------
// getMenuEngineering (chat tool)
// ---------------------------------------------------------------------------

const menuEngineeringParams = z
  .object({
    storeId: z
      .string()
      .min(1)
      .optional()
      .describe("Omit to roll across every owned store."),
    lookbackDays: z.number().int().min(7).max(180).optional().default(30),
    quadrant: z
      .enum(["STAR", "PLOWHORSE", "PUZZLE", "DOG"])
      .optional()
      .describe("Restrict to one quadrant. Omit for the full classifier output."),
    limit: z.number().int().min(1).max(100).optional().default(20),
  })
  .strict()

export type MenuEngineeringChatRow = {
  itemName: string
  category: string
  soldQty: number
  revenue: number
  unitMargin: number
  totalContribution: number
  marginPct: number | null
  quadrant: "STAR" | "PLOWHORSE" | "PUZZLE" | "DOG"
}

export type MenuEngineeringChatResult = {
  windowStart: string
  windowEnd: string
  medianVelocity: number
  medianUnitMargin: number
  counts: { STAR: number; PLOWHORSE: number; PUZZLE: number; DOG: number }
  totalContribution: number
  rows: MenuEngineeringChatRow[]
}

export const getMenuEngineeringTool: ChatTool<
  typeof menuEngineeringParams,
  MenuEngineeringChatResult | { ok: false; error: string }
> = {
  name: "getMenuEngineering",
  description:
    "Classifies costed menu items into Stars / Plowhorses / Puzzles / Dogs by a median split on (sold quantity, unit margin) over the last N days. STAR = high margin × high volume; PLOWHORSE = low margin × high volume; PUZZLE = high margin × low volume; DOG = low margin × low volume. Reads precomputed DailyCogsItem rollups, so only items with a costed recipe are classified.",
  parameters: menuEngineeringParams,
  async execute(args, ctx) {
    const result = await getMenuEngineering({
      storeId: args.storeId,
      lookbackDays: args.lookbackDays,
    })
    if (!result) return { ok: false, error: "no_session" }
    if (!result.ok) return { ok: false, error: result.error }
    void ctx
    const d = result.data
    const filtered = args.quadrant
      ? d.rows.filter((r) => r.quadrant === args.quadrant)
      : d.rows
    return {
      windowStart: d.windowStart.toISOString().slice(0, 10),
      windowEnd: d.windowEnd.toISOString().slice(0, 10),
      medianVelocity: d.medianVelocity,
      medianUnitMargin: d.medianUnitMargin,
      counts: d.counts,
      totalContribution: d.totalContribution,
      rows: filtered.slice(0, args.limit ?? 20).map((r) => ({
        itemName: r.itemName,
        category: r.category,
        soldQty: r.soldQty,
        revenue: r.revenue,
        unitMargin: r.unitMargin,
        totalContribution: r.totalContribution,
        marginPct: r.marginPct,
        quadrant: r.quadrant,
      })),
    }
  },
}

// ---------------------------------------------------------------------------
// getLostSales (chat tool)
// ---------------------------------------------------------------------------

const lostSalesParams = z
  .object({
    storeId: z.string().min(1).optional(),
    lookbackDays: z.number().int().min(7).max(180).optional().default(60),
    minBaselineQty: z.number().min(1).optional().default(3),
    minGapDays: z.number().int().min(1).optional().default(2),
  })
  .strict()

export type LostSalesChatRow = {
  storeId: string
  itemName: string
  category: string
  gapStart: string
  gapEnd: string
  gapDays: number
  baselineDailyQty: number
  meanUnitPrice: number
  estimatedLostRevenue: number
}

export type LostSalesChatResult = {
  windowStart: string
  windowEnd: string
  events: LostSalesChatRow[]
  totalEstimatedLost: number
}

export const getLostSalesTool: ChatTool<
  typeof lostSalesParams,
  LostSalesChatResult | { ok: false; error: string }
> = {
  name: "getLostSales",
  description:
    "Detects 86'd-item windows: items that sold consistently then dropped to zero for ≥ minGapDays consecutive days, with a strong pre-gap baseline. Estimates lost revenue per event as baseline_qty × gap_days × mean_unit_price. The detector caps gap_days at 14 so a permanent menu removal doesn't book unbounded losses.",
  parameters: lostSalesParams,
  async execute(args, ctx) {
    const result = await getLostSales({
      storeId: args.storeId,
      lookbackDays: args.lookbackDays,
      minBaselineQty: args.minBaselineQty,
      minGapDays: args.minGapDays,
    })
    if (!result) return { ok: false, error: "no_session" }
    if (!result.ok) return { ok: false, error: result.error }
    void ctx
    return {
      windowStart: result.data.windowStart.toISOString().slice(0, 10),
      windowEnd: result.data.windowEnd.toISOString().slice(0, 10),
      totalEstimatedLost: result.data.totalEstimatedLost,
      events: result.data.events.map((e) => ({
        storeId: e.storeId,
        itemName: e.itemName,
        category: e.category,
        gapStart: e.gapStart.toISOString().slice(0, 10),
        gapEnd: e.gapEnd.toISOString().slice(0, 10),
        gapDays: e.gapDays,
        baselineDailyQty: e.baselineDailyQty,
        meanUnitPrice: e.meanUnitPrice,
        estimatedLostRevenue: e.estimatedLostRevenue,
      })),
    }
  },
}

// ---------------------------------------------------------------------------
// getCashPositionForecast (chat tool)
// ---------------------------------------------------------------------------

const cashPositionParams = z
  .object({
    storeId: z
      .string()
      .min(1)
      .optional()
      .describe("Omit to roll across every owned store."),
    horizonDays: z.number().int().min(1).max(28).optional().default(14),
  })
  .strict()

export type CashPositionChatDay = {
  date: string
  predictedRevenue: number | null
  estimatedNetInflow: number
  scheduledPayables: number
  proRatedFixedCosts: number
  netCashFlow: number
  cumulativeNet: number
}

export type CashPositionChatResult = {
  horizonDays: number
  blendedCommissionRate: number
  proRatedFixedDaily: number
  totalScheduledPayables: number
  totalEstimatedInflow: number
  endingCumulativeNet: number
  goesNegativeOn: string | null
  days: CashPositionChatDay[]
}

export const getCashPositionForecastTool: ChatTool<
  typeof cashPositionParams,
  CashPositionChatResult | { ok: false; error: string }
> = {
  name: "getCashPositionForecast",
  description:
    "Projects daily cash flow for the next 14 days. Inflow = predicted revenue × (1 − blended commission); outflow = invoice dueDate matches + pro-rated monthly fixed costs (rent/labor/cleaning/towels). Returns DELTA cumulative cash, not absolute balance — say so once. goesNegativeOn is the first date where cumulativeNet drops below 0; null when never.",
  parameters: cashPositionParams,
  async execute(args, ctx) {
    const result = await getCashPositionForecast({
      storeId: args.storeId,
      horizonDays: args.horizonDays,
    })
    if (!result) return { ok: false, error: "no_session" }
    if (!result.ok) return { ok: false, error: result.error }
    void ctx
    const d = result.data
    const goesNegative = d.days.find((day) => day.cumulativeNet < 0)
    return {
      horizonDays: d.horizonDays,
      blendedCommissionRate: d.blendedCommissionRate,
      proRatedFixedDaily: d.proRatedFixedDaily,
      totalScheduledPayables: d.totalScheduledPayables,
      totalEstimatedInflow: d.totalEstimatedInflow,
      endingCumulativeNet: d.endingCumulativeNet,
      goesNegativeOn: goesNegative
        ? goesNegative.date.toISOString().slice(0, 10)
        : null,
      days: d.days.map((day) => ({
        date: day.date.toISOString().slice(0, 10),
        predictedRevenue: day.predictedRevenue,
        estimatedNetInflow: day.estimatedNetInflow,
        scheduledPayables: day.scheduledPayables,
        proRatedFixedCosts: day.proRatedFixedCosts,
        netCashFlow: day.netCashFlow,
        cumulativeNet: day.cumulativeNet,
      })),
    }
  },
}

export const getOpenAnomalies: ChatTool<typeof anomaliesParams, AnomalyChatRow[]> = {
  name: "getOpenAnomalies",
  description:
    "Returns OPEN anomaly events flagged by the nightly z-score detector for an owner-scoped slice of stores. Use to triage 'what changed' questions. Negative residual = volume below expected; positive = above.",
  parameters: anomaliesParams,
  async execute(args, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    const limit = args.limit ?? 25
    const sinceDays = args.sinceDays ?? 14
    const since = new Date()
    since.setDate(since.getDate() - sinceDays)
    since.setHours(0, 0, 0, 0)

    const rows = await ctx.prisma.anomalyEvent.findMany({
      where: {
        storeId: { in: storeIds },
        status: "OPEN",
        occurredOn: { gte: since },
      },
      orderBy: [{ occurredOn: "desc" }, { detectedAt: "desc" }],
      take: limit,
      select: {
        storeId: true,
        target: true,
        targetId: true,
        occurredOn: true,
        residual: true,
        zScore: true,
        method: true,
        detectedAt: true,
      },
    })

    return rows.map((r) => ({
      storeId: r.storeId,
      target: r.target,
      targetId: r.targetId,
      occurredOn: ymd(r.occurredOn as Date),
      residual: r.residual,
      zScore: r.zScore,
      method: r.method,
      detectedAt: r.detectedAt.toISOString(),
    }))
  },
}
