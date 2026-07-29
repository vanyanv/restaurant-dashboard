// ingredient-match-llm — prompt assembly + response narrowing for the
// vendor-invoice-line -> canonical-ingredient LLM adjudicator. Pure functions
// get exercised directly; the OpenAI round-trip in `adjudicate` is exercised
// against a mocked client so no test makes a live call or spends API credit.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockCreate = vi.hoisted(() => vi.fn())

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(function MockOpenAI(this: {
    chat: { completions: { create: typeof mockCreate } }
  }) {
    this.chat = { completions: { create: mockCreate } }
  }),
}))

vi.mock("@/lib/monitoring/ai-usage", () => ({
  recordAiUsage: vi.fn().mockResolvedValue("usage-event-id"),
}))

import OpenAI from "openai"
import {
  adjudicate,
  buildAdjudicatorPrompt,
  parseAdjudicatorDrafts,
  ADJUDICATOR_MODEL,
  type AdjudicatorCase,
} from "@/lib/ingredient-match-llm"
import { recordAiUsage } from "@/lib/monitoring/ai-usage"
import { logger } from "@/lib/logger"

const CASES: AdjudicatorCase[] = [
  {
    caseId: "case-1",
    productName: "Heavy Cream 40%",
    vendorName: "Sysco",
    unit: "qt",
    candidates: [
      { name: "Heavy Cream", score: 0.81 },
      { name: "Half and Half", score: 0.74 },
    ],
  },
]

describe("buildAdjudicatorPrompt", () => {
  it("includes each case's product info and its own candidates", () => {
    const prompt = buildAdjudicatorPrompt({ cases: CASES })
    expect(prompt).toContain("case-1")
    expect(prompt).toContain("Heavy Cream 40%")
    expect(prompt).toContain("Sysco")
    expect(prompt).toContain("Heavy Cream")
    expect(prompt).toContain("Half and Half")
  })

  it("never leaks one case's candidates into another case's section", () => {
    const cases: AdjudicatorCase[] = [
      ...CASES,
      {
        caseId: "case-2",
        productName: "Whole Milk",
        vendorName: "US Foods",
        unit: "gal",
        candidates: [{ name: "Whole Milk", score: 0.92 }],
      },
    ]
    const prompt = buildAdjudicatorPrompt({ cases })
    const case1Section = prompt.slice(prompt.indexOf("Case case-1"), prompt.indexOf("Case case-2"))
    expect(case1Section).not.toContain("Whole Milk")
  })
})

