// The R2 snapshot records a JobRun like the DB snapshot, so the staleness
// check can see it stop.

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/cron-auth", () => ({
  withCronAuth: (h: (req: unknown, ctx: { fromCron: boolean }) => Promise<Response>) =>
    (req: unknown) => h(req, { fromCron: true }),
}))
vi.mock("@/lib/monitoring/r2-stats", () => ({ collectR2Stats: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: { r2BucketSnapshot: { create: vi.fn() } } }))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }))
vi.mock("@/lib/monitoring/job-run", () => ({
  withJobRun: vi.fn(async (_name: string, _opts: unknown, fn: (c: { addRows: (n: number) => void }) => unknown) =>
    fn({ addRows: vi.fn() }),
  ),
}))

import { collectR2Stats } from "@/lib/monitoring/r2-stats"
import { prisma } from "@/lib/prisma"
import { withJobRun } from "@/lib/monitoring/job-run"
import { POST } from "@/app/api/cron/r2-snapshot/route"

beforeEach(() => vi.clearAllMocks())

describe("POST /api/cron/r2-snapshot", () => {
  it("runs inside withJobRun as monitoring.r2-snapshot", async () => {
    vi.mocked(collectR2Stats).mockResolvedValue({ totalBytes: BigInt(10), objectCount: 2, byPrefix: {} } as never)
    vi.mocked(prisma.r2BucketSnapshot.create).mockResolvedValue({ id: "r1" } as never)
    const res = await POST({} as never)
    expect(res.status).toBe(200)
    expect(withJobRun).toHaveBeenCalledWith("monitoring.r2-snapshot", { triggeredBy: "cron" }, expect.any(Function))
    expect(await res.json()).toMatchObject({ id: "r1", totalBytes: 10, objectCount: 2 })
  })

  it("still answers 500 when the listing fails", async () => {
    vi.mocked(collectR2Stats).mockRejectedValue(new Error("boom"))
    const res = await POST({} as never)
    expect(res.status).toBe(500)
  })
})
