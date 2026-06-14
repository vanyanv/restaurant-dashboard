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
    },
  },
}))

vi.mock("@/lib/monitoring/job-alerts", () => ({
  evaluateJobAlert: vi.fn(async () => {}),
}))

import { prisma } from "@/lib/prisma"
import { JobStatus } from "@/generated/prisma/client"
import { withJobRun } from "@/lib/monitoring/job-run"
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
