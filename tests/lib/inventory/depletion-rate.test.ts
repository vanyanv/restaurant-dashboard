// computeDailyDepletionRate — trailing-average depletion (in recipeUnit/day).
// Window:
//   - Default lookback is 14 days.
//   - If the most recent COMPLETED count is more recent than (asOf - lookback),
//     the window starts at the count instead — avoids contaminating the rate
//     with pre-anchor estimates.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    canonicalIngredient: { findUnique: vi.fn() },
    stockCountLine: { findFirst: vi.fn() },
    otterMenuItem: { findMany: vi.fn() },
    otterItemMapping: { findMany: vi.fn() },
  },
}))

vi.mock("@/lib/inventory/recipe-walk", () => ({
  walkRecipeForIngredient: vi.fn(),
}))

import { prisma } from "@/lib/prisma"
import { walkRecipeForIngredient } from "@/lib/inventory/recipe-walk"
import { computeDailyDepletionRate } from "@/lib/inventory/depletion-rate"

const ING = { id: "ing-1", name: "Mozzarella", recipeUnit: "lb" }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.canonicalIngredient.findUnique).mockResolvedValue(ING as never)
  vi.mocked(prisma.stockCountLine.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.otterItemMapping.findMany).mockResolvedValue([] as never)
  vi.mocked(walkRecipeForIngredient).mockResolvedValue(0)
})

describe("computeDailyDepletionRate", () => {
  it("returns null when the ingredient doesn't exist", async () => {
    vi.mocked(prisma.canonicalIngredient.findUnique).mockResolvedValue(null)
    const result = await computeDailyDepletionRate({ storeId: "s1", ingredientId: "missing" })
    expect(result).toBeNull()
  })

  it("returns 0 rate over the default 14-day window when there are no sales", async () => {
    const result = await computeDailyDepletionRate({
      storeId: "s1",
      ingredientId: "ing-1",
      asOf: new Date("2026-05-15"),
    })
    expect(result).not.toBeNull()
    expect(result!.ratePerDay).toBe(0)
    expect(result!.windowDays).toBe(14)
  })

  it("averages depletion over the default 14-day window", async () => {
    vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue([
      { itemName: "Margherita", fpQuantitySold: 7, tpQuantitySold: 7 },
    ] as never)
    vi.mocked(prisma.otterItemMapping.findMany).mockResolvedValue([
      { otterItemName: "Margherita", recipeId: "rec-1" },
    ] as never)
    vi.mocked(walkRecipeForIngredient).mockResolvedValue(1) // 1 lb / serving
    const result = await computeDailyDepletionRate({
      storeId: "s1",
      ingredientId: "ing-1",
      asOf: new Date("2026-05-15"),
    })
    // 14 servings × 1 lb / 14 days = 1 lb/day
    expect(result!.ratePerDay).toBe(1)
    expect(result!.depletionQty).toBe(14)
  })

  it("uses (asOf - count) as the window when the count is more recent than lookbackDays", async () => {
    vi.mocked(prisma.stockCountLine.findFirst).mockResolvedValue({
      qtyInRecipeUnit: 0,
      stockCount: { countedAt: new Date("2026-05-08") },
    } as never)
    vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue([
      { itemName: "Margherita", fpQuantitySold: 10, tpQuantitySold: 0 },
    ] as never)
    vi.mocked(prisma.otterItemMapping.findMany).mockResolvedValue([
      { otterItemName: "Margherita", recipeId: "rec-1" },
    ] as never)
    vi.mocked(walkRecipeForIngredient).mockResolvedValue(0.5)
    const result = await computeDailyDepletionRate({
      storeId: "s1",
      ingredientId: "ing-1",
      asOf: new Date("2026-05-15"),
    })
    // Count is 7 days ago; depletion = 10 × 0.5 = 5 lb; rate = 5/7 lb/day
    expect(result!.windowDays).toBe(7)
    expect(result!.depletionQty).toBe(5)
    expect(result!.ratePerDay).toBeCloseTo(5 / 7, 6)
  })

  it("falls back to the full lookback when the count is older than lookbackDays", async () => {
    vi.mocked(prisma.stockCountLine.findFirst).mockResolvedValue({
      qtyInRecipeUnit: 0,
      stockCount: { countedAt: new Date("2026-04-01") },
    } as never)
    const result = await computeDailyDepletionRate({
      storeId: "s1",
      ingredientId: "ing-1",
      asOf: new Date("2026-05-15"),
    })
    expect(result!.windowDays).toBe(14)
  })

  it("respects an override lookbackDays parameter", async () => {
    const result = await computeDailyDepletionRate({
      storeId: "s1",
      ingredientId: "ing-1",
      lookbackDays: 7,
      asOf: new Date("2026-05-15"),
    })
    expect(result!.windowDays).toBe(7)
  })

  it("clamps to a minimum of 1 day so we never divide by zero", async () => {
    vi.mocked(prisma.stockCountLine.findFirst).mockResolvedValue({
      qtyInRecipeUnit: 0,
      stockCount: { countedAt: new Date("2026-05-15") }, // same as asOf
    } as never)
    vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue([
      { itemName: "Margherita", fpQuantitySold: 3, tpQuantitySold: 0 },
    ] as never)
    vi.mocked(prisma.otterItemMapping.findMany).mockResolvedValue([
      { otterItemName: "Margherita", recipeId: "rec-1" },
    ] as never)
    vi.mocked(walkRecipeForIngredient).mockResolvedValue(1)
    const result = await computeDailyDepletionRate({
      storeId: "s1",
      ingredientId: "ing-1",
      asOf: new Date("2026-05-15"),
    })
    expect(result!.windowDays).toBe(1)
    expect(result!.ratePerDay).toBe(3)
  })
})
