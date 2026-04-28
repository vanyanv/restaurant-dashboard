import { makeAiAnalyticsCronHandler } from "@/lib/ai-analytics/cron-handler"
import {
  loadMenuSourceData,
  buildMenuSystemPrompt,
  buildMenuUserPrompt,
  buildMenuSourceSummary,
  collectMenuEntities,
} from "@/lib/ai-analytics/routes/menu"

export const maxDuration = 60

export const POST = makeAiAnalyticsCronHandler({
  route: "MENU",
  fetchSourceData: loadMenuSourceData,
  buildSystemPrompt: buildMenuSystemPrompt,
  buildUserPrompt: buildMenuUserPrompt,
  buildSourceSummary: buildMenuSourceSummary,
  collectAllowedEntities: collectMenuEntities,
  materialityThresholdDollars: 150,
  validateEntities: true,
})
