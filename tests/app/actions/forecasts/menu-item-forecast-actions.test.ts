// getMenuItemForecast — read-side server action. Returns the latest
// generation per (sku, date) grouped by sku, sorted by total predicted
// quantity descending.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findUnique: vi.fn() },
    forecastMenuItem: { findMany: vi.fn() },
    mlTrainingRun: { findFirst: vi.fn() },
  },
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { getMenuItemForecast } from "@/app/actions/forecasts/menu-item-forecast-actions"

const sessionWith = (overrides: Record<string, unknown> = {}) => ({
  user: { id: "u1", accountId: "acct-A", ...overrides },
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.mlTrainingRun.findFirst).mockResolvedValue(null as never)
})

describe("getMenuItemForecast", () => {
  it("returns null when no session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    expect(await getMenuItemForecast({ storeId: "s1" })).toBeNull()
  })

  it("rejects a cross-account store", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "S1",
      accountId: "acct-OTHER",
    } as never)
    expect(await getMenuItemForecast({ storeId: "s1" })).toEqual({
      ok: false,
      error: "store_not_in_account",
    })
  })

  it("buckets by sku, keeps latest generation per (sku, date), sorts items by total descending", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "S1",
      accountId: "acct-A",
    } as never)
    const day1 = new Date("2026-05-09")
    const day2 = new Date("2026-05-10")
    const oldGen = new Date("2026-05-07T01:00:00Z")
    const newGen = new Date("2026-05-08T01:00:00Z")
    vi.mocked(prisma.forecastMenuItem.findMany).mockResolvedValue([
      // burger — newer wins on day1
      { otterItemSkuId: "Burger", forecastDate: day1, predictedQty: 80, p10: 60, p90: 100, generatedAt: newGen },
      { otterItemSkuId: "Burger", forecastDate: day1, predictedQty: 70, p10: 55, p90: 95, generatedAt: oldGen },
      { otterItemSkuId: "Burger", forecastDate: day2, predictedQty: 90, p10: 70, p90: 110, generatedAt: newGen },
      // fries — lower volume
      { otterItemSkuId: "Fries", forecastDate: day1, predictedQty: 50, p10: 40, p90: 60, generatedAt: newGen },
    ] as never)

    const result = await getMenuItemForecast({ storeId: "s1", asOf: day1 })
    if (!result || !result.ok) throw new Error("expected ok result")
    expect(result.data.items.map((i) => i.otterItemSkuId)).toEqual(["Burger", "Fries"])
    const burger = result.data.items[0]
    expect(burger.totalPredicted).toBe(170) // 80 + 90
    expect(burger.days).toHaveLength(2)
    expect(burger.days[0].predictedQty).toBe(80)
    expect(burger.days[1].predictedQty).toBe(90)
    expect(result.data.generatedAt?.toISOString()).toBe(newGen.toISOString())
  })

  it("attaches recentMape from the latest SUCCEEDED MENU_ITEM training run", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "S1",
      accountId: "acct-A",
    } as never)
    vi.mocked(prisma.forecastMenuItem.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.mlTrainingRun.findFirst).mockResolvedValue({ mape: 0.18 } as never)
    const result = await getMenuItemForecast({ storeId: "s1" })
    if (!result || !result.ok) throw new Error("expected ok result")
    expect(result.data.recentMape).toBe(0.18)
    expect(prisma.mlTrainingRun.findFirst).toHaveBeenCalledWith({
      where: { target: "MENU_ITEM", status: "SUCCEEDED", mape: { not: null } },
      orderBy: { startedAt: "desc" },
      select: { mape: true },
    })
  })
})
