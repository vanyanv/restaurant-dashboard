import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/generated/prisma/client"
import { withCronAuth } from "@/lib/cron-auth"
import { withJobRun } from "@/lib/monitoring/job-run"
import { logger } from "@/lib/logger"

export const maxDuration = 60

// Tables that grow unbounded (audit logs + per-day forecast rows) and the age
// past which their rows stop being useful. Deletes are date-bounded and run
// nightly, so steady-state each pass only trims one day's tail.
const POLICIES = [
  { table: "JobRun", dateColumn: "startedAt", retentionDays: 90 },
  { table: "ErrorEvent", dateColumn: "occurredAt", retentionDays: 90 },
  { table: "AiForecastRun", dateColumn: "generatedAt", retentionDays: 365 },
] as const

const BATCH_SIZE = 5000
// Cap work per table per run so the very first pass over a large backlog can't
// exceed the function timeout. The next nightly run picks up where this left
// off; steady-state never approaches the cap.
const MAX_BATCHES = 50

/**
 * Delete rows older than `cutoff` from `table` in bounded batches. Returns the
 * number deleted and whether the per-run cap was hit (backlog remains).
 * Identifiers are hardcoded literals (never user input), so Prisma.raw is safe.
 */
async function purgeOldRows(
  table: string,
  dateColumn: string,
  cutoff: Date,
): Promise<{ deleted: number; capped: boolean }> {
  const ident = (name: string) => Prisma.raw(`"${name}"`)
  let deleted = 0

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const n = await prisma.$executeRaw(Prisma.sql`
      DELETE FROM ${ident(table)}
      WHERE "id" IN (
        SELECT "id" FROM ${ident(table)}
        WHERE ${ident(dateColumn)} < ${cutoff}
        LIMIT ${BATCH_SIZE}
      )
    `)
    deleted += n
    if (n < BATCH_SIZE) return { deleted, capped: false }
  }

  return { deleted, capped: true }
}

/**
 * Nightly data-retention sweep. Trims unbounded audit/forecast tables so the
 * Neon database doesn't accumulate years of monitoring rows. Triggered by the
 * `.github/workflows/retention.yml` schedule (or a manual owner request).
 */
export const POST = withCronAuth(
  async (_request, { fromCron }) => {
    const startedAt = Date.now()
    try {
      const result = await withJobRun(
        "maintenance.retention",
        { triggeredBy: fromCron ? "cron" : "manual" },
        async ({ addRows }) => {
          const now = Date.now()
          const outcomes: Array<{
            table: string
            deleted: number
            capped: boolean
          }> = []

          for (const policy of POLICIES) {
            const cutoff = new Date(
              now - policy.retentionDays * 24 * 60 * 60 * 1000,
            )
            const { deleted, capped } = await purgeOldRows(
              policy.table,
              policy.dateColumn,
              cutoff,
            )
            addRows(deleted)
            outcomes.push({ table: policy.table, deleted, capped })
            if (capped) {
              logger.warn(
                `[cron/retention] ${policy.table} hit batch cap; backlog remains for next run`,
              )
            }
          }

          return outcomes
        },
      )

      return NextResponse.json({
        outcomes: result,
        totalDeleted: result.reduce((n, o) => n + o.deleted, 0),
        durationMs: Date.now() - startedAt,
      })
    } catch (err) {
      logger.error("[cron/retention] failed:", err)
      return NextResponse.json(
        {
          error: "retention failed",
          message: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - startedAt,
        },
        { status: 500 },
      )
    }
  },
  { ownerFallback: { forbiddenMessage: "Only owners can run retention cleanup" } },
)
