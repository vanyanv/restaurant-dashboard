// Sync-job health queries — global job status (getSyncs), the per-store
// readiness grid, the OtterOrder details backlog, and OtterStore sync
// freshness.

import { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import { JOB_SCHEDULES, isOverdue } from "../job-schedules"

export type SyncRow = {
  jobName: string
  lastRunAt: Date | null
  status: "RUNNING" | "SUCCESS" | "FAILURE" | "PARTIAL" | null
  rowsWritten: number | null
  durationMs: number | null
  overdue: boolean
  cadenceLabel: string
}

export async function getSyncs(storeId?: string | null): Promise<SyncRow[]> {
  // One DISTINCT ON pass over JobRun instead of a findFirst per known job —
  // same [jobName, startedAt DESC] index, single round trip. Jobs that have
  // never run still get a null row via the JOB_SCHEDULES left-merge below.
  const latest = await prisma.$queryRaw<
    {
      jobName: string
      startedAt: Date
      status: SyncRow["status"]
      rowsWritten: number | null
      durationMs: number | null
    }[]
  >`
    SELECT DISTINCT ON ("jobName")
      "jobName",
      "startedAt",
      status::text AS status,
      "rowsWritten",
      "durationMs"
    FROM "JobRun"
    ${storeId ? Prisma.sql`WHERE "storeId" = ${storeId}` : Prisma.empty}
    ORDER BY "jobName", "startedAt" DESC
  `
  const byJob = new Map(latest.map((r) => [r.jobName, r]))
  return Object.keys(JOB_SCHEDULES).map((jobName) => {
    const row = byJob.get(jobName)
    return {
      jobName,
      lastRunAt: row?.startedAt ?? null,
      status: row?.status ?? null,
      rowsWritten: row?.rowsWritten ?? null,
      durationMs: row?.durationMs ?? null,
      overdue: isOverdue(jobName, row?.startedAt ?? null),
      cadenceLabel: JOB_SCHEDULES[jobName].description,
    }
  })
}

// ───────────────────────────────────────────────────────────────────────
// Per-store readiness queries (P1c)
// Per-store JobRun rows are useless if the read path collapses across stores.
// These queries fan out: getSyncsByStore returns last run per (jobName,
// storeId), getPendingOrderDetails surfaces the OrderDetails backlog, and
// getStaleStores flags stores whose Otter sync hasn't completed recently.
// ───────────────────────────────────────────────────────────────────────

export type StoreSyncCell = {
  storeId: string
  jobName: string
  lastRunAt: Date | null
  status: "RUNNING" | "SUCCESS" | "FAILURE" | "PARTIAL" | null
  rowsWritten: number | null
  durationMs: number | null
  /** True when this cell breached a known threshold (slow run, big batch, etc.). */
  flagged: boolean
  flagReason: string | null
}

export type StoreSyncGridStore = {
  storeId: string
  storeName: string
  isActive: boolean
}

export type StoreSyncGrid = {
  stores: StoreSyncGridStore[]
  jobNames: string[]
  /** Keyed by `${storeId}|${jobName}`. */
  cells: Record<string, StoreSyncCell>
}

const PER_STORE_JOBS = [
  "otter.metrics.sync",
  "otter.orders.sync",
  "otter.hourly.sync",
  "otter.orders.drain",
  "cogs.sweep",
] as const

const THRESHOLDS = {
  metricsDurationMs: 45_000,
  ordersRowsWritten: 4_000,
  hourlyRowsWritten: 8_000,
} as const

function evaluateCellFlag(
  jobName: string,
  durationMs: number | null,
  rowsWritten: number | null,
): { flagged: boolean; reason: string | null } {
  if (jobName === "otter.metrics.sync" && durationMs != null && durationMs > THRESHOLDS.metricsDurationMs) {
    return { flagged: true, reason: `${(durationMs / 1000).toFixed(1)}s > ${THRESHOLDS.metricsDurationMs / 1000}s` }
  }
  if (jobName === "otter.orders.sync" && rowsWritten != null && rowsWritten > THRESHOLDS.ordersRowsWritten) {
    return { flagged: true, reason: `${rowsWritten} rows > ${THRESHOLDS.ordersRowsWritten}` }
  }
  if (jobName === "otter.hourly.sync" && rowsWritten != null && rowsWritten > THRESHOLDS.hourlyRowsWritten) {
    return { flagged: true, reason: `${rowsWritten} rows > ${THRESHOLDS.hourlyRowsWritten}` }
  }
  return { flagged: false, reason: null }
}

export async function getSyncsByStore(): Promise<StoreSyncGrid> {
  const stores = await prisma.store.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  const jobNames = [...PER_STORE_JOBS]

  // Cross product is small (~stores * 5). One findFirst per pair is fine; the
  // (jobName, storeId, startedAt DESC) index makes each lookup index-scan-fast.
  const lookups = stores.flatMap((s) =>
    jobNames.map(async (jobName) => {
      // Some jobs (otter.orders.sync, otter.hourly.sync) currently record
      // global rows without storeId — fall back to global lookup if no
      // store-scoped row exists, so the grid doesn't show "—" for them
      // until/unless they get split per-store too.
      let row = await prisma.jobRun.findFirst({
        where: { jobName, storeId: s.id },
        orderBy: { startedAt: "desc" },
        select: { startedAt: true, status: true, rowsWritten: true, durationMs: true },
      })
      if (!row) {
        const global = await prisma.jobRun.findFirst({
          where: { jobName, storeId: null },
          orderBy: { startedAt: "desc" },
          select: { startedAt: true, status: true, rowsWritten: true, durationMs: true },
        })
        row = global
      }
      const flag = evaluateCellFlag(jobName, row?.durationMs ?? null, row?.rowsWritten ?? null)
      const cell: StoreSyncCell = {
        storeId: s.id,
        jobName,
        lastRunAt: row?.startedAt ?? null,
        status: row?.status ?? null,
        rowsWritten: row?.rowsWritten ?? null,
        durationMs: row?.durationMs ?? null,
        flagged: flag.flagged,
        flagReason: flag.reason,
      }
      return cell
    }),
  )
  const cellArr = await Promise.all(lookups)

  const cells: Record<string, StoreSyncCell> = {}
  for (const c of cellArr) cells[`${c.storeId}|${c.jobName}`] = c

  return {
    stores: stores.map((s) => ({ storeId: s.id, storeName: s.name, isActive: true })),
    jobNames,
    cells,
  }
}

export type PendingDetailsRow = {
  storeId: string
  storeName: string
  pending: number
  /** True if today's count is greater than yesterday's — backlog growing. */
  growing: boolean
}

/** Per-store count of OtterOrder rows whose detailsFetchedAt is null —
 *  the load-bearing data-correctness signal for COGS accuracy. */
export async function getPendingOrderDetails(): Promise<PendingDetailsRow[]> {
  // Group today's pending count.
  const grouped = await prisma.otterOrder.groupBy({
    by: ["storeId"],
    where: { detailsFetchedAt: null },
    _count: { _all: true },
  })
  const byStore = new Map<string, number>()
  for (const g of grouped) byStore.set(g.storeId, g._count._all)

  // Yesterday's snapshot — same query bounded to orders synced before today.
  // Used to flag day-over-day backlog growth.
  const startOfToday = new Date()
  startOfToday.setUTCHours(0, 0, 0, 0)
  const yesterdayGrouped = await prisma.otterOrder.groupBy({
    by: ["storeId"],
    where: { detailsFetchedAt: null, syncedAt: { lt: startOfToday } },
    _count: { _all: true },
  })
  const yesterdayByStore = new Map<string, number>()
  for (const g of yesterdayGrouped) yesterdayByStore.set(g.storeId, g._count._all)

  const stores = await prisma.store.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  return stores.map((s) => {
    const pending = byStore.get(s.id) ?? 0
    const yesterday = yesterdayByStore.get(s.id) ?? 0
    return {
      storeId: s.id,
      storeName: s.name,
      pending,
      growing: pending > yesterday,
    }
  })
}

export type StaleStoreRow = {
  storeId: string
  storeName: string
  lastSyncAt: Date | null
  ageMinutes: number | null
  isStale: boolean
}

/** Per-store OtterStore.lastSyncAt freshness check. Default 90-minute
 *  threshold matches the every-2h sync cadence (90min after a tick = real
 *  miss, not just "between runs"). */
export async function getStaleStores(thresholdMinutes = 90): Promise<StaleStoreRow[]> {
  const otterStores = await prisma.otterStore.findMany({
    include: { store: { select: { id: true, name: true, isActive: true } } },
    orderBy: { store: { name: "asc" } },
  })
  const active = otterStores.filter((os) => os.store.isActive)

  // One internal store may have multiple Otter UUIDs — surface the most
  // recent lastSyncAt across UUIDs as "the store synced".
  const byStore = new Map<string, { name: string; latest: Date | null }>()
  for (const os of active) {
    const existing = byStore.get(os.storeId)
    const cand = os.lastSyncAt
    if (!existing) {
      byStore.set(os.storeId, { name: os.store.name, latest: cand })
    } else if (cand && (!existing.latest || cand > existing.latest)) {
      existing.latest = cand
    }
  }

  const now = Date.now()
  const thresholdMs = thresholdMinutes * 60_000

  return [...byStore.entries()].map(([storeId, { name, latest }]) => {
    const ageMs = latest ? now - latest.getTime() : null
    return {
      storeId,
      storeName: name,
      lastSyncAt: latest,
      ageMinutes: ageMs != null ? Math.round(ageMs / 60_000) : null,
      isStale: ageMs == null || ageMs > thresholdMs,
    }
  })
}
