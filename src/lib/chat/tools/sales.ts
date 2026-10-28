import { z } from "zod"
import {
  dateRangeSchema,
  parseDateRange,
  resolveStoreIds,
  storeIdsSchema,
  ymd,
} from "./_shared"
import type { ChatTool, ChatToolContext } from "./types"
import { rowSales, summarySlices } from "@/lib/pnl"
import {
  loadOrderFeeGroups,
  totalCommission,
  type OrderFeeGroup,
  type SalesSlice,
  type StoreCommissionRates,
} from "@/lib/counter/commission"

/*
 * ONE DEFINITION OF SALES, ONE OF COMMISSION — the dashboard's.
 *
 * `net` is the statement's Net sales (`rowSales` in `@/lib/pnl`: gross +
 * service charges + discounts + refunds, tax excluded), not Otter's
 * `fpNetSales + tpNetSales`. `gross` is before discounts and refunds. `fees`
 * is the one commission function (`@/lib/counter/commission`): recorded
 * marketplace fees plus the store-rate estimate for orders without one — the
 * figure the P&L's commission lines print — not Otter's `fpFees + tpFees`.
 */

const SUMMARY_SUMS = {
  fpGrossSales: true,
  tpGrossSales: true,
  fpDiscounts: true,
  tpDiscounts: true,
  fpServiceCharges: true,
  tpServiceCharges: true,
  tpRefundsAdjustments: true,
  fpTaxCollected: true,
  tpTaxCollected: true,
  fpTips: true,
  tpTipForRestaurant: true,
  fpOrderCount: true,
  tpOrderCount: true,
} as const

type SummarySums = {
  [K in keyof typeof SUMMARY_SUMS]: number | null
}

function salesOf(platform: string, sums: SummarySums) {
  const r = rowSales({ platform, ...sums })
  return {
    gross: r.gross + r.serviceCharges,
    net: r.net,
    tax: r.tax,
    tips: (sums.fpTips ?? 0) + (sums.tpTipForRestaurant ?? 0),
    count: (sums.fpOrderCount ?? 0) + (sums.tpOrderCount ?? 0),
  }
}

