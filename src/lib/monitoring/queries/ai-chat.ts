// AI spend + chat-turn analytics (AiUsageEvent, ChatTurn).
//
// EVERY QUERY HERE TAKES AN ACCOUNT, AND THAT IS NEW.
//
// Until 2026-09-19 not one of them had a tenant filter, and
// `getRecentNonOkChatTurns` returned `userMessage` and `assistantMessage`
// verbatim — one operator's typed questions and another operator's dollar
// figures in the same list. Nothing called these five, which is the only
// reason it was not a live leak; a barrel export with no filter is a landmine
// rather than a bug, so the fix is a REQUIRED parameter, not an optional one.
// A future caller now has to say whose rows it wants.
//
// Neither table carries an `accountId` column, so ownership is resolved the
// same way `adapters/monitoring-tabs.ts` resolves it: through whichever of the
// two nullable owner columns the row has. A row with neither belongs to no
// tenant and is nobody's to read.

import { prisma } from "@/lib/prisma"
import { Prisma } from "@/generated/prisma/client"
import { windowFromArg, truncLiteral, type TimeWindow } from "../time-range"

/**
 * The ownership predicate, as a fragment both tables can take.
 *
 * `AiUsageEvent` and `ChatTurn` both hold a nullable `userId` and a nullable
 * `storeId` and nothing else that names a tenant, so the account is reached
 * through `User` or `Store`. Written once because two copies of a tenancy
 * filter is how one of them ends up with the wrong column.
 */
function ownedBy(alias: string, accountId: string): Prisma.Sql {
  const a = Prisma.raw(`"${alias}"`)
  return Prisma.sql`(
    ${a}."userId" IN (SELECT id FROM "User" WHERE "accountId" = ${accountId})
    OR ${a}."storeId" IN (SELECT id FROM "Store" WHERE "accountId" = ${accountId})
  )`
}

export async function getAiCostByDay(accountId: string, days = 30) {
  const since = new Date(Date.now() - days * 86_400_000)
  const rows = await prisma.$queryRaw<{ day: Date; cost: number; tokens: bigint }[]>`
    SELECT
      date_trunc('day', e."occurredAt") AS day,
      SUM(e."estimatedCostUsd")::float AS cost,
      SUM(e."inputTokens" + e."outputTokens")::bigint AS tokens
    FROM "AiUsageEvent" e
    WHERE e."occurredAt" >= ${since}
      AND ${ownedBy("e", accountId)}
    GROUP BY 1 ORDER BY 1 ASC
  `
  return rows.map((r) => ({ day: r.day, cost: Number(r.cost ?? 0), tokens: Number(r.tokens ?? 0) }))
}

