/**
 * Known cadence per job. Used by the monitoring page to compute "next expected"
 * and by the alert evaluator to detect overdue jobs (overdue = past 1.5× cadence).
 */
export type JobSchedule = {
  cadenceMinutes: number
  description: string
}

export const JOB_SCHEDULES: Record<string, JobSchedule> = {
  "otter.metrics.sync":     { cadenceMinutes: 60 * 4,  description: "every 4h" },
  "otter.orders.sync":      { cadenceMinutes: 60 * 4,  description: "every 4h" },
  "otter.orders.drain":     { cadenceMinutes: 60 * 24 * 7,  description: "weekly" },
  // Hourly, but only while Hollywood is trading (UTC 17:00–10:59 covers
  // 10:00–02:00 local year-round), so the longest legitimate gap is the 7h
  // closed window between the 10:00 and 17:00 UTC runs — not 1h.
  "otter.hourly.sync":      { cadenceMinutes: 60 * 7,  description: "hourly during service hours" },
  // Matrix fan-out for otter-sync (every 4h) and otter-drain (weekly). It was
  // declared daily, which made isOverdue() permanently false for it.
  "otter.stores":           { cadenceMinutes: 60 * 4,  description: "every 4h" },
  "invoices.email.sync":    { cadenceMinutes: 60 * 6,  description: "every 6h" },
  "cogs.sweep":             { cadenceMinutes: 60 * 4,  description: "every 4h" },
  // Same shape: driven by cogs-sweep (every 4h) and cogs-refresh (daily).
  "cogs.stores":            { cadenceMinutes: 60 * 4,  description: "every 4h" },
  "monitoring.db-snapshot": { cadenceMinutes: 60 * 24, description: "daily" },
  "ml.operator-gate-check": { cadenceMinutes: 60 * 24, description: "daily" },
  // These five record JobRun rows but had no schedule, so isOverdue() was
  // permanently false for them — harri-labor-sync could have gone silent
  // forever with no signal at all. Cadences read off the workflow crons.
  "harri-labor-sync":       { cadenceMinutes: 60 * 4,  description: "every 4h" },
  "harri-employee-sync":    { cadenceMinutes: 60 * 24 * 31, description: "monthly" },
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
