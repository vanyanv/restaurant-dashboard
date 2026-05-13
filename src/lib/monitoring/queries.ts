import { prisma } from "@/lib/prisma"
import { JOB_SCHEDULES, isOverdue } from "./job-schedules"

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
  const knownJobs = Object.keys(JOB_SCHEDULES)
  const latest = await Promise.all(
    knownJobs.map(async (jobName) => {
      const row = await prisma.jobRun.findFirst({
        where: { jobName, ...(storeId ? { storeId } : {}) },
        orderBy: { startedAt: "desc" },
        select: { startedAt: true, status: true, rowsWritten: true, durationMs: true },
      })
      return {
        jobName,
        lastRunAt: row?.startedAt ?? null,
        status: row?.status ?? null,
        rowsWritten: row?.rowsWritten ?? null,
        durationMs: row?.durationMs ?? null,
        overdue: isOverdue(jobName, row?.startedAt ?? null),
        cadenceLabel: JOB_SCHEDULES[jobName].description,
      }
    }),
  )
  return latest
}

export async function getRecentErrors(limit = 50) {
  return prisma.errorEvent.findMany({
    orderBy: { occurredAt: "desc" },
    take: limit,
    select: { id: true, occurredAt: true, source: true, route: true, status: true, message: true, stack: true },
  })
}

export async function getErrorCount24h() {
  const since = new Date(Date.now() - 24 * 3600_000)
  return prisma.errorEvent.count({ where: { occurredAt: { gte: since } } })
}

export async function getErrorsByHour(hours = 24) {
  const since = new Date(Date.now() - hours * 3600_000)
  const rows = await prisma.$queryRaw<{ bucket: Date; count: bigint }[]>`
    SELECT date_trunc('hour', "occurredAt") AS bucket, COUNT(*)::bigint AS count
    FROM "ErrorEvent"
    WHERE "occurredAt" >= ${since}
    GROUP BY 1 ORDER BY 1 ASC
  `
  return rows.map((r) => ({ bucket: r.bucket, count: Number(r.count) }))
}

export async function getAiCostByDay(days = 30) {
  const since = new Date(Date.now() - days * 86_400_000)
  const rows = await prisma.$queryRaw<{ day: Date; cost: number; tokens: bigint }[]>`
    SELECT
      date_trunc('day', "occurredAt") AS day,
      SUM("estimatedCostUsd")::float AS cost,
      SUM("inputTokens" + "outputTokens")::bigint AS tokens
    FROM "AiUsageEvent"
    WHERE "occurredAt" >= ${since}
    GROUP BY 1 ORDER BY 1 ASC
  `
  return rows.map((r) => ({ day: r.day, cost: Number(r.cost ?? 0), tokens: Number(r.tokens ?? 0) }))
}

export async function getAiByFeature(hours = 24) {
  const since = new Date(Date.now() - hours * 3600_000)
  const rows = await prisma.$queryRaw<{ feature: string; provider: string; model: string; calls: bigint; tokens_in: bigint; tokens_out: bigint; cost: number }[]>`
    SELECT
      feature,
      MIN(provider) AS provider,
      MIN(model) AS model,
      COUNT(*)::bigint AS calls,
      SUM("inputTokens")::bigint AS tokens_in,
      SUM("outputTokens")::bigint AS tokens_out,
      SUM("estimatedCostUsd")::float AS cost
    FROM "AiUsageEvent"
    WHERE "occurredAt" >= ${since}
    GROUP BY feature
    ORDER BY cost DESC
  `
  return rows.map((r) => ({
    feature: r.feature,
    provider: r.provider,
    model: r.model,
    calls: Number(r.calls),
    tokensIn: Number(r.tokens_in),
    tokensOut: Number(r.tokens_out),
    cost: Number(r.cost ?? 0),
  }))
}

