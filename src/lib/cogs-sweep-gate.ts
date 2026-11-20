/**
 * The COGS sweep's "has anything changed since the last materialization?" gate.
 *
 * Lives outside the route because a Next route module may only export route
 * fields, and the gate needs tests of its own.
 *
 * The OtterMenuItem half reads MAX("syncedAt"), which since 2026-11-20 moves
 * only when the metrics sync inserts or changes a row (it used to move on
 * every run, so this gate never skipped — every 4-hour sweep recomputed and
 * rewrote the whole window).
 */
import { prisma } from "@/lib/prisma"

/**
 * Skip a sweep only when no COGS source moved since the last sweep that
 * actually materialized this store's window began.
 */
/** A change stamped this long before a sweep started may not have been committed when it read. */
export const SETTLE_MS = 10 * 60 * 1000
/** A window is recomputed at least this often, so a delete is picked up within a day. */
export const MAX_SKIP_AGE_MS = 24 * 60 * 60 * 1000

export async function shouldSkipCogsSweep(input: {
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

  // Two margins, because the timestamps cannot see everything:
  //  - A write stamps its rows when its statement is built, and commits a
  //    moment later; a sweep that started in between read the old rows. So a
  //    change counts if it is within SETTLE_MS before the last sweep started.
  //  - A delete (a recipe, a mapping, a merged ingredient) moves no
  //    timestamp at all. So a window is recomputed at least once a day
  //    whatever the timestamps say.
  const now = Date.now()
  const sweepIsFresh = now - lastSuccessfulSweepAt.getTime() < MAX_SKIP_AGE_MS
  const settledBaseline = new Date(lastSuccessfulSweepAt.getTime() - SETTLE_MS)
  if (sweepIsFresh && (!sourceChangedAt || sourceChangedAt <= settledBaseline)) {
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

/**
 * When the last sweep that actually materialized this window STARTED.
 *
 * Two things this used to get wrong, both of which could leave COGS stale:
 *
 *  - It took `completedAt`. A source row written while a sweep was running
 *    (after that sweep had read it, before it finished) has a timestamp
 *    earlier than `completedAt`, so every later sweep skipped it until some
 *    other source moved. `startedAt` is the last moment the sweep is known to
 *    have read nothing yet; anything written after it is re-read.
 *  - It counted skipped runs. A skip is recorded as a SUCCESS too, so its
 *    completion became the new baseline, and a change landing between the
 *    skip's check and its completion was never materialized. Only a run
 *    that recomputed (metadata has no `skipped: true`) is a materialization.
 *
 */
export async function getLastSuccessfulCogsSweepAt(
  storeId: string,
  lookbackDays: number,
): Promise<Date | null> {
  const rows = await prisma.$queryRaw<Array<{ startedAt: Date | null }>>`
    SELECT "startedAt"
    FROM "JobRun"
    WHERE "jobName" = 'cogs.sweep'
      AND "storeId" = ${storeId}
      AND "status" = 'SUCCESS'::"JobStatus"
      AND "completedAt" IS NOT NULL
      AND ("metadata"->>'lookbackDays')::int = ${lookbackDays}
      AND COALESCE("metadata"->>'skipped', 'false') <> 'true'
    ORDER BY "startedAt" DESC
    LIMIT 1
  `
  return rows[0]?.startedAt ?? null
}

export async function getLatestCogsSourceChangeAt(input: {
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
