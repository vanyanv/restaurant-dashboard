/**
 * /api/cron/cogs/sweep and /api/cron/cogs/stores after the sweep itself moved
 * to `@/lib/cogs-sweep-job` (so the GitHub Actions runner can run it). The
 * endpoints stay for a sweep triggered by hand, and must answer what they
 * answered before: the same statuses and the same JSON.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => null) }))
vi.mock("@/lib/auth", () => ({ authOptions: {}, hasOwnerAccess: () => false }))
vi.mock("@/lib/cache/redis", () => ({ getRedis: () => null }))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

const job = vi.hoisted(() => ({
  runCogsSweepForStore: vi.fn(),
  listCogsSweepStores: vi.fn(),
}))
vi.mock("@/lib/cogs-sweep-job", async (orig) => {
  const real = await orig<typeof import("@/lib/cogs-sweep-job")>()
  return { ...real, ...job }
})
// The real module imports these at load; none is reached through the mocks.
vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/cogs-materializer", () => ({ recomputeDailyCogsForRange: vi.fn() }))

import { POST } from "@/app/api/cron/cogs/sweep/route"
import { GET } from "@/app/api/cron/cogs/stores/route"
import { CogsSweepFailedError, CogsSweepStoreNotFoundError } from "@/lib/cogs-sweep-job"
import type { NextRequest } from "next/server"

const SECRET = "test-cron-secret"
const req = (path: string, method: "GET" | "POST", auth = true) =>
  new Request(`http://test.local${path}`, {
    method,
    headers: auth ? { authorization: `Bearer ${SECRET}` } : {},
  }) as unknown as NextRequest

const RESULT = {
  storeId: "s1",
  storeName: "Hollywood",
  lookbackDays: 3,
  force: false,
  skipped: false,
  skipReason: null,
  sourceChangedAt: null,
  lastSuccessfulSweepAt: null,
  daysProcessed: 3,
  rowsUpserted: 40,
  rowsDeleted: 1,
  rowsChanged: 5,
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = SECRET
  job.runCogsSweepForStore.mockResolvedValue(RESULT)
  job.listCogsSweepStores.mockResolvedValue({
    stores: [{ id: "s1", name: "Hollywood", accountId: "a" }],
    activeStoreCount: 2,
    skippedEmptyStoreCount: 1,
    force: false,
  })
})

describe("POST /api/cron/cogs/sweep", () => {
  it("is refused without the cron secret", async () => {
    const res = await POST(req("/api/cron/cogs/sweep?storeId=s1", "POST", false))
    expect(res.status).toBe(401)
    expect(job.runCogsSweepForStore).not.toHaveBeenCalled()
  })

  it("answers the sweep's result plus how long it took", async () => {
    const res = await POST(req("/api/cron/cogs/sweep?storeId=s1", "POST"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject(RESULT)
    expect(typeof body.durationMs).toBe("number")
    expect(job.runCogsSweepForStore).toHaveBeenCalledWith({
      storeId: "s1",
      lookbackDays: 3,
      force: false,
      triggeredBy: "github-actions",
    })
  })

  it("passes lookbackDays and force through", async () => {
    await POST(req("/api/cron/cogs/sweep?storeId=s1&lookbackDays=30&force=true", "POST"))
    expect(job.runCogsSweepForStore).toHaveBeenCalledWith(
      expect.objectContaining({ lookbackDays: 30, force: true }),
    )
  })

  it("answers 400 without a store id", async () => {
    const res = await POST(req("/api/cron/cogs/sweep", "POST"))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "storeId query param is required" })
  })

  it("answers 400 for a lookback outside 1 to 365", async () => {
    for (const bad of ["0", "366", "abc"]) {
      const res = await POST(req(`/api/cron/cogs/sweep?storeId=s1&lookbackDays=${bad}`, "POST"))
      expect(res.status, bad).toBe(400)
      expect(await res.json()).toEqual({ error: "lookbackDays must be between 1 and 365" })
    }
    expect(job.runCogsSweepForStore).not.toHaveBeenCalled()
  })

  it("answers 404 for a store that is unknown or inactive", async () => {
    job.runCogsSweepForStore.mockRejectedValue(new CogsSweepStoreNotFoundError("gone"))
    const res = await POST(req("/api/cron/cogs/sweep?storeId=gone", "POST"))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "Store gone not found or inactive" })
  })

  it("answers 500 with the message when the sweep fails", async () => {
    job.runCogsSweepForStore.mockRejectedValue(new CogsSweepFailedError("s1", new Error("deadlock detected")))
    const res = await POST(req("/api/cron/cogs/sweep?storeId=s1", "POST"))
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({
      error: "sweep failed",
      message: "deadlock detected",
      storeId: "s1",
    })
  })
})

describe("GET /api/cron/cogs/stores", () => {
  it("is refused without the cron secret", async () => {
    const res = await GET(req("/api/cron/cogs/stores", "GET", false))
    expect(res.status).toBe(401)
    expect(job.listCogsSweepStores).not.toHaveBeenCalled()
  })

  it("answers the store list", async () => {
    const res = await GET(req("/api/cron/cogs/stores", "GET"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      stores: [{ id: "s1", name: "Hollywood", accountId: "a" }],
      activeStoreCount: 2,
      skippedEmptyStoreCount: 1,
      force: false,
    })
    expect(job.listCogsSweepStores).toHaveBeenCalledWith({ force: false, triggeredBy: "github-actions" })
  })

  it("passes force through", async () => {
    await GET(req("/api/cron/cogs/stores?force=true", "GET"))
    expect(job.listCogsSweepStores).toHaveBeenCalledWith({ force: true, triggeredBy: "github-actions" })
  })
})
