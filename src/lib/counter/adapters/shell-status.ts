import { prisma } from "@/lib/prisma"
import { cached } from "@/lib/cache/cached"
import type { SyncState } from "@/components/counter/shell/sync-chip"

/**
 * The two facts the SHELL carries on every Counter page: whether the figures
 * can be trusted (the sync chip in the topbar) and how many things need the
 * reader (the count on "Needs you" in the rail). Both are read once per
 * request in the dashboard layout and handed down as plain values, so the
 * rail and the topbar never run a query of their own.
 *
 * Sync. Otter's sync (every four hours by cron, when GitHub runs it) writes
 * a `JobRun` named `otter.metrics.sync` (`withJobRun`, src/lib/monitoring/
 * job-run.ts); its newest row is the fact. `RUNNING` is `syncing`; `FAILURE`
 * is `failed`; a `SUCCESS` older than `STALE_AFTER_HOURS` (one missed run
 * and change) is `stale`, which the chip paints in the signal colour and
 * says in words. Nothing here polls: the chip changes when the page
 * next renders, and "syncing" is only ever true for the minutes a run is
 * actually open.
 *
 * Needs you. The count of `Alert` rows still `OPEN` across the ACCOUNT's
 * stores (every store, because the rail is not scoped to one; only the
 * account's, because nothing here may see another tenant's). The rail shows
 * the badge only above zero.
 *
 * Both facts are scoped by the store ids the layout already holds
 * (`getOverviewStores`, itself account-scoped), and a sync run with no
 * store on it is the platform's own and counts for everyone. The cache key
 * carries the account id, so one tenant's minute can never be served to
 * another. Cached briefly with no tags: a 60-second lag on either fact is
 * invisible, and it keeps two extra queries off every navigation.
 */

export const STALE_AFTER_HOURS = 6
const SYNC_JOB = "otter.metrics.sync"

export interface ShellStatus {
  sync: { state: SyncState; at?: Date } | null
  needsYou: number
}

export async function getShellStatus(
  scope: { accountId: string; storeIds: string[] },
  now = new Date(),
): Promise<ShellStatus> {
  const { accountId, storeIds } = scope
  const raw = await cached<{ startedAt: string | null; completedAt: string | null; status: string | null; open: number }>(
    `counter:shell-status:${accountId}`,
    60,
    [],
    async () => {
      const [run, open] = await Promise.all([
        prisma.jobRun.findFirst({
          where: {
            jobName: SYNC_JOB,
            OR: [{ storeId: null }, { storeId: { in: storeIds } }],
          },
          orderBy: { startedAt: "desc" },
          select: { startedAt: true, completedAt: true, status: true },
        }),
        storeIds.length === 0
          ? Promise.resolve(0)
          : prisma.alert.count({ where: { status: "OPEN", storeId: { in: storeIds } } }),
      ])
      // Dates do not survive the cache (see the Counter cache notes), so
      // they travel as ISO strings and are revived below.
      return {
        startedAt: run?.startedAt.toISOString() ?? null,
        completedAt: run?.completedAt?.toISOString() ?? null,
        status: run?.status ?? null,
        open,
      }
    },
  )

  let sync: ShellStatus["sync"] = null
  if (raw.status && raw.startedAt) {
    const at = new Date(raw.completedAt ?? raw.startedAt)
    const ageHours = (now.getTime() - at.getTime()) / 3_600_000
    const state: SyncState =
      raw.status === "RUNNING"
        ? "syncing"
        : raw.status === "FAILURE"
          ? "failed"
          : ageHours > STALE_AFTER_HOURS
            ? "stale"
            : "synced"
    sync = { state, at }
  }

  return { sync, needsYou: raw.open }
}
