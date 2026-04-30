import { ActivityFeed } from "@/components/monitoring/activity-feed"
import { AiSpendPanel } from "@/components/monitoring/ai-spend-panel"
import { CachePanel } from "@/components/monitoring/cache-panel"
import { ChatPanel } from "@/components/monitoring/chat-panel"
import { DashboardCharts } from "@/components/monitoring/dashboard-charts"
import { DashboardTiles } from "@/components/monitoring/dashboard-tiles"
import { DatabasePanel } from "@/components/monitoring/database-panel"
import { ErrorsPanel } from "@/components/monitoring/errors-panel"
import { FrontPageLede } from "@/components/monitoring/front-page-lede"
import { Masthead } from "@/components/monitoring/masthead"
import { monoLabel } from "@/components/monitoring/styles"
import { SyncsPanel } from "@/components/monitoring/syncs-panel"
import { authOptions } from "@/lib/auth"
import {
  getDbSize,
  getTableSizes,
  getConnections,
} from "@/lib/monitoring/db-stats"
import {
  getAiByFeature,
  getAiCostByDay,
  getCacheHitRateByDay,
  getCacheStats,
  getChatStats,
  getDbGrowth,
  getErrorsByHour,
  getRecentActivity,
  getRecentErrors,
  getRecentNonOkChatTurns,
  getSyncRunsByDay,
  getSyncs,
} from "@/lib/monitoring/queries"
import { getRedisLive } from "@/lib/monitoring/redis-stats"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import "@/components/monitoring/monitoring.css"

export const dynamic = "force-dynamic"

export default async function MonitoringPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>
}) {
  const session = await getServerSession(authOptions)
  const params = await searchParams
  const storeId =
    params.store && params.store !== "all" ? params.store : null

  const stores = await prisma.store.findMany({
    where: { accountId: session!.user.accountId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local"
  const tzLabel = "PT"

  const [
    syncs,
    recentErrors,
    errorsByHour,
    aiByDay,
    aiByFeature,
    chatStats,
    recentChat,
    cachePrefixes,
    db,
    tables,
    conn,
    redis,
    dbGrowth,
    syncRunsByDay,
    cacheHitByDay,
    activity,
  ] = await Promise.all([
    getSyncs(storeId),
    getRecentErrors(50),
    getErrorsByHour(24),
    getAiCostByDay(30),
    getAiByFeature(24),
    getChatStats(24),
    getRecentNonOkChatTurns(20),
    getCacheStats(168),
    getDbSize(),
    getTableSizes(12),
    getConnections(),
    getRedisLive(),
    getDbGrowth(30),
    getSyncRunsByDay(7),
    getCacheHitRateByDay(7),
    getRecentActivity(15),
  ])

  const aiCost30d = aiByDay.reduce((a, b) => a + b.cost, 0)
  const aiTodayUsd = aiByDay[aiByDay.length - 1]?.cost ?? 0
  const cacheHitPctRecent =
    cacheHitByDay.length > 0
      ? cacheHitByDay[cacheHitByDay.length - 1].hitPct
      : 0
  const errorsCount24h = errorsByHour.reduce((a, b) => a + b.count, 0)

  return (
    <main className="px-4 lg:px-6 max-w-350 mx-auto pb-16">
      <Masthead stores={stores} commitSha={commitSha} tzLabel={tzLabel} />

      <FrontPageLede />

      <DashboardTiles
        db={db}
        dbGrowth={dbGrowth}
        aiTodayUsd={aiTodayUsd}
        aiCost30d={aiCost30d}
        aiCostByDay={aiByDay}
        syncs={syncs}
        errorsCount24h={errorsCount24h}
        errorsByHour={errorsByHour}
        cacheHitPctRecent={cacheHitPctRecent}
        cacheHitByDay={cacheHitByDay}
      />

      <DashboardCharts
        dbGrowth={dbGrowth}
        capBytes={db.capBytes}
        aiCostByDay={aiByDay}
        syncRunsByDay={syncRunsByDay}
        cacheHitByDay={cacheHitByDay}
      />

      <ActivityFeed rows={activity} />

      <div
        className="mt-12 mb-4 flex items-center gap-4"
        aria-hidden
      >
        <hr
          style={{
            flex: 1,
            border: 0,
            borderTop: "1px solid var(--hairline)",
          }}
        />
        <span style={{ ...monoLabel, color: "var(--ink-faint)" }}>DETAIL</span>
        <hr
          style={{
            flex: 1,
            border: 0,
            borderTop: "1px solid var(--hairline)",
          }}
        />
      </div>

      <div className="space-y-6">
        <SyncsPanel rows={syncs} />
        <ErrorsPanel errors={recentErrors} byHour={errorsByHour} />
        <AiSpendPanel byDay={aiByDay} byFeature={aiByFeature} />
        <ChatPanel stats={chatStats} recent={recentChat} />
        <DatabasePanel db={db} tables={tables} conn={conn} />
        <CachePanel redis={redis} prefixes={cachePrefixes} />
      </div>
    </main>
  )
}
