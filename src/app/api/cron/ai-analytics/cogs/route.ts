import { makeAiAnalyticsCronHandler } from "@/lib/ai-analytics/cron-handler"
import {
  loadCogsSourceData,
  buildCogsSystemPrompt,
  buildCogsUserPrompt,
  buildCogsSourceSummary,
  collectCogsEntities,
} from "@/lib/ai-analytics/routes/cogs"

export const maxDuration = 60

export const POST = makeAiAnalyticsCronHandler({
  route: "COGS",
  fetchSourceData: loadCogsSourceData,
  buildSystemPrompt: buildCogsSystemPrompt,
  buildUserPrompt: buildCogsUserPrompt,
  buildSourceSummary: buildCogsSourceSummary,
  collectAllowedEntities: collectCogsEntities,
  materialityThresholdDollars: 200,
  validateEntities: true,
})
