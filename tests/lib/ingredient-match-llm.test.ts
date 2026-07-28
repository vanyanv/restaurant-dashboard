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

import {
  adjudicate,
  buildAdjudicatorPrompt,
  parseAdjudicatorDrafts,
  type AdjudicatorCase,
} from "@/lib/ingredient-match-llm"
import { recordAiUsage } from "@/lib/monitoring/ai-usage"

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
    expect(result.model).toBeTruthy()
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
})
