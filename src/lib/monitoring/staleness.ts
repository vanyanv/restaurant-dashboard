/**
 * Staleness detection for scheduled jobs.
 *
 * Two independent questions, because on 2026-08-17 the first one was not
 * enough: the Otter daily sync workflow reported SUCCESS every 4h for a day
 * while writing zero rows (`includeRatings is not defined` was caught
 * per-chunk and the script still exited 0). A job-status check stays green
 * through that. A data check does not.
 *
 *   1. Did the job run on cadence?        → reuses isOverdue / JOB_SCHEDULES
 *   2. Is the data it owns actually fresh? → JOB_DATA_OWNERSHIP, below
 *
 * Pure functions only. The cron route gathers the readings; this file just
 * decides, so the decision is unit-testable without a database.
 */

import { JOB_SCHEDULES, isOverdue } from "./job-schedules"

/**
 * What each job is responsible for producing.
 *
 * "timestamp" — the column is @updatedAt-backed, so it bumps on every upsert
 * and tracks freshness at run granularity. Only use this kind when the schema
 * actually has @updatedAt; a plain @default(now()) column does NOT move when a
 * row is re-synced, which would produce false staleness alerts.
 *
 * "dateCoverage" — the table is partitioned by business date and gains a row
 * per day. Freshness is "how recent is the newest date it covers", which works
 * regardless of how the timestamp column is declared.
 *
 * Jobs absent from this map get the cadence check only. That is the right
 * answer for event-driven work (invoices.email.sync writes nothing when no
 * invoice arrives) and for jobs that own no table (otter.stores).
 */
export type JobDataOwnership =
  | { kind: "timestamp"; table: string; column: string; maxAgeMinutes: number }
  | { kind: "dateCoverage"; table: string; column: string; maxLagDays: number }

export const JOB_DATA_OWNERSHIP: Record<string, JobDataOwnership> = {
  // The daily report's revenue numbers. This is the one that went stale.
  "otter.metrics.sync": {
    kind: "timestamp",
    table: "OtterDailySummary",
    column: "syncedAt",
    maxAgeMinutes: 60 * 8,
  },
  "otter.hourly.sync": {
    kind: "timestamp",
    table: "OtterHourlySummary",
    column: "updatedAt",
    maxAgeMinutes: 60 * 8,
  },
  "otter.orders.sync": {
    kind: "timestamp",
    table: "OtterOrder",
    column: "syncedAt",
    maxAgeMinutes: 60 * 8,
  },
  // Date-partitioned: syncedAt/computedAt are @default(now()) without
  // @updatedAt, so they don't move on re-sync. Coverage is the honest check.
  "harri-labor-sync": {
    kind: "dateCoverage",
    table: "HarriDailyLabor",
    column: "date",
    maxLagDays: 3,
  },
  "cogs.sweep": {
    kind: "dateCoverage",
    table: "DailyCogsItem",
    column: "date",
    maxLagDays: 3,
  },
  "ml.operator-gate-check": {
    kind: "dateCoverage",
    table: "OperatorGateDailyVerdict",
    column: "verdictDate",
    maxLagDays: 3,
  },
}

export type FreshnessReading = {
  jobName: string
  lastRunAt: Date | null
  /** max(timestamp column) or max(date column), per this job's ownership. */
  dataAt: Date | null
}

export type StalenessProblem = {
  jobName: string
  reason: "overdue" | "stale-data"
  detail: string
}

export type StalenessVerdict = {
  ok: boolean
  problems: StalenessProblem[]
  /** Non-failing observations, e.g. jobs that have never recorded a run. */
  notes: string[]
}

function hoursBetween(a: Date, b: Date): number {
  return (a.getTime() - b.getTime()) / 3_600_000
}

function describeAge(now: Date, then: Date): string {
  const h = hoursBetween(now, then)
  return h < 48 ? `${h.toFixed(1)}h ago` : `${(h / 24).toFixed(1)}d ago`
}

export function detectStaleness(
  readings: FreshnessReading[],
  now: Date = new Date(),
): StalenessVerdict {
  const problems: StalenessProblem[] = []
  const notes: string[] = []

  for (const r of readings) {
    const schedule = JOB_SCHEDULES[r.jobName]
    if (!schedule) {
      notes.push(`${r.jobName}: not in JOB_SCHEDULES, skipped`)
      continue
    }

    // A job with no run history is usually one that was just added or that
    // doesn't record JobRun rows — not an incident. Surface it without
    // failing the check, so the alert keeps meaning "something broke".
    if (!r.lastRunAt) {
      notes.push(`${r.jobName}: has never recorded a run`)
    } else if (isOverdue(r.jobName, r.lastRunAt, now)) {
      problems.push({
        jobName: r.jobName,
        reason: "overdue",
        detail: `expected ${schedule.description}, last ran ${describeAge(now, r.lastRunAt)}`,
      })
    }

    const owns = JOB_DATA_OWNERSHIP[r.jobName]
    // A job that has never run owns no data yet; "table is empty" would be
    // noise, not an incident.
    if (!owns || !r.lastRunAt) continue

    if (!r.dataAt) {
      problems.push({
        jobName: r.jobName,
        reason: "stale-data",
        detail: `${owns.table} is empty`,
      })
      continue
    }

    if (owns.kind === "timestamp") {
      const ageMinutes = (now.getTime() - r.dataAt.getTime()) / 60_000
      if (ageMinutes > owns.maxAgeMinutes) {
        problems.push({
          jobName: r.jobName,
          reason: "stale-data",
          detail:
            `${owns.table}.${owns.column} newest is ${describeAge(now, r.dataAt)}` +
            ` (allowed ${(owns.maxAgeMinutes / 60).toFixed(0)}h)`,
        })
      }
    } else {
      const lagDays = (now.getTime() - r.dataAt.getTime()) / 86_400_000
      if (lagDays > owns.maxLagDays) {
        problems.push({
          jobName: r.jobName,
          reason: "stale-data",
          detail:
            `${owns.table} covers only through ${r.dataAt.toISOString().slice(0, 10)}` +
            ` (${lagDays.toFixed(1)}d behind, allowed ${owns.maxLagDays}d)`,
        })
      }
    }
  }

  return { ok: problems.length === 0, problems, notes }
}
