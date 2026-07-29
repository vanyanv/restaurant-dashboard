// computeCostUsd is pure (no Prisma), so it's exercised directly without
// mocking the DB. This file exists specifically to verify the pricing-miss
// warning path the ingredient-match-llm certification (2026-07-29) fixed
// for gpt-5.4-nano: before adding a PRICING_PER_MTOK row for it, every
// production adjudicator call would hit the `!p` branch below and silently
// record $0, making real spend invisible in AiUsageEvent.

import { describe, it, expect, vi, afterEach } from "vitest"

// computeCostUsd/PRICING_PER_MTOK don't touch Prisma, but ai-usage.ts
// imports @/lib/prisma at module scope, which throws at import time without
// DATABASE_URL. Mocked per the existing tests/lib/monitoring/ precedent
// (e.g. job-run.test.ts) rather than requiring a real DB connection just to
// exercise a pure pricing function.
vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { computeCostUsd, PRICING_PER_MTOK } from "@/lib/monitoring/ai-usage"

describe("computeCostUsd", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("has a pricing row for gpt-5.4-nano (ADJUDICATOR_MODEL) matching the eval harness's rate", () => {
    // scripts/eval-ingredient-match/llm-pricing.ts#LLM_PRICING_PER_MTOK is
    // the source of truth these numbers were taken from — pinned here so
    // the two tables can't silently drift apart.
    expect(PRICING_PER_MTOK["gpt-5.4-nano"]).toEqual({ in: 0.2, cachedIn: 0.02, out: 1.25 })
  })

  it("computes a nonzero cost for gpt-5.4-nano and does not warn — the pricing-miss path is NOT hit", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    const cost = computeCostUsd("gpt-5.4-nano", 1000, 500, 0)

    // (1000 * 0.20 + 0 * 0.02 + 500 * 1.25) / 1_000_000
    expect(cost).toBeCloseTo(0.000825)
    expect(cost).toBeGreaterThan(0)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it("accounts for cached input tokens at the cached rate for gpt-5.4-nano", () => {
    const cost = computeCostUsd("gpt-5.4-nano", 1000, 500, 200)
    // uncachedIn = 800: (800*0.20 + 200*0.02 + 500*1.25) / 1_000_000
    expect(cost).toBeCloseTo(0.000789)
  })

  it("still warns and records $0 for a genuinely unpriced model — the fallback itself still works", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    const cost = computeCostUsd("some-unpriced-model", 1000, 500, 0)

    expect(cost).toBe(0)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('missing pricing for model "some-unpriced-model"')
    )
  })
})
