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
  if (lastMessage.role === "user") {
    const text = extractText(lastMessage)
    if (text) {
      await appendMessage(chatPrisma, {
        conversationId,
        role: "user",
        content: text,
      })
    }
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
  const stepStartTimes = new Map<string, number>()

  const modelMessages = await convertToModelMessages(body.messages)

  const result = streamText({
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
      }
    },
    onFinish: async ({ text, usage, providerMetadata }) => {
      const totalMs = Math.round(performance.now() - requestStartMs)
      const toolMs = capturedToolCalls.map((c) => c.durationMs)
      const cachedTokens =
        (providerMetadata?.openai as { cachedPromptTokens?: number } | undefined)
          ?.cachedPromptTokens ?? 0
      const promptTokens = (usage as { inputTokens?: number } | undefined)
        ?.inputTokens
      console.log(
        `[chat] ownerId=${ownerId} convId=${conversationId} ` +
          `systemPromptMs=${systemPromptMs} firstTokenMs=${firstTokenMs ?? "n/a"} ` +
          `totalMs=${totalMs} tools=${capturedToolCalls.length} ` +
          `toolMs=[${toolMs.join(",")}] ` +
          `inputTokens=${promptTokens ?? "n/a"} cachedTokens=${cachedTokens}`,
      )
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
