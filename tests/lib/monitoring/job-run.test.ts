// withJobRun should be able to tell the truth when a job that was expected to
// write rows wrote none — reporting PARTIAL instead of a misleading SUCCESS
// (generalizes the known "ML nightly reports success but writes 0 rows" gap).

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma-retry", () => ({
  withPrismaRetry: <T>(fn: () => Promise<T>) => fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    jobRun: {
      create: vi.fn(async () => ({ id: "jr1", startedAt: new Date() })),
      update: vi.fn(async () => ({})),
      findFirst: vi.fn(async () => null),
    },
  },
}))

vi.mock("@/lib/monitoring/job-alerts", () => ({
  evaluateJobAlert: vi.fn(async () => {}),
}))

import { prisma } from "@/lib/prisma"
import { JobStatus } from "@/generated/prisma/client"
import { findRecentSuccess, recentSuccessSkip, withJobRun, RECENT_SUCCESS_WINDOW_MS } from "@/lib/monitoring/job-run"
import { isOverdue, JOB_SCHEDULES } from "@/lib/monitoring/job-schedules"
import { evaluateJobAlert } from "@/lib/monitoring/job-alerts"

function lastUpdateStatus(): string | undefined {
  const calls = vi.mocked(prisma.jobRun.update).mock.calls
  const last = calls.at(-1)?.[0] as { data?: { status?: string } } | undefined
  return last?.data?.status
}

beforeEach(() => vi.clearAllMocks())

describe("withJobRun — expectsRows truthfulness", () => {
  it("marks PARTIAL when expectsRows is set but zero rows were written", async () => {
    await withJobRun("test.job", { triggeredBy: "manual", expectsRows: true }, async () => {
      // does no work — writes nothing
    })
    expect(lastUpdateStatus()).toBe(JobStatus.PARTIAL)
  })

  it("marks SUCCESS when expectsRows is set and rows were written", async () => {
    await withJobRun("test.job", { triggeredBy: "manual", expectsRows: true }, async ({ addRows }) => {
      addRows(5)
    })
    expect(lastUpdateStatus()).toBe(JobStatus.SUCCESS)
  })

  it("still reports SUCCESS on zero rows when expectsRows is not set (back-compat)", async () => {
    await withJobRun("test.job", { triggeredBy: "manual" }, async () => {
      // zero rows, but caller never claimed it expected any
    })
    expect(lastUpdateStatus()).toBe(JobStatus.SUCCESS)
  })

  it("still reports FAILURE and re-throws when the body throws", async () => {
    await expect(
      withJobRun("test.job", { triggeredBy: "manual", expectsRows: true }, async () => {
        throw new Error("boom")
      }),
    ).rejects.toThrow("boom")
    expect(lastUpdateStatus()).toBe(JobStatus.FAILURE)
  })

  it("evaluates the failure-streak alert on failure", async () => {
    await expect(
      withJobRun("test.job", { triggeredBy: "manual" }, async () => {
        throw new Error("boom")
      }),
    ).rejects.toThrow("boom")
    expect(evaluateJobAlert).toHaveBeenCalledWith("test.job")
  })

  it("does not evaluate the failure-streak alert on success", async () => {
    await withJobRun("test.job", { triggeredBy: "manual" }, async ({ addRows }) => {
      addRows(1)
    })
    expect(evaluateJobAlert).not.toHaveBeenCalled()
  })
})

describe("withJobRun — skipIf", () => {
  it("writes nothing and returns the skip when skipIf answers", async () => {
    const fn = vi.fn(async () => "ran")
    const out = await withJobRun(
      "test.job",
      { triggeredBy: "github-actions", skipIf: async () => ({ skipped: "recent-success" as const }) },
      fn,
    )
    expect(out).toEqual({ skipped: "recent-success" })
    expect(fn).not.toHaveBeenCalled()
    expect(prisma.jobRun.create).not.toHaveBeenCalled()
    expect(prisma.jobRun.update).not.toHaveBeenCalled()
  })

  it("records start and SUCCESS exactly as before when skipIf says run", async () => {
    const out = await withJobRun(
      "test.job",
      { triggeredBy: "github-actions", skipIf: async () => null },
      async ({ addRows }) => {
        addRows(3)
        return "ran"
      },
    )
    expect(out).toBe("ran")
    expect(prisma.jobRun.create).toHaveBeenCalledTimes(1)
    expect(lastUpdateStatus()).toBe(JobStatus.SUCCESS)
  })

  it("runs anyway when the skip check itself fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const out = await withJobRun(
      "test.job",
      {
        triggeredBy: "github-actions",
        skipIf: async () => {
          throw new Error("boom")
        },
      },
      async () => "ran",
    )
    expect(out).toBe("ran")
    expect(prisma.jobRun.create).toHaveBeenCalledTimes(1)
    expect(lastUpdateStatus()).toBe(JobStatus.SUCCESS)
    warn.mockRestore()
  })
})

