import { prisma } from "@/lib/prisma"
import {
  generateInsights,
  GROQ_GENERATOR_MODEL,
  type GroqUsage,
} from "@/lib/groq"
import {
  extractAllowedNumbers,
  validateInsightBatch,
  type ValidatableInsight,
} from "./validate"
import { runCriticPass, type CandidateInsight } from "./critic"
import { loadRecentInsights, formatMemoryForPrompt } from "./memory"
import { Prisma } from "@/generated/prisma/client"
import type {
  AiAnalyticsRoute,
  AiAnalyticsScope,
  AiInsightSeverity,
} from "@/generated/prisma/client"

/**
 * One-stop orchestrator for an AI analytics cron run. Each per-route handler
 * just supplies its source-data fetcher, its prompt builders, and its
 * materiality threshold; the pipeline takes care of:
 *
 *   1. Fetching trailing memory (last 14d insights for the same scope).
 *   2. Calling the generator with memory context appended.
 *   3. Validating numbers/entities against the source data.
 *   4. Retrying once with a "your last answer had X wrong" message.
 *   5. Running the critic LLM pass on whatever survived.
 *   6. Writing AiAnalyticsRun + AiInsight rows in a single transaction.
 *
 * Returning the run ID lets the caller log a per-route summary in the cron
 * response.
 */

export interface AiInsightCandidatePayload {
  headline: string
  body: string
  impactDollars?: number | null
  severityHint?: string
  /** Optional structured sidecar persisted to AiInsight.payload. */
  payload?: Prisma.InputJsonValue
}

export interface GeneratorOutput {
  insights: AiInsightCandidatePayload[]
}

export interface RouteHandlerArgs<TSource> {
  route: AiAnalyticsRoute
  scope: AiAnalyticsScope
  storeId: string | null

  /** Pull the route's source data (sales rows, invoice spend, etc.). */
  fetchSourceData: () => Promise<TSource>

  /** Build the system prompt — usually static per route. */
  buildSystemPrompt: () => string

  /** Build the user prompt from source data + memory + (optional) calibration.
   * Caller appends its own data; the pipeline injects memory context. */
  buildUserPrompt: (args: {
    source: TSource
    memoryBlock: string
  }) => string

  /** Stringify a *summary* of the source data for the critic to verify
   * support against. Keep tight (a few hundred lines max) — bigger payloads
   * hurt critic accuracy and cost. */
  buildSourceSummary: (source: TSource) => string

  /** Returns every entity name (item, vendor, ingredient, store) the AI may
   * legitimately reference. Pulled from source data. Used by the validator. */
  collectAllowedEntities?: (source: TSource) => string[]

  /** Drop generator insights below this dollar impact when the critic runs.
   * Set to 0 for routes where qualitative narrative is the point. */
  materialityThresholdDollars: number

  /** Whether to enforce quoted-entity validation (off for prose-heavy routes
   * like Overview). */
  validateEntities: boolean
}

export interface PipelineResult {
  runId: string
  status: "OK" | "PARTIAL" | "FAILED"
  insightCount: number
  droppedByCritic: number
  retryCount: number
  errorDetails?: string
}

const RETRY_LIMIT = 1