async function commissionContext(
  ctx: ChatToolContext,
  storeIds: string[],
  from: Date,
  to: Date,
): Promise<{
  groups: OrderFeeGroup[]
  rates: Map<string, StoreCommissionRates>
  slices: SalesSlice[]
}> {
  const [groups, stores, daily] = await Promise.all([
    loadOrderFeeGroups(
      { accountId: ctx.accountId, storeIds, startDate: from, endDate: to },
      ctx.prisma,
    ),
    ctx.prisma.store.findMany({
      where: { id: { in: storeIds }, accountId: ctx.accountId },
      select: {
        id: true,
        uberCommissionRate: true,
        doordashCommissionRate: true,
        uberPickupCommissionRate: true,
        doordashPickupCommissionRate: true,
        grubhubCommissionRate: true,
      },
    }),
    // Per store/day/platform, so days whose order rows are missing or thin
    // are priced off the summary's sales (see `cellsOf` in commission-core).
    ctx.prisma.otterDailySummary.groupBy({
      by: ["storeId", "date", "platform"],
      where: { storeId: { in: storeIds }, date: { gte: from, lte: to } },
      _sum: SUMMARY_SUMS,
    }),
  ])
  const slices = summarySlices(
    (daily ?? []).map((d) => ({
      storeId: d.storeId as string,
      date: d.date as Date,
      platform: d.platform as string,
      ...(d._sum as SummarySums),
    })),
  )
  return { groups, rates: new Map(stores.map((s) => [s.id, s])), slices }
}

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
  /** Gross sales before discounts and refunds (channel sales + service charges). Tax excluded. */
  gross: number
  /** Net sales — the P&L's: gross less discounts and refunds. Tax excluded. */
  net: number
  /**
   * Marketplace commission (recorded + estimated at the store's rate), the
   * P&L's figure. `null` when grouped by payment method — commission is not
   * split by tender — or when nothing could be priced.
   */
  fees: number | null
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
    "Aggregates Otter's daily summaries to give gross / net / fees / tax / tips / order-count for an owner-scoped slice of stores and a date range. Default groupBy is 'day'. Use groupBy='paymentMethod' for cash vs card split on first-party sales. For two-period comparisons, prefer compareSales first, then add this if a daily or payment-method breakdown is needed.",
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

    const [grouped, fee] = await Promise.all([
      ctx.prisma.otterDailySummary.groupBy({
        // Platform always rides along: which gross column counts (fp or tp)
        // depends on it, so it cannot be summed away first.
        by: (byField === "platform" ? ["platform"] : [byField, "platform"]) as Array<
          "date" | "platform" | "paymentMethod"
        >,
        where: {
          storeId: { in: storeIds },
          date: { gte: from, lte: to },
        },
        _sum: SUMMARY_SUMS,
      }),
      commissionContext(ctx, storeIds, from, to),
    ])

    const out = new Map<string, DailySalesRow>()
    for (const row of grouped) {
      const key =
        groupKey === "day"
          ? ymd(row.date as Date)
          : groupKey === "platform"
            ? (row.platform as string)
            : (row.paymentMethod as string)
      const v = salesOf(row.platform as string, row._sum as SummarySums)
      const cur = out.get(key) ?? { gross: 0, net: 0, fees: null, tax: 0, tips: 0, count: 0 }
      cur.gross += v.gross
      cur.net += v.net
      cur.tax += v.tax
      cur.tips += v.tips
      cur.count += v.count
      if (groupKey === "day") cur.date = key
      else if (groupKey === "platform") cur.platform = key
      else cur.paymentMethod = key
      out.set(key, cur)
    }
    if (groupKey !== "paymentMethod") {
      for (const [key, r] of out) {
        r.fees = totalCommission(
          fee.groups,
          fee.rates,
          (g) => (groupKey === "day" ? g.day === key : g.platform === key),
          fee.slices,
        ).amount
      }
    }
    const rows = [...out.values()]
    if (groupKey === "day") rows.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
    return rows
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
  /** Marketplace commission, the P&L's figure. `null` when nothing could be priced. */
  fees: number | null
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
  ctx: ChatToolContext,
  storeIds: string[],
  range: { from: Date; to: Date },
): Promise<Omit<CompareSalesPeriodTotals, "label" | "from" | "to">> {
  const [grouped, fee] = await Promise.all([
    ctx.prisma.otterDailySummary.groupBy({
      by: ["platform"],
      where: {
        storeId: { in: storeIds },
        date: { gte: range.from, lte: range.to },
      },
      _sum: SUMMARY_SUMS,
    }),
    commissionContext(ctx, storeIds, range.from, range.to),
  ])
  let gross = 0
  let net = 0
  let tax = 0
  let tips = 0
  let count = 0
  for (const row of grouped) {
    const v = salesOf(row.platform, row._sum as SummarySums)
    gross += v.gross
    net += v.net
    tax += v.tax
    tips += v.tips
    count += v.count
  }
  const fees = totalCommission(fee.groups, fee.rates, undefined, fee.slices).amount
  return { gross, net, fees, tax, tips, count }
}

export const compareSales: ChatTool<typeof compareSalesParams, CompareSalesResult> = {
  name: "compareSales",
  description:
    "Compares two date ranges side-by-side, returning gross / net / fees / tax / tips / order-count totals for each plus the delta. Use this only when the user asks for a comparison: 'today vs the same day last week', 'this week vs last week', 'March vs February', or 'last Saturday vs the Saturday before'. Do not use this for a single-period question like 'what were sales last week?'. Add getDailySales for the current period when the trace needs a concrete daily row.",
  parameters: compareSalesParams,
  async execute(args, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    const a = parseDateRange(args.periodA)
    const b = parseDateRange(args.periodB)
    const [totA, totB] = await Promise.all([
      totalsFor(ctx, storeIds, a),
      totalsFor(ctx, storeIds, b),
    ])
    // `> 0`, not `!== 0`. A comparison period whose net sales came out
    // negative — a week of refunds against an earlier range, a correction
    // posted late — divides by a negative number, and the percentage change
    // comes back with its sign flipped: the model then reports a recovery as
    // a collapse. There is no meaningful percentage change from a negative
    // base, so it is withheld the same way a zero base is.
    const netPctChange = totB.net > 0 ? (totA.net - totB.net) / totB.net : null
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
