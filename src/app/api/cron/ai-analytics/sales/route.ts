import { makeAiAnalyticsCronHandler } from "@/lib/ai-analytics/cron-handler"
import {
  loadSalesSourceData,
  buildSalesSystemPrompt,
  buildSalesUserPrompt,
  buildSalesSourceSummary,
  collectSalesEntities,
} from "@/lib/ai-analytics/routes/sales"

export const maxDuration = 60

export const POST = makeAiAnalyticsCronHandler({
  route: "SALES",
  fetchSourceData: loadSalesSourceData,
  buildSystemPrompt: buildSalesSystemPrompt,
  buildUserPrompt: buildSalesUserPrompt,
  buildSourceSummary: buildSalesSourceSummary,
  collectAllowedEntities: collectSalesEntities,
  materialityThresholdDollars: 200,
  validateEntities: true,
})
