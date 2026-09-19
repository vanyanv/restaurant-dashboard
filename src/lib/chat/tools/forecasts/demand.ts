// Phase 5 / F14 — expose the ML forecast + anomaly read path to the chat
// model so Claude can ground answers in concrete predictions instead of
// just summarising history.
//
// Each tool:
//   - resolves store ids through assertOwnerOwnsStores (no model-trust)
//   - keeps the latest generation per (storeId, target, date)
//   - returns plain rows the model can rewrite into prose

import { z } from "zod"
import { resolveStoreIds, storeIdsSchema, ymd } from "../_shared"
import type { ChatTool } from "../types"

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
    includeDrivers: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Include the TreeSHAP driver breakdown for each day: what the model thinks is pushing the number up or down (weather, day of week, recent trend). Costs roughly six extra rows per day, so only ask for it when the user asks WHY a forecast looks the way it does.",
      ),
  })
  .strict()

/**
 * One operator-facing driver from the TreeSHAP waterfall. `value` is signed
 * dollars against `base`, and `base` + every `value` sums to
 * `predictedRevenue`. Grouped in ml/models/attribution.py because nobody
 * running a restaurant wants `lag_7` weighed against `roll_28`.
 */
export type ForecastDriver = { label: string; value: number }

export type RevenueForecastChatRow = {
  storeId: string
  date: string
  predictedRevenue: number
  p10: number | null
  p90: number | null
  modelVersion: string
  generatedAt: string
  /**
   * 'native' for a model fitted on this store's own history, 'transfer' for a
   * borrowed prior emitted while the store is warming up. A transfer row is a
   * real forecast but a weaker one, and the answer should say so.
   */
  forecastSource: string
  /**
   * Present only when `includeDrivers` was set. Null when the row predates
   * attribution (before 2026-08-19) or the booster declined to produce one --
   * which is not the same as "nothing is driving it".
   */
  drivers?: { base: number; groups: ForecastDriver[] } | null
}

/**
 * `attribution` is `Json?`, so it arrives as `unknown` and may be anything a
 * previous pipeline version wrote. Validate the shape rather than casting:
 * a malformed row should drop to null and leave the forecast readable, not
 * throw inside a tool call and cost the turn its whole answer.
 */
function readDrivers(
  raw: unknown,
): { base: number; groups: ForecastDriver[] } | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.base !== "number" || !Array.isArray(obj.groups)) return null
  const groups = obj.groups
    .filter(
      (g): g is { label: string; value: number } =>
        typeof g === "object" &&
        g !== null &&
        typeof (g as Record<string, unknown>).label === "string" &&
        typeof (g as Record<string, unknown>).value === "number",
    )
    .map((g) => ({ label: g.label, value: g.value }))
  if (groups.length === 0) return null
  return { base: obj.base, groups }
}

export const getRevenueForecast: ChatTool<typeof revenueParams, RevenueForecastChatRow[]> = {
  name: "getRevenueForecast",
  description:
    "Returns the latest daily revenue forecast for an owner-scoped slice of stores. Source: ForecastDailyRevenue, written by the nightly ML pipeline (XGBoost). p10/p90 are the 80% prediction-interval bounds. forecastSource is 'native' for a model fitted on the store's own history and 'transfer' for a borrowed prior used while a store is warming up. Pass includeDrivers=true to get the per-day TreeSHAP breakdown of what is pushing the number up or down. Empty when the pipeline has not run yet; check listStores first, because a pre_open store is never forecast at all.",
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
        forecastSource: true,
        ...(args.includeDrivers ? { attribution: true } : {}),
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
        forecastSource: r.forecastSource,
        ...(args.includeDrivers
          ? {
              drivers: readDrivers(
                (r as { attribution?: unknown }).attribution ?? null,
              ),
            }
          : {}),
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
