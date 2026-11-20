/*
 * An over-budget turn that misses the answer cache is refused — and leaves
 * nothing behind. It used to create the conversation and store the question
 * before the refusal, so every refused turn left an empty "Untitled" thread
 * (or a question with no answer) in the rail.
 *
 * And a stream error reaches the owner as a sentence they can act on, not the
 * SDK's "An error occurred.".
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {}, hasOwnerAccess: () => true }))
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(async () => null), RATE_LIMIT_TIERS: { moderate: {} } }))
vi.mock("@/lib/prisma", () => ({ prisma: { chatTurn: { create: vi.fn() }, aiUsageEvent: { create: vi.fn() } } }))
vi.mock("@/lib/chat/prisma-chat", () => ({
  chatPrisma: {
    chatTurn: { create: vi.fn(async () => ({})) },
    conversation: { findUnique: vi.fn(async () => ({ title: "t" })) },
  },
}))
vi.mock("@/lib/chat/tools", () => ({ chatTools: {} }))
vi.mock("@/lib/chat/tool-groups", () => ({ activeToolsForPage: () => ["getDailySales"], toolsInGroups: () => [] }))
vi.mock("@/lib/chat/tool-group-classifier", () => ({ classifyToolGroups: vi.fn(async () => null) }))
vi.mock("@/lib/chat/data-as-of", () => ({
  asOfForTool: vi.fn(async () => null),
  maxAsOfForTools: vi.fn(async () => "2026-11-20T00:00:00.000Z"),
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
  createConversation: vi.fn(async () => ({ id: "conv-new" })),
  getRecentHistory: vi.fn(async () => []),
  setConversationTitle: vi.fn(),
}))
vi.mock("@/lib/chat/system-prompt", () => ({ buildSystemPrompt: vi.fn(async () => "sys") }))
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))
vi.mock("@/lib/chat/auto-title", () => ({ generateConversationTitle: vi.fn() }))
vi.mock("@/lib/chat/spend-cap", () => ({ checkDailyBudget: vi.fn() }))

import { getServerSession } from "next-auth"
import { POST } from "@/app/api/chat/route"
import { appendMessage, createConversation } from "@/lib/chat/conversation"
import { readCachedAnswer } from "@/lib/chat/answer-cache"
import { checkDailyBudget } from "@/lib/chat/spend-cap"
import { ownerErrorMessage } from "@/lib/chat/turn-record"

function req() {
  return new Request("http://x/api/chat", {
    method: "POST",
    body: JSON.stringify({
      messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "sales yesterday?" }] }],
      askScope: { pageId: "sales" },
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getServerSession).mockResolvedValue({
    user: { id: "u1", accountId: "acct-A", role: "OWNER" },
  } as never)
  vi.mocked(checkDailyBudget).mockResolvedValue({ overBudget: true, spentUsd: 6, budgetUsd: 5 })
})

describe("POST /api/chat over budget", () => {
  it("refuses a cache miss without creating a conversation or storing the question", async () => {
    const res = await POST(req())
    expect(res.status).toBe(429)
    expect(createConversation).not.toHaveBeenCalled()
    expect(appendMessage).not.toHaveBeenCalled()
  })

  it("still serves a cache hit, and only then creates the thread and stores both sides", async () => {
    vi.mocked(readCachedAnswer).mockResolvedValue({
      text: "Sales were $1,000.",
      toolCalls: [],
      costUsd: null,
      storedAt: "2026-11-20T00:00:00.000Z",
    } as never)
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(res.headers.get("x-conversation-id")).toBe("conv-new")
    expect(createConversation).toHaveBeenCalledTimes(1)
    const roles = vi.mocked(appendMessage).mock.calls.map((c) => c[1].role)
    expect(roles).toEqual(["user", "assistant"])
  })
})

describe("ownerErrorMessage", () => {
  it("never says only 'An error occurred.'", () => {
    for (const e of [new Error("boom"), new Error("429 Rate limit reached"), new Error("Request timed out"), "x"]) {
      const m = ownerErrorMessage(e)
      expect(m).not.toBe("An error occurred.")
      expect(m.length).toBeGreaterThan(30)
    }
    expect(ownerErrorMessage(new Error("429 Rate limit reached"))).toMatch(/rate-limiting/)
  })
})
