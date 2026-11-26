/**
 * The COGS sweep as a job, apart from where it runs.
 *
 * Until 2026-11-26 this lived inside `/api/cron/cogs/sweep` and
 * `/api/cron/cogs/stores`, and GitHub Actions called those endpoints once per
 * store. The recompute is the most processor-heavy background job the app
 * has, and every second of it counted against the Vercel Hobby plan's 4 hours
 * of Active CPU a month (3.5 of 4 used by 2026-11-23). `scripts/sweep-cogs.ts`
 * now runs the same two functions on the GitHub Actions runner, the way the
 * Otter syncs already run, so the sweep costs Vercel nothing.
 *
 * The endpoints still call these, so a sweep triggered by hand through the
 * API does exactly what the scheduled one does: the same store list, the same
 * source-change skip, the same `cogs.stores` and `cogs.sweep` JobRun rows the
 * monitoring page and the staleness check read, and the same retirement of
 * saved figures for the days it rewrote.
 */
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/generated/prisma/client"
import { recomputeDailyCogsForRange } from "@/lib/cogs-materializer"
import { shouldSkipCogsSweep } from "@/lib/cogs-sweep-gate"
import { withJobRun, type JobRunOpts } from "@/lib/monitoring/job-run"
import { laDatesBetween, withScopedWrites } from "@/lib/cache/closed-range"

export const COGS_SWEEP_MIN_LOOKBACK_DAYS = 1
export const COGS_SWEEP_MAX_LOOKBACK_DAYS = 365

export function isValidCogsLookback(lookbackDays: number): boolean {
  return (
    Number.isFinite(lookbackDays) &&
    lookbackDays >= COGS_SWEEP_MIN_LOOKBACK_DAYS &&
    lookbackDays <= COGS_SWEEP_MAX_LOOKBACK_DAYS
  )
}

export type CogsSweepStore = { id: string; name: string; accountId: string }

export type CogsSweepStoreList = {
  stores: CogsSweepStore[]
  activeStoreCount: number
  skippedEmptyStoreCount: number
  force: boolean
}

/**
 * The active stores a sweep should visit. A store with no Otter menu items
 * and no Otter orders has nothing to cost and is left out unless `force`.
 * Records a `cogs.stores` JobRun.
 */
export async function listCogsSweepStores(opts: {
  force: boolean
  triggeredBy: JobRunOpts["triggeredBy"]
}): Promise<CogsSweepStoreList> {
  const { force, triggeredBy } = opts
  return withJobRun(
    "cogs.stores",
    { triggeredBy, metadata: { force } },
    async ({ addRows }) => {
      const activeStores = await prisma.store.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          accountId: true,
          _count: {
            select: {
              otterMenuItems: true,
              otterOrders: true,
            },
          },
        },
        orderBy: { name: "asc" },
      })

      const rows = (force
        ? activeStores
        : activeStores.filter(
            (store) =>
              store._count.otterMenuItems > 0 || store._count.otterOrders > 0,
          )
      ).map(({ _count, ...store }) => store)

      addRows(rows.length)
      return {
        stores: rows,
        activeStoreCount: activeStores.length,
        skippedEmptyStoreCount: activeStores.length - rows.length,
        force,
      }
    },
  )
}

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

export type CogsSweepResult = {
  storeId: string
  storeName: string
  lookbackDays: number
  force: boolean
  skipped: boolean
  skipReason: string | null
  sourceChangedAt: string | null
  lastSuccessfulSweepAt: string | null
  daysProcessed: number
  rowsUpserted: number
  rowsDeleted: number
  rowsChanged: number
}

/** The store id names no active store. The endpoint answers 404 for it. */
export class CogsSweepStoreNotFoundError extends Error {
  constructor(public readonly storeId: string) {
    super(`Store ${storeId} not found or inactive`)
    this.name = "CogsSweepStoreNotFoundError"
  }
}

/** A sweep that started and failed. Carries the store it was for. */
export class CogsSweepFailedError extends Error {
  constructor(
    public readonly storeId: string,
    public readonly cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = "CogsSweepFailedError"
  }
}

/**
 * Per-store COGS materialization for the last `lookbackDays` days. One
 * function serves both the twice-daily sweep (3 days) and the weekly refresh
 * (30 days).
 *
 * Writes are upserts; the per-day cleanup is scoped to one (storeId, date)
 * and only drops items that fell out of the source data, so historical rows
 * for other days can never be touched.
 *
 * Throws `CogsSweepStoreNotFoundError` before any JobRun row is written, and
 * `CogsSweepFailedError` when the run itself fails (its JobRun row is FAILURE).
 */
export async function runCogsSweepForStore(opts: {
  storeId: string
  lookbackDays: number
  force: boolean
  triggeredBy: JobRunOpts["triggeredBy"]
}): Promise<CogsSweepResult> {
  const { storeId, lookbackDays, force, triggeredBy } = opts
  if (!isValidCogsLookback(lookbackDays)) {
    throw new RangeError(
      `lookbackDays must be between ${COGS_SWEEP_MIN_LOOKBACK_DAYS} and ${COGS_SWEEP_MAX_LOOKBACK_DAYS}`,
    )
  }

  const store = await prisma.store.findFirst({
    where: { id: storeId, isActive: true },
    select: { id: true, name: true, accountId: true },
  })
  if (!store) throw new CogsSweepStoreNotFoundError(storeId)

  const endDate = new Date()
  endDate.setUTCHours(0, 0, 0, 0)
  const startDate = new Date(endDate)
  startDate.setUTCDate(startDate.getUTCDate() - lookbackDays)

  let result: CogsSweepOutcome
  try {
    // Scoped: afterwards it retires the saved figures of exactly the days in
    // its window. A skipped sweep, or one whose recompute changed no row,
    // wrote nothing and retires none.
    let wrote = true
    result = await withScopedWrites(
      () =>
        wrote
          ? laDatesBetween(startDate.toISOString(), endDate.toISOString())
          : [],
      async () => {
        const r: CogsSweepOutcome = await withJobRun(
          "cogs.sweep",
          {
            storeId: store.id,
            triggeredBy,
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

            const recomputed = await recomputeDailyCogsForRange({
              storeId: store.id,
              accountId: store.accountId,
              startDate,
              endDate,
            })
            addRows(recomputed.rowsUpserted)
            return {
              skipped: false,
              skipReason: null,
              sourceChangedAt: null,
              lastSuccessfulSweepAt: null,
              ...recomputed,
            }
          },
        )
        wrote = !r.skipped && r.rowsChanged > 0
        return r
      },
    )
  } catch (err) {
    throw new CogsSweepFailedError(store.id, err)
  }

  return {
    storeId: store.id,
    storeName: store.name,
    lookbackDays,
    force,
    skipped: result.skipped,
    skipReason: result.skipReason,
    sourceChangedAt: result.sourceChangedAt?.toISOString() ?? null,
    lastSuccessfulSweepAt: result.lastSuccessfulSweepAt?.toISOString() ?? null,
    daysProcessed: result.daysProcessed,
    rowsUpserted: result.rowsUpserted,
    rowsDeleted: result.rowsDeleted,
    rowsChanged: result.rowsChanged,
  }
}
