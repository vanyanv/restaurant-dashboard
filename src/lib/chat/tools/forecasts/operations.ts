// Operations chat tools — cash position, vendor reliability, channel mix
// and waste root causes, each a thin wrapper over the auth-checked forecast
// server actions.

import { z } from "zod"
import type { ChatTool } from "../types"
import { getCashPositionForecast } from "@/app/actions/forecasts/cash-position-actions"
import { getVendorReliability } from "@/app/actions/forecasts/vendor-reliability-actions"
import { getChannelMix } from "@/app/actions/forecasts/channel-mix-actions"
import { getWasteRootCauses } from "@/app/actions/forecasts/waste-cluster-actions"

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

// ---------------------------------------------------------------------------
// getVendorReliability (chat tool)
// ---------------------------------------------------------------------------

const vendorReliabilityParams = z
  .object({
    lookbackDays: z.number().int().min(30).max(365).optional().default(180),
    band: z
      .enum(["high", "medium", "low", "insufficient_data"])
      .optional()
      .describe("Filter to one band. Omit for all rows."),
    limit: z.number().int().min(1).max(100).optional().default(20),
  })
  .strict()

export type VendorReliabilityChatRow = {
  vendorName: string
  invoiceCount: number
  spend6mo: number
  meanLeadDays: number | null
  leadCV: number | null
  monthlyTotalCV: number | null
  priceVolatility: number | null
  reliabilityScore: number
  band: "high" | "medium" | "low" | "insufficient_data"
}

export const getVendorReliabilityTool: ChatTool<
  typeof vendorReliabilityParams,
  VendorReliabilityChatRow[] | { ok: false; error: string }
> = {
  name: "getVendorReliability",
  description:
    "Per-vendor reliability over the last N days (default 180). Three metrics: lead-time CV (std/mean of inter-invoice gaps), price volatility (avg per-ingredient std of month-over-month price moves), monthly-total CV. Composite reliabilityScore is 0-100 (higher = more reliable). Bands: high (≥75), medium (≥50), low (<50), insufficient_data (<4 invoices in window). Sorted by 180-day spend desc.",
  parameters: vendorReliabilityParams,
  async execute(args, ctx) {
    const result = await getVendorReliability({
      lookbackDays: args.lookbackDays,
    })
    if (!result) return { ok: false, error: "no_session" }
    if (!result.ok) return { ok: false, error: result.error }
    void ctx
    const rows = args.band
      ? result.data.rows.filter((r) => r.band === args.band)
      : result.data.rows
    return rows.slice(0, args.limit ?? 20).map((r) => ({
      vendorName: r.vendorName,
      invoiceCount: r.invoiceCount,
      spend6mo: r.spend6mo,
      meanLeadDays: r.meanLeadDays,
      leadCV: r.leadCV,
      monthlyTotalCV: r.monthlyTotalCV,
      priceVolatility: r.priceVolatility,
      reliabilityScore: r.reliabilityScore,
      band: r.band,
    }))
  },
}

// ---------------------------------------------------------------------------
// getChannelMix (F24 chat tool)
// ---------------------------------------------------------------------------

const channelMixParams = z
  .object({
    storeId: z
      .string()
      .min(1)
      .optional()
      .describe("Omit to roll across every store in the account."),
    lookbackDays: z.number().int().min(7).max(365).optional().default(90),
    shiftPct: z
      .number()
      .min(0)
      .max(0.5)
      .optional()
      .default(0.1)
      .describe(
        "Fraction of worst-net-rate channel's gross hypothetically migrated to the best-net-rate channel for the simulation. 0.1 = 10%.",
      ),
  })
  .strict()

export type ChannelMixChatRow = {
  platform: string
  isFirstParty: boolean
  grossSales: number
  fees: number
  netToOperator: number
  takeRatePct: number | null
  netRatePct: number | null
  orderCount: number
  meanTicket: number | null
  shareOfGross: number
}

export type ChannelMixChatResult = {
  windowStart: string
  windowEnd: string
  totalGross: number
  totalFees: number
  totalNet: number
  blendedNetRatePct: number | null
  rows: ChannelMixChatRow[]
  simulation: {
    shiftPct: number
    fromPlatform: string
    toPlatform: string
    shiftedGross: number
    incrementalNet: number
    newBlendedNetRatePct: number
    oldBlendedNetRatePct: number
  } | null
}

export const getChannelMixTool: ChatTool<
  typeof channelMixParams,
  ChannelMixChatResult | { ok: false; error: string }
