/**
 * How the chat route records a turn that did not finish (stopped or failed),
 * and what the owner reads when one fails. Kept out of the route file: a Next
 * route module may export only its HTTP handlers and config.
 */
import { Prisma, type PrismaClient } from "@/generated/prisma/client"
import { recordAiUsage } from "@/lib/monitoring/ai-usage"
import { appendMessage } from "@/lib/chat/conversation"
import { logger } from "@/lib/logger"

export type StepUsage = {
  inputTokens?: number
  outputTokens?: number
  inputTokenDetails?: { cacheReadTokens?: number }
  cachedInputTokens?: number
}

export type UnfinishedKind = "STOPPED" | "ERROR" | "RATE_LIMITED"

/** Sum per-step usage — the same totals `totalUsage` gives a finished turn. */
export function sumUsage(usages: readonly (StepUsage | undefined)[]): {
  inputTokens: number
  outputTokens: number
  cachedTokens: number
} {
  let inputTokens = 0
  let outputTokens = 0
  let cachedTokens = 0
  for (const u of usages) {
    if (!u) continue
    inputTokens += u.inputTokens ?? 0
    outputTokens += u.outputTokens ?? 0
    cachedTokens += u.inputTokenDetails?.cacheReadTokens ?? u.cachedInputTokens ?? 0
  }
  return { inputTokens, outputTokens, cachedTokens }
}

/** Which unfinished state an error is. */
export function unfinishedKindOf(error: unknown): Exclude<UnfinishedKind, "STOPPED"> {
  const message = error instanceof Error ? error.message : String(error)
  return /rate.?limit|429/i.test(message) ? "RATE_LIMITED" : "ERROR"
}

/** The stored assistant message for a turn that did not finish: what was shown, then why it stopped. */
export function unfinishedContent(shown: string, kind: UnfinishedKind): string {
  const note =
    kind === "STOPPED"
      ? "[Stopped before the answer finished.]"
      : kind === "RATE_LIMITED"
        ? "[This answer failed: the AI provider was rate-limiting requests.]"
        : "[This answer failed before it finished.]"
  return shown ? `${shown}\n\n${note}` : note
}

/**
 * What the owner reads when a turn fails mid-answer, in place of the SDK's
 * "An error occurred.". Says what happened and what to do; the full error is
 * on the turn's `ChatTurn.errorMessage` and in the log.
 */
export function ownerErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/rate.?limit|429/i.test(message)) {
    return "The AI provider is rate-limiting requests right now, so this answer stopped. Wait a minute and ask again."
  }
  if (/abort/i.test(message)) {
    return "This answer was stopped before it finished."
  }
  if (/timeout|timed out|ETIMEDOUT/i.test(message)) {
    return "The AI provider took too long to respond, so this answer stopped. Ask again in a moment."
  }
  return "This answer failed before it finished — the AI call returned an error. Ask again; if it keeps failing, the error is recorded on this turn."
}

export interface UnfinishedTurn {
  kind: UnfinishedKind
  /** Usage of each step that finished — what the provider already billed. */
  usages: readonly StepUsage[]
  error: unknown
  /** The text the owner had seen when the turn ended. */
  shown: string
  chatTurnId: string
  conversationId: string
  ownerId: string
  userMessage: string
  model: string
  durationMs: number
  toolCalls: Array<{ toolName: string; args: unknown; result: unknown; durationMs: number }>
  toolErrors: Record<string, string>
  /** The user message write, awaited before the answer so the thread keeps its order. */
  userPersisted: Promise<unknown>
}

/**
 * A TURN THAT DID NOT FINISH STILL LEAVES A RECORD.
 *
 * Stopped (the reader pressed stop or closed the tab) or failed (the model
 * call or the stream errored). Before this, neither wrote anything: no
 * `AiUsageEvent` for the steps the provider had already billed — so the daily
 * cap could not see them — no `ChatTurn` for the thumb, and no assistant
 * `Message`, so the thread reopened as a question with no answer.
 *
 * Never throws: each write logs its own failure.
 */
export async function recordUnfinishedTurn(
  db: Pick<PrismaClient, "chatTurn">,
  chatDb: PrismaClient,
  t: UnfinishedTurn,
): Promise<void> {
  const sum = sumUsage(t.usages)
  const aiUsageEventId =
    t.usages.length > 0
      ? await recordAiUsage({
          feature: "chat",
          provider: "openai",
          model: t.model,
          inputTokens: sum.inputTokens,
          outputTokens: sum.outputTokens,
          cachedTokens: sum.cachedTokens,
          userId: t.ownerId,
          durationMs: t.durationMs,
        })
      : null
  const errorMessage =
    t.kind === "STOPPED"
      ? null
      : (t.error instanceof Error ? t.error.message : String(t.error)).slice(0, 4000)
  logger.warn(
    `[chat] ownerId=${t.ownerId} convId=${t.conversationId} turn ${t.kind} ` +
      `steps=${t.usages.length} tools=${t.toolCalls.length}` +
      (errorMessage ? ` error=${errorMessage.slice(0, 300)}` : ""),
  )
  try {
    await db.chatTurn.create({
      data: {
        id: t.chatTurnId,
        conversationId: t.conversationId,
        userId: t.ownerId,
        userMessage: t.userMessage,
        assistantMessage: t.shown ? t.shown.slice(0, 4000) : null,
        toolsUsed: t.toolCalls.map((c) => c.toolName),
        aiUsageEventId,
        status: t.kind,
        finishReason: t.kind === "STOPPED" ? "aborted" : "error",
        errorMessage,
        toolErrors:
          Object.keys(t.toolErrors).length > 0
            ? (t.toolErrors as Prisma.InputJsonValue)
            : Prisma.DbNull,
      },
    })
  } catch (err) {
    logger.error(`[chat] failed to write ${t.kind} ChatTurn`, err)
  }
  try {
    await t.userPersisted
    await appendMessage(chatDb, {
      conversationId: t.conversationId,
      role: "assistant",
      content: unfinishedContent(t.shown, t.kind),
      toolCalls: t.toolCalls,
    })
  } catch (err) {
    logger.error(`[chat] failed to persist ${t.kind} assistant message`, err)
  }
}

