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

/**
 * Days the store traded, established by an item that never stops selling.
 *
 * `OtterMenuItem` has no row for an item that sold nothing, so the only
 * evidence a store was OPEN on a date is that something sold that date.
 * A fixture with a single item cannot distinguish "this item was 86'd" from
 * "the store was shut" — which is exactly the inference `getLostSales` used
 * to make, and why a closure or a sync outage booked a loss on every item.
 */
function tradingDays(from: string, days: number) {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(`${from}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + i)
    return row(d.toISOString().slice(0, 10), "Fries", 20, 100)
  })
}

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
    vi.mocked(prisma.store.findMany).mockResolvedValue([] as never)
    expect(await getLostSales({ storeId: "s1" })).toEqual({
      ok: false,
      error: "store_not_in_account",
    })
  })

  it("flags a 3-day stock-out after a stable baseline and prices it from the baseline avg", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findMany).mockResolvedValue([
      { id: "s1", name: "S1", accountId: "acct-A", isActive: true },
    ] as never)
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
      // Fries sells straight through, so 2026-05-01..03 are days the store
      // was OPEN and the Burger did not sell — a stock-out, not a closure.
      [...baseline, ...after, ...tradingDays("2026-04-07", 31)] as never,
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
    vi.mocked(prisma.store.findMany).mockResolvedValue([
      { id: "s1", name: "S1", accountId: "acct-A", isActive: true },
    ] as never)
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
    vi.mocked(prisma.store.findMany).mockResolvedValue([
      { id: "s1", name: "S1", accountId: "acct-A", isActive: true },
    ] as never)
    // 14 days at qty=10, then NEVER comes back over a 60-day window.
    const baseline = Array.from({ length: 14 }, (_, i) => {
      const d = new Date("2026-03-01T00:00:00Z")
      d.setUTCDate(d.getUTCDate() + i)
      return row(d.toISOString().slice(0, 10), "Delisted", 10, 80)
    })
    vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue(
      [...baseline, ...tradingDays("2026-03-01", 62)] as never,
    )
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

  it("does not book a loss on every item when the store was shut for two days", async () => {
    // The whole menu goes quiet together because the doors were locked, not
    // because three items were 86'd on the same morning. Filling the calendar
    // with qty 0 made this a simultaneous stock-out of all three, each priced
    // at its own baseline and summed into totalEstimatedLost. minGapDays is 2,
    // so a long weekend was enough.
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findMany).mockResolvedValue([
      { id: "s1", name: "S1", accountId: "acct-A", isActive: true },
    ] as never)
    const menu = ["Burger", "Fries", "Shake"]
    const rows = []
    for (let i = 0; i < 20; i += 1) {
      const d = new Date("2026-04-01T00:00:00Z")
      d.setUTCDate(d.getUTCDate() + i)
      const key = d.toISOString().slice(0, 10)
      // 2026-04-15 and 2026-04-16: closed. No rows for ANY item.
      if (key === "2026-04-15" || key === "2026-04-16") continue
      for (const item of menu) rows.push(row(key, item, 10, 80))
    }
    vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue(rows as never)
    const result = await getLostSales({
      storeId: "s1",
      asOf: new Date("2026-04-20T00:00:00Z"),
      lookbackDays: 30,
    })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.events).toHaveLength(0)
    expect(result.data.totalEstimatedLost).toBe(0)
  })

  it("does not book a loss because today and yesterday have not synced yet", async () => {
    // The window ends at startOfDay(asOf), and Otter posts a day after it
    // closes. Today therefore always had zero rows, and a sync that ran late
    // made it two — exactly minGapDays — for every item on the menu.
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findMany).mockResolvedValue([
      { id: "s1", name: "S1", accountId: "acct-A", isActive: true },
    ] as never)
    const rows = []
    for (let i = 0; i < 18; i += 1) {
      const d = new Date("2026-04-01T00:00:00Z")
      d.setUTCDate(d.getUTCDate() + i)
      const key = d.toISOString().slice(0, 10)
      for (const item of ["Burger", "Fries"]) rows.push(row(key, item, 10, 80))
    }
    vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue(rows as never)
    // Last posted day is 2026-04-18; asOf is 2026-04-20.
    const result = await getLostSales({
      storeId: "s1",
      asOf: new Date("2026-04-20T00:00:00Z"),
      lookbackDays: 30,
    })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.events).toHaveLength(0)
  })

  it("still flags one item that goes quiet while the rest of the menu sells", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findMany).mockResolvedValue([
      { id: "s1", name: "S1", accountId: "acct-A", isActive: true },
    ] as never)
    const rows = []
    for (let i = 0; i < 20; i += 1) {
      const d = new Date("2026-04-01T00:00:00Z")
      d.setUTCDate(d.getUTCDate() + i)
      const key = d.toISOString().slice(0, 10)
      rows.push(row(key, "Fries", 20, 100))
      // The Burger is off the pass on the 15th and 16th. The store is open.
      if (key !== "2026-04-15" && key !== "2026-04-16") {
        rows.push(row(key, "Burger", 10, 80))
      }
    }
    vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue(rows as never)
    const result = await getLostSales({
      storeId: "s1",
      asOf: new Date("2026-04-20T00:00:00Z"),
      lookbackDays: 30,
    })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.events).toHaveLength(1)
    const e = result.data.events[0]
    expect(e.itemName).toBe("Burger")
    expect(e.gapDays).toBe(2)
    expect(e.estimatedLostRevenue).toBeCloseTo(10 * 8 * 2, 5)
  })

  it("counts gap days a store was open, not calendar days it was shut", async () => {
    // The Burger is 86'd on the 13th and stays off; the store is then shut on
    // the 15th and 16th and reopens. Four calendar days pass with no Burger,
    // but only two of them were days it could have sold.
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findMany).mockResolvedValue([
      { id: "s1", name: "S1", accountId: "acct-A", isActive: true },
    ] as never)
    const closed = new Set(["2026-04-15", "2026-04-16"])
    const rows = []
    for (let i = 0; i < 20; i += 1) {
      const d = new Date("2026-04-01T00:00:00Z")
      d.setUTCDate(d.getUTCDate() + i)
      const key = d.toISOString().slice(0, 10)
      if (closed.has(key)) continue
      rows.push(row(key, "Fries", 20, 100))
      if (key !== "2026-04-13" && key !== "2026-04-14") {
        rows.push(row(key, "Burger", 10, 80))
      }
    }
    vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue(rows as never)
    const result = await getLostSales({
      storeId: "s1",
      asOf: new Date("2026-04-20T00:00:00Z"),
      lookbackDays: 30,
    })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.events).toHaveLength(1)
    expect(result.data.events[0].gapDays).toBe(2)
  })

  it("ignores leading zero runs at the very start of the window (no prior baseline)", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findMany).mockResolvedValue([
      { id: "s1", name: "S1", accountId: "acct-A", isActive: true },
    ] as never)
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
