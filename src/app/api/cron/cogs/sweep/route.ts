import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withCronAuth } from "@/lib/cron-auth"
import { recomputeDailyCogsForRange } from "@/lib/cogs-materializer"
import { shouldSkipCogsSweep } from "@/lib/cogs-sweep-gate"
import { withJobRun } from "@/lib/monitoring/job-run"
import { Prisma } from "@/generated/prisma/client"
import { logger } from "@/lib/logger"

export const maxDuration = 300

type CogsSweepOutcome = {
  skipped: boolean
  skipReason: string | null
  sourceChangedAt: Date | null
  lastSuccessfulSweepAt: Date | null
  daysProcessed: number
  rowsUpserted: number
  rowsDeleted: number
  /** DailyCogsItem rows actually inserted, updated or deleted. */
  rowsChanged: number
}

/**
 * Per-store COGS materialization. One endpoint serves both the 4-hour sweep
 * (lookbackDays=3) and the daily refresh (lookbackDays=30) workflows — the
 * GitHub Actions matrix fans out per-store so each call stays bounded.
 *
 * Writes are upserts; the per-day cleanup is scoped to one (storeId, date)
 * and only drops items that fell out of the source data, so historical rows
 * for other days can never be touched.
 */
import { laDatesBetween, withScopedWrites } from "@/lib/cache/closed-range"

export const POST = withCronAuth(async (request) => {
  const startedAt = Date.now()
  const url = new URL(request.url)
  const storeId = url.searchParams.get("storeId")
  const lookbackDays = Number(url.searchParams.get("lookbackDays") ?? 3)
  const force = url.searchParams.get("force") === "true"

  if (!storeId) {
    return NextResponse.json(
      { error: "storeId query param is required" },
      { status: 400 }
    )
  }
  if (!Number.isFinite(lookbackDays) || lookbackDays < 1 || lookbackDays > 365) {
    return NextResponse.json(
      { error: "lookbackDays must be between 1 and 365" },
      { status: 400 }
    )
  }

  const store = await prisma.store.findFirst({
    where: { id: storeId, isActive: true },
    select: { id: true, name: true, accountId: true },
  })
  if (!store) {
    return NextResponse.json(
      { error: `Store ${storeId} not found or inactive` },
      { status: 404 }
    )
  }

  const endDate = new Date()
  endDate.setUTCHours(0, 0, 0, 0)
  const startDate = new Date(endDate)
  startDate.setUTCDate(startDate.getUTCDate() - lookbackDays)

  try {
    // Scoped: afterwards it retires the saved figures of exactly the days in
    // its window. A skipped sweep, or one whose recompute changed no row,
    // wrote nothing and retires none.
    let wrote = true
    const result: CogsSweepOutcome = await withScopedWrites(
      () =>
        wrote
          ? laDatesBetween(startDate.toISOString(), endDate.toISOString())
          : [],
      async () => {
        const r: CogsSweepOutcome = await withJobRun(
      "cogs.sweep",
      {
        storeId: store.id,
        triggeredBy: "github-actions",
        metadata: { lookbackDays, force, skipPolicy: "source-change" },
      },
      async ({ jobRunId, addRows }) => {
        if (!force) {
          const skip = await shouldSkipCogsSweep({
            storeId: store.id,
            accountId: store.accountId,
            startDate,
            endDate,
            lookbackDays,
          })

          if (skip.shouldSkip) {
            await prisma.jobRun.update({
              where: { id: jobRunId },
              data: {
                metadata: {
                  lookbackDays,
                  force,
                  skipPolicy: "source-change",
                  skipped: true,
                  skipReason: skip.reason,
                  sourceChangedAt: skip.sourceChangedAt?.toISOString() ?? null,
                  lastSuccessfulSweepAt:
                    skip.lastSuccessfulSweepAt?.toISOString() ?? null,
                } satisfies Prisma.InputJsonValue,
              },
            })

            return {
              skipped: true,
              skipReason: skip.reason,
              sourceChangedAt: skip.sourceChangedAt,
              lastSuccessfulSweepAt: skip.lastSuccessfulSweepAt,
              daysProcessed: 0,
              rowsUpserted: 0,
              rowsDeleted: 0,
              rowsChanged: 0,
            }
          }
        }

        const r = await recomputeDailyCogsForRange({
          storeId: store.id,
          accountId: store.accountId,
          startDate,
          endDate,
        })
        addRows(r.rowsUpserted)
        return {
          skipped: false,
          skipReason: null,
          sourceChangedAt: null,
          lastSuccessfulSweepAt: null,
          ...r,
        }
      }
    )
        wrote = !r.skipped && r.rowsChanged > 0
        return r
      },
    )

    return NextResponse.json({
      storeId: store.id,
      storeName: store.name,
      lookbackDays,
      force,
      skipped: result.skipped,
      skipReason: result.skipReason,
      sourceChangedAt: result.sourceChangedAt?.toISOString() ?? null,
      lastSuccessfulSweepAt:
        result.lastSuccessfulSweepAt?.toISOString() ?? null,
      daysProcessed: result.daysProcessed,
      rowsUpserted: result.rowsUpserted,
      rowsDeleted: result.rowsDeleted,
      rowsChanged: result.rowsChanged,
      durationMs: Date.now() - startedAt,
    })
  } catch (err) {
    logger.error(`[cron/cogs/sweep] store ${store.id} failed:`, err)
    return NextResponse.json(
      {
        error: "sweep failed",
        message: err instanceof Error ? err.message : String(err),
        storeId: store.id,
        durationMs: Date.now() - startedAt,
      },
      { status: 500 }
    )
  }
})
