// Chat-tool surface for the ML forecasts. Each tool resolves storeIds via
// the owner-scope helper, runs a Prisma query, and dedupes to the latest
// generation per (storeId, date) — that dedup is the substance worth
// testing here.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/chat/owner-scope", () => ({
  assertOwnerOwnsStores: vi.fn(),
  listOwnerStores: vi.fn(),
  renderStoreListForPrompt: vi.fn(),
}))

// food-cost chat tool imports the server action; mock its prisma + auth
// transitive deps so the test doesn't try to hit a real DATABASE_URL.
vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/recipe-cost", () => ({ computeRecipeCost: vi.fn() }))

import { assertOwnerOwnsStores } from "@/lib/chat/owner-scope"
import {
  getMenuItemForecast,
  getOpenAnomalies,
  getRevenueForecast,
} from "@/lib/chat/tools/forecasts"
import type { ChatToolContext } from "@/lib/chat/tools/types"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(assertOwnerOwnsStores).mockImplementation(async (_acct, ids) =>
    ids ?? ["s1", "s2"],
  )
})

function makeCtx(overrides: Partial<ChatToolContext["prisma"]> = {}): ChatToolContext {
  return {
    ownerId: "u1",
    accountId: "acct-A",
    prisma: {
      forecastDailyRevenue: { findMany: vi.fn().mockResolvedValue([]) },
      forecastMenuItem: { findMany: vi.fn().mockResolvedValue([]) },
      anomalyEvent: { findMany: vi.fn().mockResolvedValue([]) },
      ...overrides,
    } as never,
  }
}

describe("getRevenueForecast (chat tool)", () => {
  it("dedupes to the latest generation per (storeId, date) and serializes dates as YYYY-MM-DD", async () => {
    const day1 = new Date("2026-05-09")
    const day2 = new Date("2026-05-10")
    const oldGen = new Date("2026-05-07T01:00:00Z")
    const newGen = new Date("2026-05-08T01:00:00Z")
    const findMany = vi.fn().mockResolvedValue([
      { storeId: "s1", forecastDate: day1, predictedRevenue: 4000, p10: 3500, p90: 4500, modelVersion: "v2", generatedAt: newGen },
      { storeId: "s1", forecastDate: day1, predictedRevenue: 3800, p10: 3300, p90: 4300, modelVersion: "v1", generatedAt: oldGen },
      { storeId: "s1", forecastDate: day2, predictedRevenue: 4200, p10: 3700, p90: 4700, modelVersion: "v2", generatedAt: newGen },
    ])
    const ctx = makeCtx({ forecastDailyRevenue: { findMany } } as never)

    const result = await getRevenueForecast.execute(
      { horizonDays: 14, storeIds: ["s1"] },
      ctx,
    )
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ storeId: "s1", date: "2026-05-09", predictedRevenue: 4000 })
    expect(result[1]).toMatchObject({ storeId: "s1", date: "2026-05-10", predictedRevenue: 4200 })
  })

  it("calls assertOwnerOwnsStores so a foreign id can't leak in", async () => {
    const ctx = makeCtx()
    await getRevenueForecast.execute({ horizonDays: 14, storeIds: ["s1"] }, ctx)
    expect(assertOwnerOwnsStores).toHaveBeenCalledWith("acct-A", ["s1"])
  })
})

describe("getMenuItemForecast (chat tool)", () => {
  it("buckets per (storeId, sku), totals quantities, and returns top-N per store", async () => {
    const day = new Date("2026-05-09")
    const gen = new Date("2026-05-08T01:00:00Z")
    const findMany = vi.fn().mockResolvedValue([
      { storeId: "s1", otterItemSkuId: "Burger", forecastDate: day, predictedQty: 80, p10: 60, p90: 100, generatedAt: gen },
      { storeId: "s1", otterItemSkuId: "Fries", forecastDate: day, predictedQty: 50, p10: 40, p90: 60, generatedAt: gen },
      { storeId: "s1", otterItemSkuId: "Salad", forecastDate: day, predictedQty: 10, p10: 5, p90: 15, generatedAt: gen },
    ])
    const ctx = makeCtx({ forecastMenuItem: { findMany } } as never)

    const result = await getMenuItemForecast.execute(
      { horizonDays: 7, topN: 2, storeIds: ["s1"] },
      ctx,
    )
    expect(result.map((r) => r.itemSkuId)).toEqual(["Burger", "Fries"])
    expect(result[0].totalPredicted).toBe(80)
    expect(result[0].dailyAverage).toBe(80)
    expect(result[0].days[0]).toMatchObject({ date: "2026-05-09", predictedQty: 80 })
  })

  it("dedupes per (storeId, sku, date) keeping the newest generation", async () => {
    const day = new Date("2026-05-09")
    const oldGen = new Date("2026-05-07T01:00:00Z")
    const newGen = new Date("2026-05-08T01:00:00Z")
    const findMany = vi.fn().mockResolvedValue([
      { storeId: "s1", otterItemSkuId: "Burger", forecastDate: day, predictedQty: 80, p10: 60, p90: 100, generatedAt: newGen },
      { storeId: "s1", otterItemSkuId: "Burger", forecastDate: day, predictedQty: 70, p10: 50, p90: 90, generatedAt: oldGen },
    ])
    const ctx = makeCtx({ forecastMenuItem: { findMany } } as never)
    const result = await getMenuItemForecast.execute({ horizonDays: 7, topN: 5, storeIds: ["s1"] }, ctx)
    expect(result[0].totalPredicted).toBe(80)
  })
})

describe("getOpenAnomalies (chat tool)", () => {
  it("scopes to OPEN events within sinceDays, takes up to limit, and serializes dates", async () => {
    const occurredOn = new Date("2026-05-08")
    const detectedAt = new Date("2026-05-09T06:00:00Z")
    const findMany = vi.fn().mockResolvedValue([
      {
        storeId: "s1",
        target: "REVENUE",
        targetId: null,
        occurredOn,
        residual: -1500,
        zScore: -3.4,
        method: "ZSCORE",
        detectedAt,
      },
    ])
    const ctx = makeCtx({ anomalyEvent: { findMany } } as never)
    const result = await getOpenAnomalies.execute(
      { storeIds: ["s1"], limit: 10, sinceDays: 14 },
      ctx,
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      storeId: "s1",
      target: "REVENUE",
      occurredOn: "2026-05-08",
      zScore: -3.4,
    })
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          storeId: { in: ["s1"] },
          status: "OPEN",
        }),
        take: 10,
      }),
    )
  })
})