export async function getChatStats(hours = 24) {
  const since = new Date(Date.now() - hours * 3600_000)
  const rows = await prisma.$queryRaw<{ status: string; count: bigint }[]>`
    SELECT status, COUNT(*)::bigint AS count
    FROM "ChatTurn"
    WHERE "occurredAt" >= ${since}
    GROUP BY status
  `
  return rows.map((r) => ({ status: r.status, count: Number(r.count) }))
}

export async function getRecentNonOkChatTurns(limit = 20) {
  return prisma.chatTurn.findMany({
    where: { status: { not: "OK" } },
    orderBy: { occurredAt: "desc" },
    take: limit,
    select: {
      id: true, occurredAt: true, status: true, finishReason: true,
      userMessage: true, assistantMessage: true, errorMessage: true, toolErrors: true,
      aiUsageEventId: true,
    },
  })
}

export async function getCacheStats(hours = 168) {
  const since = new Date(Date.now() - hours * 3600_000)
  const rows = await prisma.$queryRaw<{ keyPrefix: string; hits: bigint; misses: bigint; writes: bigint; busts: bigint; failures: bigint }[]>`
    SELECT
      "keyPrefix",
      SUM(hits)::bigint     AS hits,
      SUM(misses)::bigint   AS misses,
      SUM(writes)::bigint   AS writes,
      SUM(busts)::bigint    AS busts,
      SUM(failures)::bigint AS failures
    FROM "CacheStat"
    WHERE "hourBucket" >= ${since}
    GROUP BY "keyPrefix"
    ORDER BY (SUM(hits) + SUM(misses)) DESC
  `
  return rows.map((r) => {
    const hits = Number(r.hits)
    const misses = Number(r.misses)
    const total = hits + misses
    return {
      keyPrefix: r.keyPrefix,
      hits, misses,
      writes: Number(r.writes),
      busts: Number(r.busts),
      failures: Number(r.failures),
      hitPct: total > 0 ? (hits / total) * 100 : 0,
      sample: total,
    }
  })
}

// ───────────────────────────────────────────────────────────────────────
// Phase 7c.1: chart-data queries for the redesigned monitoring dashboard
// ───────────────────────────────────────────────────────────────────────

export type DbGrowthPoint = {
  date: Date
  totalBytes: number
}

export async function getDbGrowth(days = 30): Promise<DbGrowthPoint[]> {
  const since = new Date()
  since.setHours(0, 0, 0, 0)
  since.setDate(since.getDate() - days)
  const rows = await prisma.dbSnapshot.findMany({
    where: { date: { gte: since } },
    orderBy: { date: "asc" },
    select: { date: true, totalBytes: true },
  })
  return rows.map((r) => ({ date: r.date, totalBytes: Number(r.totalBytes) }))
}

export type SyncRunsByDayPoint = {
  day: Date
  success: number
  failure: number
  partial: number
  running: number
}

export async function getSyncRunsByDay(days = 7): Promise<SyncRunsByDayPoint[]> {
  const since = new Date(Date.now() - days * 86_400_000)
  const rows = await prisma.$queryRaw<{ day: Date; status: string; count: bigint }[]>`
    SELECT
      date_trunc('day', "startedAt") AS day,
      status::text AS status,
      COUNT(*)::bigint AS count
    FROM "JobRun"
    WHERE "startedAt" >= ${since}
    GROUP BY 1, 2
    ORDER BY 1 ASC
  `
  // Pivot status rows into per-day buckets
  const byDay = new Map<string, SyncRunsByDayPoint>()
  for (const r of rows) {
    const key = r.day.toISOString()
    let bucket = byDay.get(key)
    if (!bucket) {
      bucket = { day: r.day, success: 0, failure: 0, partial: 0, running: 0 }
      byDay.set(key, bucket)
    }
    const n = Number(r.count)
    if (r.status === "SUCCESS") bucket.success += n
    else if (r.status === "FAILURE") bucket.failure += n
    else if (r.status === "PARTIAL") bucket.partial += n
    else if (r.status === "RUNNING") bucket.running += n
  }
  return Array.from(byDay.values()).sort((a, b) => a.day.getTime() - b.day.getTime())
}

