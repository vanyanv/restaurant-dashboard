// Cost & margin chat tools — thin wrappers over the auth-checked forecast
// server actions (food cost %, budgeted labor staffing, menu engineering).

import { z } from "zod"
import { ymd } from "../_shared"
import type { ChatTool } from "../types"
import { getFoodCostForecast } from "@/app/actions/forecasts/food-cost-forecast-actions"
import { getLaborStaffingForecast } from "@/app/actions/forecasts/labor-staffing-actions"
import { getMenuEngineering } from "@/app/actions/forecasts/menu-engineering-actions"

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
      storeId: d.storeId ?? args.storeId,
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
      storeId: d.storeId ?? args.storeId,
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
