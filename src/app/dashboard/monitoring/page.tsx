import { Masthead } from "@/components/monitoring/masthead"
import { FrontPageLede } from "@/components/monitoring/front-page-lede"
import { SyncsPanel } from "@/components/monitoring/syncs-panel"
import { ErrorsPanel } from "@/components/monitoring/errors-panel"
import { AiSpendPanel } from "@/components/monitoring/ai-spend-panel"
import { ChatPanel } from "@/components/monitoring/chat-panel"
import { DatabasePanel } from "@/components/monitoring/database-panel"
import { CachePanel } from "@/components/monitoring/cache-panel"
import {
  getSyncs,
  getRecentErrors,
  getErrorsByHour,
  getAiCostByDay,
  getAiByFeature,
  getChatStats,
  getRecentNonOkChatTurns,
  getCacheStats,
} from "@/lib/monitoring/queries"
import {
  getDbSize,
  getTableSizes,
  getConnections,
} from "@/lib/monitoring/db-stats"
import { getRedisLive } from "@/lib/monitoring/redis-stats"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import "@/components/monitoring/monitoring.css"

export const dynamic = "force-dynamic"

export default async function MonitoringPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>
}) {
  const session = await getServerSession(authOptions)
  const params = await searchParams
  const storeId = params.store && params.store !== "all" ? params.store : null

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
  ])

  return (
    <main className="px-6 max-w-275 mx-auto pb-16">
      <Masthead stores={stores} commitSha={commitSha} tzLabel={tzLabel} />
      <FrontPageLede />
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
