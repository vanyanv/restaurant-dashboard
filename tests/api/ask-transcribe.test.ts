/*
 * The mic route checks the daily AI cap before it calls OpenAI, and never
 * prices a transcription from the client's `seconds` field.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(async () => null), RATE_LIMIT_TIERS: { moderate: {} } }))
const transcribe = vi.fn()
vi.mock("@/lib/chat/openai-client", () => ({
  getChatOpenAIClient: () => ({ audio: { transcriptions: { create: transcribe } } }),
}))
vi.mock("@/lib/monitoring/ai-usage", () => ({
  recordAiUsage: vi.fn(async () => "ev"),
  PRICING_PER_MINUTE: { "gpt-4o-mini-transcribe": 0.003 },
}))
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock("@/lib/chat/spend-cap", () => ({ checkDailyBudget: vi.fn() }))

import { getServerSession } from "next-auth"
import { POST } from "@/app/api/ask/transcribe/route"
import { recordAiUsage } from "@/lib/monitoring/ai-usage"
import { checkDailyBudget } from "@/lib/chat/spend-cap"

function req(seconds = "600") {
  const form = new FormData()
  form.set("audio", new File([new Uint8Array([1, 2, 3])], "q.webm", { type: "audio/webm" }))
  form.set("seconds", seconds)
  return new Request("http://x/api/ask/transcribe", { method: "POST", body: form })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: "u1", accountId: "acct-A" } } as never)
  vi.mocked(checkDailyBudget).mockResolvedValue({ overBudget: false, spentUsd: 0, budgetUsd: 5 })
})

describe("POST /api/ask/transcribe", () => {
  it("refuses over budget without calling OpenAI", async () => {
    vi.mocked(checkDailyBudget).mockResolvedValue({ overBudget: true, spentUsd: 9, budgetUsd: 5 })
    const res = await POST(req())
    expect(res.status).toBe(429)
    expect(((await res.json()) as { error: string }).error).toMatch(/daily AI limit/)
    expect(transcribe).not.toHaveBeenCalled()
    expect(checkDailyBudget).toHaveBeenCalledWith("acct-A")
  })

  it("prices a reported duration per minute, ignoring the client's seconds", async () => {
    transcribe.mockResolvedValue({ text: " hello ", usage: { type: "duration", seconds: 30 } })
    const res = await POST(req("6000"))
    expect(await res.json()).toEqual({ text: "hello" })
    expect(transcribe.mock.calls[0][0].response_format).toBe("json")
    const rec = vi.mocked(recordAiUsage).mock.calls[0][0]
    expect(rec.costUsd).toBeCloseTo(0.5 * 0.003, 9)
  })

  it("records token usage (priced by the token table) when OpenAI reports tokens", async () => {
    transcribe.mockResolvedValue({ text: "hi", usage: { type: "tokens", input_tokens: 50, output_tokens: 5, total_tokens: 55 } })
    await POST(req("6000"))
    const rec = vi.mocked(recordAiUsage).mock.calls[0][0]
    expect(rec.costUsd).toBeUndefined()
    expect(rec.inputTokens).toBe(50)
    expect(rec.outputTokens).toBe(5)
  })
})