export type CacheHitRateByDayPoint = {
  day: Date
  hits: number
  misses: number
  hitPct: number
}

export async function getCacheHitRateByDay(days = 7): Promise<CacheHitRateByDayPoint[]> {
  const since = new Date(Date.now() - days * 86_400_000)
  const rows = await prisma.$queryRaw<{ day: Date; hits: bigint; misses: bigint }[]>`
    SELECT
      date_trunc('day', "hourBucket") AS day,
      SUM(hits)::bigint   AS hits,
      SUM(misses)::bigint AS misses
    FROM "CacheStat"
    WHERE "hourBucket" >= ${since}
    GROUP BY 1
    ORDER BY 1 ASC
  `
  return rows.map((r) => {
    const hits = Number(r.hits)
    const misses = Number(r.misses)
    const total = hits + misses
    return { day: r.day, hits, misses, hitPct: total > 0 ? (hits / total) * 100 : 0 }
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

export type ActivityRow = {
  id: string
  occurredAt: Date
  kind: "sync" | "error"
  label: string                // job name or error route
  detail: string | null        // status word, error message, etc.
  isFailure: boolean
}

export async function getRecentActivity(limit = 20): Promise<ActivityRow[]> {
  const [syncs, errors] = await Promise.all([
    prisma.jobRun.findMany({
      orderBy: { startedAt: "desc" },
      take: limit,
      select: { id: true, startedAt: true, jobName: true, status: true, rowsWritten: true, errorMessage: true },
    }),
    prisma.errorEvent.findMany({
      orderBy: { occurredAt: "desc" },
      take: limit,
      select: { id: true, occurredAt: true, source: true, route: true, message: true },
    }),
  ])

  const merged: ActivityRow[] = [
    ...syncs.map((s): ActivityRow => ({
      id: `sync-${s.id}`,
      occurredAt: s.startedAt,
      kind: "sync",
      label: s.jobName,
      detail: s.status === "FAILURE" ? (s.errorMessage ?? "failed") : `${s.status?.toLowerCase() ?? "—"}${s.rowsWritten != null ? ` · ${s.rowsWritten} rows` : ""}`,
      isFailure: s.status === "FAILURE",
    })),
    ...errors.map((e): ActivityRow => ({
      id: `err-${e.id}`,
      occurredAt: e.occurredAt,
      kind: "error",
      label: e.route ?? e.source,
      detail: e.message.slice(0, 120),
      isFailure: true,
    })),
  ]

  merged.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
  return merged.slice(0, limit)
}

/** Hourly AI cost rollup for the last `hours` (default 24). Used by the
 * command-bridge sparkline. */
export async function getAiCostByHour(hours = 24) {
  const since = new Date(Date.now() - hours * 3600_000)
  const rows = await prisma.$queryRaw<{ bucket: Date; cost: number }[]>`
    SELECT
      date_trunc('hour', "occurredAt") AS bucket,
      SUM("estimatedCostUsd")::float AS cost
    FROM "AiUsageEvent"
    WHERE "occurredAt" >= ${since}
    GROUP BY 1 ORDER BY 1 ASC
  `
  return rows.map((r) => ({ bucket: r.bucket, cost: Number(r.cost ?? 0) }))
}

/** Hourly login rollup (succeeded vs failed) for the last `hours`. */
export async function getLoginsByHour(hours = 24) {
  const since = new Date(Date.now() - hours * 3600_000)
  const rows = await prisma.$queryRaw<
    { bucket: Date; succeeded: bigint; failed: bigint }[]
  >`
    SELECT
      date_trunc('hour', "createdAt") AS bucket,
      SUM(CASE WHEN kind = 'SIGN_IN'        THEN 1 ELSE 0 END)::bigint AS succeeded,
      SUM(CASE WHEN kind = 'SIGN_IN_FAILED' THEN 1 ELSE 0 END)::bigint AS failed
    FROM "LoginEvent"
    WHERE "createdAt" >= ${since}
    GROUP BY 1 ORDER BY 1 ASC
  `
  return rows.map((r) => ({
    bucket: r.bucket,
    succeeded: Number(r.succeeded ?? 0),
    failed: Number(r.failed ?? 0),
  }))
}

export type BridgeEventRow = {
  id: string
  occurredAt: Date
  kind: "sync" | "error" | "login"
  system: "syncs" | "auth" | "db" | "r2" | "cache" | "other"
  sourceLabel: string
  description: string
  isFailure: boolean
}

/** Build the bridge's recent-events feed (Row 4) from Prisma. */
export async function getBridgeEvents(limit = 10): Promise<BridgeEventRow[]> {
  const since = new Date(Date.now() - 24 * 3600_000)
  const [syncs, errors, logins] = await Promise.all([
    prisma.jobRun.findMany({
      where: { startedAt: { gte: since } },
      orderBy: { startedAt: "desc" },
      take: limit,
      select: { id: true, startedAt: true, jobName: true, status: true, errorMessage: true, rowsWritten: true },
    }),
    prisma.errorEvent.findMany({
      where: { occurredAt: { gte: since } },
      orderBy: { occurredAt: "desc" },
      take: limit,
      select: { id: true, occurredAt: true, source: true, route: true, message: true, status: true },
    }),
    prisma.loginEvent.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, createdAt: true, emailTried: true, kind: true, ipAddress: true },
    }),
  ])

  const merged: BridgeEventRow[] = [
    ...syncs.map((s): BridgeEventRow => ({
      id: `sync-${s.id}`,
      occurredAt: s.startedAt,
      kind: "sync",
      system: "syncs",
      sourceLabel: "SYNC",
      description:
        s.status === "FAILURE"
          ? `${s.jobName} failed${s.errorMessage ? ` — ${s.errorMessage.slice(0, 80)}` : ""}`
          : `${s.jobName} ${s.status?.toLowerCase() ?? "—"}${s.rowsWritten != null ? ` (${s.rowsWritten} rows)` : ""}`,
      isFailure: s.status === "FAILURE",
    })),
    ...errors.map((e): BridgeEventRow => ({
      id: `err-${e.id}`,
      occurredAt: e.occurredAt,
      kind: "error",
      system: "other",
      sourceLabel: "ERROR",
      description: `${e.route ?? e.source}${e.status ? ` ${e.status}` : ""} — ${e.message.slice(0, 100)}`,
      isFailure: true,
    })),
    ...logins.map((l): BridgeEventRow => ({
      id: `login-${l.id}`,
      occurredAt: l.createdAt,
      kind: "login",
      system: "auth",
      sourceLabel: "AUTH",
      description:
        l.kind === "SIGN_IN_FAILED"
          ? `Failed sign-in for ${l.emailTried}${l.ipAddress ? ` from ${l.ipAddress}` : ""}`
          : l.kind === "SIGN_OUT"
          ? `Sign-out ${l.emailTried}`
          : `Sign-in ${l.emailTried}${l.ipAddress ? ` from ${l.ipAddress}` : ""}`,
      isFailure: l.kind === "SIGN_IN_FAILED",
    })),
  ]

  merged.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
  return merged.slice(0, limit)
}

