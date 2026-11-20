/**
 * The stores an Otter metrics sync run should fan out to — the list behind
 * `/api/cron/otter/stores`. Lives outside the route because a Next route
 * module may only export route fields, and this needs tests of its own.
 */
import { prisma } from "@/lib/prisma"
import { JobStatus } from "@/generated/prisma/client"
import { RECENT_SUCCESS_WINDOW_MS } from "@/lib/monitoring/job-run"
import { shouldSyncStore } from "@/lib/store-lifecycle"

/** The scheduled run's window: the last 3 days up to now, every phase. */
const SCHEDULED_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000
const WINDOW_SLACK_MS = 60 * 60 * 1000

/**
 * True when a recent run did at least what the scheduled run would: all
 * phases including ratings, a window reaching back 3 days and up to when it
 * started. A backfill writes "internal" rows per 30-day chunk (oldest first)
 * and `--daily-only` runs skip categories, items and ratings — neither may
 * stand in for the scheduled sync.
 */
export function coversScheduledWindow(startedAt: Date, metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false
  const m = metadata as Record<string, unknown>
  if (m.dailyOnly !== false || m.includeRatings !== true) return false
  const start = typeof m.windowStart === "string" ? Date.parse(m.windowStart) : NaN
  const end = typeof m.windowEnd === "string" ? Date.parse(m.windowEnd) : NaN
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false
  const t = startedAt.getTime()
  return end >= t - WINDOW_SLACK_MS && start <= t - SCHEDULED_LOOKBACK_MS + WINDOW_SLACK_MS
}

export type OtterSyncStore = { storeId: string; name: string; otterStoreIds: string[] }

/**
 * Active stores with their Otter UUIDs, sorted by name. With `skipRecent`,
 * stores whose `otter.metrics.sync` succeeded within the last 20 minutes
 * (from the scheduled backfill script, `triggeredBy: "internal"`) are moved
 * to `recent` instead: one read on JobRun's `[jobName, startedAt]` index.
 */
export async function otterStoresToSync(opts: { skipRecent: boolean; now?: Date }): Promise<{
  stores: OtterSyncStore[]
  /** Store ids left out because a sync of theirs just succeeded. */
  recent: string[]
  /** Active stores before that filter. */
  active: number
}> {
  const now = opts.now ?? new Date()
  const [otterStores, recentRuns] = await Promise.all([
    prisma.otterStore.findMany({
      include: {
        store: { select: { id: true, name: true, isActive: true, lifecycleStage: true } },
      },
    }),
    opts.skipRecent
      ? prisma.jobRun.findMany({
          where: {
            jobName: "otter.metrics.sync",
            triggeredBy: "internal",
            status: JobStatus.SUCCESS,
            startedAt: { gte: new Date(now.getTime() - RECENT_SUCCESS_WINDOW_MS) },
            storeId: { not: null },
          },
          select: { storeId: true, startedAt: true, metadata: true },
        })
      : Promise.resolve([] as Array<{ storeId: string | null; startedAt: Date; metadata: unknown }>),
  ])
  const active = otterStores.filter((os) => shouldSyncStore(os.store))

  const grouped = new Map<string, OtterSyncStore>()
  for (const os of active) {
    const existing = grouped.get(os.storeId)
    if (existing) {
      existing.otterStoreIds.push(os.otterStoreId)
    } else {
      grouped.set(os.storeId, {
        storeId: os.storeId,
        name: os.store.name,
        otterStoreIds: [os.otterStoreId],
      })
    }
  }

  const recentIds = new Set(
    recentRuns.filter((r) => coversScheduledWindow(r.startedAt, r.metadata)).map((r) => r.storeId),
  )
  const all = [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name))
  return {
    stores: all.filter((s) => !recentIds.has(s.storeId)),
    recent: all.filter((s) => recentIds.has(s.storeId)).map((s) => s.storeId),
    active: all.length,
  }
}
