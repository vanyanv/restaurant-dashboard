import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isCronRequest } from "@/lib/rate-limit"
import { recomputeDailyCogsForRange } from "@/lib/cogs-materializer"
import { withJobRun } from "@/lib/monitoring/job-run"
import { Prisma } from "@/generated/prisma/client"

export const maxDuration = 300

type CogsSweepOutcome = {
  skipped: boolean
  skipReason: string | null
  sourceChangedAt: Date | null
  lastSuccessfulSweepAt: Date | null
  daysProcessed: number
  rowsUpserted: number
  rowsDeleted: number
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
export async function POST(request: NextRequest) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

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
    const result: CogsSweepOutcome = await withJobRun(
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
      durationMs: Date.now() - startedAt,
    })
  } catch (err) {
    console.error(`[cron/cogs/sweep] store ${store.id} failed:`, err)
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
}

async function shouldSkipCogsSweep(input: {
  storeId: string
  accountId: string
  startDate: Date
  endDate: Date
  lookbackDays: number
}): Promise<{
  shouldSkip: boolean
  reason: string | null
  sourceChangedAt: Date | null
  lastSuccessfulSweepAt: Date | null
}> {
  const [sourceChangedAt, lastSuccessfulSweepAt] = await Promise.all([
    getLatestCogsSourceChangeAt(input),
    getLastSuccessfulCogsSweepAt(input.storeId, input.lookbackDays),
  ])

  if (!lastSuccessfulSweepAt) {
    return {
      shouldSkip: false,
      reason: null,
      sourceChangedAt,
      lastSuccessfulSweepAt,
    }
  }

  if (!sourceChangedAt || sourceChangedAt <= lastSuccessfulSweepAt) {
    return {
      shouldSkip: true,
      reason: "no source changes since last successful sweep",
      sourceChangedAt,
      lastSuccessfulSweepAt,
    }
  }

  return {
    shouldSkip: false,
    reason: null,
    sourceChangedAt,
    lastSuccessfulSweepAt,
  }
}

async function getLastSuccessfulCogsSweepAt(
  storeId: string,
  lookbackDays: number,
): Promise<Date | null> {
  const rows = await prisma.$queryRaw<Array<{ completedAt: Date | null }>>`
    SELECT "completedAt"
    FROM "JobRun"
    WHERE "jobName" = 'cogs.sweep'
      AND "storeId" = ${storeId}
      AND "status" = 'SUCCESS'::"JobStatus"
      AND "completedAt" IS NOT NULL
      AND ("metadata"->>'lookbackDays')::int = ${lookbackDays}
    ORDER BY "completedAt" DESC
    LIMIT 1
  `
  return rows[0]?.completedAt ?? null
}

async function getLatestCogsSourceChangeAt(input: {
  storeId: string
  accountId: string
  startDate: Date
  endDate: Date
}): Promise<Date | null> {
  const endExclusive = new Date(input.endDate)
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1)

  const rows = await prisma.$queryRaw<Array<{ changedAt: Date | null }>>`
    SELECT NULLIF(GREATEST(
      COALESCE((
        SELECT MAX("syncedAt")
        FROM "OtterMenuItem"
        WHERE "storeId" = ${input.storeId}
          AND "date" >= ${input.startDate}::date
          AND "date" <= ${input.endDate}::date
      ), 'epoch'::timestamp),
      COALESCE((
        SELECT MAX("syncedAt")
        FROM "OtterOrder"
        WHERE "storeId" = ${input.storeId}
          AND "referenceTimeLocal" >= ${input.startDate}
          AND "referenceTimeLocal" < ${endExclusive}
      ), 'epoch'::timestamp),
      COALESCE((
        SELECT MAX("detailsFetchedAt")
        FROM "OtterOrder"
        WHERE "storeId" = ${input.storeId}
          AND "referenceTimeLocal" >= ${input.startDate}
          AND "referenceTimeLocal" < ${endExclusive}
      ), 'epoch'::timestamp),
      COALESCE((
        SELECT MAX("updatedAt")
        FROM "Recipe"
        WHERE "accountId" = ${input.accountId}
      ), 'epoch'::timestamp),
      COALESCE((
        SELECT MAX(ri."updatedAt")
        FROM "RecipeIngredient" ri
        JOIN "Recipe" r ON r.id = ri."recipeId"
        WHERE r."accountId" = ${input.accountId}
      ), 'epoch'::timestamp),
      COALESCE((
        SELECT MAX(GREATEST("updatedAt", COALESCE("costUpdatedAt", 'epoch'::timestamp)))
        FROM "CanonicalIngredient"
        WHERE "accountId" = ${input.accountId}
      ), 'epoch'::timestamp),
      COALESCE((
        SELECT MAX(GREATEST("createdAt", "confirmedAt"))
        FROM "OtterItemMapping"
        WHERE "storeId" = ${input.storeId}
      ), 'epoch'::timestamp),
      COALESCE((
        SELECT MAX(GREATEST("createdAt", "confirmedAt"))
        FROM "OtterSubItemMapping"
        WHERE "storeId" = ${input.storeId}
      ), 'epoch'::timestamp),
      COALESCE((
        SELECT MAX("updatedAt")
        FROM "Invoice"
        WHERE "accountId" = ${input.accountId}
          AND ("storeId" = ${input.storeId} OR "storeId" IS NULL)
      ), 'epoch'::timestamp),
      COALESCE((
        SELECT MAX(li."matchedAt")
        FROM "InvoiceLineItem" li
        JOIN "Invoice" i ON i.id = li."invoiceId"
        WHERE i."accountId" = ${input.accountId}
          AND (i."storeId" = ${input.storeId} OR i."storeId" IS NULL)
      ), 'epoch'::timestamp)
    ), 'epoch'::timestamp) AS "changedAt"
  `

  return rows[0]?.changedAt ?? null
}
