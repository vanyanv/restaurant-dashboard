/**
 * Known cadence per job. Used by the monitoring page to compute "next expected"
 * and by the alert evaluator to detect overdue jobs (overdue = past 1.5× cadence).
 */
export type JobSchedule = {
  cadenceMinutes: number
  description: string
}

export const JOB_SCHEDULES: Record<string, JobSchedule> = {
  // Four times a day since 2026-11-23 (10 AM, 2 PM, 6 PM, 2 AM LA via
  // sync-ticker.yml); the longest gap is the closed 8h from 2 AM to 10 AM.
  "otter.metrics.sync":     { cadenceMinutes: 60 * 8,  description: "4 times a day" },
  "otter.orders.sync":      { cadenceMinutes: 60 * 8,  description: "4 times a day" },
  "otter.orders.drain":     { cadenceMinutes: 60 * 24 * 7,  description: "weekly" },
  // Every other hour while Hollywood is trading (even UTC hours 18:00–10:00),
  // since 2026-11-23; the longest legitimate gap is the 8h closed window
  // between the 10:00 and 18:00 UTC runs.
  "otter.hourly.sync":      { cadenceMinutes: 60 * 8,  description: "every 2h during service hours" },
  // Matrix fan-out for otter-sync (4 times a day) and otter-drain (weekly). It
  // was declared daily, which made isOverdue() permanently false for it.
  "otter.stores":           { cadenceMinutes: 60 * 8,  description: "4 times a day" },
  // 6 AM, noon, 6 PM LA; the longest gap is overnight, 12h (overdue at 18h).
  "invoices.email.sync":    { cadenceMinutes: 60 * 12, description: "3 times a day" },
  // Twice a day since 2026-11-23 (3 PM and 3 AM LA).
  "cogs.sweep":             { cadenceMinutes: 60 * 12, description: "twice a day" },
  // Same shape: driven by cogs-sweep (twice a day) and cogs-refresh (weekly).
  "cogs.stores":            { cadenceMinutes: 60 * 12, description: "twice a day" },
  "monitoring.db-snapshot": { cadenceMinutes: 60 * 24, description: "daily" },
  "monitoring.r2-snapshot": { cadenceMinutes: 60 * 24, description: "daily" },
  // The real backup (db-backup.yml: pg_dump to R2), not a size reading.
  "db.backup":              { cadenceMinutes: 60 * 24, description: "nightly" },
  // checks-cron.yml runs every 30 min, but a half-hour in which no check
  // window moved is skipped without a JobRun row (`checkAlertAccountsDue`),
  // and the gate forces a real run once the last SUCCESS is 2h old
  // (GATE_MAX_SKIP_MS). So the longest healthy gap between rows is 2h30m.
  "checks.alerts":          { cadenceMinutes: 150, description: "every 30 min (recorded at least every 2.5h)" },
  "ml.operator-gate-check": { cadenceMinutes: 60 * 24, description: "daily" },
  // These five record JobRun rows but had no schedule, so isOverdue() was
  // permanently false for them — harri-labor-sync could have gone silent
  // forever with no signal at all. Cadences read off the workflow crons.
  "harri-labor-sync":       { cadenceMinutes: 60 * 4,  description: "every 4h" },
  // Weekly since harri-employees-cron.yml moved to Mondays 07:00 UTC (store
  // checks hand out PINs from this roster). Declared monthly, a stopped
  // roster refresh went unnoticed for four and a half weeks.
  "harri-employee-sync":    { cadenceMinutes: 60 * 24 * 7, description: "weekly" },
  "proposals.generate":     { cadenceMinutes: 60 * 4,  description: "every 4h" },
  "maintenance.retention":  { cadenceMinutes: 60 * 24, description: "daily" },
  "alerts.ingest":          { cadenceMinutes: 60 * 24, description: "daily" },
}

export const OVERDUE_MULTIPLIER = 1.5

/**
 * How far past cadence "it has not run" stops being an observation and becomes
 * an incident.
 *
 * GitHub Actions delivers roughly two thirds of this repo's scheduled runs:
 * over the week to 2026-08-28, `Otter Hourly Sync` fired 109 times against a
 * cron that asks for 168, and Invoices Sync and Harri Labor Sync were stretched
 * the same way. The schedules are already well staggered — only two workflows
 * share a slot — so this is GitHub's scheduler, not crowding, and nothing in
 * this repo can fix it.
 *
 * At 1.5x, that drift alone turned the staleness check red on jobs whose data
 * was perfectly current, which is the fastest way to teach an operator to skim
 * past the alert. Past 3x, a cron really has stopped.
 */
export const OVERDUE_CEILING_MULTIPLIER = 3

function pastCadence(
  jobName: string,
  lastRunAt: Date | null,
  multiplier: number,
  now: Date,
): boolean {
  if (!lastRunAt) return false
  const sched = JOB_SCHEDULES[jobName]
  if (!sched) return false
  const ageMs = now.getTime() - lastRunAt.getTime()
  return ageMs > sched.cadenceMinutes * 60_000 * multiplier
}

/** Late enough to show as late on the monitoring page. */
export function isOverdue(
  jobName: string,
  lastRunAt: Date | null,
  now: Date = new Date(),
): boolean {
  return pastCadence(jobName, lastRunAt, OVERDUE_MULTIPLIER, now)
}

/** Late enough that the cron itself is presumed broken. See the ceiling above. */
export function isFarOverdue(
  jobName: string,
  lastRunAt: Date | null,
  now: Date = new Date(),
): boolean {
  return pastCadence(jobName, lastRunAt, OVERDUE_CEILING_MULTIPLIER, now)
}

/**
 * How long a run may sit in RUNNING before a view stops calling it "syncing
 * now". A run killed mid-flight (a Vercel function past `maxDuration`, a
 * cancelled Actions job, a crashed process) never reaches its `update`, so
 * without a bound its RUNNING row reads "syncing" forever.
 *
 * Twice the job's own limit, never under 15 minutes. Jobs absent here run
 * from GitHub Actions scripts with no tight limit; an hour is several times
 * the longest healthy run any of them records.
 */
export const RUNNING_STALL_FLOOR_MINUTES = 15
export const RUNNING_STALL_DEFAULT_MINUTES = 60
const RUNNING_STALL_MINUTES: Record<string, number> = {
  // Vercel routes: 2x maxDuration, floored at 15 min.
  "alerts.ingest": 15, // maxDuration 120s
  "proposals.generate": 15, // maxDuration 120s
  "monitoring.db-snapshot": 15, // maxDuration 30s
  "monitoring.r2-snapshot": 15, // maxDuration 60s
  "maintenance.retention": 15, // maxDuration 60s
  "checks.alerts": 15,
  "cogs.sweep": 15, // maxDuration 300s -> 10 min, floored
  "db.backup": 120, // db-backup.yml timeout-minutes 60
}

export function runningStallMinutes(jobName: string): number {
  return Math.max(
    RUNNING_STALL_FLOOR_MINUTES,
    RUNNING_STALL_MINUTES[jobName] ?? RUNNING_STALL_DEFAULT_MINUTES,
  )
}

/** A RUNNING row older than its bound: the run died without recording how. */
export function isStalledRunning(
  jobName: string,
  startedAt: Date,
  now: Date = new Date(),
): boolean {
  return now.getTime() - startedAt.getTime() > runningStallMinutes(jobName) * 60_000
}
