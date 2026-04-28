import { makeAiAnalyticsCronHandler } from "@/lib/ai-analytics/cron-handler"
import {
  loadOverviewSourceData,
  buildOverviewSystemPrompt,
  buildOverviewUserPrompt,
  buildOverviewSourceSummary,
  collectOverviewEntities,
} from "@/lib/ai-analytics/routes/overview"

export const maxDuration = 60

export const POST = makeAiAnalyticsCronHandler({
  route: "OVERVIEW",
  fetchSourceData: loadOverviewSourceData,
  buildSystemPrompt: buildOverviewSystemPrompt,
  buildUserPrompt: buildOverviewUserPrompt,
  buildSourceSummary: buildOverviewSourceSummary,
  collectAllowedEntities: collectOverviewEntities,
  materialityThresholdDollars: 100,
  validateEntities: false,
})
