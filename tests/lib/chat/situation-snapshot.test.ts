/*
 * The chat's "what's happening right now" snapshot cuts days in Los Angeles.
 *
 * `OtterDailySummary.date` and `AnomalyEvent.occurredOn` are `@db.Date`
 * business days. The snapshot floored `now` at UTC midnight, so from 5pm
 * Pacific (midnight UTC) "today" was already tomorrow: the trailing 7 days
 * slid a day forward every evening and took in the half-finished day it says
 * it excludes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    otterDailySummary: { groupBy: vi.fn() },
    anomalyEvent: { count: vi.fn() },
    forecastDailyRevenue: { findFirst: vi.fn() },
  },
}))
vi.mock("@/lib/account-stores", () => ({ getAccountStores: vi.fn() }))

import { prisma } from "@/lib/prisma"
import { getAccountStores } from "@/lib/account-stores"
import { buildSituationSnapshot } from "@/lib/chat/situation-snapshot"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  asMock(getAccountStores).mockResolvedValue([{ id: "holly", name: "Hollywood" }])
  asMock(prisma.otterDailySummary.groupBy).mockResolvedValue([])
  asMock(prisma.anomalyEvent.count).mockResolvedValue(0)
  asMock(prisma.forecastDailyRevenue.findFirst).mockResolvedValue(null)
})

describe("situation snapshot · business days", () => {
  it("at 8pm Pacific, today is still the LA day, not tomorrow's UTC day", async () => {
    // 2026-10-20 20:00 PDT = 2026-10-21 03:00 UTC.
    const text = await buildSituationSnapshot("acct_evening", new Date("2026-10-21T03:00:00Z"))
    const where = asMock(prisma.otterDailySummary.groupBy).mock.calls[0][0].where
    expect(where.date).toEqual({
      gte: new Date("2026-10-13T00:00:00.000Z"),
      lt: new Date("2026-10-20T00:00:00.000Z"),
    })
    expect(asMock(prisma.anomalyEvent.count).mock.calls[0][0].where.occurredOn).toEqual({
      gte: new Date("2026-10-13T00:00:00.000Z"),
    })
    expect(text).toContain("2026-10-13 → 2026-10-20")
  })

  it("in the morning the window is the same seven days", async () => {
    await buildSituationSnapshot("acct_morning", new Date("2026-10-20T16:00:00Z"))
    const where = asMock(prisma.otterDailySummary.groupBy).mock.calls[0][0].where
    expect(where.date.lt).toEqual(new Date("2026-10-20T00:00:00.000Z"))
  })
})
