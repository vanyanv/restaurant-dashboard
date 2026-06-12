// Pins getSyncs() behavior through its N-query -> single-query rewrite:
//  - one SyncRow per JOB_SCHEDULES entry, in JOB_SCHEDULES key order, even
//    for jobs that have never run (nulls + overdue=false)
//  - exactly ONE $queryRaw (DISTINCT ON), never per-job findFirst
//  - optional storeId scopes the query
//  - overdue = age > cadence * 1.5 (from isOverdue)

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    jobRun: { findFirst: vi.fn() },
  },
}))

import { prisma } from "@/lib/prisma"
import { getSyncs } from "@/lib/monitoring/queries"
import { JOB_SCHEDULES } from "@/lib/monitoring/job-schedules"

const NOW = new Date("2026-06-12T12:00:00Z")

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.mocked(prisma.$queryRaw).mockResolvedValue([])
  vi.mocked(prisma.jobRun.findFirst).mockResolvedValue(null as never)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("getSyncs", () => {
  it("issues exactly one raw query and never a per-job findFirst", async () => {
    await getSyncs()
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
    expect(prisma.jobRun.findFirst).not.toHaveBeenCalled()
  })

  it("returns one row per JOB_SCHEDULES entry (in key order) with nulls for never-run jobs", async () => {
    const rows = await getSyncs()
    const jobNames = Object.keys(JOB_SCHEDULES)
    expect(rows.map((r) => r.jobName)).toEqual(jobNames)
    for (const r of rows) {
      expect(r).toMatchObject({
        lastRunAt: null,
        status: null,
        rowsWritten: null,
        durationMs: null,
        overdue: false,
        cadenceLabel: JOB_SCHEDULES[r.jobName].description,
      })
    }
  })

  it("maps a raw row onto its SyncRow and computes overdue from cadence * 1.5", async () => {
    // otter.metrics.sync cadence is 4h -> overdue past 6h. 7h-old run is
    // overdue; a 1h-old cogs.sweep run is not.
    const staleStart = new Date(NOW.getTime() - 7 * 3_600_000)
    const freshStart = new Date(NOW.getTime() - 1 * 3_600_000)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { jobName: "otter.metrics.sync", startedAt: staleStart, status: "SUCCESS", rowsWritten: 1200, durationMs: 30_000 },
      { jobName: "cogs.sweep", startedAt: freshStart, status: "PARTIAL", rowsWritten: null, durationMs: null },
    ] as never)

    const rows = await getSyncs()
    const metrics = rows.find((r) => r.jobName === "otter.metrics.sync")
    expect(metrics).toEqual({
      jobName: "otter.metrics.sync",
      lastRunAt: staleStart,
      status: "SUCCESS",
      rowsWritten: 1200,
      durationMs: 30_000,
      overdue: true,
      cadenceLabel: "every 4h",
    })
    const sweep = rows.find((r) => r.jobName === "cogs.sweep")
    expect(sweep).toMatchObject({
      lastRunAt: freshStart,
      status: "PARTIAL",
      rowsWritten: null,
      durationMs: null,
      overdue: false,
    })
  })

  it("drops jobNames not present in JOB_SCHEDULES", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { jobName: "some.retired.job", startedAt: NOW, status: "SUCCESS", rowsWritten: 1, durationMs: 1 },
    ] as never)
    const rows = await getSyncs()
    expect(rows.map((r) => r.jobName)).toEqual(Object.keys(JOB_SCHEDULES))
  })

  it("scopes the query to the storeId argument when given", async () => {
    await getSyncs("store-1")
    const callArgs = vi.mocked(prisma.$queryRaw).mock.calls[0]
    expect(JSON.stringify(callArgs)).toContain("store-1")
  })
})
