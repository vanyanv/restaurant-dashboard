import { makeAiAnalyticsCronHandler } from "@/lib/ai-analytics/cron-handler"
import {
  loadInvoiceSourceData,
  buildInvoiceSystemPrompt,
  buildInvoiceUserPrompt,
  buildInvoiceSourceSummary,
  collectInvoiceEntities,
} from "@/lib/ai-analytics/routes/invoices"

export const maxDuration = 60

export const POST = makeAiAnalyticsCronHandler({
  route: "INVOICES",
  fetchSourceData: loadInvoiceSourceData,
  buildSystemPrompt: buildInvoiceSystemPrompt,
  buildUserPrompt: buildInvoiceUserPrompt,
  buildSourceSummary: buildInvoiceSourceSummary,
  collectAllowedEntities: collectInvoiceEntities,
  materialityThresholdDollars: 250,
  validateEntities: true,
})
