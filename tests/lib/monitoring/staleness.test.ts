import { describe, expect, it } from "vitest"

import {
  JOB_DATA_OWNERSHIP,
  detectStaleness,
  type FreshnessReading,
} from "@/lib/monitoring/staleness"
import { JOB_SCHEDULES } from "@/lib/monitoring/job-schedules"

const NOW = new Date("2026-08-18T18:00:00Z")
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000)
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60_000)

function reading(over: Partial<FreshnessReading> = {}): FreshnessReading {
  return {
    jobName: "otter.metrics.sync",
    lastRunAt: minsAgo(60),
    dataAt: minsAgo(60),
    ...over,
  }
}

describe("JOB_DATA_OWNERSHIP", () => {
  it("names only jobs that JOB_SCHEDULES knows about", () => {
    for (const jobName of Object.keys(JOB_DATA_OWNERSHIP)) {
      expect(JOB_SCHEDULES, `${jobName} is not a scheduled job`).toHaveProperty(jobName)
    }
  })

  it("covers the daily report's revenue path — the data that went stale", () => {
    expect(JOB_DATA_OWNERSHIP["otter.metrics.sync"]).toMatchObject({
      kind: "timestamp",
      table: "OtterDailySummary",
      column: "syncedAt",
    })
  })
})

describe("detectStaleness — cadence", () => {
  it("is ok when the job ran within cadence", () => {
    expect(detectStaleness([reading()], NOW).ok).toBe(true)
  })

  it("flags a job that stopped running — the 24h outage", () => {
    // otter.metrics.sync is every 4h; overdue at 1.5x = 6h.
    const v = detectStaleness([reading({ lastRunAt: minsAgo(60 * 24), dataAt: minsAgo(60 * 24) })], NOW)
    expect(v.ok).toBe(false)
    expect(v.problems.map((p) => p.reason)).toContain("overdue")
  })

  it("does not flag a job still inside its overdue window", () => {
    expect(detectStaleness([reading({ lastRunAt: minsAgo(60 * 5), dataAt: minsAgo(60 * 5) })], NOW).ok).toBe(true)
  })

  it("reports a never-run job as a note, not a problem — keeps the alert credible", () => {
    const v = detectStaleness([reading({ lastRunAt: null, dataAt: null })], NOW)
    expect(v.ok).toBe(true)
    expect(v.notes.join(" ")).toContain("otter.metrics.sync")
  })
})

describe("detectStaleness — data freshness", () => {
  /**
   * The whole point. On 2026-08-18 the workflow reported SUCCESS every 4h
   * while writing zero rows, so a cadence-only check would have stayed green.
   */
  it("flags fresh job runs that are writing stale data", () => {
    const v = detectStaleness([reading({ lastRunAt: minsAgo(5), dataAt: minsAgo(60 * 22) })], NOW)
    expect(v.ok).toBe(false)
    expect(v.problems.map((p) => p.reason)).toContain("stale-data")
    expect(v.problems[0].detail).toContain("OtterDailySummary")
  })

  it("ignores data freshness for jobs that own no table", () => {
    const v = detectStaleness(
      [{ jobName: "otter.stores", lastRunAt: minsAgo(60), dataAt: null }],
      NOW,
    )
    expect(v.ok).toBe(true)
  })

  it("flags a date-partitioned table that stopped gaining days", () => {
    const v = detectStaleness(
      [{ jobName: "cogs.sweep", lastRunAt: minsAgo(30), dataAt: daysAgo(9) }],
      NOW,
    )
    expect(v.ok).toBe(false)
    expect(v.problems.map((p) => p.reason)).toContain("stale-data")
  })

  it("accepts a date-partitioned table within its lag allowance", () => {
    const v = detectStaleness(
      [{ jobName: "cogs.sweep", lastRunAt: minsAgo(30), dataAt: daysAgo(1) }],
      NOW,
    )
    expect(v.ok).toBe(true)
  })

  it("reports both problems when a job is overdue AND its data is stale", () => {
    const v = detectStaleness([reading({ lastRunAt: minsAgo(60 * 30), dataAt: minsAgo(60 * 30) })], NOW)
    expect(v.problems).toHaveLength(2)
  })

  it("is ok with no readings at all", () => {
    expect(detectStaleness([], NOW).ok).toBe(true)
  })
})
