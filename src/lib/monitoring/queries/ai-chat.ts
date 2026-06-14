// AI spend + chat-turn analytics (AiUsageEvent, ChatTurn).

import { prisma } from "@/lib/prisma"
import { Prisma } from "@/generated/prisma/client"
import { windowFromArg, truncLiteral, type TimeWindow } from "../time-range"

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

/** AI cost rollup bucketed by hour (legacy `hours` arg) or by the bucket of a
 * {@link TimeWindow} from the global range control. Used by the command-bridge
 * sparkline. */
export async function getAiCostByHour(arg: number | TimeWindow = 24) {
  const { since, until, bucket } = windowFromArg(arg)
  const rows = await prisma.$queryRaw<{ bucket: Date; cost: number }[]>`
    SELECT
      date_trunc(${Prisma.raw(truncLiteral(bucket))}, "occurredAt") AS bucket,
      SUM("estimatedCostUsd")::float AS cost
    FROM "AiUsageEvent"
    WHERE "occurredAt" >= ${since} AND "occurredAt" <= ${until}
    GROUP BY 1 ORDER BY 1 ASC
  `
  return rows.map((r) => ({ bucket: r.bucket, cost: Number(r.cost ?? 0) }))
}
