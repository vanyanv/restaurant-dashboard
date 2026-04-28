import { prisma } from "@/lib/prisma"
import {
  generateInsights,
  OPENAI_GENERATOR_MODEL,
  type OpenAIUsage,
} from "@/lib/openai-insights"
import {
  validateInsightBatch,
  type ValidatableInsight,
  extractAllowedNumbers,
} from "./validate"
import { runCriticPass, type CandidateInsight } from "./critic"
import { loadRecentInsights, formatMemoryForPrompt } from "./memory"
import { Prisma } from "@/generated/prisma/client"
import type {
  AiAnalyticsRoute,
  AiAnalyticsScope,
  AiAnalyticsRunStatus,
  AiInsightSeverity,
} from "@/generated/prisma/client"

/**
 * Phased AI analytics pipeline. The work is split into three short-lived
 * Vercel function invocations because the Hobby plan caps every function at
 * 60s — too tight for source-fetch + generator + critic + DB writes in a
 * single call. Intermediate state is persisted on the AiAnalyticsRun row.
 *
 *   Phase 1 (Prompt)   — fetch source, build prompts, persist
 *   Phase 2 (Generate) — call generator (with one validator-driven retry),
 *                        persist candidates
 *   Phase 3 (Critique) — call critic, persist reviewed insights
 *
 * Each phase is idempotent: if called on a run already past its phase, the
 * function returns the existing terminal state without re-doing any work.
 */

export interface AiInsightCandidatePayload {
  headline: string
  body: string
  impactDollars?: number | null
  severityHint?: string
  payload?: Prisma.InputJsonValue
}

interface GeneratorOutput {
  insights: AiInsightCandidatePayload[]
}

interface SourceSnapshot {
  summary: string
  allowedNumbers: { dollars: number[]; percents: number[] }
  allowedEntities: string[]
  materialityThresholdDollars: number
  validateEntities: boolean
}

interface GeneratorPayload {
  candidates: AiInsightCandidatePayload[]
  totalUsage: OpenAIUsage
  retryCount: number
}

const RETRY_LIMIT = 1
const MAX_VALIDATOR_FEEDBACK = 10

export interface RunPhasePromptArgs<TSource> {
  route: AiAnalyticsRoute
  scope: AiAnalyticsScope
  storeId: string | null

  fetchSourceData: () => Promise<TSource>
  buildSystemPrompt: () => string
  buildUserPrompt: (args: { source: TSource; memoryBlock: string }) => string
  buildSourceSummary: (source: TSource) => string
  collectAllowedEntities?: (source: TSource) => string[]
  materialityThresholdDollars: number
  validateEntities: boolean
}

export interface PhasePromptResult {
  runId: string
  status: AiAnalyticsRunStatus
  nextStep: "generate" | "done"
  errorDetails?: string
}

export async function runPhasePrompt<TSource>(
  args: RunPhasePromptArgs<TSource>,
): Promise<PhasePromptResult> {
  const run = await prisma.aiAnalyticsRun.create({
    data: {
      route: args.route,
      scope: args.scope,
      storeId: args.storeId,
      status: "QUEUED",
      generatorModel: OPENAI_GENERATOR_MODEL,
    },
  })

  try {
    const source = await args.fetchSourceData()
    const allowedNumbers = extractAllowedNumbers(source)
    const allowedEntities = args.collectAllowedEntities?.(source) ?? []

    const memory = await loadRecentInsights({
      route: args.route,
      scope: args.scope,
      storeId: args.storeId,
    })
    const memoryBlock = formatMemoryForPrompt(memory)

    const systemPrompt = args.buildSystemPrompt()
    const userPrompt = args.buildUserPrompt({ source, memoryBlock })
    const summary = args.buildSourceSummary(source)

    const snapshot: SourceSnapshot = {
      summary,
      allowedNumbers,
      allowedEntities,
      materialityThresholdDollars: args.materialityThresholdDollars,
      validateEntities: args.validateEntities,
    }

    await prisma.aiAnalyticsRun.update({
      where: { id: run.id },
      data: {
        status: "PROMPT_READY",
        systemPrompt,
        userPrompt,
        sourceSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      },
    })

    return { runId: run.id, status: "PROMPT_READY", nextStep: "generate" }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await prisma.aiAnalyticsRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        errorDetails: message.slice(0, 2000),
        completedAt: new Date(),
      },
    })
    return {
      runId: run.id,
      status: "FAILED",
      nextStep: "done",
      errorDetails: message,
    }
  }
}

