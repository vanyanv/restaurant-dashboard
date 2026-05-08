// getLostSales — finds 86'd-item windows in OtterMenuItem history and
// estimates lost revenue from the pre-gap baseline. Tests the gap-detection
// algorithm + auth/scope.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findUnique: vi.fn(), findMany: vi.fn() },
    otterMenuItem: { findMany: vi.fn() },
  },
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { getLostSales } from "@/app/actions/forecasts/lost-sales-actions"

const sessionWith = (overrides: Record<string, unknown> = {}) => ({
  user: { id: "u1", accountId: "acct-A", ...overrides },
})

beforeEach(() => {
  vi.clearAllMocks()
})

function row(date: string, itemName: string, qty: number, sales: number) {
  return {
    storeId: "s1",
    itemName,
    category: "Burgers",
    date: new Date(`${date}T00:00:00Z`),
    fpQuantitySold: qty,
    tpQuantitySold: 0,
    fpTotalSales: sales,
    tpTotalSales: 0,
  }
}

describe("getLostSales", () => {
  it("returns null without a session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    expect(await getLostSales({})).toBeNull()
  })

  it("rejects a cross-account store", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "S1",
      accountId: "acct-OTHER",
    } as never)
    expect(await getLostSales({ storeId: "s1" })).toEqual({
      ok: false,
      error: "store_not_in_account",
    })
  })

  it("flags a 3-day stock-out after a stable baseline and prices it from the baseline avg", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "S1",
      accountId: "acct-A",
    } as never)
    // 14 days baseline at 10 qty/day @ $8 each, then 3 days of zero, then back.
    const baseline = Array.from({ length: 14 }, (_, i) => {
      const d = new Date("2026-04-15T00:00:00Z")
      d.setUTCDate(d.getUTCDate() + i)
      return row(d.toISOString().slice(0, 10), "Burger", 10, 80)
    })
    // Then days 29, 30, 31 are missing (qty=0). Days 32+ resume.
    const after = Array.from({ length: 5 }, (_, i) => {
      const d = new Date("2026-05-02T00:00:00Z")
      d.setUTCDate(d.getUTCDate() + i)
      return row(d.toISOString().slice(0, 10), "Burger", 10, 80)
    })
    vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue(
      [...baseline, ...after] as never,
    )
    const asOf = new Date("2026-05-07T00:00:00Z")
    const result = await getLostSales({
      storeId: "s1",
      asOf,
      lookbackDays: 30,
    })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.events).toHaveLength(1)
    const e = result.data.events[0]
    expect(e.itemName).toBe("Burger")
    expect(e.gapDays).toBeGreaterThanOrEqual(2) // at least minGapDays
    expect(e.baselineDailyQty).toBeCloseTo(10, 5)
    expect(e.meanUnitPrice).toBeCloseTo(8, 5)
    // 10 baseline × 8 unit price × gapDays
    expect(e.estimatedLostRevenue).toBeCloseTo(10 * 8 * e.gapDays, 5)
  })

  it("ignores items whose baseline is below minBaselineQty", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "S1",
      accountId: "acct-A",
    } as never)
    // Long, slow, low-baseline item: 1 unit/day for 14 days, then 5 zero days.
    const baseline = Array.from({ length: 14 }, (_, i) => {
      const d = new Date("2026-04-15T00:00:00Z")
      d.setUTCDate(d.getUTCDate() + i)
      return row(d.toISOString().slice(0, 10), "Slow", 1, 10)
    })
    vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue(baseline as never)
    const result = await getLostSales({
      storeId: "s1",
      asOf: new Date("2026-05-04T00:00:00Z"),
      lookbackDays: 21,
      minBaselineQty: 3,
    })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.events).toHaveLength(0)
  })

  it("caps gap_days at maxGapDays so a delisted item doesn't book unbounded losses", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "S1",
      accountId: "acct-A",
    } as never)
    // 14 days at qty=10, then NEVER comes back over a 60-day window.
    const baseline = Array.from({ length: 14 }, (_, i) => {
      const d = new Date("2026-03-01T00:00:00Z")
      d.setUTCDate(d.getUTCDate() + i)
      return row(d.toISOString().slice(0, 10), "Delisted", 10, 80)
    })
    vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue(baseline as never)
    const result = await getLostSales({
      storeId: "s1",
      asOf: new Date("2026-05-01T00:00:00Z"),
      lookbackDays: 60,
      maxGapDays: 14,
    })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.events).toHaveLength(1)
    expect(result.data.events[0].gapDays).toBe(14)
  })

  it("ignores leading zero runs at the very start of the window (no prior baseline)", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "S1",
      accountId: "acct-A",
    } as never)
    // No data at all for the first 5 days, then strong sales.
    const after = Array.from({ length: 14 }, (_, i) => {
      const d = new Date("2026-04-20T00:00:00Z")
      d.setUTCDate(d.getUTCDate() + i)
      return row(d.toISOString().slice(0, 10), "NewItem", 10, 80)
    })
    vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue(after as never)
    const result = await getLostSales({
      storeId: "s1",
      asOf: new Date("2026-05-04T00:00:00Z"),
      lookbackDays: 21,
    })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.events).toHaveLength(0)
  })
})
