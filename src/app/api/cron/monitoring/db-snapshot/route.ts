import { NextResponse } from "next/server"
import { withCronAuth } from "@/lib/cron-auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/generated/prisma/client"
import { getDbSize, getTableSizes } from "@/lib/monitoring/db-stats"
import { withJobRun } from "@/lib/monitoring/job-run"

export const maxDuration = 30

/**
 * Captures one DbSnapshot row per day. Idempotent via UPSERT on the date
 * unique key — running multiple times in a day overwrites the previous
 * snapshot for that day with the latest measurement.
 *
 * Schedule: daily (e.g. 02:00 UTC via GitHub Actions or Vercel cron).
 */
export const POST = withCronAuth(
  async (_request, { fromCron }) =>
    // This job has always worked, but never recorded a JobRun, so the
    // monitoring page and the staleness detector both read it as "has never
    // run". A job nothing can observe is a job nothing can miss.
    withJobRun(
      "monitoring.db-snapshot",
      { triggeredBy: fromCron ? "cron" : "manual" },
      async ({ addRows }) => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [size, tables] = await Promise.all([getDbSize(), getTableSizes(12)])

    const perTable = tables.map((t) => ({
      table: t.table,
      bytes: t.bytes,
      rows: Number(t.rows), // BigInt → Number for JSON
    }))

    const row = await prisma.dbSnapshot.upsert({
      where: { date: today },
      create: {
        date: today,
        totalBytes: BigInt(size.totalBytes),
        perTable: perTable as Prisma.InputJsonValue,
      },
      update: {
        capturedAt: new Date(),
        totalBytes: BigInt(size.totalBytes),
        perTable: perTable as Prisma.InputJsonValue,
      },
      select: { id: true, date: true, totalBytes: true },
    })

    addRows(1)

    return NextResponse.json({
      id: row.id,
      date: row.date,
      totalBytes: Number(row.totalBytes),
    })
      },
    ),
  { unauthorized: { status: 403, error: "forbidden" } }
)
