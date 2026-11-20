// An orphaned RUNNING JobRun (a killed function, a cancelled job) must stop
// reading "syncing now" once it is older than the job's bound.

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    jobRun: { findMany: vi.fn(), findFirst: vi.fn() },
    alert: { count: vi.fn(async () => 0) },
  },
}))
vi.mock("@/lib/cache/cached", () => ({
  cached: vi.fn(async (_k: string, _t: number, _tags: string[], load: () => unknown) => load()),
}))

import { prisma } from "@/lib/prisma"
import { getFeedHealth } from "@/lib/counter/adapters/feed-health"
import { getShellStatus } from "@/lib/counter/adapters/shell-status"
import {
  JOB_SCHEDULES,
  isStalledRunning,
  runningStallMinutes,
} from "@/lib/monitoring/job-schedules"

const now = new Date("2026-11-20T20:00:00Z")
const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000)

beforeEach(() => vi.clearAllMocks())

describe("isStalledRunning", () => {
  it("is never under 15 minutes, and 2x a Vercel route's maxDuration otherwise", () => {
    expect(runningStallMinutes("alerts.ingest")).toBe(15)
    expect(runningStallMinutes("otter.metrics.sync")).toBe(60)
    expect(runningStallMinutes("db.backup")).toBe(120)
    expect(isStalledRunning("otter.metrics.sync", minsAgo(30), now)).toBe(false)
    expect(isStalledRunning("otter.metrics.sync", minsAgo(61), now)).toBe(true)
  })
})

describe("JOB_SCHEDULES cadences", () => {
  it("harri-employee-sync is weekly, matching its Monday cron", () => {
    expect(JOB_SCHEDULES["harri-employee-sync"].cadenceMinutes).toBe(60 * 24 * 7)
  })
  it("watches the checks cron, the R2 snapshot and the backup", () => {
    expect(JOB_SCHEDULES["checks.alerts"]).toBeDefined()
    expect(JOB_SCHEDULES["monitoring.r2-snapshot"].cadenceMinutes).toBe(60 * 24)
    expect(JOB_SCHEDULES["db.backup"].cadenceMinutes).toBe(60 * 24)
  })
})

describe("getFeedHealth", () => {
  const scope = { accountId: "acct", storeIds: ["s1"] }
  const run = (jobName: string, status: string, startedAt: Date, completedAt: Date | null = null) => ({
    jobName,
    status,
    startedAt,
    completedAt,
  })

  it("a fresh RUNNING row reads syncing now; an orphaned one reads never finished", async () => {
    vi.mocked(prisma.jobRun.findMany).mockResolvedValue([
      run("otter.metrics.sync", "RUNNING", minsAgo(5)),
      run("harri-labor-sync", "RUNNING", minsAgo(60 * 30)),
    ] as never)
    const lines = await getFeedHealth(scope, now)
    const by = Object.fromEntries(lines.map((l) => [l.key, l]))
    expect(by["otter.metrics.sync"]).toMatchObject({ reading: "syncing now", tone: "ok" })
    expect(by["harri-labor-sync"]).toMatchObject({ reading: "last run never finished", tone: "warn" })
  })

  it("labels the hourly sync as hourly, not every 4 hours", async () => {
    vi.mocked(prisma.jobRun.findMany).mockResolvedValue([
      run("otter.hourly.sync", "SUCCESS", minsAgo(40), minsAgo(38)),
    ] as never)
    const lines = await getFeedHealth(scope, now)
    expect(lines.find((l) => l.key === "otter.hourly.sync")?.reading).toBe(
      "synced 38 min ago · hourly while open",
    )
  })
})

describe("getShellStatus", () => {
  it("RUNNING for minutes is syncing; RUNNING for hours is failed", async () => {
    vi.mocked(prisma.jobRun.findFirst).mockResolvedValueOnce({
      startedAt: minsAgo(3),
      completedAt: null,
      status: "RUNNING",
    } as never)
    expect((await getShellStatus({ accountId: "a", storeIds: ["s1"] }, now)).sync?.state).toBe("syncing")

    vi.mocked(prisma.jobRun.findFirst).mockResolvedValueOnce({
      startedAt: minsAgo(60 * 9),
      completedAt: null,
      status: "RUNNING",
    } as never)
    expect((await getShellStatus({ accountId: "a", storeIds: ["s1"] }, now)).sync?.state).toBe("failed")
  })
})
