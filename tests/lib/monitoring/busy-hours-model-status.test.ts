import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}))

import { prisma } from "@/lib/prisma"
import { getBusyHoursModelStatus } from "@/lib/monitoring/queries"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getBusyHoursModelStatus", () => {
  it("surfaces stale Harri coverage, stale forecasts, failed runs, and accuracy", async () => {
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([
        {
          storeId: "s1",
          startedAt: new Date("2026-05-09T02:00:00Z"),
          completedAt: new Date("2026-05-09T02:05:00Z"),
          status: "FAILED",
          mape: null,
          mae: null,
          sampleSize: null,
          errorMessage: "insufficient_hourly_history",
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          storeId: "s1",
          storeName: "Store 1",
          daysWithLabor: 20,
          coveragePct: 20 / 90,
          lastSyncedAt: new Date("2026-05-08T02:00:00Z"),
          insufficient: true,
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          storeId: "s1",
          storeName: "Store 1",
          latestGeneratedAt: null,
          latestForecastDate: null,
          forecastRows: 0,
          stale: true,
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          reconciledRows: 48,
          mape: 0.12,
          mae: 3.5,
        },
      ] as never)

    const status = await getBusyHoursModelStatus()

    expect(status.runs[0].status).toBe("FAILED")
    expect(status.runs[0].errorMessage).toBe("insufficient_hourly_history")
    expect(status.harriCoverage[0].insufficient).toBe(true)
    expect(status.staleForecasts[0].stale).toBe(true)
    expect(status.accuracy).toEqual({ reconciledRows: 48, mape: 0.12, mae: 3.5 })
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(4)
  })

  it("returns an empty accuracy object when no reconciled rows exist", async () => {
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)

    const status = await getBusyHoursModelStatus()

    expect(status.accuracy).toEqual({ reconciledRows: 0, mape: null, mae: null })
  })
})
