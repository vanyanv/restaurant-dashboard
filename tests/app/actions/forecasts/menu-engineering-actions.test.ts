// getMenuEngineering — quadrant classifier on (velocity, unit margin)
// medians. Tests the math + auth/scope, the classification filter (COSTED
// non-Packaging rows only — UNMAPPED rows carry revenue at $0 cost and would
// otherwise classify as fake 100%-margin STARs), and the coverage summary.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findUnique: vi.fn(), findMany: vi.fn() },
    dailyCogsItem: { groupBy: vi.fn(), aggregate: vi.fn() },
    menuItemElasticity: { findMany: vi.fn() },
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
  vi.mocked(prisma.dailyCogsItem.aggregate).mockResolvedValue({
    _sum: { salesRevenue: 0 },
  } as never)
  // Elasticity is decoration on these rows — default to "no fits available"
  // so the classification assertions stay about the classifier.
  vi.mocked(prisma.menuItemElasticity.findMany).mockResolvedValue([] as never)
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

  it("attaches elasticity only when the nightly fit is usable", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "S1",
      accountId: "acct-A",
    } as never)
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
    vi.mocked(prisma.menuItemElasticity.findMany).mockResolvedValue([
      // Strong fit, long series — quotable.
      {
        otterItemSkuId: "Burger",
        elasticity: -1.4,
        fitR2: 0.55,
        sampleSize: 90,
        pricePointCount: 6,
      },
      // Real but weak — shown, flagged.
      {
        otterItemSkuId: "Soda",
        elasticity: -0.6,
        fitR2: 0.18,
        sampleSize: 40,
        pricePointCount: 3,
      },
      // No price variance: the coefficient is meaningless.
      {
        otterItemSkuId: "Steak",
        elasticity: -2.2,
        fitR2: 0.9,
        sampleSize: 200,
        pricePointCount: 1,
      },
      // Positive coefficient is noise for a demand curve, not a finding.
      {
        otterItemSkuId: "Salad",
        elasticity: 0.4,
        fitR2: 0.6,
        sampleSize: 120,
        pricePointCount: 5,
      },
    ] as never)

    const result = await getMenuEngineering({ storeId: "s1" })
    if (!result || !result.ok) throw new Error("expected ok")
    const byName = Object.fromEntries(result.data.rows.map((r) => [r.itemName, r]))

    expect(byName.Burger.elasticity).toBeCloseTo(-1.4, 5)
    expect(byName.Burger.elasticityConfidence).toBe("high")

    expect(byName.Soda.elasticity).toBeCloseTo(-0.6, 5)
    expect(byName.Soda.elasticityConfidence).toBe("low")

    expect(byName.Steak.elasticity).toBeNull()
    expect(byName.Steak.elasticityConfidence).toBeNull()

    expect(byName.Salad.elasticity).toBeNull()
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
      { id: "s1", name: "Store 1" },
      { id: "s2", name: "Store 2" },
    ] as never)
    vi.mocked(prisma.dailyCogsItem.groupBy).mockResolvedValue([] as never)
    await getMenuEngineering({})
    expect(prisma.store.findMany).toHaveBeenCalledWith({
      where: { accountId: "acct-A", isActive: true },
      select: { id: true, name: true },
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

describe("getMenuEngineering — classification filter + coverage", () => {
  const classifiedRow = (input: {
    itemName: string
    qty: number
    revenue: number
    cogs: number
  }) => ({
    itemName: input.itemName,
    category: "Menu",
    recipeId: `r-${input.itemName}`,
    _sum: {
      qtySold: input.qty,
      salesRevenue: input.revenue,
      lineCost: input.cogs,
    },
  })

  const FIXTURE = [
    classifiedRow({ itemName: "Star", qty: 100, revenue: 1000, cogs: 200 }),
    classifiedRow({ itemName: "Dog", qty: 10, revenue: 50, cogs: 40 }),
  ]

  const STATUS_ROLLUP = [
    { status: "COSTED", _sum: { salesRevenue: 1050, qtySold: 110 } },
    { status: "UNMAPPED", _sum: { salesRevenue: 300, qtySold: 30 } },
    { status: "MISSING_COST", _sum: { salesRevenue: 50, qtySold: 5 } },
  ]

  beforeEach(() => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "S1",
      accountId: "acct-A",
    } as never)
    vi.mocked(prisma.dailyCogsItem.groupBy)
      .mockResolvedValueOnce(FIXTURE as never)
      .mockResolvedValueOnce(STATUS_ROLLUP as never)
    vi.mocked(prisma.dailyCogsItem.aggregate).mockResolvedValue({
      _sum: { salesRevenue: 100 },
    } as never)
  })

  it("classifies only COSTED non-Packaging rows and carries recipeId", async () => {
    const result = await getMenuEngineering({ storeId: "s1" })
    if (!result || !result.ok) throw new Error("expected ok")

    const classifyArgs = vi.mocked(prisma.dailyCogsItem.groupBy).mock.calls[0][0]
    expect(classifyArgs.where).toMatchObject({
      status: "COSTED",
      category: { not: "Packaging" },
    })
    expect(classifyArgs.by).toContain("recipeId")

    expect(result.data.rows.map((r) => r.recipeId).sort()).toEqual([
      "r-Dog",
      "r-Star",
    ])
  })

  it("reports revenue by status so owners can see what the quadrants cover", async () => {
    const result = await getMenuEngineering({ storeId: "s1" })
    if (!result || !result.ok) throw new Error("expected ok")

    expect(result.data.coverage).toEqual({
      costedRevenue: 1050,
      unmappedRevenue: 300,
      missingCostRevenue: 50,
      partialCostRevenue: 100,
      coveragePct: 75, // 1050 / (1050 + 300 + 50)
    })

    // The status rollup must exclude Packaging pseudo-rows and not pre-filter
    // by status (it needs UNMAPPED + MISSING_COST to measure the gap).
    const statusArgs = vi.mocked(prisma.dailyCogsItem.groupBy).mock.calls[1][0]
    expect(statusArgs.by).toEqual(["status"])
    expect(statusArgs.where).toMatchObject({ category: { not: "Packaging" } })
    expect(statusArgs.where?.status).toBeUndefined()
  })

  it("returns 100% coverage when every dollar sold is COSTED", async () => {
    vi.mocked(prisma.dailyCogsItem.groupBy)
      .mockReset()
      .mockResolvedValueOnce(FIXTURE as never)
      .mockResolvedValueOnce([
        { status: "COSTED", _sum: { salesRevenue: 1050, qtySold: 110 } },
      ] as never)
    vi.mocked(prisma.dailyCogsItem.aggregate).mockResolvedValue({
      _sum: { salesRevenue: 0 },
    } as never)

    const result = await getMenuEngineering({ storeId: "s1" })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.coverage.coveragePct).toBe(100)
    expect(result.data.coverage.unmappedRevenue).toBe(0)
  })
})
