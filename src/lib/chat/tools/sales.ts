import { z } from "zod"
import {
  dateRangeSchema,
  parseDateRange,
  resolveStoreIds,
  storeIdsSchema,
  ymd,
} from "./_shared"
import type { ChatTool } from "./types"

const dailySalesParams = z
  .object({
    storeIds: storeIdsSchema,
    dateRange: dateRangeSchema,
    groupBy: z
      .enum(["day", "platform", "paymentMethod"])
      .optional()
      .default("day")
      .describe(
        "How to bucket the rows. 'day' returns one row per date. 'platform' rolls into Otter's pos_summary_ofo (e.g. css-pos, doordash, ubereats). 'paymentMethod' splits CARD vs CASH for first-party rows.",
      ),
  })
  .strict()

export type DailySalesRow = {
  /** Present when groupBy === 'day'. */
  date?: string
  /** Present when groupBy === 'platform'. */
  platform?: string
  /** Present when groupBy === 'paymentMethod'. */
  paymentMethod?: string
  /** First-party + third-party gross sales summed. */
  gross: number
  /** First-party + third-party net sales summed. */
  net: number
  /** Platform fees withheld by Otter / OFO partners. */
  fees: number
  /** Tax collected (FP + 3P combined). */
  tax: number
  /** Tips paid to the restaurant (FP cash/card + 3P passthrough). */
  tips: number
  /** Order count (FP + 3P combined). */
  count: number
}

export const getDailySales: ChatTool<typeof dailySalesParams, DailySalesRow[]> = {
  name: "getDailySales",
  description:
    "Aggregates Otter's daily summaries to give gross / net / fees / tax / tips / order-count for an owner-scoped slice of stores and a date range. Default groupBy is 'day'. To compare two periods, call this tool twice with different dateRanges and compute the delta in the answer.",
  parameters: dailySalesParams,
  async execute(args, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    const { from, to } = parseDateRange(args.dateRange)

    const groupKey = args.groupBy ?? "day"
    const byField =
      groupKey === "day"
        ? "date"
        : groupKey === "platform"
          ? "platform"
          : "paymentMethod"

    const grouped = await ctx.prisma.otterDailySummary.groupBy({
      by: [byField as "date" | "platform" | "paymentMethod"],
      where: {
        storeId: { in: storeIds },
        date: { gte: from, lte: to },
      },
      _sum: {
        fpGrossSales: true,
        tpGrossSales: true,
        fpNetSales: true,
        tpNetSales: true,
        fpFees: true,
        tpFees: true,
        fpTaxCollected: true,
        tpTaxCollected: true,
        fpTips: true,
        tpTipForRestaurant: true,
        fpOrderCount: true,
        tpOrderCount: true,
      },
      orderBy:
        groupKey === "day"
          ? [{ date: "asc" }]
          : undefined,
    })

    return grouped.map((row): DailySalesRow => {
      const s = row._sum
      const gross = (s.fpGrossSales ?? 0) + (s.tpGrossSales ?? 0)
      const net = (s.fpNetSales ?? 0) + (s.tpNetSales ?? 0)
      const fees = (s.fpFees ?? 0) + (s.tpFees ?? 0)
      const tax = (s.fpTaxCollected ?? 0) + (s.tpTaxCollected ?? 0)
      const tips = (s.fpTips ?? 0) + (s.tpTipForRestaurant ?? 0)
      const count = (s.fpOrderCount ?? 0) + (s.tpOrderCount ?? 0)

      const out: DailySalesRow = { gross, net, fees, tax, tips, count }
      if (groupKey === "day") {
        out.date = ymd(row.date as Date)
      } else if (groupKey === "platform") {
        out.platform = row.platform as string
      } else {
        out.paymentMethod = row.paymentMethod as string
      }
      return out
    })
  },
}

const hourlyTrendParams = z
  .object({
    storeIds: storeIdsSchema,
    dateRange: dateRangeSchema,
    dayOfWeek: z
      .number()
      .int()
      .min(0)
      .max(6)
      .optional()
      .describe("0=Sunday … 6=Saturday. Filters the date range to one weekday."),
  })
  .strict()

export type HourlyTrendRow = {
  hour: number
  count: number
  netSales: number
}

export const getHourlyTrend: ChatTool<
  typeof hourlyTrendParams,
  HourlyTrendRow[]
