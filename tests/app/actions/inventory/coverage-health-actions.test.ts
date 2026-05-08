// Coverage-health widget surfaces accuracy debt: how much of the past week's
// sales is mapped to a recipe (so the depletion model can see them) and how
// many ingredient↔SKU matches are stuck at the default conversionFactor=1
// despite having different from/to units (a likely-bogus passthrough).

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findUnique: vi.fn() },
    dailyCogsItem: { groupBy: vi.fn() },
    ingredientSkuMatch: { findMany: vi.fn() },
  },
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { getInventoryCoverageHealth } from "@/app/actions/inventory/coverage-health-actions"

const session = (overrides: Record<string, unknown> = {}) => ({
  user: { id: "u1", accountId: "acct-A", ...overrides },
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getInventoryCoverageHealth", () => {
  it("returns null when no session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    const r = await getInventoryCoverageHealth({ storeId: "s1" })
    expect(r).toBeNull()
  })

  it("rejects a store from another account", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "X",
      accountId: "acct-OTHER",
    } as never)
    const r = await getInventoryCoverageHealth({ storeId: "s1" })
    expect(r).toEqual({ ok: false, error: "store_not_in_account" })
  })

  it("computes coverage % from DailyCogsItem grouped by status", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "Lakewood",
      accountId: "acct-A",
    } as never)
    vi.mocked(prisma.dailyCogsItem.groupBy).mockResolvedValue([
      { status: "COSTED", _sum: { salesRevenue: 800 } },
      { status: "MISSING_COST", _sum: { salesRevenue: 100 } },
      { status: "UNMAPPED", _sum: { salesRevenue: 100 } },
    ] as never)
    vi.mocked(prisma.ingredientSkuMatch.findMany).mockResolvedValue([] as never)

    const r = await getInventoryCoverageHealth({ storeId: "s1" })
    expect(r?.ok).toBe(true)
    if (!r?.ok) return
    expect(r.data.totalSalesRevenue).toBe(1000)
    expect(r.data.mappedRevenue).toBe(900) // COSTED + MISSING_COST
    expect(r.data.unmappedRevenue).toBe(100)
    expect(r.data.coveragePct).toBe(0.9)
  })

  it("treats zero-sales week as null coveragePct (don't divide by zero)", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "Lakewood",
      accountId: "acct-A",
    } as never)
    vi.mocked(prisma.dailyCogsItem.groupBy).mockResolvedValue([] as never)
    vi.mocked(prisma.ingredientSkuMatch.findMany).mockResolvedValue([] as never)

    const r = await getInventoryCoverageHealth({ storeId: "s1" })
    expect(r?.ok).toBe(true)
    if (!r?.ok) return
    expect(r.data.totalSalesRevenue).toBe(0)
    expect(r.data.coveragePct).toBeNull()
  })

  it("counts SKU matches with cross-unit fromUnit/toUnit and default conversionFactor=1 as a conversion gap", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "Lakewood",
      accountId: "acct-A",
    } as never)
    vi.mocked(prisma.dailyCogsItem.groupBy).mockResolvedValue([] as never)
    vi.mocked(prisma.ingredientSkuMatch.findMany).mockResolvedValue([
      // Different units, default factor of 1 → suspect, count as gap
      { id: "m1", fromUnit: "case", toUnit: "lb", conversionFactor: 1 },
      // Different units, real factor → fine, don't count
      { id: "m2", fromUnit: "case", toUnit: "lb", conversionFactor: 24 },
      // Same unit, factor 1 → passthrough is correct
      { id: "m3", fromUnit: "lb", toUnit: "lb", conversionFactor: 1 },
    ] as never)

    const r = await getInventoryCoverageHealth({ storeId: "s1" })
    expect(r?.ok).toBe(true)
    if (!r?.ok) return
    expect(r.data.conversionGapCount).toBe(1)
  })

  it("scopes the SKU-match query to the caller's account", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "Lakewood",
      accountId: "acct-A",
    } as never)
    vi.mocked(prisma.dailyCogsItem.groupBy).mockResolvedValue([] as never)
    vi.mocked(prisma.ingredientSkuMatch.findMany).mockResolvedValue([] as never)

    await getInventoryCoverageHealth({ storeId: "s1" })

    const callArg = vi.mocked(prisma.ingredientSkuMatch.findMany).mock.calls[0][0] as {
      where: { accountId: string }
    }
    expect(callArg.where.accountId).toBe("acct-A")
  })
})
