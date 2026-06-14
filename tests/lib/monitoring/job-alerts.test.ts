// Cron-failure alerting: when a job fails N times in a row, surface it once
// (not every run) on the in-app error log. The decision is a pure function so
// the "fire exactly once per streak" dedup is testable without a DB.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    jobRun: { findMany: vi.fn() },
    errorEvent: { create: vi.fn(async () => ({})) },
  },
}))

import { prisma } from "@/lib/prisma"
import { isNewFailureStreak, evaluateJobAlert } from "@/lib/monitoring/job-alerts"

const F = "FAILURE"
const S = "SUCCESS"

describe("isNewFailureStreak", () => {
  it("fires when the most recent N runs are all failures and the prior run was not", () => {
    // exactly N failures, nothing older -> the streak just reached N
    expect(isNewFailureStreak([F, F, F], 3)).toBe(true)
    // N failures preceded by a success -> fresh streak of exactly N
    expect(isNewFailureStreak([F, F, F, S], 3)).toBe(true)
  })

  it("does not fire again once the streak has already exceeded N", () => {
    expect(isNewFailureStreak([F, F, F, F], 3)).toBe(false)
  })

  it("does not fire before the threshold is reached", () => {
    expect(isNewFailureStreak([F, F], 3)).toBe(false)
    expect(isNewFailureStreak([F, F, S], 3)).toBe(false)
    expect(isNewFailureStreak([S, F, F], 3)).toBe(false)
  })
})

describe("evaluateJobAlert", () => {
  beforeEach(() => vi.clearAllMocks())

  it("writes one ErrorEvent when the failure streak first reaches the threshold", async () => {
    vi.mocked(prisma.jobRun.findMany).mockResolvedValue(
      [{ status: F }, { status: F }, { status: F }, { status: S }] as never,
    )
    await evaluateJobAlert("otter.orders.sync", 3)
    expect(prisma.errorEvent.create).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(prisma.errorEvent.create).mock.calls[0][0] as {
      data: { source: string; message: string }
    }
    expect(arg.data.source).toContain("cron")
    expect(arg.data.message).toContain("otter.orders.sync")
  })

  it("writes nothing when there is no fresh streak", async () => {
    vi.mocked(prisma.jobRun.findMany).mockResolvedValue(
      [{ status: F }, { status: S }] as never,
    )
    await evaluateJobAlert("otter.orders.sync", 3)
    expect(prisma.errorEvent.create).not.toHaveBeenCalled()
  })

  it("never throws even if the alert write fails (must not break the job)", async () => {
    vi.mocked(prisma.jobRun.findMany).mockResolvedValue(
      [{ status: F }, { status: F }, { status: F }] as never,
    )
    vi.mocked(prisma.errorEvent.create).mockRejectedValueOnce(new Error("db down"))
    await expect(evaluateJobAlert("otter.orders.sync", 3)).resolves.toBeUndefined()
  })
})
