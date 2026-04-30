import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type ToolSet,
  type UIMessage,
} from "ai"
import { openai } from "@ai-sdk/openai"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { recordAiUsage } from "@/lib/monitoring/ai-usage"
import { chatPrisma } from "@/lib/chat/prisma-chat"
import { chatTools } from "@/lib/chat/tools"
import {
  appendMessage,
  createConversation,
  getConversation,
  setConversationTitle,
} from "@/lib/chat/conversation"
import { buildSystemPrompt } from "@/lib/chat/system-prompt"
import { CHAT_ROUTING_MODEL } from "@/lib/chat/openai-client"
import { generateConversationTitle } from "@/lib/chat/auto-title"

export const maxDuration = 60

interface ChatRequestBody {
  messages: UIMessage[]
  conversationId?: string
}

/**
 * Streams an LLM reply for the owner-analytics chat. Owner-scoped at every
 * boundary:
 *
 *   - The route reads `ownerId` from the next-auth session, never trusts
 *     anything from the body.
 *   - Every tool's `execute` receives a context with the same `ownerId`.
 *   - Conversation reads/writes go through `getConversation` which throws
 *     on `NOT_OWNED`.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (session.user.role !== "OWNER") {
    return NextResponse.json(
      { error: "Chat is owner-only for now" },
      { status: 403 },
    )
  }

  const ownerId = session.user.id
  const accountId = session.user.accountId
  let body: ChatRequestBody
  try {
    body = (await req.json()) as ChatRequestBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: "messages required" }, { status: 400 })
  }

  // Resolve or create the conversation. `getConversation` throws on
  // NOT_OWNED, which we surface as 403.
  let conversationId = body.conversationId
  if (conversationId) {
    try {
      await getConversation(chatPrisma, accountId, conversationId)
    } catch (err) {
      const code = (err as { code?: string }).code
      const status = code === "NOT_OWNED" ? 403 : 404
      return NextResponse.json({ error: code ?? "not found" }, { status })
    }
  } else {
    const created = await createConversation(chatPrisma, ownerId, accountId)
    conversationId = created.id
  }

  // Persist the user's latest turn before invoking the model so the
  // conversation reflects what the model saw.
  const lastMessage = body.messages[body.messages.length - 1]
  const userMessageText =
    lastMessage.role === "user" ? extractText(lastMessage) : ""
  // ChatTurn truncates to 4KB on each side.
  const userMessageStored = userMessageText.slice(0, 4000)
  if (lastMessage.role === "user" && userMessageText) {
    await appendMessage(chatPrisma, {
      conversationId,
      role: "user",
      content: userMessageText,
    })
  }

  const ctx = { ownerId, accountId, prisma: chatPrisma }

  // Wrap each domain tool in the AI SDK `tool()` shape. The owner-scope
  // helpers inside `execute` enforce auth on every call.
  const toolSet: ToolSet = Object.fromEntries(
    Object.values(chatTools).map((t) => [
      t.name,
      tool({
        description: t.description,
        inputSchema: t.parameters,
        execute: async (args: unknown) =>
          t.execute(args as never, ctx) as Promise<unknown>,
      }),
    ]),
  )

  const requestStartMs = performance.now()
  const systemPromptStartMs = performance.now()
  const system = await buildSystemPrompt(accountId)
  const systemPromptMs = Math.round(performance.now() - systemPromptStartMs)

  // First-token latency captured from the first `text-delta` chunk.
  const streamStartMs = performance.now()
  let firstTokenMs: number | null = null

  // Captured per-step so we can persist tool-call provenance alongside
  // the assistant's final text.
  const capturedToolCalls: Array<{
    toolName: string
    args: unknown
    result: unknown
    durationMs: number
  }> = []
  const capturedToolErrors: Record<string, string> = {}
  const stepStartTimes = new Map<string, number>()
  const turnStartMs = Date.now()

  const modelMessages = await convertToModelMessages(body.messages)

  let result: ReturnType<typeof streamText>
  try {
    result = streamText({
    model: openai(CHAT_ROUTING_MODEL),
    system,
    messages: modelMessages,
    tools: toolSet,
    stopWhen: stepCountIs(8),
    onChunk: ({ chunk }) => {
      if (firstTokenMs === null && chunk.type === "text-delta") {
        firstTokenMs = Math.round(performance.now() - streamStartMs)
      }
    },
    onStepFinish: ({ toolCalls, toolResults }) => {
      const now = Date.now()
      for (const call of toolCalls) {
        stepStartTimes.set(call.toolCallId, now)
      }
      for (const tr of toolResults) {
        const start = stepStartTimes.get(tr.toolCallId) ?? now
        capturedToolCalls.push({
          toolName: tr.toolName,
          args: tr.input,
          result: tr.output,
          durationMs: Math.max(0, now - start),
        })
        const maybeError = (tr as { error?: unknown }).error
        if (maybeError !== undefined && maybeError !== null) {
          capturedToolErrors[tr.toolName] = String(maybeError).slice(0, 1000)
        }
      }
    },
    onFinish: async ({ text, usage, providerMetadata, finishReason }) => {
      const totalMs = Math.round(performance.now() - requestStartMs)
      const toolMs = capturedToolCalls.map((c) => c.durationMs)
      const cachedTokens =
        (providerMetadata?.openai as { cachedPromptTokens?: number } | undefined)
          ?.cachedPromptTokens ?? 0
      const promptTokens = (usage as { inputTokens?: number } | undefined)
        ?.inputTokens
      const completionTokens = (usage as { outputTokens?: number } | undefined)
        ?.outputTokens
      console.log(
        `[chat] ownerId=${ownerId} convId=${conversationId} ` +
          `systemPromptMs=${systemPromptMs} firstTokenMs=${firstTokenMs ?? "n/a"} ` +
          `totalMs=${totalMs} tools=${capturedToolCalls.length} ` +
          `toolMs=[${toolMs.join(",")}] ` +
          `inputTokens=${promptTokens ?? "n/a"} cachedTokens=${cachedTokens}`,
      )

      // Record token usage. Wrapper never throws — returns null on failure.
      const aiUsageEventId = await recordAiUsage({
        feature: "chat",
        provider: "openai",
        model: CHAT_ROUTING_MODEL,
        inputTokens: promptTokens ?? 0,
        outputTokens: completionTokens ?? 0,
        cachedTokens,
        userId: ownerId,
        durationMs: Date.now() - turnStartMs,
      })

      // Classify the turn.
      let status: "OK" | "EMPTY" | "TRUNCATED" | "REFUSED" | "TOOL_FAILED" = "OK"
      if (Object.keys(capturedToolErrors).length > 0) status = "TOOL_FAILED"
      else if (finishReason === "length") status = "TRUNCATED"
      else if (finishReason === "content-filter") status = "REFUSED"
      else if (!text || text.trim().length === 0) status = "EMPTY"

      try {
        await prisma.chatTurn.create({
          data: {
            conversationId: conversationId!,
            userId: ownerId,
            userMessage: userMessageStored,
            assistantMessage: String(text ?? "").slice(0, 4000),
            toolsUsed: capturedToolCalls.map((c) => c.toolName),
            aiUsageEventId,
            status,
            finishReason: finishReason ?? null,
            toolErrors:
              Object.keys(capturedToolErrors).length > 0
                ? (capturedToolErrors as never)
                : undefined,
          },
        })
      } catch (err) {
        console.error("[chat] failed to write ChatTurn (non-fatal)", err)
      }

      try {
        await appendMessage(chatPrisma, {
          conversationId: conversationId!,
          role: "assistant",
          content: text,
          toolCalls: capturedToolCalls,
        })
      } catch (err) {
        console.error("[chat] failed to persist assistant message", err)
      }

      // Auto-title on the first assistant turn. Non-fatal: a failure here
      // leaves the conversation as "Untitled" and the user can rename
      // manually.
      try {
        const conv = await chatPrisma.conversation.findUnique({
          where: { id: conversationId! },
          select: { title: true },
        })
        if (!conv?.title) {
          const firstUser = extractText(lastMessage)
          const title = await generateConversationTitle(firstUser, text)
          if (title) {
            await setConversationTitle(chatPrisma, conversationId!, title)
          }
        }
      } catch (err) {
        console.error("[chat] auto-title path failed (non-fatal)", err)
      }
    },
  })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const isRateLimit = /rate.?limit|429/i.test(message)
    try {
      await prisma.chatTurn.create({
        data: {
          conversationId: conversationId!,
          userId: ownerId,
          userMessage: userMessageStored,
          assistantMessage: null,
          toolsUsed: [],
          status: isRateLimit ? "RATE_LIMITED" : "ERROR",
          errorMessage: message.slice(0, 4000),
        },
      })
    } catch (writeErr) {
      console.error("[chat] failed to write error ChatTurn", writeErr)
    }
    throw err
  }

  const response = result.toUIMessageStreamResponse()
  // Surface the conversation id so the client can pin it after first turn.
  response.headers.set("x-conversation-id", conversationId)
  return response
}

function extractText(m: UIMessage): string {
  // Legacy clients sometimes send `content: string`; accept both shapes.
  const legacy = (m as unknown as { content?: unknown }).content
  if (typeof legacy === "string") return legacy

  const parts = (m as unknown as { parts?: Array<{ type: string; text?: string }> }).parts
  if (Array.isArray(parts)) {
    return parts
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text as string)
      .join("\n")
      .trim()
  }
  return ""
}