describe("parseAdjudicatorDrafts", () => {
  it("parses well-formed drafts", () => {
    const drafts = parseAdjudicatorDrafts(
      JSON.stringify({
        drafts: [
          {
            caseId: "case-1",
            matchName: "Heavy Cream",
            confidence: 0.9,
            reasoning: "exact product match",
          },
        ],
      })
    )
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({
      caseId: "case-1",
      matchName: "Heavy Cream",
      confidence: 0.9,
    })
  })

  it("returns [] on malformed JSON", () => {
    expect(parseAdjudicatorDrafts("not json")).toEqual([])
    expect(parseAdjudicatorDrafts("{ unterminated")).toEqual([])
  })

  it("returns [] when the drafts key is missing or not an array", () => {
    expect(parseAdjudicatorDrafts(JSON.stringify({ nope: true }))).toEqual([])
    expect(parseAdjudicatorDrafts(JSON.stringify({ drafts: "oops" }))).toEqual([])
    expect(parseAdjudicatorDrafts(JSON.stringify({ drafts: { caseId: "case-1" } }))).toEqual([])
  })

  it("drops a draft with a non-numeric confidence", () => {
    const drafts = parseAdjudicatorDrafts(
      JSON.stringify({
        drafts: [
          { caseId: "case-1", matchName: "Heavy Cream", confidence: "high", reasoning: "" },
        ],
      })
    )
    expect(drafts).toEqual([])
  })

  it("clamps confidence into [0, 1]", () => {
    const over = parseAdjudicatorDrafts(
      JSON.stringify({
        drafts: [{ caseId: "case-1", matchName: "Heavy Cream", confidence: 5, reasoning: "" }],
      })
    )
    expect(over[0].confidence).toBe(1)

    const under = parseAdjudicatorDrafts(
      JSON.stringify({
        drafts: [{ caseId: "case-1", matchName: "Heavy Cream", confidence: -3, reasoning: "" }],
      })
    )
    expect(under[0].confidence).toBe(0)
  })

  it("keeps matchName: null with a newIngredient block intact", () => {
    const drafts = parseAdjudicatorDrafts(
      JSON.stringify({
        drafts: [
          {
            caseId: "case-1",
            matchName: null,
            confidence: 0.6,
            reasoning: "none of the candidates are this product",
            newIngredient: { name: "Oat Milk", category: "Dairy Alt", recipeUnit: "qt" },
          },
        ],
      })
    )
    expect(drafts).toHaveLength(1)
    expect(drafts[0].matchName).toBeNull()
    expect(drafts[0].newIngredient).toEqual({
      name: "Oat Milk",
      category: "Dairy Alt",
      recipeUnit: "qt",
    })
  })

  it("returns a matchName absent from that case's shortlist as-is — the parser does not police membership", () => {
    // The parser only sees the raw JSON string, not the case's candidate
    // list, so it cannot and must not police whether matchName was actually
    // offered. That's the caller's job once it re-resolves against the DB.
    const drafts = parseAdjudicatorDrafts(
      JSON.stringify({
        drafts: [
          {
            caseId: "case-1",
            matchName: "Ingredient Never Offered As A Candidate",
            confidence: 0.8,
            reasoning: "hallucinated match",
          },
        ],
      })
    )
    expect(drafts).toHaveLength(1)
    expect(drafts[0].matchName).toBe("Ingredient Never Offered As A Candidate")
  })

  it("drops a draft missing caseId", () => {
    const drafts = parseAdjudicatorDrafts(
      JSON.stringify({
        drafts: [{ matchName: "Heavy Cream", confidence: 0.9, reasoning: "" }],
      })
    )
    expect(drafts).toEqual([])
  })

  it("drops non-object entries but keeps valid siblings", () => {
    const drafts = parseAdjudicatorDrafts(
      JSON.stringify({
        drafts: [
          null,
          "oops",
          42,
          { caseId: "case-1", matchName: "Heavy Cream", confidence: 0.9, reasoning: "" },
        ],
      })
    )
    expect(drafts).toHaveLength(1)
    expect(drafts[0].caseId).toBe("case-1")
  })

  it("drops the newIngredient block when matchName is a real match, even if the model sent one", () => {
    const drafts = parseAdjudicatorDrafts(
      JSON.stringify({
        drafts: [
          {
            caseId: "case-1",
            matchName: "Heavy Cream",
            confidence: 0.9,
            reasoning: "match",
            newIngredient: { name: "Oat Milk", category: "Dairy Alt", recipeUnit: "qt" },
          },
        ],
      })
    )
    expect(drafts[0].matchName).toBe("Heavy Cream")
    expect(drafts[0].newIngredient).toBeUndefined()
  })
})

