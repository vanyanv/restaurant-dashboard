// Opportunity-detection chat tools — historical signal miners (86'd-item
// lost sales, inferred promo ROI, new-item launch trajectories), each a
// thin wrapper over the auth-checked forecast server actions.

import { z } from "zod"
import type { ChatTool } from "../types"
import { getLostSales } from "@/app/actions/forecasts/lost-sales-actions"
import { getPromoRoi } from "@/app/actions/forecasts/promo-roi-actions"
import { getLaunchTrajectory } from "@/app/actions/forecasts/launch-trajectory-actions"

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
// getPromoRoi (F17 chat tool)
// ---------------------------------------------------------------------------

const promoRoiParams = z
  .object({
    storeId: z
      .string()
      .min(1)
      .optional()
      .describe("Omit to roll across every store in the account."),
    lookbackDays: z.number().int().min(14).max(365).optional().default(90),
    limit: z.number().int().min(1).max(50).optional().default(10),
  })
  .strict()

export type PromoRoiChatEvent = {
  date: string
  weekday: number
  netSales: number
  baselineNetSales: number
  baselineSampleSize: number
  discount: number
  discountPct: number
  lift: number
  liftCI80Low: number
  liftCI80High: number
  roi: number | null
}

export type PromoRoiChatResult = {
  windowStart: string
  windowEnd: string
  totalLift: number
  totalDiscount: number
  blendedRoi: number | null
  events: PromoRoiChatEvent[]
}

export const getPromoRoiTool: ChatTool<
  typeof promoRoiParams,
  PromoRoiChatResult | { ok: false; error: string }
> = {
  name: "getPromoRoi",
  description:
    "Returns historical promotion ROI events. We don't have an explicit Promotion entity, so this infers promo days from elevated daily discount-to-gross-sales share in OtterDailySummary, then compares actual net sales against same-weekday non-promo baseline. roi is lift_dollars / discount_dollars (e.g. 2.5× = $2.50 of lift per $1 of discount). Cannibalization is NOT computed (order-level signal only). State this is inferred, not from a campaigns table.",
  parameters: promoRoiParams,
  async execute(args, ctx) {
    const result = await getPromoRoi({
      storeId: args.storeId,
      lookbackDays: args.lookbackDays,
    })
    if (!result) return { ok: false, error: "no_session" }
    if (!result.ok) return { ok: false, error: result.error }
    void ctx
    const d = result.data
    return {
      windowStart: d.windowStart.toISOString().slice(0, 10),
      windowEnd: d.windowEnd.toISOString().slice(0, 10),
      totalLift: d.totalLift,
      totalDiscount: d.totalDiscount,
      blendedRoi: d.blendedRoi,
      events: d.events.slice(0, args.limit ?? 10).map((e) => ({
        date: e.date.toISOString().slice(0, 10),
        weekday: e.weekday,
        netSales: e.netSales,
        baselineNetSales: e.baselineNetSales,
        baselineSampleSize: e.baselineSampleSize,
        discount: e.discount,
        discountPct: e.discountPct,
        lift: e.lift,
        liftCI80Low: e.liftCI80Low,
        liftCI80High: e.liftCI80High,
        roi: e.roi,
      })),
    }
  },
}

// ---------------------------------------------------------------------------
// getLaunchTrajectory (F23 chat tool)
// ---------------------------------------------------------------------------

const launchTrajectoryParams = z
  .object({
    storeId: z
      .string()
      .min(1)
      .optional()
      .describe("Omit to roll across every store in the account."),
    recentDays: z
      .number()
      .int()
      .min(7)
      .max(180)
      .optional()
      .default(60)
      .describe("How recent the first sale must be to count as a launch."),
    limit: z.number().int().min(1).max(50).optional().default(10),
  })
  .strict()

export type LaunchTrajectoryChatRow = {
  storeId: string
  category: string
  itemName: string
  firstSaleDate: string
  daysSinceLaunch: number
  totalQty: number
  totalRevenue: number
  meanUnitPrice: number
  meanDailyQtyTrailing7: number | null
  projectedQty90d: number | null
  projectedQtyCI80Low: number | null
  projectedQtyCI80High: number | null
}

export const getLaunchTrajectoryTool: ChatTool<
  typeof launchTrajectoryParams,
  LaunchTrajectoryChatRow[] | { ok: false; error: string }
> = {
  name: "getLaunchTrajectory",
  description:
    "Detects newly-launched menu items (first sale in the last `recentDays` days, no prior sales in the 90 days before) and returns the daily-qty trajectory plus a 90-day projection. Projection extends the trailing 7-day mean qty forward — assumes no growth or decay. Items launched < 7 days ago return null projection. Sorted by total revenue desc. Don't claim the projection accounts for ramp-up; it doesn't.",
  parameters: launchTrajectoryParams,
  async execute(args, ctx) {
    const result = await getLaunchTrajectory({
      storeId: args.storeId,
      recentDays: args.recentDays,
    })
    if (!result) return { ok: false, error: "no_session" }
    if (!result.ok) return { ok: false, error: result.error }
    void ctx
    return result.data.launches.slice(0, args.limit ?? 10).map((l) => ({
      storeId: l.storeId,
      category: l.category,
      itemName: l.itemName,
      firstSaleDate: l.firstSaleDate.toISOString().slice(0, 10),
      daysSinceLaunch: l.daysSinceLaunch,
      totalQty: l.totalQty,
      totalRevenue: l.totalRevenue,
      meanUnitPrice: l.meanUnitPrice,
      meanDailyQtyTrailing7: l.projection?.meanDailyQtyTrailing7 ?? null,
      projectedQty90d: l.projection?.projectedQty90d ?? null,
      projectedQtyCI80Low: l.projection?.projectedQtyCI80Low ?? null,
      projectedQtyCI80High: l.projection?.projectedQtyCI80High ?? null,
    }))
  },
}
