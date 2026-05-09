// getPromoRoi — detects elevated-discount days and computes lift vs
// same-weekday baseline.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findFirst: vi.fn() },
    otterDailySummary: { findMany: vi.fn() },
  },
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { getPromoRoi } from "@/app/actions/forecasts/promo-roi-actions"

const sessionWith = (overrides: Record<string, unknown> = {}) => ({
  user: { id: "u1", accountId: "acct-A", ...overrides },
})

beforeEach(() => {
  vi.clearAllMocks()
})

interface DayFixture {
  date: string
  fpNet?: number
  tpNet?: number
  fpGross?: number
  tpGross?: number
  fpDisc?: number
  tpDisc?: number
}

function row(d: DayFixture) {
  return {
    date: new Date(`${d.date}T00:00:00Z`),
    fpNetSales: d.fpNet ?? 0,
    tpNetSales: d.tpNet ?? 0,
    fpGrossSales: d.fpGross ?? (d.fpNet ?? 0) + (d.fpDisc ?? 0),
    tpGrossSales: d.tpGross ?? (d.tpNet ?? 0) + (d.tpDisc ?? 0),
    fpDiscounts: d.fpDisc ?? 0,
    tpDiscounts: d.tpDisc ?? 0,
  }
}

describe("getPromoRoi", () => {
  it("returns null without a session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    expect(await getPromoRoi({})).toBeNull()
  })

  it("scopes to store_not_in_account when storeId belongs to another account", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findFirst).mockResolvedValue(null as never)
    expect(await getPromoRoi({ storeId: "stranger" })).toEqual({
      ok: false,
      error: "store_not_in_account",
    })
  })

  it("returns no_data when there are no daily-summary rows", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.otterDailySummary.findMany).mockResolvedValue([] as never)
    expect(await getPromoRoi({})).toEqual({ ok: false, error: "no_data" })
  })

  it("detects a promo Saturday with positive lift vs the prior Saturdays", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    // 4 prior Saturdays around $1000 net sales, no discounts.
    // 1 promo Saturday: $1500 net, $200 discount → 11.7% discount share.
    // Plus 4 Mondays @ $700 to make sure baseline is computed weekday-wise.
    const fixtures: DayFixture[] = [
      // Saturdays (weekday 6)
      { date: "2026-04-04", fpNet: 1000, fpGross: 1000 },
      { date: "2026-04-11", fpNet: 1000, fpGross: 1000 },
      { date: "2026-04-18", fpNet: 1000, fpGross: 1000 },
      { date: "2026-04-25", fpNet: 1000, fpGross: 1000 },
      { date: "2026-05-02", fpNet: 1500, fpDisc: 200, fpGross: 1700 }, // promo
      // Mondays (weekday 1) for variety
      { date: "2026-04-06", fpNet: 700, fpGross: 700 },
      { date: "2026-04-13", fpNet: 700, fpGross: 700 },
      { date: "2026-04-20", fpNet: 700, fpGross: 700 },
      { date: "2026-04-27", fpNet: 700, fpGross: 700 },
    ]
    vi.mocked(prisma.otterDailySummary.findMany).mockResolvedValue(
      fixtures.map(row) as never,
    )

    const result = await getPromoRoi({
      asOf: new Date("2026-05-08T00:00:00Z"),
    })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.events).toHaveLength(1)
    const e = result.data.events[0]
    expect(e.weekday).toBe(6) // Saturday
    expect(e.discount).toBe(200)
    expect(e.baselineNetSales).toBeCloseTo(1000, 5)
    expect(e.lift).toBeCloseTo(500, 5)
    expect(e.roi).toBeCloseTo(2.5, 5) // $500 lift per $200 discount
    expect(result.data.blendedRoi).toBeCloseTo(2.5, 5)
  })

  it("aggregates across FP+3P platforms within a single date", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    // Two summary rows on the same Saturday: one css-pos, one doordash.
    const fixtures: DayFixture[] = [
      { date: "2026-04-04", fpNet: 800, fpGross: 800 },
      { date: "2026-04-11", fpNet: 800, fpGross: 800 },
      { date: "2026-04-18", fpNet: 800, fpGross: 800 },
      { date: "2026-04-25", fpNet: 800, fpGross: 800 },
      { date: "2026-05-02", fpNet: 600, fpGross: 700, fpDisc: 100 },
      { date: "2026-05-02", tpNet: 400, tpGross: 500, tpDisc: 100 },
    ]
    vi.mocked(prisma.otterDailySummary.findMany).mockResolvedValue(
      fixtures.map(row) as never,
    )
    const result = await getPromoRoi({
      asOf: new Date("2026-05-08T00:00:00Z"),
    })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.events).toHaveLength(1)
    const e = result.data.events[0]
    expect(e.netSales).toBeCloseTo(1000, 5)
    expect(e.discount).toBeCloseTo(200, 5)
    expect(e.lift).toBeCloseTo(200, 5) // 1000 actual − 800 baseline
  })

  it("does not flag any days when discount share is uniformly negligible", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    // Every day under 1% discount → no campaign signature.
    const fixtures: DayFixture[] = Array.from({ length: 14 }, (_, i) => {
      const d = new Date("2026-04-01T00:00:00Z")
      d.setUTCDate(d.getUTCDate() + i)
      return {
        date: d.toISOString().slice(0, 10),
        fpNet: 1000,
        fpGross: 1005,
        fpDisc: 5,
      }
    })
    vi.mocked(prisma.otterDailySummary.findMany).mockResolvedValue(
      fixtures.map(row) as never,
    )
    const result = await getPromoRoi({
      asOf: new Date("2026-05-08T00:00:00Z"),
    })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.events).toHaveLength(0)
  })
})