> = {
  name: "getChannelMix",
  description:
    "Returns per-platform gross / fees / net rate over the lookback window plus a directional shift simulation. Net rate = (gross - fees) / gross — what the operator keeps before COGS. Simulation answers 'what if X% of the worst-rate channel's gross sat on the best-rate channel instead' as a directional read on dollars left on the table at the current mix. NOT a recommendation to drop or push channels — operator interprets demand reality.",
  parameters: channelMixParams,
  async execute(args, ctx) {
    const result = await getChannelMix({
      storeId: args.storeId,
      lookbackDays: args.lookbackDays,
      shiftPct: args.shiftPct,
    })
    if (!result) return { ok: false, error: "no_session" }
    if (!result.ok) return { ok: false, error: result.error }
    void ctx
    const d = result.data
    return {
      windowStart: d.windowStart.toISOString().slice(0, 10),
      windowEnd: d.windowEnd.toISOString().slice(0, 10),
      totalGross: d.totalGross,
      totalFees: d.totalFees,
      totalNet: d.totalNet,
      blendedNetRatePct: d.blendedNetRatePct,
      rows: d.rows.map((r) => ({
        platform: r.platform,
        isFirstParty: r.isFirstParty,
        grossSales: r.grossSales,
        fees: r.fees,
        netToOperator: r.netToOperator,
        takeRatePct: r.takeRatePct,
        netRatePct: r.netRatePct,
        orderCount: r.orderCount,
        meanTicket: r.meanTicket,
        shareOfGross: r.shareOfGross,
      })),
      simulation: d.simulation,
    }
  },
}

// ---------------------------------------------------------------------------
// getWasteRootCauses (F29 chat tool)
// ---------------------------------------------------------------------------

const wasteClusterParams = z
  .object({
    storeId: z.string().min(1).optional(),
    lookbackWeeks: z.number().int().min(2).max(52).optional().default(12),
    limit: z.number().int().min(1).max(100).optional().default(25),
    label: z
      .enum([
        "insufficient_data",
        "stable_within_noise",
        "systematic_overuse",
        "systematic_underuse",
        "expiry_driven",
        "theft_or_unrecorded",
        "improving",
      ])
      .optional()
      .describe("Filter to one cluster label."),
  })
  .strict()

export type WasteClusterChatRow = {
  storeId: string
  ingredientName: string
  defaultUnit: string
  weeklyThroughput: number
  sampleSize: number
  label: string
  meanResidual: number
  meanResidualPctOfThroughput: number | null
  expiryAdjustments: number
  theftAdjustments: number
  annualizedDollarExposure: number | null
  rationale: string
}

export const getWasteRootCausesTool: ChatTool<
  typeof wasteClusterParams,
  | { rows: WasteClusterChatRow[]; summary: Record<string, number> }
  | { ok: false; error: string }
> = {
  name: "getWasteRootCauses",
  description:
    "Per-(store, ingredient) waste-residual cluster classification across the lookback window of completed counts. Labels: theft_or_unrecorded (high mean overuse with no logged expiry/theft), systematic_overuse (overuse with at least one logged adjustment), systematic_underuse, expiry_driven (high variance + ≥1 expiry adjustment), improving (residual magnitude shrinking), stable_within_noise, insufficient_data. Sorted by annualized dollar exposure desc. NEVER call out an individual person — 'theft_or_unrecorded' is a pattern label, not an accusation.",
  parameters: wasteClusterParams,
  async execute(args, ctx) {
    const result = await getWasteRootCauses({
      storeId: args.storeId,
      lookbackWeeks: args.lookbackWeeks,
    })
    if (!result) return { ok: false, error: "no_session" }
    if (!result.ok) return { ok: false, error: result.error }
    void ctx
    let rows = result.data.rows
    if (args.label) {
      rows = rows.filter((r) => r.classification.label === args.label)
    }
    return {
      summary: result.data.summary,
      rows: rows.slice(0, args.limit ?? 25).map((r) => ({
        storeId: r.storeId,
        ingredientName: r.ingredientName,
        defaultUnit: r.defaultUnit,
        weeklyThroughput: r.weeklyThroughput,
        sampleSize: r.sampleSize,
        label: r.classification.label,
        meanResidual: r.classification.meanResidual,
        meanResidualPctOfThroughput:
          r.classification.meanResidualPctOfThroughput,
        expiryAdjustments: r.classification.expiryAdjustments,
        theftAdjustments: r.classification.theftAdjustments,
        annualizedDollarExposure: r.annualizedDollarExposure,
        rationale: r.classification.rationale,
      })),
    }
  },
}
