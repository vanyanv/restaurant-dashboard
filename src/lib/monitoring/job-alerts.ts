import { prisma } from "@/lib/prisma"
import { JobStatus } from "@/generated/prisma/client"

/** Number of consecutive failed runs of a job before we raise an alert. */
export const FAILURE_STREAK_THRESHOLD = 3

/**
 * Decide whether a job's run history just crossed into a failure streak.
 *
 * `statuses` is the most-recent-first list of the last `threshold + 1` run
 * statuses. Returns true iff the most recent `threshold` runs are all failures
 * AND the run immediately before them was not a failure (or doesn't exist) —
 * i.e. the streak has *just* reached the threshold. This fires exactly once per
 * streak, so repeated failures don't spam the error log.
 */
export function isNewFailureStreak(statuses: string[], threshold: number): boolean {
  if (statuses.length < threshold) return false
  const window = statuses.slice(0, threshold)
  if (!window.every((s) => s === JobStatus.FAILURE)) return false
  const prior = statuses[threshold]
  return prior !== JobStatus.FAILURE
}

/**
 * After a job run completes, check whether it just produced a fresh failure
 * streak and, if so, record one ErrorEvent (the in-app error log surfaced on
 * the monitoring dashboard). Never throws — alerting must not break the job.
 *
 * Note: the CI workflows independently open `cron-failure` GitHub issues via
 * report-workflow-failure.sh; this is the in-app counterpart for failures
 * observed at runtime (e.g. manual triggers, webhook-driven jobs).
 */
export async function evaluateJobAlert(
  jobName: string,
  threshold: number = FAILURE_STREAK_THRESHOLD,
): Promise<void> {
  try {
    const recent = await prisma.jobRun.findMany({
      where: { jobName },
      orderBy: { startedAt: "desc" },
      take: threshold + 1,
      select: { status: true },
    })
    if (!isNewFailureStreak(recent.map((r) => r.status), threshold)) return

    await prisma.errorEvent.create({
      data: {
        source: "cron.failure-streak",
        message: `Job "${jobName}" failed ${threshold} times consecutively`,
        metadata: { jobName, threshold },
      },
    })
  } catch (err) {
    // Alerting is best-effort; swallow so a failing alert can't fail the job.
    console.error(`[job-alerts] evaluateJobAlert(${jobName}) failed:`, err)
  }
}
