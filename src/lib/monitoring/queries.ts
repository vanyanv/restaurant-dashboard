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
