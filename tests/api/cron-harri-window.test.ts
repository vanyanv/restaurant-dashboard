// The Harri labor window ends on the LA business date. It used to end at UTC
// midnight, which from 4-5pm Pacific is already tomorrow, so every evening run
// wrote a HarriDailyLabor row for a day that had not started.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextResponse } from "next/server"

vi.mock("@/lib/cron-auth", () => ({
  withCronAuth:
    (fn: (req: Request, ctx: { fromCron: boolean }) => Promise<Response>) => (req: Request) =>
      fn(req, { fromCron: true }),
  parseJsonBody: async (req: Request) => req.json(),
}))
// The cron path never reads Store, but the route imports prisma.
vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/harri-labor-sync", () => ({
  runHarriLaborSync: vi.fn(async () => ({ daysWritten: 0, positionsWritten: 0, alertsWritten: 0, rowsChanged: 0 })),
}))
vi.mock("@/lib/harri-schedule-sync", () => ({ runHarriScheduleSync: vi.fn(async () => ({})) }))
vi.mock("@/lib/harri-schedule", () => ({
  scheduleSyncWindow: () => ({ startDate: new Date("2026-11-16T00:00:00Z"), endDate: new Date("2026-11-29T00:00:00Z") }),
}))
vi.mock("@/lib/cache/cached", () => ({ bustTags: vi.fn(), monthTagsForRange: () => [] }))
vi.mock("@/lib/cache/closed-range", () => ({
  laIsoWeeksSpanning: () => [],
  withScopedWrites: async (_scope: unknown, fn: () => Promise<unknown>) => fn(),
}))

import { POST } from "@/app/api/cron/harri/route"
import { runHarriLaborSync } from "@/lib/harri-labor-sync"

const post = () =>
  (POST as unknown as (r: Request) => Promise<NextResponse>)(
    new Request("http://test.local/api/cron/harri", {
      method: "POST",
      body: JSON.stringify({ storeId: "s1", days: 3 }),
    }),
  )

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.useRealTimers())

describe("POST /api/cron/harri window", () => {
  it("ends on today's LA date in the evening, not tomorrow's UTC date", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-20T02:30:00Z")) // Nov 19, 6:30pm PST
    await post()
    const { startDate, endDate } = vi.mocked(runHarriLaborSync).mock.calls[0][0]
    expect(endDate.toISOString()).toBe("2026-11-19T00:00:00.000Z")
    expect(startDate.toISOString()).toBe("2026-11-17T00:00:00.000Z")
  })

  it("matches the UTC date in the morning", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-20T17:00:00Z")) // Nov 20, 9am PST
    await post()
    const { endDate } = vi.mocked(runHarriLaborSync).mock.calls[0][0]
    expect(endDate.toISOString()).toBe("2026-11-20T00:00:00.000Z")
  })
})
