/**
 * The Otter sync's store list. With `?skipRecent=1` (otter-sync.yml on a run
 * with no explicit lookback) it leaves out stores whose metrics sync
 * succeeded in the last 20 minutes; when that leaves none, the answer is a
 * clear skip, no JobRun row is written, and the workflow's matrix is empty.
 * Without it (an explicit backfill, or otter-drain) every store is listed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {}, hasOwnerAccess: () => true }))
vi.mock("@/lib/prisma-retry", () => ({ withPrismaRetry: <T>(fn: () => Promise<T>) => fn() }))
vi.mock("@/lib/monitoring/job-alerts", () => ({ evaluateJobAlert: vi.fn(async () => {}) }))

const db = vi.hoisted(() => ({
  otterStore: { findMany: vi.fn() },
  jobRun: {
    findMany: vi.fn(),
    create: vi.fn(async () => ({ id: "jr1", startedAt: new Date() })),
    update: vi.fn(async () => ({})),
  },
}))
vi.mock("@/lib/prisma", () => ({ prisma: db }))

import { GET } from "@/app/api/cron/otter/stores/route"
import type { NextRequest } from "next/server"

const SECRET = "test-cron-secret"
const req = (qs = "") =>
  new Request(`http://test.local/api/cron/otter/stores${qs}`, {
    headers: { authorization: `Bearer ${SECRET}` },
  }) as unknown as NextRequest

const open = { isActive: true, lifecycleStage: "operating" }
const OTTER_STORES = [
  { otterStoreId: "o-b", storeId: "s-b", store: { id: "s-b", name: "Bravo", ...open } },
  { otterStoreId: "o-a1", storeId: "s-a", store: { id: "s-a", name: "Alpha", ...open } },
  { otterStoreId: "o-a2", storeId: "s-a", store: { id: "s-a", name: "Alpha", ...open } },
]

/** A recent "internal" metrics run; by default one that did what the scheduled run does. */
function run(storeId: string, over: Record<string, unknown> = {}) {
  const startedAt = new Date(Date.now() - 5 * 60 * 1000)
  return {
    storeId,
    startedAt,
    metadata: {
      windowStart: new Date(startedAt.getTime() - 3 * 86_400_000).toISOString(),
      windowEnd: startedAt.toISOString(),
      dailyOnly: false,
      includeRatings: true,
      ...over,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = SECRET
  db.otterStore.findMany.mockResolvedValue(OTTER_STORES)
  db.jobRun.findMany.mockResolvedValue([])
})

describe("GET /api/cron/otter/stores", () => {
  it("lists every store, as before, without skipRecent", async () => {
    const body = await (await GET(req())).json()
    expect(body.stores.map((s: { storeId: string }) => s.storeId)).toEqual(["s-a", "s-b"])
    expect(body.stores[0].otterStoreIds).toEqual(["o-a1", "o-a2"])
    expect(db.jobRun.findMany).not.toHaveBeenCalled()
    expect(db.jobRun.create).toHaveBeenCalledTimes(1)
  })

  it("leaves out a store whose sync just succeeded", async () => {
    db.jobRun.findMany.mockResolvedValue([run("s-a")])
    const body = await (await GET(req("?skipRecent=1"))).json()
    expect(body.stores.map((s: { storeId: string }) => s.storeId)).toEqual(["s-b"])
    expect(body.skippedRecent).toEqual(["s-a"])
    expect(db.jobRun.create).toHaveBeenCalledTimes(1)
    const where = db.jobRun.findMany.mock.calls[0][0].where
    expect(where).toMatchObject({ jobName: "otter.metrics.sync", triggeredBy: "internal", status: "SUCCESS" })
  })

  it("skips the whole run, writing nothing, when every store just synced", async () => {
    db.jobRun.findMany.mockResolvedValue([run("s-a"), run("s-b")])
    const body = await (await GET(req("?skipRecent=1"))).json()
    expect(body).toEqual({ skipped: "recent-success", stores: [] })
    expect(db.jobRun.create).not.toHaveBeenCalled()
    expect(db.jobRun.update).not.toHaveBeenCalled()
    // One read of the store list, not a second inside the run.
    expect(db.otterStore.findMany).toHaveBeenCalledTimes(1)
  })

  it("does not let a backfill chunk or a daily-only run stand in for the scheduled sync", async () => {
    const old = run("s-a")
    db.jobRun.findMany.mockResolvedValue([
      // an older 30-day backfill chunk that ends weeks ago
      run("s-a", {
        windowStart: new Date(old.startedAt.getTime() - 60 * 86_400_000).toISOString(),
        windowEnd: new Date(old.startedAt.getTime() - 30 * 86_400_000).toISOString(),
      }),
      run("s-b", { dailyOnly: true, includeRatings: false }),
    ])
    const body = await (await GET(req("?skipRecent=1"))).json()
    expect(body.stores.map((s: { storeId: string }) => s.storeId)).toEqual(["s-a", "s-b"])
  })

  it("does not let a run with failed fetches stand in for the scheduled sync", async () => {
    db.jobRun.findMany.mockResolvedValue([
      run("s-a", { problems: ["categories: fetch failed for 1/4 days (2026-11-18)"] }),
      run("s-b", { problems: [] }),
    ])
    const body = await (await GET(req("?skipRecent=1"))).json()
    expect(body.stores.map((s: { storeId: string }) => s.storeId)).toEqual(["s-a"])
  })
})
