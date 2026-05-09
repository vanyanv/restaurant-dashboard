// getFoodCostForecast — joins ForecastDailyRevenue × ForecastMenuItem ×
// OtterItemMapping × computeRecipeCost into a per-day food cost % forecast.
// Verifies dedup, mapping resolution, the unmapped item count, and the
// p10/p90 boundary math (high cost ÷ low revenue → worst pct).

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findUnique: vi.fn() },
    forecastDailyRevenue: { findMany: vi.fn() },
    forecastMenuItem: { findMany: vi.fn() },
    otterItemMapping: { findMany: vi.fn() },
  },
}))
vi.mock("@/lib/recipe-cost", () => ({
  computeRecipeCost: vi.fn(),
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { computeRecipeCost } from "@/lib/recipe-cost"
import { getFoodCostForecast } from "@/app/actions/forecasts/food-cost-forecast-actions"

const sessionWith = (overrides: Record<string, unknown> = {}) => ({
  user: { id: "u1", accountId: "acct-A", ...overrides },
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getFoodCostForecast", () => {
  it("returns null without a session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    expect(await getFoodCostForecast({ storeId: "s1" })).toBeNull()
  })

  it("rejects a cross-account store", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "S1",
      accountId: "acct-OTHER",
    } as never)
    expect(await getFoodCostForecast({ storeId: "s1" })).toEqual({
      ok: false,
      error: "store_not_in_account",
    })
  })

  it("computes per-day food cost % from forecasted qty × recipe cost ÷ predicted revenue", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "S1",
      accountId: "acct-A",
    } as never)
    const day1 = new Date("2026-05-09")
    const gen = new Date("2026-05-08T01:00:00Z")
    vi.mocked(prisma.forecastDailyRevenue.findMany).mockResolvedValue([
      { forecastDate: day1, predictedRevenue: 1000, p10: 800, p90: 1200, generatedAt: gen },
    ] as never)
    vi.mocked(prisma.forecastMenuItem.findMany).mockResolvedValue([
      { otterItemSkuId: "Burger", forecastDate: day1, predictedQty: 100, p10: 80, p90: 120, generatedAt: gen },
      { otterItemSkuId: "Fries", forecastDate: day1, predictedQty: 50, p10: 40, p90: 60, generatedAt: gen },
    ] as never)
    vi.mocked(prisma.otterItemMapping.findMany).mockResolvedValue([
      { otterItemName: "Burger", recipeId: "r-burger" },
      { otterItemName: "Fries", recipeId: "r-fries" },
    ] as never)
    vi.mocked(computeRecipeCost).mockImplementation((async (recipeId: string) => {
      const cost = recipeId === "r-burger" ? 2.5 : 1.0
      return { recipeId, itemName: recipeId, totalCost: cost, lines: [], partial: false }
    }) as never)

    const result = await getFoodCostForecast({ storeId: "s1", asOf: day1 })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.days).toHaveLength(1)
    const d = result.data.days[0]
    // food cost = 100*2.5 + 50*1.0 = 300; revenue = 1000; pct = 0.30
    expect(d.predictedFoodCost).toBeCloseTo(300, 5)
    expect(d.foodCostPct).toBeCloseTo(0.3, 5)
    // p90 cost (worst-case high) = 120*2.5 + 60*1.0 = 360; rev p10 = 800 → 0.45
    expect(d.pctP90).toBeCloseTo(360 / 800, 5)
    // p10 cost (best-case low) = 80*2.5 + 40*1.0 = 240; rev p90 = 1200 → 0.20
    expect(d.pctP10).toBeCloseTo(240 / 1200, 5)
    expect(d.unmappedItemCount).toBe(0)
    expect(result.data.blendedFoodCostPct).toBeCloseTo(0.3, 5)
  })

  it("counts unmapped items separately and excludes them from food cost", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "S1",
      accountId: "acct-A",
    } as never)
    const day = new Date("2026-05-09")
    const gen = new Date("2026-05-08T01:00:00Z")
    vi.mocked(prisma.forecastDailyRevenue.findMany).mockResolvedValue([
      { forecastDate: day, predictedRevenue: 500, p10: 400, p90: 600, generatedAt: gen },
    ] as never)
    vi.mocked(prisma.forecastMenuItem.findMany).mockResolvedValue([
      { otterItemSkuId: "Burger", forecastDate: day, predictedQty: 50, p10: 40, p90: 60, generatedAt: gen },
      { otterItemSkuId: "Mystery", forecastDate: day, predictedQty: 10, p10: 5, p90: 15, generatedAt: gen },
    ] as never)
    vi.mocked(prisma.otterItemMapping.findMany).mockResolvedValue([
      { otterItemName: "Burger", recipeId: "r-burger" },
    ] as never)
    vi.mocked(computeRecipeCost).mockResolvedValue({
      recipeId: "r-burger",
      itemName: "Burger",
      totalCost: 2,
      lines: [],
      partial: false,
    } as never)

    const result = await getFoodCostForecast({ storeId: "s1", asOf: day })
    if (!result || !result.ok) throw new Error("expected ok")
    const d = result.data.days[0]
    expect(d.predictedFoodCost).toBeCloseTo(100, 5) // 50*2 only — Mystery skipped
    expect(d.unmappedItemCount).toBe(1)
  })

  it("dedupes to the latest generation per (date) and per (sku, date)", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "S1",
      accountId: "acct-A",
    } as never)
    const day = new Date("2026-05-09")
    const old = new Date("2026-05-07T01:00:00Z")
    const fresh = new Date("2026-05-08T01:00:00Z")
    vi.mocked(prisma.forecastDailyRevenue.findMany).mockResolvedValue([
      { forecastDate: day, predictedRevenue: 1100, p10: 900, p90: 1300, generatedAt: fresh },
      { forecastDate: day, predictedRevenue: 1000, p10: 800, p90: 1200, generatedAt: old },
    ] as never)
    vi.mocked(prisma.forecastMenuItem.findMany).mockResolvedValue([
      { otterItemSkuId: "Burger", forecastDate: day, predictedQty: 110, p10: 90, p90: 130, generatedAt: fresh },
      { otterItemSkuId: "Burger", forecastDate: day, predictedQty: 100, p10: 80, p90: 120, generatedAt: old },
    ] as never)
    vi.mocked(prisma.otterItemMapping.findMany).mockResolvedValue([
      { otterItemName: "Burger", recipeId: "r-burger" },
    ] as never)
    vi.mocked(computeRecipeCost).mockResolvedValue({
      recipeId: "r-burger",
      itemName: "Burger",
      totalCost: 2,
      lines: [],
      partial: false,
    } as never)
    const result = await getFoodCostForecast({ storeId: "s1", asOf: day })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.days[0].predictedRevenue).toBe(1100)
    expect(result.data.days[0].predictedFoodCost).toBeCloseTo(220, 5) // 110*2
  })

  it("returns blended pct=null when revenue is missing or zero", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "S1",
      accountId: "acct-A",
    } as never)
    vi.mocked(prisma.forecastDailyRevenue.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.forecastMenuItem.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.otterItemMapping.findMany).mockResolvedValue([] as never)
    const result = await getFoodCostForecast({ storeId: "s1" })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.days).toEqual([])
    expect(result.data.blendedFoodCostPct).toBeNull()
  })
})
