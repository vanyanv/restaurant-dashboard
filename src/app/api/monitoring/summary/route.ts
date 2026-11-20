import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getDbSize, getConnections } from "@/lib/monitoring/db-stats"
import { getRedisLive } from "@/lib/monitoring/redis-stats"
import { getSyncs, getErrorCount24h } from "@/lib/monitoring/queries"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (session?.user.role !== "DEVELOPER") {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }
  const url = new URL(req.url)
  const storeParam = url.searchParams.get("store")
  const storeId = storeParam && storeParam !== "all" ? storeParam : null
  const accountId = session.user.accountId

  // A named store must be one of the caller's: a store id from another
  // account reads as not found, the same answer as a store that never existed.
  if (storeId) {
    const own = await prisma.store.findFirst({ where: { id: storeId, accountId }, select: { id: true } })
    if (!own) return NextResponse.json({ error: "store not found" }, { status: 404 })
  }

  const [db, redis, conn, syncs, errorsCount, todayCost] = await Promise.all([
    getDbSize(),
    getRedisLive(),
    getConnections(),
    getSyncs(storeId),
    getErrorCount24h(),
    aiCostToday(accountId),
  ])

  return NextResponse.json({
    refreshedAt: new Date().toISOString(),
    db,
    redis,
    conn,
    syncs,
    errorsCount,
    todayCostUsd: todayCost,
  })
}

/**
 * Today's AI spend for the caller's account. `AiUsageEvent` has no account
 * column, so an event belongs to the account of its user or its store, the
 * same rule the chat spend cap uses (`src/lib/chat/spend-cap.ts`). It used to
 * sum every account's events.
 */
async function aiCostToday(accountId: string): Promise<number> {
  const since = new Date()
  since.setHours(0, 0, 0, 0)
  const rows = await prisma.$queryRaw<{ s: number }[]>`
    SELECT COALESCE(SUM(e."estimatedCostUsd"), 0)::float AS s
    FROM "AiUsageEvent" e
    WHERE e."occurredAt" >= ${since}
      AND (
        e."userId" IN (SELECT id FROM "User" WHERE "accountId" = ${accountId})
        OR e."storeId" IN (SELECT id FROM "Store" WHERE "accountId" = ${accountId})
      )
  `
  return Number(rows[0]?.s ?? 0)
}
