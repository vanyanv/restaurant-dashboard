/*
 * Every OpenAI call the chat makes is recorded in AiUsageEvent, so the daily
 * spend cap (which sums that table) can see it. Before 2026-11-20 the tool
 * group classifier, the auto-title call and every embedding were unrecorded.
 *
 * And the classifier: no retries (the shared client retries twice, tripling
 * a 2.5 s timeout), and a failure is not cached for the life of the instance.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const create = vi.fn()
const embCreate = vi.fn()
vi.mock("@/lib/chat/openai-client", () => ({
  getChatOpenAIClient: () => ({ chat: { completions: { create } }, embeddings: { create: embCreate } }),
  CHAT_CLASSIFIER_MODEL: "gpt-4.1-mini",
  CHAT_TITLE_MODEL: "gpt-4.1-mini",
  CHAT_EMBEDDING_MODEL: "text-embedding-3-small",
  CHAT_EMBEDDING_DIMS: 2,
}))
vi.mock("@/lib/monitoring/ai-usage", () => ({ recordAiUsage: vi.fn(async () => "ev") }))
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { recordAiUsage } from "@/lib/monitoring/ai-usage"
import { classifyToolGroups } from "@/lib/chat/tool-group-classifier"
import { generateConversationTitle } from "@/lib/chat/auto-title"
import { embed, embedBatch } from "@/lib/chat/embeddings"

const usage = { prompt_tokens: 120, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 0 } }

beforeEach(() => {
  vi.clearAllMocks()
})

describe("tool-group classifier", () => {
  it("calls with maxRetries 0 and records its usage against the asker", async () => {
    create.mockResolvedValueOnce({ choices: [{ message: { content: "sales" } }], usage })
    expect(await classifyToolGroups("billing question one", "u1")).toEqual(["sales"])
    expect(create.mock.calls[0][1]).toMatchObject({ maxRetries: 0, timeout: 2_500 })
    expect(recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ feature: "chat-classifier", model: "gpt-4.1-mini", inputTokens: 120, outputTokens: 4, userId: "u1" }),
    )
  })

  it("does not cache a failure: the same question is asked again next time", async () => {
    create.mockRejectedValueOnce(new Error("timeout"))
    expect(await classifyToolGroups("billing question two", "u1")).toBeNull()
    create.mockResolvedValueOnce({ choices: [{ message: { content: "labor" } }], usage })
    expect(await classifyToolGroups("billing question two", "u1")).toEqual(["labor"])
    expect(create).toHaveBeenCalledTimes(2)
  })

  it("still caches a successful answer", async () => {
    create.mockResolvedValueOnce({ choices: [{ message: { content: "menu" } }], usage })
    await classifyToolGroups("billing question three", "u1")
    await classifyToolGroups("billing question three", "u1")
    expect(create).toHaveBeenCalledTimes(1)
  })
})

describe("auto-title", () => {
  it("records the title call", async () => {
    create.mockResolvedValueOnce({ choices: [{ message: { content: "Sales this week" } }], usage })
    expect(await generateConversationTitle("how are sales", "fine", "u1")).toBe("Sales this week")
    expect(recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ feature: "chat-title", inputTokens: 120, userId: "u1" }),
    )
  })
})

describe("embeddings", () => {
  it("records embed() and embedBatch() with the caller's billing", async () => {
    embCreate.mockResolvedValueOnce({ data: [{ embedding: [1, 2], index: 0 }], usage: { prompt_tokens: 7 } })
    await embed("beef", { feature: "chat-search", userId: "u1" })
    await new Promise((r) => setTimeout(r, 10))
    expect(recordAiUsage).toHaveBeenLastCalledWith(
      expect.objectContaining({ feature: "chat-search", model: "text-embedding-3-small", inputTokens: 7, userId: "u1" }),
    )
    embCreate.mockResolvedValueOnce({ data: [{ embedding: [1, 2], index: 0 }], usage: { prompt_tokens: 3 } })
    await embedBatch(["x"])
    await new Promise((r) => setTimeout(r, 10))
    expect(recordAiUsage).toHaveBeenLastCalledWith(
      expect.objectContaining({ feature: "embedding", inputTokens: 3, userId: null }),
    )
  })
})
