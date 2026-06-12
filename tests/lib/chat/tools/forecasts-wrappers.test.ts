// Contract tests for the 10 chat tools that wrap forecast server actions.
// Each wrapper: calls the action, returns {ok:false,error:"no_session"} on a
// null result, propagates {ok:false,error} unchanged, and maps result.data
// into a flat chat payload with YYYY-MM-DD date strings. These tests pin
// that mapping so the forecasts.ts split can't drift it — they import from
// the original path, which becomes the re-export shim after the split.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { z } from "zod"

vi.mock("@/lib/chat/owner-scope", () => ({
  assertOwnerOwnsStores: vi.fn(),
  listOwnerStores: vi.fn(),
  renderStoreListForPrompt: vi.fn(),
}))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))

vi.mock("@/app/actions/forecasts/food-cost-forecast-actions", () => ({ getFoodCostForecast: vi.fn() }))
vi.mock("@/app/actions/forecasts/labor-staffing-actions", () => ({ getLaborStaffingForecast: vi.fn() }))
vi.mock("@/app/actions/forecasts/menu-engineering-actions", () => ({ getMenuEngineering: vi.fn() }))
vi.mock("@/app/actions/forecasts/lost-sales-actions", () => ({ getLostSales: vi.fn() }))
vi.mock("@/app/actions/forecasts/cash-position-actions", () => ({ getCashPositionForecast: vi.fn() }))
vi.mock("@/app/actions/forecasts/vendor-reliability-actions", () => ({ getVendorReliability: vi.fn() }))
vi.mock("@/app/actions/forecasts/promo-roi-actions", () => ({ getPromoRoi: vi.fn() }))
vi.mock("@/app/actions/forecasts/launch-trajectory-actions", () => ({ getLaunchTrajectory: vi.fn() }))
vi.mock("@/app/actions/forecasts/channel-mix-actions", () => ({ getChannelMix: vi.fn() }))
vi.mock("@/app/actions/forecasts/waste-cluster-actions", () => ({ getWasteRootCauses: vi.fn() }))

import { getFoodCostForecast } from "@/app/actions/forecasts/food-cost-forecast-actions"
import { getLaborStaffingForecast } from "@/app/actions/forecasts/labor-staffing-actions"
import { getMenuEngineering } from "@/app/actions/forecasts/menu-engineering-actions"
import { getLostSales } from "@/app/actions/forecasts/lost-sales-actions"
import { getCashPositionForecast } from "@/app/actions/forecasts/cash-position-actions"
import { getVendorReliability } from "@/app/actions/forecasts/vendor-reliability-actions"
import { getPromoRoi } from "@/app/actions/forecasts/promo-roi-actions"
import { getLaunchTrajectory } from "@/app/actions/forecasts/launch-trajectory-actions"
import { getChannelMix } from "@/app/actions/forecasts/channel-mix-actions"
import { getWasteRootCauses } from "@/app/actions/forecasts/waste-cluster-actions"

import {
  getFoodCostForecastTool,
  getLaborStaffingForecastTool,
  getMenuEngineeringTool,
  getLostSalesTool,
  getCashPositionForecastTool,
  getVendorReliabilityTool,
  getPromoRoiTool,
  getLaunchTrajectoryTool,
  getChannelMixTool,
  getWasteRootCausesTool,
} from "@/lib/chat/tools/forecasts"
import type { ChatToolContext } from "@/lib/chat/tools/types"

const ctx: ChatToolContext = { ownerId: "u1", accountId: "acct-A", prisma: {} as never }
const ymdString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

beforeEach(() => {
  vi.clearAllMocks()
})

