import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}))

import { prisma } from "@/lib/prisma"
import { getExternalSignalStatus } from "@/lib/monitoring/queries"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getExternalSignalStatus", () => {
  it("reports geocode coverage, stale providers, backfill ranges, and model flavor", async () => {
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([
        { activeStores: 2, geocodedStores: 1, missingCoordinates: 1 },
      ] as never)
      .mockResolvedValueOnce([
        {
          storeId: "s1",
          storeName: "Store 1",
          weatherSyncedAt: new Date("2026-05-09T01:00:00Z"),
          eventSyncedAt: null,
          weatherRows: 240,
          eventRows: 0,
          rawEventRows: 0,
          radiusMiles: 2.1,
          radiusProvider: "predicthq-suggested-radius",
          radiusUpdatedAt: new Date("2026-05-09T00:00:00Z"),
          staleWeather: false,
          staleEvents: true,
          earliestWeatherDate: new Date("2026-01-01T00:00:00Z"),
          latestWeatherDate: new Date("2026-05-23T00:00:00Z"),
          earliestEventDate: null,
          latestEventDate: null,
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          target: "BUSY_HOURS",
          modelVersion: "xgboost-local-20260509-weather-events",
          startedAt: new Date("2026-05-09T02:00:00Z"),
          mape: 0.08,
          mae: 2.1,
        },
      ] as never)

    const status = await getExternalSignalStatus()

    expect(status.coverage.missingCoordinates).toBe(1)
    expect(status.freshness[0].staleEvents).toBe(true)
    expect(status.freshness[0].weatherRows).toBe(240)
    expect(status.freshness[0].radiusMiles).toBe(2.1)
    expect(status.promotedModels[0].modelVersion).toContain("weather-events")
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3)
  })
})