export interface PhaseGenerateResult {
  runId: string
  status: AiAnalyticsRunStatus
  nextStep: "critique" | "done"
  candidateCount?: number
  errorDetails?: string
}

export async function runPhaseGenerate(runId: string): Promise<PhaseGenerateResult> {
  const run = await prisma.aiAnalyticsRun.findUnique({ where: { id: runId } })
  if (!run) {
    return {
      runId,
      status: "FAILED",
      nextStep: "done",
      errorDetails: `Run ${runId} not found`,
    }
  }

  // Idempotency: if we're past this phase, return the existing terminal state.
  if (run.status === "GENERATED") {
    return { runId, status: "GENERATED", nextStep: "critique" }
  }
  if (run.status === "OK" || run.status === "PARTIAL" || run.status === "FAILED") {
    return {
      runId,
      status: run.status,
      nextStep: "done",
      errorDetails: run.errorDetails ?? undefined,
    }
  }
  if (run.status !== "PROMPT_READY") {
    return {
      runId,
      status: "FAILED",
      nextStep: "done",
      errorDetails: `Run ${runId} is in status ${run.status}; expected PROMPT_READY`,
    }
  }

  const systemPrompt = run.systemPrompt
  const baseUserPrompt = run.userPrompt
  const snapshot = run.sourceSnapshot as unknown as SourceSnapshot | null
  if (!systemPrompt || !baseUserPrompt || !snapshot) {
    await markFailed(runId, "Run missing prompts or source snapshot for generate phase")
    return {
      runId,
      status: "FAILED",
      nextStep: "done",
      errorDetails: "Run missing prompts or source snapshot",
    }
  }

  let candidates: AiInsightCandidatePayload[] = []
  let retryCount = 0
  let totalUsage: OpenAIUsage = { promptTokens: 0, completionTokens: 0 }
  let lastValidationFailures: string[] = []

  try {
    for (let attempt = 0; attempt <= RETRY_LIMIT; attempt += 1) {
      const userPrompt =
        attempt === 0
          ? baseUserPrompt
          : [
              baseUserPrompt,
              "",
              "## Validator feedback on your previous answer",
              "Your previous answer cited the following values that are NOT in the source data above. Rewrite all insights using only values that appear verbatim in the source data.",
              ...lastValidationFailures.map((f) => `- ${f}`),
            ].join("\n")

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
          allowedNumbers: snapshot.allowedNumbers,
          allowedEntities: snapshot.allowedEntities,
          validateEntities: snapshot.validateEntities,
        },
      )

      if (validation.ok) {
        candidates = proposed
        retryCount = attempt
        break
      }

      retryCount = attempt + 1
      lastValidationFailures = validation.failures.slice(0, MAX_VALIDATOR_FEEDBACK)

      if (attempt === RETRY_LIMIT) {
        const errMsg = `Validator failed twice. Last failures: ${lastValidationFailures.join("; ")}`
        await prisma.aiAnalyticsRun.update({
          where: { id: runId },
          data: {
            status: "FAILED",
            retryCount,
            promptTokens: totalUsage.promptTokens,
            completionTokens: totalUsage.completionTokens,
            insightCount: 0,
            droppedByCritic: 0,
            errorDetails: errMsg,
            completedAt: new Date(),
          },
        })
        return {
          runId,
          status: "FAILED",
          nextStep: "done",
          errorDetails: lastValidationFailures.join("; "),
        }
      }
    }

    if (candidates.length === 0) {
      await prisma.aiAnalyticsRun.update({
        where: { id: runId },
        data: {
          status: "OK",
          retryCount,
          promptTokens: totalUsage.promptTokens,
          completionTokens: totalUsage.completionTokens,
          insightCount: 0,
          droppedByCritic: 0,
          completedAt: new Date(),
        },
      })
      return { runId, status: "OK", nextStep: "done", candidateCount: 0 }
    }

    const payload: GeneratorPayload = {
      candidates,
      totalUsage,
      retryCount,
    }

    await prisma.aiAnalyticsRun.update({
      where: { id: runId },
      data: {
        status: "GENERATED",
        retryCount,
        promptTokens: totalUsage.promptTokens,
        completionTokens: totalUsage.completionTokens,
        generatorPayload: payload as unknown as Prisma.InputJsonValue,
      },
    })

    return {
      runId,
      status: "GENERATED",
      nextStep: "critique",
      candidateCount: candidates.length,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await markFailed(runId, message)
    return { runId, status: "FAILED", nextStep: "done", errorDetails: message }
  }
}

