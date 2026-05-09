// getMenuEngineering — quadrant classifier on (velocity, unit margin)
// medians. Tests the math + auth/scope.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findUnique: vi.fn(), findMany: vi.fn() },
    dailyCogsItem: { groupBy: vi.fn() },
  },
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { getMenuEngineering } from "@/app/actions/forecasts/menu-engineering-actions"

const sessionWith = (overrides: Record<string, unknown> = {}) => ({
  user: { id: "u1", accountId: "acct-A", ...overrides },
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getMenuEngineering", () => {
  it("returns null without a session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    expect(await getMenuEngineering({})).toBeNull()
  })

  it("rejects a cross-account store when storeId is supplied", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "S1",
      accountId: "acct-OTHER",
    } as never)
    expect(await getMenuEngineering({ storeId: "s1" })).toEqual({
      ok: false,
      error: "store_not_in_account",
    })
  })

  it("classifies STAR / PLOWHORSE / PUZZLE / DOG by median split", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "S1",
      accountId: "acct-A",
    } as never)
    // Four items with explicit (qtySold, unitMargin) so median splits are
    // unambiguous:
    //   Burger:  100 sold, $5 margin   → high vol, high margin → STAR
    //   Soda:    100 sold, $1 margin   → high vol, low margin  → PLOWHORSE
    //   Steak:    20 sold, $8 margin   → low vol,  high margin → PUZZLE
    //   Salad:    20 sold, $0.5 margin → low vol,  low margin  → DOG
    vi.mocked(prisma.dailyCogsItem.groupBy).mockResolvedValue([
      {
        itemName: "Burger",
        category: "Entree",
        _sum: { qtySold: 100, salesRevenue: 1000, lineCost: 500 },
      },
      {
        itemName: "Soda",
        category: "Drinks",
        _sum: { qtySold: 100, salesRevenue: 300, lineCost: 200 },
      },
      {
        itemName: "Steak",
        category: "Entree",
        _sum: { qtySold: 20, salesRevenue: 400, lineCost: 240 },
      },
      {
        itemName: "Salad",
        category: "Sides",
        _sum: { qtySold: 20, salesRevenue: 60, lineCost: 50 },
      },
    ] as never)

    const result = await getMenuEngineering({ storeId: "s1" })
    if (!result || !result.ok) throw new Error("expected ok")
    const byName = Object.fromEntries(result.data.rows.map((r) => [r.itemName, r]))
    expect(byName.Burger.quadrant).toBe("STAR")
    expect(byName.Soda.quadrant).toBe("PLOWHORSE")
    expect(byName.Steak.quadrant).toBe("PUZZLE")
    expect(byName.Salad.quadrant).toBe("DOG")
    expect(result.data.counts).toEqual({ STAR: 1, PLOWHORSE: 1, PUZZLE: 1, DOG: 1 })
    // Total contribution = 500 + 100 + 160 + 10 = 770
    expect(result.data.totalContribution).toBeCloseTo(770, 5)
  })

  it("filters out long-tail items below minSoldQty", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "S1",
      accountId: "acct-A",
    } as never)
    vi.mocked(prisma.dailyCogsItem.groupBy).mockResolvedValue([
      {
        itemName: "BigSeller",
        category: "X",
        _sum: { qtySold: 100, salesRevenue: 1000, lineCost: 500 },
      },
      {
        itemName: "SoldOnce",
        category: "Y",
        _sum: { qtySold: 1, salesRevenue: 8, lineCost: 3 },
      },
    ] as never)
    const result = await getMenuEngineering({ storeId: "s1", minSoldQty: 5 })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.rows).toHaveLength(1)
    expect(result.data.rows[0].itemName).toBe("BigSeller")
  })

  it("rolls across all owned stores when no storeId is supplied", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findMany).mockResolvedValue([
      { id: "s1" },
      { id: "s2" },
    ] as never)
    vi.mocked(prisma.dailyCogsItem.groupBy).mockResolvedValue([] as never)
    await getMenuEngineering({})
    expect(prisma.store.findMany).toHaveBeenCalledWith({
      where: { accountId: "acct-A", isActive: true },
      select: { id: true },
    })
    expect(prisma.dailyCogsItem.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ storeId: { in: ["s1", "s2"] } }),
      }),
    )
  })

  it("handles an empty result with zero medians and empty quadrant counts", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "S1",
      accountId: "acct-A",
    } as never)
    vi.mocked(prisma.dailyCogsItem.groupBy).mockResolvedValue([] as never)
    const result = await getMenuEngineering({ storeId: "s1" })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.rows).toHaveLength(0)
    expect(result.data.counts).toEqual({ STAR: 0, PLOWHORSE: 0, PUZZLE: 0, DOG: 0 })
  })
})
