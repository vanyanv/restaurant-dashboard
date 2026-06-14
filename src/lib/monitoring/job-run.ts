/**
 * Job-run wrapper. Two DB writes per call (start + end) — fine for sync/cron
 * work, NOT for per-request handlers. Don't wrap a hot HTTP path in this.
 */
import { prisma } from "@/lib/prisma"
import { withPrismaRetry } from "@/lib/prisma-retry"
import { evaluateJobAlert } from "@/lib/monitoring/job-alerts"
import { JobStatus, Prisma } from "@/generated/prisma/client"

export type JobRunCtx = {
  jobRunId: string
  addRows: (n: number) => void
}

export type JobRunOpts = {
  storeId?: string | null
  triggeredBy: "cron" | "manual" | "webhook" | "github-actions" | "internal"
  metadata?: Record<string, unknown>
  /**
   * When true, a run that completes without throwing but writes zero rows
   * (`addRows` total === 0) is recorded as PARTIAL rather than SUCCESS — so a
   * job that silently did no work can't masquerade as healthy. Opt write-
   * expecting syncs in; leave false for jobs that legitimately write nothing.
   */
  expectsRows?: boolean
}

/**
 * Wrap a sync/cron operation. Writes a JobRun row at start (RUNNING),
 * updates to SUCCESS/FAILURE on completion, captures duration + rows + error.
 * Re-throws caught errors after writing the row so existing error paths
 * still trigger upstream behavior.
 */
export async function withJobRun<T>(
  jobName: string,
  opts: JobRunOpts,
  fn: (ctx: JobRunCtx) => Promise<T>,
): Promise<T> {
  // First DB call of the run — most exposed to Neon cold-start ETIMEDOUTs
  // (incidents #40/#41), so retry transient connection failures.
  const run = await withPrismaRetry(
    () =>
      prisma.jobRun.create({
        data: {
          jobName,
          storeId: opts.storeId ?? null,
          triggeredBy: opts.triggeredBy,
          metadata: opts.metadata ? (opts.metadata as Prisma.InputJsonValue) : Prisma.DbNull,
          status: JobStatus.RUNNING,
        },
        select: { id: true, startedAt: true },
      }),
    { label: `withJobRun:${jobName}` },
  )

  let rows = 0
  const addRows = (n: number) => { rows += n }

  const start = Date.now()

  try {
    const result = await fn({ jobRunId: run.id, addRows })
    const status =
      opts.expectsRows && rows === 0 ? JobStatus.PARTIAL : JobStatus.SUCCESS
    await prisma.jobRun.update({
      where: { id: run.id },
      data: {
        status,
        completedAt: new Date(),
        durationMs: Date.now() - start,
        rowsWritten: rows,
      },
    })
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    await prisma.jobRun
      .update({
        where: { id: run.id },
        data: {
          status: JobStatus.FAILURE,
          completedAt: new Date(),
          durationMs: Date.now() - start,
          rowsWritten: rows,
          errorMessage: message.slice(0, 4000),
          errorStack: stack?.slice(0, 8000),
        },
      })
      .catch(() => {})
    // Best-effort, never throws — surfaces N-in-a-row failures on the error log.
    await evaluateJobAlert(jobName)
    throw err
  }
}