describe("recentSuccessSkip", () => {
  it("asks for a SUCCESS of the same job, store and caller in the last 20 minutes", async () => {
    const now = new Date("2026-11-20T18:00:00Z")
    await findRecentSuccess("otter.metrics.sync", { storeId: "s1", triggeredBy: "internal", now })
    expect(prisma.jobRun.findFirst).toHaveBeenCalledWith({
      where: {
        jobName: "otter.metrics.sync",
        storeId: "s1",
        triggeredBy: "internal",
        status: JobStatus.SUCCESS,
        startedAt: { gte: new Date("2026-11-20T17:40:00Z") },
      },
      orderBy: { startedAt: "desc" },
      select: { id: true, startedAt: true, metadata: true },
    })
  })

  it("skips when one is found, naming when it started", async () => {
    vi.mocked(prisma.jobRun.findFirst).mockResolvedValueOnce({
      id: "jr0",
      startedAt: new Date("2026-11-20T17:50:00Z"),
      metadata: null,
    } as never)
    expect(await recentSuccessSkip("otter.hourly.sync")()).toEqual({
      skipped: "recent-success",
      jobName: "otter.hourly.sync",
      lastSuccessAt: "2026-11-20T17:50:00.000Z",
    })
  })

  it("runs when none is found", async () => {
    expect(await recentSuccessSkip("otter.hourly.sync")()).toBeNull()
  })

  it("runs when accept refuses the recent run (e.g. it left emails deferred)", async () => {
    vi.mocked(prisma.jobRun.findFirst).mockResolvedValueOnce({
      id: "jr0",
      startedAt: new Date(),
      metadata: { deferred: 4 },
    } as never)
    const skip = recentSuccessSkip("invoices.email.sync", {
      accept: (r) => (r.metadata as { deferred?: number }).deferred === 0,
    })
    expect(await skip()).toBeNull()
  })

  it("a skipped run writes no JobRun row at all", async () => {
    vi.mocked(prisma.jobRun.findFirst).mockResolvedValueOnce({
      id: "jr0",
      startedAt: new Date(),
      metadata: null,
    } as never)
    const out = await withJobRun(
      "otter.orders.sync",
      { triggeredBy: "github-actions", skipIf: recentSuccessSkip("otter.orders.sync") },
      async () => "ran",
    )
    expect(out).toMatchObject({ skipped: "recent-success" })
    expect(prisma.jobRun.create).not.toHaveBeenCalled()
    expect(prisma.jobRun.update).not.toHaveBeenCalled()
  })
})

describe("a recent-success skip never makes a job look overdue", () => {
  // The skipped run writes nothing, so monitoring keeps reading the run that
  // made it unnecessary. That run is at most 20 minutes old — far inside
  // every cadence of the jobs that skip this way.
  const jobs = ["otter.hourly.sync", "otter.orders.sync", "otter.metrics.sync", "otter.stores", "invoices.email.sync"]
  it.each(jobs)("%s", (job) => {
    expect(JOB_SCHEDULES[job]).toBeDefined()
    const now = new Date("2026-11-20T18:00:00Z")
    const lastSuccess = new Date(now.getTime() - RECENT_SUCCESS_WINDOW_MS)
    expect(isOverdue(job, lastSuccess, now)).toBe(false)
    expect(JOB_SCHEDULES[job].cadenceMinutes * 60_000).toBeGreaterThan(RECENT_SUCCESS_WINDOW_MS)
  })
})