// Every wrapper shares the same two error contracts.
const errorCases: Array<{
  name: string
  action: ReturnType<typeof vi.fn>
  run: () => Promise<unknown>
}> = [
  { name: "getFoodCostForecastTool", action: vi.mocked(getFoodCostForecast), run: () => getFoodCostForecastTool.execute({ storeId: "s1", horizonDays: 7 }, ctx) },
  { name: "getLaborStaffingForecastTool", action: vi.mocked(getLaborStaffingForecast), run: () => getLaborStaffingForecastTool.execute({ storeId: "s1", horizonDays: 7 }, ctx) },
  { name: "getMenuEngineeringTool", action: vi.mocked(getMenuEngineering), run: () => getMenuEngineeringTool.execute({ lookbackDays: 30, limit: 20 }, ctx) },
  { name: "getLostSalesTool", action: vi.mocked(getLostSales), run: () => getLostSalesTool.execute({ lookbackDays: 60, minBaselineQty: 3, minGapDays: 2 }, ctx) },
  { name: "getCashPositionForecastTool", action: vi.mocked(getCashPositionForecast), run: () => getCashPositionForecastTool.execute({ horizonDays: 14 }, ctx) },
  { name: "getVendorReliabilityTool", action: vi.mocked(getVendorReliability), run: () => getVendorReliabilityTool.execute({ lookbackDays: 180, limit: 20 }, ctx) },
  { name: "getPromoRoiTool", action: vi.mocked(getPromoRoi), run: () => getPromoRoiTool.execute({ lookbackDays: 90, limit: 10 }, ctx) },
  { name: "getLaunchTrajectoryTool", action: vi.mocked(getLaunchTrajectory), run: () => getLaunchTrajectoryTool.execute({ recentDays: 60, limit: 10 }, ctx) },
  { name: "getChannelMixTool", action: vi.mocked(getChannelMix), run: () => getChannelMixTool.execute({ lookbackDays: 90, shiftPct: 0.1 }, ctx) },
  { name: "getWasteRootCausesTool", action: vi.mocked(getWasteRootCauses), run: () => getWasteRootCausesTool.execute({ lookbackWeeks: 12, limit: 25 }, ctx) },
]

describe("wrapper error contracts (all 10 tools)", () => {
  for (const c of errorCases) {
    it(`${c.name}: null action result -> {ok:false, error:"no_session"}`, async () => {
      c.action.mockResolvedValue(null as never)
      expect(await c.run()).toEqual({ ok: false, error: "no_session" })
    })

    it(`${c.name}: action {ok:false} propagates the error string unchanged`, async () => {
      c.action.mockResolvedValue({ ok: false, error: "store_not_found" } as never)
      expect(await c.run()).toEqual({ ok: false, error: "store_not_found" })
    })
  }
})

describe("getFoodCostForecastTool", () => {
  it("maps action data into the chat shape with YYYY-MM-DD days", async () => {
    vi.mocked(getFoodCostForecast).mockResolvedValue({
      ok: true,
      data: {
        storeId: "s1",
        generatedAt: new Date("2026-06-10T05:00:00Z"),
        blendedFoodCostPct: 0.31,
        totalPredictedRevenue: 70000,
        totalPredictedFoodCost: 21700,
        days: [
          { date: new Date("2026-06-12T00:00:00Z"), predictedRevenue: 10000, predictedFoodCost: 3100, foodCostPct: 0.31, pctP10: 0.28, pctP90: 0.34, unmappedItemCount: 2 },
        ],
      },
    } as never)

    const result = await getFoodCostForecastTool.execute({ storeId: "s1", horizonDays: 7 }, ctx)
    const schema = z.object({
      storeId: z.literal("s1"),
      generatedAt: z.string(),
      blendedFoodCostPct: z.number(),
      totalPredictedRevenue: z.number(),
      totalPredictedFoodCost: z.number(),
      days: z.array(
        z.object({
          date: ymdString,
          predictedRevenue: z.number(),
          predictedFoodCost: z.number(),
          foodCostPct: z.number(),
          pctP10: z.number(),
          pctP90: z.number(),
          unmappedItemCount: z.number(),
        }),
      ),
    })
    const parsed = schema.parse(result)
    expect(parsed.days[0].date).toBe("2026-06-12")
    expect(vi.mocked(getFoodCostForecast)).toHaveBeenCalledWith({ storeId: "s1", horizonDays: 7 })
  })

  it("passes through a null generatedAt", async () => {
    vi.mocked(getFoodCostForecast).mockResolvedValue({
      ok: true,
      data: { storeId: "s1", generatedAt: null, blendedFoodCostPct: null, totalPredictedRevenue: 0, totalPredictedFoodCost: 0, days: [] },
    } as never)
    const result = await getFoodCostForecastTool.execute({ storeId: "s1", horizonDays: 7 }, ctx)
    expect(result).toMatchObject({ generatedAt: null, blendedFoodCostPct: null, days: [] })
  })
})

