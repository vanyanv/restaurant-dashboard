import { NextResponse } from "next/server"
import { Prisma } from "@/generated/prisma/client"
import { withCronAuth } from "@/lib/cron-auth"
import { prisma } from "@/lib/prisma"
import { JOB_SCHEDULES } from "@/lib/monitoring/job-schedules"
import {
  JOB_DATA_OWNERSHIP,
  detectStaleness,
  type FreshnessReading,
} from "@/lib/monitoring/staleness"

export const maxDuration = 60

/**
 * Is every scheduled job still running, and is the data it owns still fresh?
 *
 * Returns 200 when healthy and 503 when not, so the workflow step fails and
 * hands off to the existing report-workflow-failure.sh incident flow. The
 * body carries the detail either way — a green run still shows what it saw.
 */
export const GET = withCronAuth(
  async () => {
    const now = new Date()

    const lastRuns = await prisma.$queryRaw<{ jobName: string; startedAt: Date }[]>`
      SELECT DISTINCT ON ("jobName") "jobName", "startedAt"
      FROM "JobRun"
      ORDER BY "jobName", "startedAt" DESC
    `
    const lastRunByJob = new Map(lastRuns.map((r) => [r.jobName, r.startedAt]))

    // One MAX() per owned table. Identifiers come from JOB_DATA_OWNERSHIP, a
    // module constant — never from request input — so raw interpolation here
    // is safe. Prisma.raw is required because identifiers can't be bound.
    const dataAtByJob = new Map<string, Date | null>()
    await Promise.all(
      Object.entries(JOB_DATA_OWNERSHIP).map(async ([jobName, owns]) => {
        const rows = await prisma.$queryRaw<{ max: Date | null }[]>(
          Prisma.sql`SELECT MAX(${Prisma.raw(`"${owns.column}"`)}) AS max FROM ${Prisma.raw(`"${owns.table}"`)}`,
        )
        dataAtByJob.set(jobName, rows[0]?.max ?? null)
      }),
    )

    const readings: FreshnessReading[] = Object.keys(JOB_SCHEDULES).map((jobName) => ({
      jobName,
      lastRunAt: lastRunByJob.get(jobName) ?? null,
      dataAt: dataAtByJob.get(jobName) ?? null,
    }))

    const verdict = detectStaleness(readings, now)

    // Mirror failures into the in-app error log the monitoring page reads.
    // Best-effort: a failing write must not mask the verdict.
    if (!verdict.ok) {
      try {
        await prisma.errorEvent.create({
          data: {
            source: "cron.staleness",
            message: `${verdict.problems.length} stale job(s): ${verdict.problems
              .map((p) => `${p.jobName} (${p.reason})`)
              .join(", ")}`,
            metadata: { problems: verdict.problems },
          },
        })
      } catch (err) {
        console.error("[cron.staleness] errorEvent write failed:", err)
      }
    }

    return NextResponse.json(
      { checkedAt: now.toISOString(), ...verdict },
      { status: verdict.ok ? 200 : 503 },
    )
  },
  { unauthorized: { status: 403, error: "forbidden" } },
)
