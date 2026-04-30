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

  const [db, redis, conn, syncs, errorsCount, todayCost] = await Promise.all([
    getDbSize(),
    getRedisLive(),
    getConnections(),
    getSyncs(storeId),
    getErrorCount24h(),
    aiCostToday(),
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

async function aiCostToday(): Promise<number> {
  const since = new Date()
  since.setHours(0, 0, 0, 0)
  const rows = await prisma.$queryRaw<{ s: number }[]>`
    SELECT COALESCE(SUM("estimatedCostUsd"), 0)::float AS s
    FROM "AiUsageEvent" WHERE "occurredAt" >= ${since}
  `
  return Number(rows[0]?.s ?? 0)
}
