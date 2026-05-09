// getCashPositionForecast — joins ForecastDailyRevenue × Invoice.dueDate ×
// per-store fixed monthly costs into a per-day cash-flow projection.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    store: { findUnique: vi.fn(), findMany: vi.fn() },
    invoice: { groupBy: vi.fn() },
  },
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { getCashPositionForecast } from "@/app/actions/forecasts/cash-position-actions"

const sessionWith = (overrides: Record<string, unknown> = {}) => ({
  user: { id: "u1", accountId: "acct-A", ...overrides },
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.invoice.groupBy).mockResolvedValue([] as never)
  vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never)
})

describe("getCashPositionForecast", () => {
  it("returns null without a session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    expect(await getCashPositionForecast({})).toBeNull()
  })

  it("rejects a cross-account store", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "S1",
      accountId: "acct-OTHER",
    } as never)
    expect(await getCashPositionForecast({ storeId: "s1" })).toEqual({
      ok: false,
      error: "store_not_in_account",
    })
  })

  it("computes net inflow = revenue × (1 − blended commission), subtracts payables + pro-rated fixed costs", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "S1",
      accountId: "acct-A",
      uberCommissionRate: 0.2,
      doordashCommissionRate: 0.2,
      fixedMonthlyLabor: 30000,
      fixedMonthlyRent: 6000,
      fixedMonthlyTowels: 0,
      fixedMonthlyCleaning: 0,
    } as never)
    // Two days of forecast: $5,000 each. 20% commission → $4,000 net inflow.
    const day0 = new Date("2026-05-09T00:00:00Z")
    const day1 = new Date("2026-05-10T00:00:00Z")
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      {
        forecastDate: day0,
        predictedRevenue: 5000,
      },
      {
        forecastDate: day1,
        predictedRevenue: 5000,
      },
    ] as never)
    // One invoice due on day1 for $1,000
    vi.mocked(prisma.invoice.groupBy).mockResolvedValue([
      { dueDate: day1, _sum: { totalAmount: 1000 } },
    ] as never)

    const result = await getCashPositionForecast({
      storeId: "s1",
      horizonDays: 2,
      asOf: day0,
    })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.blendedCommissionRate).toBeCloseTo(0.2, 5)
    // Pro-rated fixed = (30000 + 6000) / 30 = 1200 / day
    expect(result.data.proRatedFixedDaily).toBeCloseTo(1200, 5)
    expect(result.data.days).toHaveLength(2)
    // Day 0: 4000 inflow − 0 payables − 1200 fixed = 2800
    expect(result.data.days[0].netCashFlow).toBeCloseTo(2800, 5)
    expect(result.data.days[0].cumulativeNet).toBeCloseTo(2800, 5)
    // Day 1: 4000 inflow − 1000 payables − 1200 fixed = 1800
    expect(result.data.days[1].netCashFlow).toBeCloseTo(1800, 5)
    // Cumulative: 2800 + 1800 = 4600
    expect(result.data.days[1].cumulativeNet).toBeCloseTo(4600, 5)
    expect(result.data.totalEstimatedInflow).toBeCloseTo(8000, 5)
    expect(result.data.totalScheduledPayables).toBeCloseTo(1000, 5)
  })

  it("rolls across all owned stores when no storeId is supplied", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findMany).mockResolvedValue([
      {
        id: "s1",
        uberCommissionRate: 0.2,
        doordashCommissionRate: 0.2,
        fixedMonthlyLabor: 30000,
        fixedMonthlyRent: 6000,
        fixedMonthlyTowels: 0,
        fixedMonthlyCleaning: 0,
      },
      {
        id: "s2",
        uberCommissionRate: 0.2,
        doordashCommissionRate: 0.2,
        fixedMonthlyLabor: 30000,
        fixedMonthlyRent: 6000,
        fixedMonthlyTowels: 0,
        fixedMonthlyCleaning: 0,
      },
    ] as never)
    const day = new Date("2026-05-09T00:00:00Z")
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      {
        forecastDate: day,
        predictedRevenue: 6000,
      },
    ] as never)
    const result = await getCashPositionForecast({
      horizonDays: 1,
      asOf: day,
    })
    if (!result || !result.ok) throw new Error("expected ok")
    // Pro-rated fixed across two stores: (36000 + 36000)/30 = 2400 / day
    expect(result.data.proRatedFixedDaily).toBeCloseTo(2400, 5)
    // Inflow per day = (3000 + 3000) × 0.8 = 4800
    expect(result.data.days[0].estimatedNetInflow).toBeCloseTo(4800, 5)
  })
})