describe("getLaborStaffingForecastTool", () => {
  it("renames totalForecastLaborHours and drops closed hours (staff=0) from hourlyStaff", async () => {
    vi.mocked(getLaborStaffingForecast).mockResolvedValue({
      ok: true,
      data: {
        storeId: "s1",
        meanAvgTicket: 24.5,
        coversPerStaffHour: 6,
        minStaff: 2,
        totalForecastLaborHours: 120,
        days: [
          {
            date: new Date("2026-06-12T00:00:00Z"),
            weekday: 5,
            predictedRevenue: 9000,
            predictedOrders: 360,
            totalLaborHours: 40,
            hours: [
              { hour: 3, recommendedStaff: 0, predictedOrders: 0 },
              { hour: 12, recommendedStaff: 4, predictedOrders: 50 },
            ],
          },
        ],
      },
    } as never)

    const result = await getLaborStaffingForecastTool.execute({ storeId: "s1", horizonDays: 7 }, ctx)
    expect(result).toMatchObject({
      storeId: "s1",
      meanAvgTicket: 24.5,
      coversPerStaffHour: 6,
      minStaff: 2,
      totalLaborHours: 120,
    })
    const day = (result as { days: Array<{ date: string; hourlyStaff: unknown[] }> }).days[0]
    expect(day.date).toBe("2026-06-12")
    expect(day.hourlyStaff).toEqual([{ hour: 12, staff: 4, predictedOrders: 50 }])
  })
})

describe("getMenuEngineeringTool", () => {
  const data = {
    windowStart: new Date("2026-05-13T00:00:00Z"),
    windowEnd: new Date("2026-06-12T00:00:00Z"),
    medianVelocity: 12,
    medianUnitMargin: 5.5,
    counts: { STAR: 1, PLOWHORSE: 1, PUZZLE: 0, DOG: 0 },
    totalContribution: 5000,
    rows: [
      { itemName: "Burger", category: "Mains", soldQty: 100, revenue: 1500, unitMargin: 8, totalContribution: 800, marginPct: 0.53, quadrant: "STAR" },
      { itemName: "Fries", category: "Sides", soldQty: 200, revenue: 800, unitMargin: 2, totalContribution: 400, marginPct: 0.5, quadrant: "PLOWHORSE" },
    ],
  }

  it("maps window dates to YYYY-MM-DD and keeps counts/rows", async () => {
    vi.mocked(getMenuEngineering).mockResolvedValue({ ok: true, data } as never)
    const result = await getMenuEngineeringTool.execute({ lookbackDays: 30, limit: 20 }, ctx)
    expect(result).toMatchObject({
      windowStart: "2026-05-13",
      windowEnd: "2026-06-12",
      counts: { STAR: 1, PLOWHORSE: 1, PUZZLE: 0, DOG: 0 },
    })
    expect((result as { rows: unknown[] }).rows).toHaveLength(2)
  })

  it("filters by quadrant and applies the limit", async () => {
    vi.mocked(getMenuEngineering).mockResolvedValue({ ok: true, data } as never)
    const result = await getMenuEngineeringTool.execute(
      { lookbackDays: 30, quadrant: "STAR", limit: 20 },
      ctx,
    )
    const rows = (result as { rows: Array<{ itemName: string }> }).rows
    expect(rows.map((r) => r.itemName)).toEqual(["Burger"])
  })
})

describe("getLostSalesTool", () => {
  it("serializes gap windows and totals", async () => {
    vi.mocked(getLostSales).mockResolvedValue({
      ok: true,
      data: {
        windowStart: new Date("2026-04-13T00:00:00Z"),
        windowEnd: new Date("2026-06-12T00:00:00Z"),
        totalEstimatedLost: 920,
        events: [
          {
            storeId: "s1", itemName: "Wings", category: "Mains",
            gapStart: new Date("2026-06-01T00:00:00Z"), gapEnd: new Date("2026-06-04T00:00:00Z"),
            gapDays: 4, baselineDailyQty: 10, meanUnitPrice: 23, estimatedLostRevenue: 920,
          },
        ],
      },
    } as never)

    const result = await getLostSalesTool.execute({ lookbackDays: 60, minBaselineQty: 3, minGapDays: 2 }, ctx)
    expect(result).toMatchObject({ windowStart: "2026-04-13", windowEnd: "2026-06-12", totalEstimatedLost: 920 })
    expect((result as { events: unknown[] }).events[0]).toMatchObject({
      gapStart: "2026-06-01",
      gapEnd: "2026-06-04",
      estimatedLostRevenue: 920,
    })
  })
})

