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
  "otter.hourly.sync":      { cadenceMinutes: 60 * 4,  description: "every 4h" },
  "otter.stores":           { cadenceMinutes: 60 * 24, description: "daily" },
  "invoices.email.sync":    { cadenceMinutes: 60 * 6,  description: "every 6h" },
  "yelp.sync":              { cadenceMinutes: 60 * 24, description: "daily" },
  "cogs.sweep":             { cadenceMinutes: 60 * 4,  description: "every 4h" },
  "cogs.stores":            { cadenceMinutes: 60 * 24, description: "daily" },
  "monitoring.cache-flush": { cadenceMinutes: 10,      description: "every 10m" },
  "monitoring.sweep":       { cadenceMinutes: 15,      description: "every 15m" },
  "monitoring.cleanup":     { cadenceMinutes: 60 * 24, description: "daily" },
  "monitoring.db-snapshot": { cadenceMinutes: 60 * 24, description: "daily" },
  "ml.operator-gate-check": { cadenceMinutes: 60 * 24, description: "daily" },
}

export const OVERDUE_MULTIPLIER = 1.5

export function isOverdue(jobName: string, lastRunAt: Date | null): boolean {
  if (!lastRunAt) return false
  const sched = JOB_SCHEDULES[jobName]
  if (!sched) return false
  const ageMs = Date.now() - lastRunAt.getTime()
  return ageMs > sched.cadenceMinutes * 60_000 * OVERDUE_MULTIPLIER
}
