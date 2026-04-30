import { prisma } from "@/lib/prisma"
import { JobStatus } from "@/generated/prisma/client"

export type JobRunCtx = {
  jobRunId: string
  addRows: (n: number) => void
}

export type JobRunOpts = {
  storeId?: string | null
  triggeredBy: "cron" | "manual" | "webhook" | "github-actions" | "internal"
  metadata?: Record<string, unknown>
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
  const run = await prisma.jobRun.create({
    data: {
      jobName,
      storeId: opts.storeId ?? null,
      triggeredBy: opts.triggeredBy,
      metadata: (opts.metadata ?? null) as never,
      status: JobStatus.RUNNING,
    },
    select: { id: true, startedAt: true },
  })

  let rows = 0
  const addRows = (n: number) => { rows += n }

  const start = Date.now()

  try {
    const result = await fn({ jobRunId: run.id, addRows })
    await prisma.jobRun.update({
      where: { id: run.id },
      data: {
        status: JobStatus.SUCCESS,
        completedAt: new Date(),
        durationMs: Date.now() - start,
        rowsWritten: rows,
      },
    })
    // Phase 8 will add: void evaluateAlerts(run.id)
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
    throw err
  }
}
