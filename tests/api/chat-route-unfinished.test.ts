/*
 * A chat turn that fails or is stopped mid-stream still leaves a record:
 * the `ChatTurn` row (status ERROR / STOPPED), the assistant `Message` with
 * what the owner had already read, and — for a stop — the `AiUsageEvent` for
 * the steps already billed. Before this the route never set `abortSignal`,
 * never consumed the stream and had no `onError`/`onAbort`, so none of the
 * three were written, and a stream error reached the owner as "An error
 * occurred.".
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { MockLanguageModelV3 } from "ai/test"

const model = { current: null as unknown }
vi.mock("@ai-sdk/openai", () => ({ openai: () => model.current }))
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {}, hasOwnerAccess: () => true }))
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(async () => null), RATE_LIMIT_TIERS: { moderate: {} } }))
const chatTurnCreate = vi.fn(async (_a: unknown) => ({}))
const aiUsageCreate = vi.fn(async (_a: unknown) => ({ id: "ev1" }))
vi.mock("@/lib/prisma", () => ({
  prisma: { chatTurn: { create: (a: unknown) => chatTurnCreate(a) }, aiUsageEvent: { create: (a: unknown) => aiUsageCreate(a) } },
}))
vi.mock("@/lib/chat/prisma-chat", () => ({
  chatPrisma: { conversation: { findUnique: vi.fn(async () => ({ title: "t" })) } },
}))
vi.mock("@/lib/chat/tools", () => ({ chatTools: {} }))
vi.mock("@/lib/chat/tool-groups", () => ({ activeToolsForPage: () => [], toolsInGroups: () => [] }))
vi.mock("@/lib/chat/tool-group-classifier", () => ({ classifyToolGroups: vi.fn(async () => null) }))
vi.mock("@/lib/chat/data-as-of", () => ({
  asOfForTool: vi.fn(async () => null),
  maxAsOfForTools: vi.fn(async () => null),
  everyToolStamped: () => true,
}))
vi.mock("@/lib/chat/present", () => ({ presentFor: () => null }))
vi.mock("@/lib/chat/answer-cache", () => ({
  answerCacheKey: () => "k",
  readCachedAnswer: vi.fn(async () => null),
  writeCachedAnswer: vi.fn(),
}))
vi.mock("@/lib/chat/conversation", () => ({
  appendMessage: vi.fn(async () => ({ id: "m" })),
  assertConversationAccess: vi.fn(),
  createConversation: vi.fn(async () => ({ id: "conv-1" })),
  getRecentHistory: vi.fn(async () => []),
  setConversationTitle: vi.fn(),
}))
vi.mock("@/lib/chat/system-prompt", () => ({ buildSystemPrompt: vi.fn(async () => "sys") }))
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))
vi.mock("@/lib/chat/auto-title", () => ({ generateConversationTitle: vi.fn(async () => null) }))
vi.mock("@/lib/chat/spend-cap", () => ({
  checkDailyBudget: vi.fn(async () => ({ overBudget: false, spentUsd: 0, budgetUsd: 5 })),
}))

import { getServerSession } from "next-auth"
import { POST } from "@/app/api/chat/route"
import { appendMessage } from "@/lib/chat/conversation"

function req(signal?: AbortSignal) {
  return new Request("http://x/api/chat", {
    method: "POST",
    signal,
    body: JSON.stringify({
      messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "how are sales?" }] }],
      askScope: { pageId: "sales" },
    }),
  })
}

const settle = () => new Promise((r) => setTimeout(r, 30))

function streamOf(parts: unknown[]): ReadableStream<never> {
  return new ReadableStream({
    start(c) {
      for (const p of parts) c.enqueue(p as never)
      c.close()
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getServerSession).mockResolvedValue({
    user: { id: "u1", accountId: "acct-A", role: "OWNER" },
  } as never)
})

describe("POST /api/chat — unfinished turns", () => {
  it("a stream error writes an ERROR ChatTurn and the text already shown, and tells the owner plainly", async () => {
    model.current = new MockLanguageModelV3({
      doStream: async () => ({
        stream: streamOf([
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", delta: "Sales were up " },
          { type: "error", error: new Error("upstream exploded") },
        ]),
      }),
    })
    const res = await POST(req())
    const body = await res.text()
    await settle()

    expect(body).not.toContain("An error occurred.")
    expect(body).toContain("This answer failed before it finished")
    expect(res.headers.get("x-chat-turn-id")).toBeTruthy()

    const turn = (chatTurnCreate.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data
    expect(turn.status).toBe("ERROR")
    expect(turn.id).toBe(res.headers.get("x-chat-turn-id"))
    expect(turn.assistantMessage).toBe("Sales were up")
    expect(String(turn.errorMessage)).toContain("upstream exploded")

    const assistant = vi.mocked(appendMessage).mock.calls.find((c) => c[1].role === "assistant")!
    expect(assistant[1].content).toContain("Sales were up")
    expect(assistant[1].content).toContain("[This answer failed before it finished.]")
  })

  it("a stop (the request aborted) writes a STOPPED ChatTurn and keeps what was shown", async () => {
    const ctl = new AbortController()
    model.current = new MockLanguageModelV3({
      // Like a real provider's fetch: the open stream errors with an
      // AbortError when the signal it was handed fires.
      doStream: async ({ abortSignal }) => ({
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: "stream-start", warnings: [] } as never)
            c.enqueue({ type: "text-start", id: "t" } as never)
            c.enqueue({ type: "text-delta", id: "t", delta: "Half an answer" } as never)
            abortSignal?.addEventListener("abort", () =>
              c.error(new DOMException("The operation was aborted.", "AbortError")),
            )
          },
        }),
      }),
    })
    const res = await POST(req(ctl.signal))
    const reader = res.body!.getReader()
    await reader.read()
    await settle()
    ctl.abort()
    await reader.read().catch(() => undefined)
    await settle()

    const turn = (chatTurnCreate.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data
    expect(turn.status).toBe("STOPPED")
    expect(turn.assistantMessage).toBe("Half an answer")
    const assistant = vi.mocked(appendMessage).mock.calls.find((c) => c[1].role === "assistant")!
    expect(assistant[1].content).toBe("Half an answer\n\n[Stopped before the answer finished.]")
  })

  it("a finished turn stores the text the owner saw and records usage once", async () => {
    model.current = new MockLanguageModelV3({
      doStream: async () => ({
        stream: streamOf([
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", delta: "All good." },
          { type: "text-end", id: "t" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage: {
              inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 10, text: 10, reasoning: 0 },
            },
          },
        ]),
      }),
    })
    const res = await POST(req())
    await res.text()
    await settle()
    expect(chatTurnCreate).toHaveBeenCalledTimes(1)
    const turn = (chatTurnCreate.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data
    expect(turn.status).toBe("OK")
    expect(turn.assistantMessage).toBe("All good.")
    expect(aiUsageCreate).toHaveBeenCalledTimes(1)
  })
})