> = {
  name: "getHourlyTrend",
  description:
    "Hour-of-day order volume + net sales rolled across the date range. Use this for 'what hour are we busiest?' / 'how does Saturday morning look?' style questions. Pass dayOfWeek to isolate one weekday.",
  parameters: hourlyTrendParams,
  async execute(args, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    const { from, to } = parseDateRange(args.dateRange)

    const rows = await ctx.prisma.otterHourlySummary.findMany({
      where: {
        storeId: { in: storeIds },
        date: { gte: from, lte: to },
      },
      select: { date: true, hour: true, orderCount: true, netSales: true },
    })

    const byHour = new Map<number, { count: number; netSales: number }>()
    for (const r of rows) {
      if (
        args.dayOfWeek !== undefined &&
        (r.date as Date).getUTCDay() !== args.dayOfWeek
      ) {
        continue
      }
      const cur = byHour.get(r.hour) ?? { count: 0, netSales: 0 }
      cur.count += r.orderCount
      cur.netSales += r.netSales
      byHour.set(r.hour, cur)
    }

    return Array.from(byHour.entries())
      .map(([hour, v]) => ({ hour, count: v.count, netSales: v.netSales }))
      .sort((a, b) => a.hour - b.hour)
  },
}

const compareSalesParams = z
  .object({
    storeIds: storeIdsSchema,
    periodA: dateRangeSchema.describe(
      "First period (typically the more recent / current one).",
    ),
    periodB: dateRangeSchema.describe(
      "Second period to compare against (typically the prior / baseline one).",
    ),
  })
  .strict()

export type CompareSalesPeriodTotals = {
  label: "A" | "B"
  from: string
  to: string
  gross: number
  net: number
  fees: number
  tax: number
  tips: number
  count: number
}

export type CompareSalesResult = {
  periodA: CompareSalesPeriodTotals
  periodB: CompareSalesPeriodTotals
  delta: {
    gross: number
    net: number
    count: number
    /** Decimal change relative to period B's net sales (A.net - B.net) / B.net. Null when B.net is 0. */
    netPctChange: number | null
  }
}

async function totalsFor(
  ctx: { ownerId: string; prisma: import("@/generated/prisma/client").PrismaClient },
  storeIds: string[],
  range: { from: Date; to: Date },
): Promise<Omit<CompareSalesPeriodTotals, "label" | "from" | "to">> {
  const grouped = await ctx.prisma.otterDailySummary.groupBy({
    by: ["storeId"],
    where: {
      storeId: { in: storeIds },
      date: { gte: range.from, lte: range.to },
    },
    _sum: {
      fpGrossSales: true,
      tpGrossSales: true,
      fpNetSales: true,
      tpNetSales: true,
      fpFees: true,
      tpFees: true,
      fpTaxCollected: true,
      tpTaxCollected: true,
      fpTips: true,
      tpTipForRestaurant: true,
      fpOrderCount: true,
      tpOrderCount: true,
    },
  })
  let gross = 0
  let net = 0
  let fees = 0
  let tax = 0
  let tips = 0
  let count = 0
  for (const row of grouped) {
    const s = row._sum
    gross += (s.fpGrossSales ?? 0) + (s.tpGrossSales ?? 0)
    net += (s.fpNetSales ?? 0) + (s.tpNetSales ?? 0)
    fees += (s.fpFees ?? 0) + (s.tpFees ?? 0)
    tax += (s.fpTaxCollected ?? 0) + (s.tpTaxCollected ?? 0)
    tips += (s.fpTips ?? 0) + (s.tpTipForRestaurant ?? 0)
    count += (s.fpOrderCount ?? 0) + (s.tpOrderCount ?? 0)
  }
  return { gross, net, fees, tax, tips, count }
}

export const compareSales: ChatTool<typeof compareSalesParams, CompareSalesResult> = {
  name: "compareSales",
  description:
    "Compares two date ranges side-by-side, returning gross / net / fees / tax / tips / order-count totals for each plus the delta. Use this for 'this week vs last week', 'March vs February', 'last Saturday vs the Saturday before'. The model can also compose two getDailySales calls — compareSales is the cheaper, single-shot path.",
  parameters: compareSalesParams,
  async execute(args, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    const a = parseDateRange(args.periodA)
    const b = parseDateRange(args.periodB)
    const [totA, totB] = await Promise.all([
      totalsFor(ctx, storeIds, a),
      totalsFor(ctx, storeIds, b),
    ])
    const netPctChange = totB.net !== 0 ? (totA.net - totB.net) / totB.net : null
    return {
      periodA: { label: "A", from: ymd(a.from), to: ymd(a.to), ...totA },
      periodB: { label: "B", from: ymd(b.from), to: ymd(b.to), ...totB },
      delta: {
        gross: totA.gross - totB.gross,
        net: totA.net - totB.net,
        count: totA.count - totB.count,
        netPctChange,
      },
    }
  },
}
