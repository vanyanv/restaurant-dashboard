/**
 * Contract for the staleness endpoint. The status code is the whole point:
 * curl-cron-json.sh exits 22 on any non-2xx, and that exit is what opens the
 * incident issue. A route that reported problems in the body but still
 * returned 200 would be exactly the failure it exists to prevent.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// @/lib/auth pulls in welcome.ts -> "server-only", which doesn't resolve
// under vitest. Same boundary the telemetry-page-view test mocks. The route
// takes the cron-bearer path, so neither export is actually exercised.
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {}, hasOwnerAccess: () => true }))

vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: vi.fn(), errorEvent: { create: vi.fn() } },
}))

import { prisma } from "@/lib/prisma"
import { GET } from "@/app/api/cron/monitoring/staleness/route"
import type { NextRequest } from "next/server"

const SECRET = "test-cron-secret"
const queryRaw = vi.mocked(prisma.$queryRaw)
const createErrorEvent = vi.mocked(prisma.errorEvent.create)

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000)

/** A tagged-template call is the JobRun query; anything else is a MAX() probe. */
function mockDb(opts: { lastRunMinsAgo: number | null; dataMinsAgo: number | null }) {
  queryRaw.mockImplementation((...args: unknown[]) => {
    const first = args[0]
    const isTaggedTemplate = Array.isArray(first) && "raw" in (first as object)
    if (isTaggedTemplate) {
      return Promise.resolve(
        opts.lastRunMinsAgo == null
          ? []
          : [{ jobName: "otter.metrics.sync", startedAt: minsAgo(opts.lastRunMinsAgo) }],
      ) as never
    }
    return Promise.resolve([
      { max: opts.dataMinsAgo == null ? null : minsAgo(opts.dataMinsAgo) },
    ]) as never
  })
}

function req(auth?: string): NextRequest {
  return new Request("http://test.local/api/cron/monitoring/staleness", {
    headers: auth ? { authorization: auth } : {},
  }) as unknown as NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = SECRET
})

describe("GET /api/cron/monitoring/staleness", () => {
  it("rejects an unauthenticated caller with 403", async () => {
    mockDb({ lastRunMinsAgo: 30, dataMinsAgo: 30 })
    expect((await GET(req())).status).toBe(403)
  })

  it("rejects a wrong bearer with 403", async () => {
    mockDb({ lastRunMinsAgo: 30, dataMinsAgo: 30 })
    expect((await GET(req("Bearer wrong-secret!!"))).status).toBe(403)
  })

  it("returns 200 when every job is running and its data is fresh", async () => {
    mockDb({ lastRunMinsAgo: 30, dataMinsAgo: 30 })
    const res = await GET(req(`Bearer ${SECRET}`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.problems).toEqual([])
    expect(createErrorEvent).not.toHaveBeenCalled()
  })

  it("returns 503 when a job has gone stale, so the workflow step fails", async () => {
    // The outage shape: ran 22h ago, data 22h old.
    mockDb({ lastRunMinsAgo: 60 * 22, dataMinsAgo: 60 * 22 })
    const res = await GET(req(`Bearer ${SECRET}`))
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.problems.map((p: { jobName: string }) => p.jobName)).toContain(
      "otter.metrics.sync",
    )
  })

  it("mirrors a failure into the in-app error log", async () => {
    mockDb({ lastRunMinsAgo: 60 * 22, dataMinsAgo: 60 * 22 })
    await GET(req(`Bearer ${SECRET}`))
    expect(createErrorEvent).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ source: "cron.staleness" }) }),
    )
  })

  it("still returns the verdict when the error-log write fails", async () => {
    mockDb({ lastRunMinsAgo: 60 * 22, dataMinsAgo: 60 * 22 })
    createErrorEvent.mockRejectedValueOnce(new Error("db down"))
    expect((await GET(req(`Bearer ${SECRET}`))).status).toBe(503)
  })
})