describe("adjudicate", () => {
  const originalKey = process.env.OPENAI_API_KEY

  beforeEach(() => {
    mockCreate.mockReset()
    vi.mocked(recordAiUsage).mockClear()
    process.env.OPENAI_API_KEY = "test-key"
  })

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalKey
  })

  it("parses the model response and records usage against the default model", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              drafts: [
                { caseId: "case-1", matchName: "Heavy Cream", confidence: 0.9, reasoning: "match" },
              ],
            }),
          },
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    })

    const result = await adjudicate({ cases: CASES, storeId: "store-1", userId: "user-1" })

    expect(result.drafts).toHaveLength(1)
    expect(result.drafts[0].caseId).toBe("case-1")
    // Pins the certified model — a swap here must fail a test, not slip
    // through a `toBeTruthy()` that any non-empty string satisfies.
    expect(result.model).toBe(ADJUDICATOR_MODEL)
    expect(recordAiUsage).toHaveBeenCalledTimes(1)
    expect(recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai",
        model: result.model,
        storeId: "store-1",
        userId: "user-1",
      })
    )
  })

  it("uses a model override instead of the default when provided", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ drafts: [] }) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    })

    const result = await adjudicate({ cases: CASES, model: "gpt-4o-mini" })
    expect(result.model).toBe("gpt-4o-mini")
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-4o-mini" }))
  })

  it("never throws and returns an empty result when the OpenAI call rejects", async () => {
    mockCreate.mockRejectedValue(new Error("rate limited"))
    const result = await adjudicate({ cases: CASES })
    expect(result.drafts).toEqual([])
  })

  it("never throws and returns an empty result when the API key is missing", async () => {
    delete process.env.OPENAI_API_KEY
    const result = await adjudicate({ cases: CASES })
    expect(result.drafts).toEqual([])
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("sends reasoning-model params for the default (reasoning) model, not temperature/max_tokens", async () => {
    // ADJUDICATOR_MODEL is gpt-5.4-nano, a reasoning-capable model. Getting
    // this branch wrong silently zeroes out every production adjudication
    // (the model call 400s, caught, resolved to []) — this is the test that
    // would have caught the original ADJUDICATOR_MODEL swap regression.
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ drafts: [] }) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    })

    await adjudicate({ cases: CASES })

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: ADJUDICATOR_MODEL,
        max_completion_tokens: 32_000,
        reasoning_effort: "low",
      })
    )
    const callArgs = mockCreate.mock.calls[0][0]
    expect(callArgs).not.toHaveProperty("temperature")
    expect(callArgs).not.toHaveProperty("max_tokens")
  })

  it("sends temperature/max_tokens for a non-reasoning model override, not reasoning params", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ drafts: [] }) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    })

    await adjudicate({ cases: CASES, model: "gpt-4.1-mini" })

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4.1-mini",
        temperature: 0.2,
        max_tokens: 4000,
      })
    )
    const callArgs = mockCreate.mock.calls[0][0]
    expect(callArgs).not.toHaveProperty("max_completion_tokens")
    expect(callArgs).not.toHaveProperty("reasoning_effort")
  })

  it("constructs the OpenAI client with the raised timeout the bake-off validated", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ drafts: [] }) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    })

    await adjudicate({ cases: CASES })

    // gpt-5.4-nano measured 54.3s for an 88-case batch
    // (runs/2026-07-28-1646-llm.md); 300_000ms matches what the eval
    // harness itself uses, not the 60_000ms this file previously shipped.
    expect(vi.mocked(OpenAI)).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 300_000 })
    )
  })

  it("treats finish_reason 'length' as truncation: discards drafts and logs an error, doesn't read partial content", async () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {})
    mockCreate.mockResolvedValue({
      choices: [
        {
          finish_reason: "length",
          message: { content: '{"drafts": [{"caseId": "case-1", "matchName": "Heavy Cream"' },
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 32_000 },
    })

    const result = await adjudicate({ cases: CASES })

    expect(result.drafts).toEqual([])
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("truncated"))
    // The call still cost money — usage is still recorded even though the
    // content is discarded.
    expect(recordAiUsage).toHaveBeenCalledTimes(1)
    errorSpy.mockRestore()
  })

  it("chunks more than MAX_CASES_PER_REQUEST cases into multiple requests and merges the drafts", async () => {
    const manyCases: AdjudicatorCase[] = Array.from({ length: 81 }, (_, i) => ({
      caseId: `case-${i}`,
      productName: `Product ${i}`,
      vendorName: "Sysco",
      unit: "CS",
      candidates: [{ name: `Candidate ${i}`, score: 0.6 }],
    }))

    mockCreate
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                drafts: [{ caseId: "case-0", matchName: "Candidate 0", confidence: 0.8, reasoning: "" }],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                drafts: [{ caseId: "case-80", matchName: "Candidate 80", confidence: 0.8, reasoning: "" }],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      })

    const result = await adjudicate({ cases: manyCases })

    // 81 cases at a cap of 80 per request must produce exactly 2 requests —
    // one giant request was never validated against the bake-off's measured
    // shape.
    expect(mockCreate).toHaveBeenCalledTimes(2)
    const firstChunkPrompt = mockCreate.mock.calls[0][0].messages[0].content
    expect(firstChunkPrompt).toContain("Case case-79")
    expect(firstChunkPrompt).not.toContain("Case case-80")
    expect(result.drafts.map((d) => d.caseId)).toEqual(["case-0", "case-80"])
  })
})
