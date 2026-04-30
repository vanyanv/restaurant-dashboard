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