describe("getCashPositionForecastTool", () => {
  const day = (date: string, cumulativeNet: number) => ({
    date: new Date(`${date}T00:00:00Z`),
    predictedRevenue: 1000,
    estimatedNetInflow: 800,
    scheduledPayables: 500,
    proRatedFixedCosts: 300,
    netCashFlow: 0,
    cumulativeNet,
  })
  const base = {
    horizonDays: 14,
    blendedCommissionRate: 0.2,
    proRatedFixedDaily: 300,
    totalScheduledPayables: 7000,
    totalEstimatedInflow: 11200,
    endingCumulativeNet: 4200,
  }

  it("computes goesNegativeOn from the first day cumulativeNet < 0", async () => {
    vi.mocked(getCashPositionForecast).mockResolvedValue({
      ok: true,
      data: { ...base, days: [day("2026-06-12", 100), day("2026-06-13", -50), day("2026-06-14", -20)] },
    } as never)
    const result = await getCashPositionForecastTool.execute({ horizonDays: 14 }, ctx)
    expect(result).toMatchObject({ goesNegativeOn: "2026-06-13", blendedCommissionRate: 0.2 })
    expect((result as { days: Array<{ date: string }> }).days[0].date).toBe("2026-06-12")
  })

  it("returns null goesNegativeOn when cumulative cash never dips below zero", async () => {
    vi.mocked(getCashPositionForecast).mockResolvedValue({
      ok: true,
      data: { ...base, days: [day("2026-06-12", 100), day("2026-06-13", 200)] },
    } as never)
    const result = await getCashPositionForecastTool.execute({ horizonDays: 14 }, ctx)
    expect(result).toMatchObject({ goesNegativeOn: null })
  })
})

describe("getVendorReliabilityTool", () => {
  const rows = [
    { vendorName: "Sysco", invoiceCount: 40, spend6mo: 50000, meanLeadDays: 7, leadCV: 0.1, monthlyTotalCV: 0.2, priceVolatility: 0.05, reliabilityScore: 88, band: "high" },
    { vendorName: "Patchy Produce", invoiceCount: 12, spend6mo: 8000, meanLeadDays: 9, leadCV: 0.6, monthlyTotalCV: 0.5, priceVolatility: 0.3, reliabilityScore: 41, band: "low" },
  ]

  it("returns mapped rows and respects the band filter + limit", async () => {
    vi.mocked(getVendorReliability).mockResolvedValue({ ok: true, data: { rows } } as never)
    const all = await getVendorReliabilityTool.execute({ lookbackDays: 180, limit: 20 }, ctx)
    expect(all).toHaveLength(2)

    vi.mocked(getVendorReliability).mockResolvedValue({ ok: true, data: { rows } } as never)
    const lowOnly = await getVendorReliabilityTool.execute({ lookbackDays: 180, band: "low", limit: 20 }, ctx)
    expect(lowOnly).toEqual([expect.objectContaining({ vendorName: "Patchy Produce", band: "low" })])
  })
})

describe("getPromoRoiTool", () => {
  it("serializes window + event dates and applies the event limit", async () => {
    const event = (date: string) => ({
      date: new Date(`${date}T00:00:00Z`), weekday: 5, netSales: 5000, baselineNetSales: 4000,
      baselineSampleSize: 8, discount: 400, discountPct: 0.08, lift: 1000,
      liftCI80Low: 600, liftCI80High: 1400, roi: 2.5,
    })
    vi.mocked(getPromoRoi).mockResolvedValue({
      ok: true,
      data: {
        windowStart: new Date("2026-03-14T00:00:00Z"),
        windowEnd: new Date("2026-06-12T00:00:00Z"),
        totalLift: 2000, totalDiscount: 800, blendedRoi: 2.5,
        events: [event("2026-06-01"), event("2026-06-02")],
      },
    } as never)

    const result = await getPromoRoiTool.execute({ lookbackDays: 90, limit: 1 }, ctx)
    expect(result).toMatchObject({ windowStart: "2026-03-14", windowEnd: "2026-06-12", blendedRoi: 2.5 })
    const events = (result as { events: Array<{ date: string }> }).events
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ date: "2026-06-01", roi: 2.5 })
  })
})