export type BusyHoursRunRow = {
  storeId: string
  startedAt: Date
  completedAt: Date | null
  status: "RUNNING" | "SUCCEEDED" | "FAILED"
  mape: number | null
  mae: number | null
  sampleSize: number | null
  modelVersion: string | null
  errorMessage: string | null
}

export type HarriCoverageRow = {
  storeId: string
  storeName: string
  daysWithLabor: number
  coveragePct: number
  lastSyncedAt: Date | null
  insufficient: boolean
}

export type StaleBusyHoursForecastRow = {
  storeId: string
  storeName: string
  latestGeneratedAt: Date | null
  latestForecastDate: Date | null
  forecastRows: number
  stale: boolean
}

export type BusyHoursAccuracy = {
  reconciledRows: number
  mape: number | null
  mae: number | null
}

export type BusyHoursModelStatus = {
  runs: BusyHoursRunRow[]
  harriCoverage: HarriCoverageRow[]
  staleForecasts: StaleBusyHoursForecastRow[]
  accuracy: BusyHoursAccuracy
}

export async function getBusyHoursModelStatus(): Promise<BusyHoursModelStatus> {
  const [runs, harriCoverage, staleForecasts, accuracyRows] = await Promise.all([
    prisma.$queryRaw<BusyHoursRunRow[]>`
      SELECT DISTINCT ON (scope)
        scope AS "storeId",
        "startedAt",
        "completedAt",
        status::text AS status,
        mape,
        mae,
        "sampleSize",
        "modelVersion",
        "errorMessage"
      FROM "MlTrainingRun"
      WHERE target = 'BUSY_HOURS'::"MlTarget"
        AND scope IS NOT NULL
      ORDER BY scope, "startedAt" DESC
    `,
    prisma.$queryRaw<HarriCoverageRow[]>`
      SELECT
        s.id AS "storeId",
        s.name AS "storeName",
        COUNT(hdl.date)::int AS "daysWithLabor",
        LEAST(1.0, COUNT(hdl.date)::float / 90.0) AS "coveragePct",
        MAX(hdl."syncedAt") AS "lastSyncedAt",
        (COUNT(hdl.date)::float / 90.0) < 0.6 AS insufficient
      FROM "Store" s
      LEFT JOIN "HarriDailyLabor" hdl
        ON hdl."storeId" = s.id
       AND hdl.date >= (CURRENT_DATE - 90)
       AND hdl.date < CURRENT_DATE
      WHERE s."isActive" = true
      GROUP BY s.id, s.name
      ORDER BY s.name ASC
    `,
    prisma.$queryRaw<StaleBusyHoursForecastRow[]>`
      SELECT
        s.id AS "storeId",
        s.name AS "storeName",
        MAX(fho."generatedAt") AS "latestGeneratedAt",
        MAX(fho."forecastDate") AS "latestForecastDate",
        COUNT(fho.id)::int AS "forecastRows",
        (
          MAX(fho."generatedAt") IS NULL
          OR MAX(fho."generatedAt") < (NOW() - INTERVAL '36 hours')
          OR COUNT(fho.id) < 24
        ) AS stale
      FROM "Store" s
      LEFT JOIN "ForecastHourlyOrders" fho
        ON fho."storeId" = s.id
       AND fho."forecastDate" >= CURRENT_DATE
       AND fho."forecastDate" < (CURRENT_DATE + 14)
      WHERE s."isActive" = true
      GROUP BY s.id, s.name
      ORDER BY s.name ASC
    `,
    prisma.$queryRaw<BusyHoursAccuracy[]>`
      SELECT
        COUNT(*)::int AS "reconciledRows",
        AVG(ABS("errorPct"))::float AS mape,
        AVG(ABS("actualOrders" - "predictedOrders"))::float AS mae
      FROM "ForecastHourlyOrders"
      WHERE "reconciledAt" IS NOT NULL
        AND "forecastDate" >= (CURRENT_DATE - 30)
    `,
  ])
  return {
    runs,
    harriCoverage,
    staleForecasts,
    accuracy: accuracyRows[0] ?? { reconciledRows: 0, mape: null, mae: null },
  }
}

