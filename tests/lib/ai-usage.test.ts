// A pricing miss is silent by design: computeCostUsd warns and records $0 so a
// new model can never crash a request. That is the right call at the call site
// and the wrong one for the ledger — the feature's spend simply never appears
// in AiUsageEvent, and the only symptom is a console line in a serverless log.
//
// It has already happened once: the comment above PRICING_PER_MTOK records
// gpt-5.4-nano being added specifically to stop the adjudicator writing $0 from
// day one. It happened again with CHAT_ROUTING_MODEL, which defaults to
// gpt-5-mini and had no row — so every chat turn, the heaviest LLM call in the
// product at up to 15 tool steps against a 58-tool catalogue, has been booking
// zero. Found by the golden-set runner, which reports its own spend and had to
// print "unpriced" for it.
//
// This is the check that stops the third occurrence: every model constant the
// app can actually send traffic to must have a rate.

import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { PRICING_PER_MTOK, computeCostUsd } from "@/lib/monitoring/ai-usage"
import { VERDICT_MODEL } from "@/lib/decision-verdict-llm"
import { PROPOSAL_MODEL } from "@/lib/proposal-llm"
import { ADJUDICATOR_MODEL } from "@/lib/ingredient-match-llm"
import { CHAT_ROUTING_MODEL } from "@/lib/chat/openai-client"

const SHIPPED_MODELS: Record<string, string> = {
  "decision-verdict": VERDICT_MODEL,
  "mapping-proposals": PROPOSAL_MODEL,
  "ingredient-adjudicator": ADJUDICATOR_MODEL,
  chat: CHAT_ROUTING_MODEL,
}

describe("every model the app sends traffic to has a published rate", () => {
  for (const [feature, model] of Object.entries(SHIPPED_MODELS)) {
    it(`${feature} → ${model}`, () => {
      expect(
        Object.keys(PRICING_PER_MTOK),
        `"${model}" has no row in PRICING_PER_MTOK, so every ${feature} call ` +
          `records $0 and that feature's spend is invisible in AiUsageEvent. ` +
          `Add the rate from https://developers.openai.com/api/docs/pricing.`,
      ).toContain(model)
    })
  }

  it("prices a call at a non-zero amount once tokens are spent", () => {
    // Guards the other half: a row that exists but is all zeros would satisfy
    // the check above and still book nothing.
    for (const model of Object.values(SHIPPED_MODELS)) {
      expect(computeCostUsd(model, 10_000, 2_000, 0), model).toBeGreaterThan(0)
    }
  })

  it("charges the cached rate for the cached portion of the input", () => {
    const full = computeCostUsd(CHAT_ROUTING_MODEL, 10_000, 0, 0)
    const cached = computeCostUsd(CHAT_ROUTING_MODEL, 10_000, 0, 10_000)
    expect(cached).toBeLessThan(full)
    expect(cached).toBeGreaterThan(0)
  })
})
