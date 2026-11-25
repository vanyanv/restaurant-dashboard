// A manual (owner-session) trigger of /api/cron/harri may only sync a store in
// the caller's own account. The owner fallback in withCronAuth proves the
// caller owns SOME account; before this check, posting another account's
// storeId synced that store. Cron runs stay unscoped.
// (A thrown lookup surfaces as Next's 500; it is not mapped to 404.)

import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

const ctx = { fromCron: false, accountId: "acct-a" as string | null }

vi.mock("@/lib/cron-auth", () => ({
  withCronAuth:
    (fn: (req: Request, c: typeof ctx) => Promise<Response>) => (req: Request) =>
      fn(req, ctx),
  parseJsonBody: async (req: Request) => req.json(),
}))
vi.mock("@/lib/prisma", () => ({ prisma: { store: { findFirst: vi.fn() } } }))
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
import { prisma } from "@/lib/prisma"
import { runHarriLaborSync } from "@/lib/harri-labor-sync"
import { runHarriScheduleSync } from "@/lib/harri-schedule-sync"

const post = (storeId: string) =>
  (POST as unknown as (r: Request) => Promise<NextResponse>)(
    new Request("http://test.local/api/cron/harri", {
      method: "POST",
      body: JSON.stringify({ storeId }),
    }),
  )

beforeEach(() => {
  vi.clearAllMocks()
  ctx.fromCron = false
  ctx.accountId = "acct-a"
})

describe("POST /api/cron/harri account scope", () => {
  it("refuses another account's store with 404 and syncs nothing", async () => {
    vi.mocked(prisma.store.findFirst).mockResolvedValue(null)
    const res = await post("store-of-account-b")
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "Store not found" })
    expect(vi.mocked(prisma.store.findFirst).mock.calls[0][0]).toMatchObject({
      where: { id: "store-of-account-b", accountId: "acct-a" },
    })
    expect(runHarriLaborSync).not.toHaveBeenCalled()
    expect(runHarriScheduleSync).not.toHaveBeenCalled()
  })

  it("syncs the caller's own store", async () => {
    vi.mocked(prisma.store.findFirst).mockResolvedValue({ id: "s1" } as never)
    const res = await post("s1")
    expect(res.status).toBe(200)
    expect(runHarriLaborSync).toHaveBeenCalledOnce()
  })

  it("a database error is a 500, not a misleading 404", async () => {
    vi.mocked(prisma.store.findFirst).mockRejectedValue(new Error("db down"))
    await expect(post("s1")).rejects.toThrow("db down")
    expect(runHarriLaborSync).not.toHaveBeenCalled()
  })

  it("a cron run skips the account check", async () => {
    ctx.fromCron = true
    ctx.accountId = null
    const res = await post("s1")
    expect(res.status).toBe(200)
    expect(prisma.store.findFirst).not.toHaveBeenCalled()
    expect(runHarriLaborSync).toHaveBeenCalledOnce()
  })
})
