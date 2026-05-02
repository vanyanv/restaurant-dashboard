import { AiSpendPanel } from "@/components/monitoring/ai-spend-panel"
import { ChatPanel } from "@/components/monitoring/chat-panel"
import { getAiByFeature, getAiCostByDay, getChatStats, getRecentNonOkChatTurns } from "@/lib/monitoring/queries"

export const dynamic = "force-dynamic"

export default async function CostsPage() {
  const [aiByDay, aiByFeature, chatStats, recentChat] = await Promise.all([
    getAiCostByDay(30),
    getAiByFeature(24),
    getChatStats(24),
    getRecentNonOkChatTurns(20),
  ])
  return (
    <div className="flex flex-col gap-6">
      <AiSpendPanel byDay={aiByDay} byFeature={aiByFeature} />
      <ChatPanel stats={chatStats} recent={recentChat} />
    </div>
  )
}