export type OperatorGateRun = {
  startedAt: Date | null
  completedAt: Date | null
  status: "RUNNING" | "SUCCESS" | "FAILURE" | "PARTIAL" | null
  durationMs: number | null
  errorMessage: string | null
}

export type OperatorGateSignal = {
  key: "evalRows" | "seasonalNaive" | "coverage" | "reconciliation"
  label: string
  passed: boolean
  detail: string
}

export type OperatorGateStatus = {
  latestRun: OperatorGateRun | null
  passStreak: number
  neededPasses: number
  gates: OperatorGateSignal[]
}

type DailyGateRun = {
  day: Date
  status: "SUCCESS" | "FAILURE"
}

function countConsecutiveSuccesses(rows: DailyGateRun[]): number {
  let streak = 0
  for (const row of rows) {
    if (row.status !== "SUCCESS") break
    streak += 1
  }
  return streak
}

export async function getOperatorGateStatus(): Promise<OperatorGateStatus> {
  const [
    latestRun,
    dailyRuns,
    evalRows,
    seasonalRows,
    coverageRows,
    reconciliationRows,
  ] = await Promise.all([
    prisma.jobRun.findFirst({
      where: { jobName: "ml.operator-gate-check" },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true, completedAt: true, status: true, durationMs: true, errorMessage: true },
    }),
    prisma.$queryRaw<DailyGateRun[]>`
      SELECT
        date_trunc('day', "startedAt") AS day,
        CASE
          WHEN BOOL_OR(status = 'SUCCESS'::"JobStatus") THEN 'SUCCESS'
          ELSE 'FAILURE'
        END AS status
      FROM "JobRun"
      WHERE "jobName" = 'ml.operator-gate-check'
      GROUP BY 1
      ORDER BY 1 DESC
      LIMIT 14
    `,
    prisma.$queryRaw<{ expected: number; covered: number }[]>`
      WITH pairs AS (
        SELECT s.id AS "storeId", t.target
        FROM "Store" s
        CROSS JOIN (VALUES
          ('REVENUE'::"MlTarget"),
          ('BUSY_HOURS'::"MlTarget"),
          ('MENU_ITEM'::"MlTarget")
        ) AS t(target)
        WHERE s."isActive" = true
      )
      SELECT
        COUNT(*)::int AS expected,
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1
            FROM "MlForecastEvaluation" e
            WHERE e."storeId" = pairs."storeId"
              AND e.target = pairs.target
              AND e."computedAt"::date = CURRENT_DATE
          )
        )::int AS covered
      FROM pairs
    `,
    prisma.$queryRaw<{ naiveMentions: number; totalRuns: number }[]>`
      SELECT
        COUNT(*) FILTER (WHERE "errorMessage" ILIKE '%seasonal-naive%')::int AS "naiveMentions",
        COUNT(*)::int AS "totalRuns"
      FROM "MlTrainingRun"
      WHERE "startedAt" >= (CURRENT_DATE - INTERVAL '7 days')
    `,
    prisma.$queryRaw<{ stores: number; minCoverage: number | null; avgCoverage: number | null; maxCoverage: number | null; outsideAcceptBand: number }[]>`
      WITH per_store AS (
        SELECT
          s.id,
          AVG(e."intervalCoverage80")::float AS coverage
        FROM "Store" s
        JOIN "MlForecastEvaluation" e
          ON e."storeId" = s.id
         AND e.target = 'REVENUE'::"MlTarget"
         AND e."computedAt" >= (NOW() - INTERVAL '7 days')
         AND e."intervalCoverage80" IS NOT NULL
        WHERE s."isActive" = true
        GROUP BY s.id
      )
      SELECT
        COUNT(*)::int AS stores,
        MIN(coverage)::float AS "minCoverage",
        AVG(coverage)::float AS "avgCoverage",
        MAX(coverage)::float AS "maxCoverage",
        COUNT(*) FILTER (WHERE coverage < 0.75 OR coverage > 0.85)::int AS "outsideAcceptBand"
      FROM per_store
    `,
    prisma.$queryRaw<{ tables: number; passingTables: number; minCoveragePct: number | null }[]>`
      WITH coverage AS (
        SELECT 'ForecastDailyRevenue' AS table_name, COUNT(*)::int AS total, COUNT("actualRevenue")::int AS reconciled
        FROM "ForecastDailyRevenue"
        WHERE "forecastDate" < CURRENT_DATE
        UNION ALL
        SELECT 'ForecastHourlyOrders' AS table_name, COUNT(*)::int AS total, COUNT("actualOrders")::int AS reconciled
        FROM "ForecastHourlyOrders"
        WHERE "forecastDate" < CURRENT_DATE
        UNION ALL
        SELECT 'ForecastMenuItem' AS table_name, COUNT(*)::int AS total, COUNT("actualQty")::int AS reconciled
        FROM "ForecastMenuItem"
        WHERE "forecastDate" < CURRENT_DATE
      )
      SELECT
        COUNT(*)::int AS tables,
        COUNT(*) FILTER (
          WHERE total > 0 AND (reconciled::float / NULLIF(total, 0)) >= 0.8
        )::int AS "passingTables",
        MIN(CASE WHEN total > 0 THEN reconciled::float / total * 100 ELSE 0 END)::float AS "minCoveragePct"
      FROM coverage
    `,
  ])

  const evalSummary = evalRows[0] ?? { expected: 0, covered: 0 }
  const seasonal = seasonalRows[0] ?? { naiveMentions: 0, totalRuns: 0 }
  const coverage = coverageRows[0] ?? {
    stores: 0,
    minCoverage: null,
    avgCoverage: null,
    maxCoverage: null,
    outsideAcceptBand: 0,
  }
  const reconciliation = reconciliationRows[0] ?? { tables: 0, passingTables: 0, minCoveragePct: null }

  const coverageDetail =
    coverage.stores > 0
      ? `${coverage.stores} stores, avg ${((coverage.avgCoverage ?? 0) * 100).toFixed(1)}%, range ${((coverage.minCoverage ?? 0) * 100).toFixed(1)}-${((coverage.maxCoverage ?? 0) * 100).toFixed(1)}%`
      : "No revenue coverage rows in the trailing 7 days"

  return {
    latestRun: latestRun
      ? {
          startedAt: latestRun.startedAt,
          completedAt: latestRun.completedAt,
          status: latestRun.status,
          durationMs: latestRun.durationMs,
          errorMessage: latestRun.errorMessage,
        }
      : null,
    passStreak: countConsecutiveSuccesses(dailyRuns),
    neededPasses: 7,
    gates: [
      {
        key: "evalRows",
        label: "Eval rows today",
        passed: evalSummary.expected > 0 && evalSummary.covered === evalSummary.expected,
        detail: `${evalSummary.covered}/${evalSummary.expected} active store-target pairs covered`,
      },
      {
        key: "seasonalNaive",
        label: "Seasonal-naive gate",
        passed: seasonal.naiveMentions > 0,
        detail: `${seasonal.naiveMentions}/${seasonal.totalRuns} runs mention seasonal-naive in 7 days`,
      },
      {
        key: "coverage",
        label: "Revenue interval coverage",
        passed: coverage.stores > 0 && coverage.outsideAcceptBand === 0,
        detail: coverageDetail,
      },
      {
        key: "reconciliation",
        label: "Reconciliation coverage",
        passed: reconciliation.tables === 3 && reconciliation.passingTables === 3,
        detail: `${reconciliation.passingTables}/${reconciliation.tables} tables >=80%, floor ${(reconciliation.minCoveragePct ?? 0).toFixed(1)}%`,
      },
    ],
  }
}