export interface PhaseCritiqueResult {
  runId: string
  status: AiAnalyticsRunStatus
  insightCount: number
  droppedByCritic: number
  errorDetails?: string
}

export async function runPhaseCritique(runId: string): Promise<PhaseCritiqueResult> {
  const run = await prisma.aiAnalyticsRun.findUnique({ where: { id: runId } })
  if (!run) {
    return {
      runId,
      status: "FAILED",
      insightCount: 0,
      droppedByCritic: 0,
      errorDetails: `Run ${runId} not found`,
    }
  }

  // Idempotency: terminal status returns the existing record.
  if (run.status === "OK" || run.status === "PARTIAL" || run.status === "FAILED") {
    return {
      runId,
      status: run.status,
      insightCount: run.insightCount,
      droppedByCritic: run.droppedByCritic,
      errorDetails: run.errorDetails ?? undefined,
    }
  }

  if (run.status !== "GENERATED") {
    return {
      runId,
      status: "FAILED",
      insightCount: 0,
      droppedByCritic: 0,
      errorDetails: `Run ${runId} is in status ${run.status}; expected GENERATED`,
    }
  }

  const snapshot = run.sourceSnapshot as unknown as SourceSnapshot | null
  const generator = run.generatorPayload as unknown as GeneratorPayload | null
  if (!snapshot || !generator) {
    await markFailed(runId, "Run missing source snapshot or generator payload for critique phase")
    return {
      runId,
      status: "FAILED",
      insightCount: 0,
      droppedByCritic: 0,
      errorDetails: "Missing snapshot or generator payload",
    }
  }

  try {
    const criticInput: CandidateInsight[] = generator.candidates.map((c) => ({
      headline: c.headline,
      body: c.body,
      impactDollars: c.impactDollars ?? undefined,
      severityHint: c.severityHint,
    }))

    const criticResult = await runCriticPass({
      candidates: criticInput,
      sourceDataSummary: snapshot.summary,
      materialityThresholdDollars: snapshot.materialityThresholdDollars,
      routeLabel: run.route,
    })

    const reviewed = criticResult.reviewed
    const droppedByCritic = criticResult.droppedCount
    const totalPromptTokens = (run.promptTokens ?? 0) + criticResult.usage.promptTokens
    const totalCompletionTokens =
      (run.completionTokens ?? 0) + criticResult.usage.completionTokens

    if (reviewed.length === 0 && droppedByCritic > 0) {
      await prisma.aiAnalyticsRun.update({
        where: { id: runId },
        data: {
          status: "PARTIAL",
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          criticModel: criticResult.modelUsed,
          insightCount: 0,
          droppedByCritic,
          completedAt: new Date(),
        },
      })
      return { runId, status: "PARTIAL", insightCount: 0, droppedByCritic }
    }

    await prisma.$transaction(async (tx) => {
      for (const r of reviewed) {
        const matched = generator.candidates.find((c) => c.headline === r.headline)
        await tx.aiInsight.create({
          data: {
            runId,
            route: run.route,
            scope: run.scope,
            storeId: run.storeId,
            headline: r.headline,
            body: r.body,
            severity: r.severity as AiInsightSeverity,
            impactDollars: r.impactDollars,
            payload: (matched?.payload as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          },
        })
      }
    })

    const finalStatus: "OK" | "PARTIAL" = droppedByCritic > 0 ? "PARTIAL" : "OK"

    await prisma.aiAnalyticsRun.update({
      where: { id: runId },
      data: {
        status: finalStatus,
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        criticModel: criticResult.modelUsed,
        insightCount: reviewed.length,
        droppedByCritic,
        completedAt: new Date(),
      },
    })

    return {
      runId,
      status: finalStatus,
      insightCount: reviewed.length,
      droppedByCritic,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await markFailed(runId, message)
    return {
      runId,
      status: "FAILED",
      insightCount: 0,
      droppedByCritic: 0,
      errorDetails: message,
    }
  }
}

async function markFailed(runId: string, message: string): Promise<void> {
  await prisma.aiAnalyticsRun.update({
    where: { id: runId },
    data: {
      status: "FAILED",
      errorDetails: message.slice(0, 2000),
      completedAt: new Date(),
    },
  })
}
