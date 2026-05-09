// getLaborStaffingForecast — deterministic projection from forecasted
// daily revenue × historical hour-of-day shape × avg ticket. Verifies the
// math + the auth/scope guards.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findUnique: vi.fn() },
    forecastDailyRevenue: { findMany: vi.fn() },
    otterHourlySummary: { findMany: vi.fn() },
    otterDailySummary: { groupBy: vi.fn() },
  },
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { getLaborStaffingForecast } from "@/app/actions/forecasts/labor-staffing-actions"
import {
  COVERS_PER_STAFF_HOUR,
  MIN_STAFF,
} from "@/app/actions/forecasts/labor-staffing-constants"

const sessionWith = (overrides: Record<string, unknown> = {}) => ({
  user: { id: "u1", accountId: "acct-A", ...overrides },
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getLaborStaffingForecast", () => {
  it("returns null without a session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    expect(await getLaborStaffingForecast({ storeId: "s1" })).toBeNull()
  })

  it("rejects a cross-account store", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "S1",
      accountId: "acct-OTHER",
    } as never)
    expect(await getLaborStaffingForecast({ storeId: "s1" })).toEqual({
      ok: false,
      error: "store_not_in_account",
    })
  })

  it("returns insufficient_history when there's no hourly data", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "S1",
      accountId: "acct-A",
    } as never)
    vi.mocked(prisma.forecastDailyRevenue.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.otterHourlySummary.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.otterDailySummary.groupBy).mockResolvedValue([] as never)
    expect(await getLaborStaffingForecast({ storeId: "s1" })).toEqual({
      ok: false,
      error: "insufficient_history",
    })
  })

  it("converts predicted revenue → orders → hourly share → staff with the floor honored", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "S1",
      accountId: "acct-A",
    } as never)

    // asOf is a Friday in UTC: 2026-05-08 is a Friday → weekday=5
    const asOf = new Date("2026-05-08T12:00:00Z")
    const day0 = new Date("2026-05-08T00:00:00Z")

    // 28-day rolling history: avgTicket = totalRevenue/totalOrders =
    //   (28000 + 0) / 1000 = 28
    vi.mocked(prisma.otterDailySummary.groupBy).mockResolvedValue([
      {
        date: new Date("2026-05-01"),
        _sum: { fpNetSales: 28000, tpNetSales: 0, fpOrderCount: 1000, tpOrderCount: 0 },
      },
    ] as never)

    // Hourly: only hour 12 had any orders historically — share = 1.0
    // 4 weeks of identical Fridays at 50 orders / hour 12.
    const fridayHourlyRows = Array.from({ length: 4 }, (_, i) => ({
      date: new Date(`2026-04-0${3 + i * 7}T00:00:00Z`),
      hour: 12,
      orderCount: 50,
    }))
    vi.mocked(prisma.otterHourlySummary.findMany).mockResolvedValue(fridayHourlyRows as never)

    // Forecasted revenue for day0 = $5,600 → predictedOrders = 5600/28 = 200
    vi.mocked(prisma.forecastDailyRevenue.findMany).mockResolvedValue([
      {
        forecastDate: day0,
        predictedRevenue: 5600,
        generatedAt: new Date("2026-05-08T01:00:00Z"),
      },
    ] as never)

    const result = await getLaborStaffingForecast({
      storeId: "s1",
      horizonDays: 1,
      asOf,
    })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.meanAvgTicket).toBeCloseTo(28, 5)
    expect(result.data.days).toHaveLength(1)
    const day = result.data.days[0]
    expect(day.predictedOrders).toBeCloseTo(200, 5)

    // Hour 12 carries 100% of the orders → 200 orders → ceil(200/12) = 17,
    // bounded below by MIN_STAFF (which is well below 17 anyway).
    const hour12 = day.hours.find((h) => h.hour === 12)!
    expect(hour12.recommendedStaff).toBe(Math.ceil(200 / COVERS_PER_STAFF_HOUR))

    // Hours with no historical orders → recommendedStaff = 0 (closed)
    const hour3 = day.hours.find((h) => h.hour === 3)!
    expect(hour3.recommendedStaff).toBe(0)

    expect(MIN_STAFF).toBeGreaterThanOrEqual(2)
  })

  it("respects the MIN_STAFF floor on light hours that historically had a few orders", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "S1",
      accountId: "acct-A",
    } as never)
    const asOf = new Date("2026-05-08T12:00:00Z")
    const day0 = new Date("2026-05-08T00:00:00Z")

    vi.mocked(prisma.otterDailySummary.groupBy).mockResolvedValue([
      {
        date: new Date("2026-05-01"),
        _sum: { fpNetSales: 2800, tpNetSales: 0, fpOrderCount: 100, tpOrderCount: 0 },
      },
    ] as never)
    // Two hours: 11 with 80 orders, 12 with 5 orders — share for 12 is small
    vi.mocked(prisma.otterHourlySummary.findMany).mockResolvedValue([
      { date: new Date("2026-04-03T00:00:00Z"), hour: 11, orderCount: 80 },
      { date: new Date("2026-04-03T00:00:00Z"), hour: 12, orderCount: 5 },
    ] as never)
    vi.mocked(prisma.forecastDailyRevenue.findMany).mockResolvedValue([
      {
        forecastDate: day0,
        predictedRevenue: 280,
        generatedAt: new Date("2026-05-08T01:00:00Z"),
      },
    ] as never)
    // predictedOrders = 280/28 = 10. Hour-12 share = 5/85 ≈ 0.059 → ~0.59
    // orders → ceil(0.59/12) = 1, then floor MIN_STAFF kicks in.
    const result = await getLaborStaffingForecast({
      storeId: "s1",
      horizonDays: 1,
      asOf,
    })
    if (!result || !result.ok) throw new Error("expected ok")
    const hour12 = result.data.days[0].hours.find((h) => h.hour === 12)!
    expect(hour12.recommendedStaff).toBe(MIN_STAFF)
  })
})