export type ExternalSignalCoverageSummary = {
  activeStores: number
  geocodedStores: number
  missingCoordinates: number
}

export type ExternalSignalFreshnessRow = {
  storeId: string
  storeName: string
  weatherSyncedAt: Date | null
  eventSyncedAt: Date | null
  weatherRows: number
  eventRows: number
  rawEventRows: number
  radiusMiles: number | null
  radiusProvider: string | null
  radiusUpdatedAt: Date | null
  staleWeather: boolean
  staleEvents: boolean
  earliestWeatherDate: Date | null
  latestWeatherDate: Date | null
  earliestEventDate: Date | null
  latestEventDate: Date | null
}

export type PromotedModelFlavorRow = {
  target: "REVENUE" | "BUSY_HOURS" | "MENU_ITEM" | "INVENTORY"
  modelVersion: string | null
  startedAt: Date
  mape: number | null
  mae: number | null
}

export type ExternalSignalStatus = {
  coverage: ExternalSignalCoverageSummary
  freshness: ExternalSignalFreshnessRow[]
  promotedModels: PromotedModelFlavorRow[]
}

export async function getExternalSignalStatus(): Promise<ExternalSignalStatus> {
  const [coverageRows, freshness, promotedModels] = await Promise.all([
    prisma.$queryRaw<ExternalSignalCoverageSummary[]>`
      SELECT
        COUNT(*)::int AS "activeStores",
        COUNT(*) FILTER (WHERE latitude IS NOT NULL AND longitude IS NOT NULL)::int AS "geocodedStores",
        COUNT(*) FILTER (WHERE latitude IS NULL OR longitude IS NULL)::int AS "missingCoordinates"
      FROM "Store"
      WHERE "isActive" = true
    `,
    prisma.$queryRaw<ExternalSignalFreshnessRow[]>`
      WITH weather AS (
        SELECT
          "storeId",
          MAX("syncedAt") AS "weatherSyncedAt",
          COUNT(*)::int AS "weatherRows",
          MIN(date) AS "earliestWeatherDate",
          MAX(date) AS "latestWeatherDate"
        FROM "StoreWeatherSignal"
        GROUP BY "storeId"
      ),
      events AS (
        SELECT
          "storeId",
          MAX("syncedAt") AS "eventSyncedAt",
          COUNT(*)::int AS "eventRows",
          MIN(date) AS "earliestEventDate",
          MAX(date) AS "latestEventDate"
        FROM "StoreEventSignal"
        GROUP BY "storeId"
      ),
      event_details AS (
        SELECT
          "storeId",
          COUNT(*)::int AS "rawEventRows"
        FROM "StoreEventDetailSignal"
        GROUP BY "storeId"
      )
      SELECT
        s.id AS "storeId",
        s.name AS "storeName",
        w."weatherSyncedAt",
        e."eventSyncedAt",
        COALESCE(w."weatherRows", 0)::int AS "weatherRows",
        COALESCE(e."eventRows", 0)::int AS "eventRows",
        COALESCE(ed."rawEventRows", 0)::int AS "rawEventRows",
        s."eventSignalRadiusMiles"::float AS "radiusMiles",
        s."eventSignalRadiusProvider" AS "radiusProvider",
        s."eventSignalRadiusUpdatedAt" AS "radiusUpdatedAt",
        (w."weatherSyncedAt" IS NULL OR w."weatherSyncedAt" < (NOW() - INTERVAL '36 hours')) AS "staleWeather",
        (e."eventSyncedAt" IS NULL OR e."eventSyncedAt" < (NOW() - INTERVAL '36 hours')) AS "staleEvents",
        w."earliestWeatherDate",
        w."latestWeatherDate",
        e."earliestEventDate",
        e."latestEventDate"
      FROM "Store" s
      LEFT JOIN weather w ON w."storeId" = s.id
      LEFT JOIN events e ON e."storeId" = s.id
      LEFT JOIN event_details ed ON ed."storeId" = s.id
      WHERE s."isActive" = true
      ORDER BY s.name ASC
    `,
    prisma.$queryRaw<PromotedModelFlavorRow[]>`
      SELECT DISTINCT ON (target)
        target::text AS target,
        "modelVersion",
        "startedAt",
        mape,
        mae
      FROM "MlTrainingRun"
      WHERE target IN ('REVENUE'::"MlTarget", 'BUSY_HOURS'::"MlTarget")
        AND status = 'SUCCEEDED'::"MlTrainingStatus"
      ORDER BY target, "startedAt" DESC
    `,
  ])
  return {
    coverage: coverageRows[0] ?? { activeStores: 0, geocodedStores: 0, missingCoordinates: 0 },
    freshness,
    promotedModels,
  }
}
