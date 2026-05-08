// getMenuItemElasticity — read-side action returning per-item price
// elasticity with a confidence classifier and a 10%-hike % volume change.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findUnique: vi.fn() },
    menuItemElasticity: { findMany: vi.fn() },
  },
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { getMenuItemElasticity } from "@/app/actions/forecasts/elasticity-actions"

const sessionWith = (overrides: Record<string, unknown> = {}) => ({
  user: { id: "u1", accountId: "acct-A", ...overrides },
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getMenuItemElasticity", () => {
  it("returns null without a session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    expect(await getMenuItemElasticity({ storeId: "s1" })).toBeNull()
  })

  it("rejects a cross-account store", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "S1",
      accountId: "acct-OTHER",
    } as never)
    expect(await getMenuItemElasticity({ storeId: "s1" })).toEqual({
      ok: false,
      error: "store_not_in_account",
    })
  })

  it("classifies confidence by R² and price-point count, and computes %ΔQ at 10% hike", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "S1",
      accountId: "acct-A",
    } as never)
    vi.mocked(prisma.menuItemElasticity.findMany).mockResolvedValue([
      // High-confidence elastic
      {
        otterItemSkuId: "Burger",
        elasticity: -1.5,
        intercept: 4.5,
        fitR2: 0.6,
        sampleSize: 180,
        pricePointCount: 4,
        meanPrice: 12,
        meanQty: 80,
        computedAt: new Date("2026-05-08"),
      },
      // Medium
      {
        otterItemSkuId: "Fries",
        elasticity: -0.5,
        intercept: 3.0,
        fitR2: 0.2,
        sampleSize: 180,
        pricePointCount: 3,
        meanPrice: 4,
        meanQty: 50,
        computedAt: new Date("2026-05-08"),
      },
      // No signal — only 1 price point
      {
        otterItemSkuId: "Static",
        elasticity: -0.1,
        intercept: 2.0,
        fitR2: 0.05,
        sampleSize: 180,
        pricePointCount: 1,
        meanPrice: 3,
        meanQty: 20,
        computedAt: new Date("2026-05-08"),
      },
      // No signal — positive elasticity (confound)
      {
        otterItemSkuId: "Confound",
        elasticity: 0.4,
        intercept: 2.0,
        fitR2: 0.1,
        sampleSize: 60,
        pricePointCount: 3,
        meanPrice: 5,
        meanQty: 10,
        computedAt: new Date("2026-05-08"),
      },
    ] as never)

    const result = await getMenuItemElasticity({ storeId: "s1" })
    if (!result || !result.ok) throw new Error("expected ok")
    const byName = Object.fromEntries(result.data.rows.map((r) => [r.otterItemSkuId, r]))
    expect(byName.Burger.confidence).toBe("high")
    expect(byName.Fries.confidence).toBe("medium")
    expect(byName.Static.confidence).toBe("no_signal")
    expect(byName.Confound.confidence).toBe("no_signal")
    expect(byName.Burger.pctVolumeChangeAt10PctHike).toBeCloseTo(-0.15, 5) // 0.1 * -1.5
    expect(byName.Fries.pctVolumeChangeAt10PctHike).toBeCloseTo(-0.05, 5)
  })
})