export async function getAiByFeature(accountId: string, hours = 24) {
  const since = new Date(Date.now() - hours * 3600_000)
  const rows = await prisma.$queryRaw<{ feature: string; provider: string; model: string; calls: bigint; tokens_in: bigint; tokens_out: bigint; cost: number }[]>`
    SELECT
      e.feature,
      MIN(e.provider) AS provider,
      MIN(e.model) AS model,
      COUNT(*)::bigint AS calls,
      SUM(e."inputTokens")::bigint AS tokens_in,
      SUM(e."outputTokens")::bigint AS tokens_out,
      SUM(e."estimatedCostUsd")::float AS cost
    FROM "AiUsageEvent" e
    WHERE e."occurredAt" >= ${since}
      AND ${ownedBy("e", accountId)}
    GROUP BY e.feature
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

export async function getChatStats(accountId: string, hours = 24) {
  const since = new Date(Date.now() - hours * 3600_000)
  const rows = await prisma.$queryRaw<{ status: string; count: bigint }[]>`
    SELECT t.status, COUNT(*)::bigint AS count
    FROM "ChatTurn" t
    WHERE t."occurredAt" >= ${since}
      AND ${ownedBy("t", accountId)}
    GROUP BY t.status
  `
  return rows.map((r) => ({ status: r.status, count: Number(r.count) }))
}

/**
 * How the answers were rated, by reason.
 *
 * `ChatTurn.feedback` stores one word — `up`, or `down:<reason>` from
 * `ASK_DOWN_REASONS` — and `src/lib/counter/ask-feedback.ts` says the shape is
 * one word "so the monitoring queries can group on it". No monitoring query
 * did. Every thumb an owner pressed, including "Wrong number", was written to
 * a column nothing read. This is that query.
 */
export async function getChatFeedback(accountId: string, days = 30) {
  const since = new Date(Date.now() - days * 86_400_000)
  const rows = await prisma.$queryRaw<{ feedback: string; count: bigint }[]>`
    SELECT t.feedback, COUNT(*)::bigint AS count
    FROM "ChatTurn" t
    WHERE t."occurredAt" >= ${since}
      AND t.feedback IS NOT NULL
      AND ${ownedBy("t", accountId)}
    GROUP BY t.feedback
    ORDER BY count DESC
  `
  return rows.map((r) => ({ feedback: r.feedback, count: Number(r.count) }))
}

/**
 * The turns an owner marked wrong, newest first — the eval set writing itself.
 *
 * `down:number` is the one that matters: the reader is saying a figure did not
 * match a page, which is the failure this product can least afford and the
 * hardest to find any other way. Returned with the tools the turn read, so a
 * reviewer can go straight to the call that produced the figure.
 */
export async function getDownvotedChatTurns(
  accountId: string,
  limit = 50,
  reason?: string,
) {
  const since = new Date(Date.now() - 90 * 86_400_000)
  return prisma.$queryRaw<
    Array<{
      id: string
      occurredAt: Date
      feedback: string
      userMessage: string
      assistantMessage: string | null
      toolsUsed: string[]
    }>
  >`
    SELECT t.id, t."occurredAt", t.feedback, t."userMessage",
           t."assistantMessage", t."toolsUsed"
      FROM "ChatTurn" t
     WHERE t."occurredAt" >= ${since}
       AND t.feedback LIKE 'down%'
       ${reason ? Prisma.sql`AND t.feedback = ${reason}` : Prisma.empty}
       AND ${ownedBy("t", accountId)}
     ORDER BY t."occurredAt" DESC
     LIMIT ${limit}
  `
}

export async function getRecentNonOkChatTurns(accountId: string, limit = 20) {
  return prisma.$queryRaw<
    Array<{
      id: string
      occurredAt: Date
      status: string
      finishReason: string | null
      userMessage: string
      assistantMessage: string | null
      errorMessage: string | null
      toolErrors: Prisma.JsonValue
      aiUsageEventId: string | null
    }>
  >`
    SELECT t.id, t."occurredAt", t.status, t."finishReason", t."userMessage",
           t."assistantMessage", t."errorMessage", t."toolErrors",
           t."aiUsageEventId"
      FROM "ChatTurn" t
     WHERE t.status <> 'OK'
       AND ${ownedBy("t", accountId)}
     ORDER BY t."occurredAt" DESC
     LIMIT ${limit}
  `
}

/** AI cost rollup bucketed by hour (legacy `hours` arg) or by the bucket of a
 * {@link TimeWindow} from the global range control. Used by the command-bridge
 * sparkline. */
export async function getAiCostByHour(
  accountId: string,
  arg: number | TimeWindow = 24,
) {
  const { since, until, bucket } = windowFromArg(arg)
  const rows = await prisma.$queryRaw<{ bucket: Date; cost: number }[]>`
    SELECT
      date_trunc(${Prisma.raw(truncLiteral(bucket))}, e."occurredAt") AS bucket,
      SUM(e."estimatedCostUsd")::float AS cost
    FROM "AiUsageEvent" e
    WHERE e."occurredAt" >= ${since} AND e."occurredAt" <= ${until}
      AND ${ownedBy("e", accountId)}
    GROUP BY 1 ORDER BY 1 ASC
  `
  return rows.map((r) => ({ bucket: r.bucket, cost: Number(r.cost ?? 0) }))
}
