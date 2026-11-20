// The scheduled Otter syncs skip a window that already synced successfully in
// the last 20 minutes (the ticker's dispatch and the workflow's backup
// schedule landing on the same hour) — but only when the scheduled script asks
// for it. Any other caller (the dashboard, a backfill) always runs.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma-retry", () => ({ withPrismaRetry: <T>(fn: () => Promise<T>) => fn() }))
vi.mock("@/lib/monitoring/job-alerts", () => ({ evaluateJobAlert: vi.fn(async () => {}) }))
vi.mock("@/lib/otter", () => ({
  queryMetrics: vi.fn(),
  buildCustomerOrdersBody: vi.fn(() => ({})),
  fetchOrderDetails: vi.fn(async () => null),
  withConcurrency: async <T>(tasks: Array<() => Promise<T>>) => Promise.all(tasks.map((t) => t())),
}))

const db = vi.hoisted(() => ({
  otterStore: { findMany: vi.fn(async () => []) },
  jobRun: {
    findFirst: vi.fn(),
    create: vi.fn(async () => ({ id: "jr1", startedAt: new Date() })),
    update: vi.fn(async (_args: unknown) => ({})),
  },
}))
vi.mock("@/lib/prisma", () => ({ prisma: db }))

import { runHourlySync } from "@/lib/hourly-sync"
import { runOrdersSync } from "@/lib/otter-orders-sync"

const recent = { id: "jr0", startedAt: new Date("2026-11-20T17:50:00Z"), metadata: null }

beforeEach(() => {
  vi.clearAllMocks()
  db.jobRun.findFirst.mockResolvedValue(null)
})

describe.each([
  ["otter.hourly.sync", (skip: boolean) => runHourlySync({ triggeredBy: "github-actions", skipIfRecentSuccess: skip })],
  ["otter.orders.sync", (skip: boolean) => runOrdersSync(3, undefined, { triggeredBy: "github-actions", skipIfRecentSuccess: skip })],
] as const)("%s", (jobName, run) => {
  it("skips, touching neither Otter nor JobRun, after a recent success", async () => {
    db.jobRun.findFirst.mockResolvedValue(recent)
    expect(await run(true)).toEqual({
      skipped: "recent-success",
      jobName,
      lastSuccessAt: "2026-11-20T17:50:00.000Z",
    })
    expect(db.jobRun.findFirst.mock.calls[0][0].where).toMatchObject({
      jobName,
      triggeredBy: "github-actions",
      status: "SUCCESS",
    })
    expect(db.otterStore.findMany).not.toHaveBeenCalled()
    expect(db.jobRun.create).not.toHaveBeenCalled()
  })

  it("runs and records the run when nothing succeeded recently", async () => {
    const out = await run(true)
    expect(out).not.toHaveProperty("skipped")
    expect(db.jobRun.create).toHaveBeenCalledTimes(1)
    expect(db.jobRun.update.mock.calls.at(-1)?.[0]).toMatchObject({ data: { status: "SUCCESS" } })
  })

  it("never looks for a recent run unless asked (backfills, the dashboard)", async () => {
    db.jobRun.findFirst.mockResolvedValue(recent)
    const out = await run(false)
    expect(out).not.toHaveProperty("skipped")
    expect(db.jobRun.findFirst).not.toHaveBeenCalled()
    expect(db.jobRun.create).toHaveBeenCalledTimes(1)
  })
})
