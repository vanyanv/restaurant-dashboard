import { NextResponse } from "next/server"
import { withCronAuth } from "@/lib/cron-auth"
import { collectR2Stats } from "@/lib/monitoring/r2-stats"
import { withJobRun } from "@/lib/monitoring/job-run"
import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"

export const maxDuration = 60

/**
 * Daily R2 bucket snapshot. Lists every object via paginated
 * ListObjectsV2, sums sizes, groups by top-level prefix.
 * Schedule: 04:00 UTC.
 *
 * Records a `monitoring.r2-snapshot` JobRun like the DB snapshot does, so
 * the monitoring page and the staleness detector can see it stop.
 */
export const POST = withCronAuth(
  async (_request, { fromCron }) => {
    try {
      return await withJobRun(
        "monitoring.r2-snapshot",
        { triggeredBy: fromCron ? "cron" : "manual" },
        async ({ addRows }) => {
          const stats = await collectR2Stats()
          const row = await prisma.r2BucketSnapshot.create({
            data: {
              totalBytes: stats.totalBytes,
              objectCount: stats.objectCount,
              byPrefix: stats.byPrefix,
            },
            select: { id: true },
          })
          addRows(1)
          return NextResponse.json({
            id: row.id,
            totalBytes: Number(stats.totalBytes),
            objectCount: stats.objectCount,
            byPrefix: stats.byPrefix,
          })
        },
      )
    } catch (err) {
      logger.error("[r2-snapshot] failed", err)
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "unknown" },
        { status: 500 },
      )
    }
  },
  { unauthorized: { status: 403, error: "forbidden" } }
)
