/**
 * Job-run wrapper. Two DB writes per call (start + end) — fine for sync/cron
 * work, NOT for per-request handlers. Don't wrap a hot HTTP path in this.
 *
 * A run that `skipIf` turns away writes nothing at all: no RUNNING row, no
 * SUCCESS row. That is safe for monitoring only because of what a skip is
 * allowed to mean — "a real run already did this moments ago" (see
 * `recentSuccessSkip`), and that run's own SUCCESS row is what overdue and
 * staleness checks read. A skip that can last longer than a job's cadence
 * (the COGS sweep's "no source changed" skip) must NOT use `skipIf`; it
 * records a SUCCESS row with `metadata.skipped` instead, or the job would
 * read as overdue overnight.
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

/** What a skipped run returns instead of the job's own result. */
export type JobRunSkip = { skipped: string } & Record<string, unknown>

/** The answer when a scheduled run duplicates one that just succeeded. */
export type RecentSuccessSkip = {
  skipped: "recent-success"
  jobName: string
  storeId?: string
  /** When the run that made this one unnecessary started, ISO. */
  lastSuccessAt: string
}

/**
 * How recent a SUCCESS must be for a scheduled run to count as a duplicate.
 * The sync ticker dispatches each sales sync on time and every workflow's own
 * `schedule:` stays as a backup that GitHub fires late, so the same window
 * is often requested twice within minutes. The shortest cadence among the
 * jobs that use this is hourly, so 20 minutes never swallows a run that was
 * due.
 */
export const RECENT_SUCCESS_WINDOW_MS = 20 * 60_000

export function isJobRunSkip(v: unknown): v is JobRunSkip {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { skipped?: unknown }).skipped === "string"
  )
}

/**
 * The newest SUCCESS run of `jobName` that started within `withinMs` of
 * `now`, or null. One indexed read: `[jobName, startedAt DESC]`, or
 * `[jobName, storeId, startedAt DESC]` when `storeId` is given.
 *
 * `triggeredBy` narrows it to runs from the same kind of caller, so a short
 * manual run from the dashboard never stands in for a scheduled one.
 */
export async function findRecentSuccess(
  jobName: string,
  opts: {
    storeId?: string
    triggeredBy?: JobRunOpts["triggeredBy"]
    withinMs?: number
    now?: Date
  } = {},
): Promise<{ id: string; startedAt: Date; metadata: unknown } | null> {
  const now = opts.now ?? new Date()
  const since = new Date(now.getTime() - (opts.withinMs ?? RECENT_SUCCESS_WINDOW_MS))
  return prisma.jobRun.findFirst({
    where: {
      jobName,
      ...(opts.storeId !== undefined ? { storeId: opts.storeId } : {}),
      ...(opts.triggeredBy ? { triggeredBy: opts.triggeredBy } : {}),
      status: JobStatus.SUCCESS,
      startedAt: { gte: since },
    },
    orderBy: { startedAt: "desc" },
    select: { id: true, startedAt: true, metadata: true },
  })
}

/**
 * A `skipIf` for `withJobRun`: skip when the same job (and store) succeeded
 * within the last 20 minutes. `accept` can refuse a recent run as a stand-in
 * (the invoice sync refuses one that left emails deferred, so its drain keeps
 * going).
 */
export function recentSuccessSkip(
  jobName: string,
  opts: {
    storeId?: string
    triggeredBy?: JobRunOpts["triggeredBy"]
    withinMs?: number
    accept?: (run: { startedAt: Date; metadata: unknown }) => boolean
  } = {},
): () => Promise<RecentSuccessSkip | null> {
  return async () => {
    const run = await findRecentSuccess(jobName, opts)
    if (!run || (opts.accept && !opts.accept(run))) return null
    return {
      skipped: "recent-success",
      jobName,
      ...(opts.storeId !== undefined ? { storeId: opts.storeId } : {}),
      lastSuccessAt: run.startedAt.toISOString(),
    }
  }
}

/**
 * Wrap a sync/cron operation. Writes a JobRun row at start (RUNNING),
 * updates to SUCCESS/FAILURE on completion, captures duration + rows + error.
 * Re-throws caught errors after writing the row so existing error paths
 * still trigger upstream behavior.
 *
 * With `skipIf`, that check runs first; when it returns a skip, the skip is
 * returned and nothing is written (see the module comment for when that is
 * allowed).
 */
export function withJobRun<T, S extends JobRunSkip>(
  jobName: string,
  opts: JobRunOpts & { skipIf: () => Promise<S | null> },
  fn: (ctx: JobRunCtx) => Promise<T>,
): Promise<T | S>
export function withJobRun<T>(
  jobName: string,
  opts: JobRunOpts,
  fn: (ctx: JobRunCtx) => Promise<T>,
): Promise<T>
export async function withJobRun<T>(
  jobName: string,
  opts: JobRunOpts & { skipIf?: () => Promise<JobRunSkip | null> },
  fn: (ctx: JobRunCtx) => Promise<T>,
): Promise<T | JobRunSkip> {
  if (opts.skipIf) {
    // The check reads the database too, and is now the first call of the
    // run, so it gets the same cold-start retry as the create below.
    // If the check itself fails, run anyway: every job that skips is safe to
    // run twice, and a failed check must not turn into a failed sync.
    let skip: JobRunSkip | null = null
    try {
      skip = await withPrismaRetry(() => opts.skipIf!(), {
        label: `withJobRun:${jobName}:skipIf`,
      })
    } catch (error) {
      console.warn(`[withJobRun:${jobName}] skip check failed, running anyway:`, error)
    }
    if (skip) return skip
  }

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