describe("getLaunchTrajectoryTool", () => {
  it("flattens projections and nulls them for launches younger than 7 days", async () => {
    vi.mocked(getLaunchTrajectory).mockResolvedValue({
      ok: true,
      data: {
        launches: [
          {
            storeId: "s1", category: "Mains", itemName: "Smash Burger",
            firstSaleDate: new Date("2026-05-20T00:00:00Z"), daysSinceLaunch: 23,
            totalQty: 300, totalRevenue: 4500, meanUnitPrice: 15,
            projection: { meanDailyQtyTrailing7: 14, projectedQty90d: 1260, projectedQtyCI80Low: 900, projectedQtyCI80High: 1600 },
          },
          {
            storeId: "s1", category: "Sides", itemName: "New Slaw",
            firstSaleDate: new Date("2026-06-09T00:00:00Z"), daysSinceLaunch: 3,
            totalQty: 20, totalRevenue: 120, meanUnitPrice: 6,
            projection: null,
          },
        ],
      },
    } as never)

    const result = await getLaunchTrajectoryTool.execute({ recentDays: 60, limit: 10 }, ctx)
    expect(result).toHaveLength(2)
    expect(result).toMatchObject([
      { itemName: "Smash Burger", firstSaleDate: "2026-05-20", projectedQty90d: 1260 },
      { itemName: "New Slaw", firstSaleDate: "2026-06-09", meanDailyQtyTrailing7: null, projectedQty90d: null },
    ])
  })
})

describe("getChannelMixTool", () => {
  it("maps rows and passes the simulation through untouched", async () => {
    const simulation = {
      shiftPct: 0.1, fromPlatform: "ubereats", toPlatform: "css-pos",
      shiftedGross: 1200, incrementalNet: 280, newBlendedNetRatePct: 0.81, oldBlendedNetRatePct: 0.79,
    }
    vi.mocked(getChannelMix).mockResolvedValue({
      ok: true,
      data: {
        windowStart: new Date("2026-03-14T00:00:00Z"),
        windowEnd: new Date("2026-06-12T00:00:00Z"),
        totalGross: 100000, totalFees: 21000, totalNet: 79000, blendedNetRatePct: 0.79,
        rows: [
          { platform: "css-pos", isFirstParty: true, grossSales: 60000, fees: 3000, netToOperator: 57000, takeRatePct: 0.05, netRatePct: 0.95, orderCount: 2400, meanTicket: 25, shareOfGross: 0.6 },
        ],
        simulation,
      },
    } as never)

    const result = await getChannelMixTool.execute({ lookbackDays: 90, shiftPct: 0.1 }, ctx)
    expect(result).toMatchObject({
      windowStart: "2026-03-14",
      windowEnd: "2026-06-12",
      blendedNetRatePct: 0.79,
      simulation,
    })
    expect((result as { rows: unknown[] }).rows[0]).toMatchObject({ platform: "css-pos", netRatePct: 0.95 })
  })
})

describe("getWasteRootCausesTool", () => {
  const row = (ingredientName: string, label: string) => ({
    storeId: "s1", ingredientName, defaultUnit: "lb", weeklyThroughput: 50, sampleSize: 10,
    annualizedDollarExposure: 2600,
    classification: {
      label, meanResidual: -3.1, meanResidualPctOfThroughput: -0.06,
      expiryAdjustments: 0, theftAdjustments: 0, rationale: "overuse with no logged adjustments",
    },
  })

  it("flattens classification fields onto the row and filters by label", async () => {
    vi.mocked(getWasteRootCauses).mockResolvedValue({
      ok: true,
      data: { summary: { theft_or_unrecorded: 1, expiry_driven: 1 }, rows: [row("Cheese", "theft_or_unrecorded"), row("Lettuce", "expiry_driven")] },
    } as never)

    const result = await getWasteRootCausesTool.execute(
      { lookbackWeeks: 12, limit: 25, label: "theft_or_unrecorded" },
      ctx,
    )
    expect(result).toMatchObject({ summary: { theft_or_unrecorded: 1, expiry_driven: 1 } })
    const rows = (result as { rows: Array<Record<string, unknown>> }).rows
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      ingredientName: "Cheese",
      label: "theft_or_unrecorded",
      meanResidual: -3.1,
      rationale: "overuse with no logged adjustments",
      annualizedDollarExposure: 2600,
    })
  })
})
