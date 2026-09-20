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

/** The average month the whole app prorates a monthly fixed cost over. */
const DAYS_PER_MONTH = 365.25 / 12

/**
 * The action makes two raw queries, in this order inside one `Promise.all`:
 * the revenue forecast, then the trailing channel mix the commission blend is
 * weighted by. A single `mockResolvedValue` answers both with the same rows,
 * which left the blend with no platform rows at all and silently falling back.
 */
function mockRaw(
  revenue: { forecastDate: Date; predictedRevenue: number }[],
  mix: { storeId: string; platform: string; net: number }[],
) {
  vi.mocked(prisma.$queryRaw)
    .mockResolvedValueOnce(revenue as never)
    .mockResolvedValueOnce(mix as never)
}

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
    mockRaw(
      [
        { forecastDate: day0, predictedRevenue: 5000 },
        { forecastDate: day1, predictedRevenue: 5000 },
      ],
      // Everything the store sold went through the two commissioned
      // marketplaces, both at 20%, so the whole-revenue blend IS 20%.
      [
        { storeId: "s1", platform: "ubereats", net: 5000 },
        { storeId: "s1", platform: "doordash", net: 5000 },
      ],
    )
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
    // Pro-rated over the AVERAGE month, the same divisor the P&L uses for the
    // same rent. `/ 30` here made the daily figure 1.5% higher than the P&L's.
    expect(result.data.proRatedFixedDaily).toBeCloseTo(36000 / DAYS_PER_MONTH, 5)
    const fixed = 36000 / DAYS_PER_MONTH
    expect(result.data.days).toHaveLength(2)
    // Day 0: 4000 inflow − 0 payables − fixed
    expect(result.data.days[0].netCashFlow).toBeCloseTo(4000 - fixed, 5)
    expect(result.data.days[0].cumulativeNet).toBeCloseTo(4000 - fixed, 5)
    // Day 1: 4000 inflow − 1000 payables − fixed
    expect(result.data.days[1].netCashFlow).toBeCloseTo(4000 - 1000 - fixed, 5)
    expect(result.data.days[1].cumulativeNet).toBeCloseTo(8000 - 1000 - 2 * fixed, 5)
    expect(result.data.unforecastDays).toBe(0)
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
        isActive: true,
      },
      {
        id: "s2",
        uberCommissionRate: 0.2,
        doordashCommissionRate: 0.2,
        fixedMonthlyLabor: 30000,
        fixedMonthlyRent: 6000,
        fixedMonthlyTowels: 0,
        fixedMonthlyCleaning: 0,
        isActive: true,
      },
    ] as never)
    const day = new Date("2026-05-09T00:00:00Z")
    mockRaw(
      [{ forecastDate: day, predictedRevenue: 6000 }],
      [
        { storeId: "s1", platform: "ubereats", net: 1000 },
        { storeId: "s1", platform: "doordash", net: 1000 },
        { storeId: "s2", platform: "ubereats", net: 1000 },
        { storeId: "s2", platform: "doordash", net: 1000 },
      ],
    )
    const result = await getCashPositionForecast({
      horizonDays: 1,
      asOf: day,
    })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.proRatedFixedDaily).toBeCloseTo(72000 / DAYS_PER_MONTH, 5)
    // Inflow = 6000 × 0.8 = 4800
    expect(result.data.days[0].estimatedNetInflow).toBeCloseTo(4800, 5)
  })

  it("charges commission against marketplace sales only, not in-house ones", async () => {
    // The blend used to be `(uberRate + doordashRate) / 2` and was charged
    // against every dollar of predicted revenue. This store takes half its
    // trade over its own counter, where no marketplace takes a cut, so 23%
    // off the whole line understated daily cash by more than a tenth.
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "S1",
      accountId: "acct-A",
      uberCommissionRate: 0.21,
      doordashCommissionRate: 0.25,
      fixedMonthlyLabor: 0,
      fixedMonthlyRent: 0,
      fixedMonthlyTowels: 0,
      fixedMonthlyCleaning: 0,
    } as never)
    const day = new Date("2026-05-09T00:00:00Z")
    mockRaw(
      [{ forecastDate: day, predictedRevenue: 10000 }],
      [
        { storeId: "s1", platform: "css-pos", net: 5000 },
        { storeId: "s1", platform: "ubereats", net: 3000 },
        { storeId: "s1", platform: "doordash", net: 2000 },
      ],
    )
    const result = await getCashPositionForecast({ storeId: "s1", horizonDays: 1, asOf: day })
    if (!result || !result.ok) throw new Error("expected ok")
    // (3000 × 0.21 + 2000 × 0.25) / 10000 = 0.113, not (0.21 + 0.25) / 2.
    expect(result.data.blendedCommissionRate).toBeCloseTo(0.113, 5)
    expect(result.data.days[0].estimatedNetInflow).toBeCloseTo(8870, 5)
  })

  it("weights the blend by what each channel actually sold", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "S1",
      accountId: "acct-A",
      uberCommissionRate: 0.2,
      doordashCommissionRate: 0.3,
      fixedMonthlyLabor: 0,
      fixedMonthlyRent: 0,
      fixedMonthlyTowels: 0,
      fixedMonthlyCleaning: 0,
    } as never)
    const day = new Date("2026-05-09T00:00:00Z")
    mockRaw(
      [{ forecastDate: day, predictedRevenue: 1000 }],
      [
        // Nine dollars on Uber for every one on DoorDash. An unweighted mean
        // of the two rates gives 25%; the store actually pays 21%.
        { storeId: "s1", platform: "ubereats", net: 9000 },
        { storeId: "s1", platform: "doordash", net: 1000 },
      ],
    )
    const result = await getCashPositionForecast({ storeId: "s1", horizonDays: 1, asOf: day })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.blendedCommissionRate).toBeCloseTo(0.21, 5)
  })

  it("leaves Grubhub in the denominator with nothing in the numerator", async () => {
    // Otter publishes no commission row for it and `Store` has no rate column,
    // so it is sales with no measured commission — the same convention
    // `channel-series.ts` applies. Inventing a rate would be worse.
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "S1",
      accountId: "acct-A",
      uberCommissionRate: 0.2,
      doordashCommissionRate: 0.2,
      fixedMonthlyLabor: 0,
      fixedMonthlyRent: 0,
      fixedMonthlyTowels: 0,
      fixedMonthlyCleaning: 0,
    } as never)
    const day = new Date("2026-05-09T00:00:00Z")
    mockRaw(
      [{ forecastDate: day, predictedRevenue: 1000 }],
      [
        { storeId: "s1", platform: "ubereats", net: 5000 },
        { storeId: "s1", platform: "grubhub", net: 5000 },
      ],
    )
    const result = await getCashPositionForecast({ storeId: "s1", horizonDays: 1, asOf: day })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.blendedCommissionRate).toBeCloseTo(0.1, 5)
  })

  it("withholds the running total from the first day with no forecast", async () => {
    // Two stores have no successfully trained forecast at all. `?? 0` charged
    // their whole horizon of fixed costs and payables against nothing coming
    // in, and the morning briefing led with a cash crisis that was a training
    // failure.
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "S1",
      accountId: "acct-A",
      uberCommissionRate: 0.2,
      doordashCommissionRate: 0.2,
      fixedMonthlyLabor: 30000,
      fixedMonthlyRent: 0,
      fixedMonthlyTowels: 0,
      fixedMonthlyCleaning: 0,
    } as never)
    const day0 = new Date("2026-05-09T00:00:00Z")
    mockRaw(
      // Day 0 forecast, days 1 and 2 missing.
      [{ forecastDate: day0, predictedRevenue: 5000 }],
      [{ storeId: "s1", platform: "ubereats", net: 5000 }],
    )
    const result = await getCashPositionForecast({ storeId: "s1", horizonDays: 3, asOf: day0 })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.days[0].cumulativeNet).not.toBeNull()
    expect(result.data.days[1].predictedRevenue).toBeNull()
    expect(result.data.days[1].estimatedNetInflow).toBeNull()
    expect(result.data.days[1].netCashFlow).toBeNull()
    expect(result.data.days[1].cumulativeNet).toBeNull()
    // And it does not resume: a running total cannot step over an unknown.
    expect(result.data.days[2].cumulativeNet).toBeNull()
    expect(result.data.endingCumulativeNet).toBeNull()
    expect(result.data.unforecastDays).toBe(2)
    // The payables on those days are still real and still counted.
    expect(result.data.days[1].proRatedFixedCosts).toBeGreaterThan(0)
  })

  it("falls back to a whole-revenue blend when the store has no trailing sales", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "S1",
      accountId: "acct-A",
      uberCommissionRate: 0.21,
      doordashCommissionRate: 0.25,
      fixedMonthlyLabor: 0,
      fixedMonthlyRent: 0,
      fixedMonthlyTowels: 0,
      fixedMonthlyCleaning: 0,
    } as never)
    const day = new Date("2026-05-09T00:00:00Z")
    mockRaw([{ forecastDate: day, predictedRevenue: 1000 }], [])
    const result = await getCashPositionForecast({ storeId: "s1", horizonDays: 1, asOf: day })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.blendedCommissionRate).toBeCloseTo(0.13, 5)
  })
})
