// Read-side server action for daily revenue forecasts. The Python ML
// pipeline (ml/run_nightly.py) writes rows; the dashboard ONLY reads. This
// test confirms auth, scoping, latest-generation deduplication, and that
// MAPE comes from the most recent successful MlTrainingRun.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findUnique: vi.fn() },
    forecastDailyRevenue: { findMany: vi.fn() },
    mlTrainingRun: { findFirst: vi.fn() },
  },
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { getRevenueForecast } from "@/app/actions/forecasts/revenue-forecast-actions"

const sessionWith = (overrides: Record<string, unknown> = {}) => ({
  user: { id: "u1", accountId: "acct-A", ...overrides },
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.mlTrainingRun.findFirst).mockResolvedValue(null as never)
})

describe("getRevenueForecast", () => {
  it("returns null when no session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    const result = await getRevenueForecast({ storeId: "s1" })
    expect(result).toBeNull()
  })

  it("rejects a store outside the caller's account", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "Store 1",
      accountId: "acct-OTHER",
    } as never)
    const result = await getRevenueForecast({ storeId: "s1" })
    expect(result).toEqual({ ok: false, error: "store_not_in_account" })
  })

  it("returns an empty days array (with a null generatedAt) when no forecasts exist yet", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "Store 1",
      accountId: "acct-A",
    } as never)
    vi.mocked(prisma.forecastDailyRevenue.findMany).mockResolvedValue([] as never)
    const result = await getRevenueForecast({ storeId: "s1" })
    expect(result).toEqual({
      ok: true,
      data: {
        storeId: "s1",
        storeName: "Store 1",
        generatedAt: null,
        openedAt: null,
        recentMape: null,
        days: [],
      },
    })
  })

  it("keeps only the most recent generation per forecastDate", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "Store 1",
      accountId: "acct-A",
    } as never)
    const day1 = new Date("2026-05-09")
    const day2 = new Date("2026-05-10")
    const oldGen = new Date("2026-05-07T01:00:00.000Z")
    const newGen = new Date("2026-05-08T01:00:00.000Z")
    vi.mocked(prisma.forecastDailyRevenue.findMany).mockResolvedValue([
      // Same forecastDate, newer generation wins
      {
        forecastDate: day1,
        predictedRevenue: 4000,
        p10: 3500,
        p90: 4500,
        modelVersion: "v2",
        generatedAt: newGen,
      },
      {
        forecastDate: day1,
        predictedRevenue: 3800,
        p10: 3300,
        p90: 4300,
        modelVersion: "v1",
        generatedAt: oldGen,
      },
      {
        forecastDate: day2,
        predictedRevenue: 4200,
        p10: 3700,
        p90: 4700,
        modelVersion: "v2",
        generatedAt: newGen,
      },
    ] as never)

    const result = await getRevenueForecast({
      storeId: "s1",
      asOf: new Date("2026-05-09"),
      horizonDays: 14,
    })
    if (!result || !result.ok) throw new Error("expected ok result")
    expect(result.data.days).toHaveLength(2)
    expect(result.data.days[0]).toMatchObject({ predictedRevenue: 4000, modelVersion: "v2" })
    expect(result.data.days[1]).toMatchObject({ predictedRevenue: 4200, modelVersion: "v2" })
    expect(result.data.generatedAt?.toISOString()).toBe(newGen.toISOString())
  })

  it("attaches recentMape from the most recent SUCCEEDED MlTrainingRun for REVENUE", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "Store 1",
      accountId: "acct-A",
    } as never)
    vi.mocked(prisma.forecastDailyRevenue.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.mlTrainingRun.findFirst).mockResolvedValue({ mape: 0.083 } as never)

    const result = await getRevenueForecast({ storeId: "s1" })
    if (!result || !result.ok) throw new Error("expected ok result")
    expect(result.data.recentMape).toBe(0.083)
    expect(prisma.mlTrainingRun.findFirst).toHaveBeenCalledWith({
      where: { target: "REVENUE", status: "SUCCEEDED", mape: { not: null } },
      orderBy: { startedAt: "desc" },
      select: { mape: true },
    })
  })
})