export async function runAiAnalyticsRoute<TSource>(
  args: RouteHandlerArgs<TSource>,
): Promise<PipelineResult> {
  const startedAt = new Date()

  const run = await prisma.aiAnalyticsRun.create({
    data: {
      route: args.route,
      scope: args.scope,
      storeId: args.storeId,
      status: "FAILED",
      generatorModel: GROQ_GENERATOR_MODEL,
      startedAt,
    },
  })

  const finalize = async (
    fields: Partial<{
      status: "OK" | "PARTIAL" | "FAILED"
      retryCount: number
      promptTokens: number
      completionTokens: number
      criticModel: string
      insightCount: number
      droppedByCritic: number
      errorDetails: string
    }>,
  ) => {
    await prisma.aiAnalyticsRun.update({
      where: { id: run.id },
      data: { ...fields, completedAt: new Date() },
    })
  }

  try {
    const source = await args.fetchSourceData()
    const allowedNumbers = extractAllowedNumbers(source)
    const allowedEntities = args.collectAllowedEntities?.(source) ?? []

    const memory = await loadRecentInsights({
      route: args.route,
      scope: args.scope,
      storeId: args.storeId,
    })
    let memoryBlock = formatMemoryForPrompt(memory)

    const systemPrompt = args.buildSystemPrompt()

    let candidates: AiInsightCandidatePayload[] = []
    let retryCount = 0
    let totalUsage: GroqUsage = { promptTokens: 0, completionTokens: 0 }
    let lastValidationFailures: string[] = []

    for (let attempt = 0; attempt <= RETRY_LIMIT; attempt += 1) {
      const userPrompt = (() => {
        const base = args.buildUserPrompt({ source, memoryBlock })
        if (attempt === 0) return base
        return [
          base,
          "",
          "## Validator feedback on your previous answer",
          "Your previous answer cited the following values that are NOT in the source data above. Rewrite all insights using only values that appear verbatim in the source data.",
          ...lastValidationFailures.map((f) => `- ${f}`),
        ].join("\n")
      })()

      const result = await generateInsights<GeneratorOutput>({
        systemPrompt,
        userPrompt,
      })

      totalUsage = {
        promptTokens: totalUsage.promptTokens + result.usage.promptTokens,
        completionTokens: totalUsage.completionTokens + result.usage.completionTokens,
      }

      const proposed = (result.data.insights ?? []).filter(
        (x): x is AiInsightCandidatePayload =>
          !!x && typeof x.headline === "string" && typeof x.body === "string",
      )

      const validation = validateInsightBatch(
        proposed.map<ValidatableInsight>((p) => ({ headline: p.headline, body: p.body })),
        {
          allowedNumbers,
          allowedEntities,
          validateEntities: args.validateEntities,
        },
      )

      if (validation.ok) {
        candidates = proposed
        retryCount = attempt
        break
      }

      retryCount = attempt + 1
      lastValidationFailures = validation.failures.slice(0, 10)

      if (attempt === RETRY_LIMIT) {
        // Two strikes — bail with an empty candidate set and FAILED status.
        await finalize({
          status: "FAILED",
          retryCount,
          promptTokens: totalUsage.promptTokens,
          completionTokens: totalUsage.completionTokens,
          insightCount: 0,
          droppedByCritic: 0,
          errorDetails: `Validator failed twice. Last failures: ${lastValidationFailures.join("; ")}`,
        })
        return {
          runId: run.id,
          status: "FAILED",
          insightCount: 0,
          droppedByCritic: 0,
          retryCount,
          errorDetails: lastValidationFailures.join("; "),
        }
      }
    }

    if (candidates.length === 0) {
      await finalize({
        status: "OK",
        retryCount,
        promptTokens: totalUsage.promptTokens,
        completionTokens: totalUsage.completionTokens,
        insightCount: 0,
        droppedByCritic: 0,
      })
      return {
        runId: run.id,
        status: "OK",
        insightCount: 0,
        droppedByCritic: 0,
        retryCount,
      }
    }

    const sourceSummary = args.buildSourceSummary(source)

    const criticInput: CandidateInsight[] = candidates.map((c) => ({
      headline: c.headline,
      body: c.body,
      impactDollars: c.impactDollars ?? undefined,
      severityHint: c.severityHint,
    }))

    const criticResult = await runCriticPass({
      candidates: criticInput,
      sourceDataSummary: sourceSummary,
      materialityThresholdDollars: args.materialityThresholdDollars,
      routeLabel: args.route,
    })

    const reviewed = criticResult.reviewed
    const droppedByCritic = criticResult.droppedCount

    if (reviewed.length === 0 && droppedByCritic > 0) {
      await finalize({
        status: "PARTIAL",
        retryCount,
        promptTokens: totalUsage.promptTokens + criticResult.usage.promptTokens,
        completionTokens: totalUsage.completionTokens + criticResult.usage.completionTokens,
        criticModel: criticResult.modelUsed,
        insightCount: 0,
        droppedByCritic,
      })
      return {
        runId: run.id,
        status: "PARTIAL",
        insightCount: 0,
        droppedByCritic,
        retryCount,
      }
    }

    await prisma.$transaction(async (tx) => {
      for (const r of reviewed) {
        const matched = candidates.find((c) => c.headline === r.headline)
        await tx.aiInsight.create({
          data: {
            runId: run.id,
            route: args.route,
            scope: args.scope,
            storeId: args.storeId,
            headline: r.headline,
            body: r.body,
            severity: r.severity as AiInsightSeverity,
            impactDollars: r.impactDollars,
            payload: matched?.payload ?? Prisma.JsonNull,
          },
        })
      }
    })

    const finalStatus: "OK" | "PARTIAL" =
      droppedByCritic > 0 ? "PARTIAL" : "OK"

    await finalize({
      status: finalStatus,
      retryCount,
      promptTokens: totalUsage.promptTokens + criticResult.usage.promptTokens,
      completionTokens: totalUsage.completionTokens + criticResult.usage.completionTokens,
      criticModel: criticResult.modelUsed,
      insightCount: reviewed.length,
      droppedByCritic,
    })

    return {
      runId: run.id,
      status: finalStatus,
      insightCount: reviewed.length,
      droppedByCritic,
      retryCount,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await finalize({
      status: "FAILED",
      errorDetails: message.slice(0, 2000),
    })
    return {
      runId: run.id,
      status: "FAILED",
      insightCount: 0,
      droppedByCritic: 0,
      retryCount: 0,
      errorDetails: message,
    }
  }
}

