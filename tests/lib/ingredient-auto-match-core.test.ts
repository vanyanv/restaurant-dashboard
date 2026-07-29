// ingredient-auto-match-core — the pure L1 exact-match resolver and L3
// acceptance gate. No Prisma, no network, so these are exercised directly
// rather than only indirectly through the orchestrator's mocked-DB tests
// (tests/lib/ingredient-auto-match.test.ts).

import { describe, it, expect } from "vitest"
import {
  resolveLlmDraft,
  resolveExactMatch,
  resolveAutoMatchMode,
} from "@/lib/ingredient-auto-match-core"
import type { MatchCandidate } from "@/lib/ingredient-match-scoring"
import type { AdjudicatorDraft } from "@/lib/ingredient-match-llm"

const draft = (overrides: Partial<AdjudicatorDraft> = {}): AdjudicatorDraft => ({
  caseId: "case-1",
  matchName: "Ground Beef 73/27",
  confidence: 0.9,
  reasoning: "clear match",
  ...overrides,
})

const shortlist: MatchCandidate[] = [
  { canonicalIngredientId: "canon-1", name: "Ground Beef 73/27", score: 0.6 },
  { canonicalIngredientId: "canon-2", name: "Chuck Roll", score: 0.55 },
]

describe("resolveLlmDraft", () => {
  it("accepts a draft at confidence >= llmAccept naming a shortlist member", () => {
    const result = resolveLlmDraft({ shortlist, draft: draft({ confidence: 0.9 }), llmAccept: 0.78 })
    expect(result).toEqual({ canonicalIngredientId: "canon-1", name: "Ground Beef 73/27", score: 0.6 })
  })

  it("accepts at exactly the llmAccept boundary (>=, not >)", () => {
    const result = resolveLlmDraft({ shortlist, draft: draft({ confidence: 0.78 }), llmAccept: 0.78 })
    expect(result).not.toBeNull()
  })

  it("rejects when there is no draft for this case", () => {
    expect(resolveLlmDraft({ shortlist, draft: undefined, llmAccept: 0.78 })).toBeNull()
  })

  it("rejects a null matchName (the model's 'none of these' signal — no auto-create path to route it to)", () => {
    const result = resolveLlmDraft({
      shortlist,
      draft: draft({ matchName: null, confidence: 0.99 }),
      llmAccept: 0.78,
    })
    expect(result).toBeNull()
  })

  it("rejects confidence below llmAccept", () => {
    const result = resolveLlmDraft({ shortlist, draft: draft({ confidence: 0.77 }), llmAccept: 0.78 })
    expect(result).toBeNull()
  })

  it("rejects NaN confidence — the gate must fail CLOSED, not open, on untrusted model output", () => {
    // `confidence < llmAccept` is false for NaN (NaN compares false against
    // everything), so a `<`-based gate silently ACCEPTS a NaN confidence.
    // The gate must be written as `!(confidence >= llmAccept)` so NaN (which
    // also fails `>=`) is rejected. This is the caller's own gate — the
    // parser is documented to already filter non-finite values, but that's
    // the parser's contract, not this gate's, and this test exercises the
    // gate on its own regardless of what upstream currently guarantees.
    const result = resolveLlmDraft({
      shortlist,
      draft: draft({ confidence: NaN }),
      llmAccept: 0.78,
    })
    expect(result).toBeNull()
  })

  it("rejects a matchName not present in THIS group's own shortlist (hallucinated or borrowed from another case)", () => {
    const result = resolveLlmDraft({
      shortlist,
      draft: draft({ matchName: "Frying Oil Shortening", confidence: 0.99 }),
      llmAccept: 0.78,
    })
    expect(result).toBeNull()
  })
})

describe("resolveExactMatch", () => {
  it("returns null when neither index has this name", () => {
    expect(resolveExactMatch("kosher salt", new Map(), new Map())).toBeNull()
  })

  it("returns the single canonical id when the canonical-name index has exactly one hit", () => {
    const canonicalByName = new Map([["kosher salt", new Set(["canon-1"])]])
    const result = resolveExactMatch("kosher salt", canonicalByName, new Map())
    expect(result).toEqual({ canonicalIngredientId: "canon-1" })
  })

  it("returns ambiguous when the canonical-name index has more than one hit (case-insensitive collision)", () => {
    // "Ground Beef" and "ground beef" can coexist — CanonicalIngredient's
    // per-account uniqueness is case-sensitive in Postgres.
    const canonicalByName = new Map([["ground beef", new Set(["canon-fresh", "canon-frozen"])]])
    const result = resolveExactMatch("ground beef", canonicalByName, new Map())
    expect(result).toEqual({ ambiguous: true })
  })

  it("falls back to the alias index when there is no canonical-name hit", () => {
    const aliasByName = new Map([["chkn brst 40#", new Set(["canon-1"])]])
    const result = resolveExactMatch("chkn brst 40#", new Map(), aliasByName)
    expect(result).toEqual({ canonicalIngredientId: "canon-1" })
  })

  it("returns ambiguous when the alias index has more than one hit (same raw name, different stores)", () => {
    // IngredientAlias is unique per (storeId, rawName), not per account, so
    // Hollywood and Glendale can legitimately alias the same raw string to
    // different canonicals.
    const aliasByName = new Map([["chkn brst 40#", new Set(["canon-fresh", "canon-frozen"])]])
    const result = resolveExactMatch("chkn brst 40#", new Map(), aliasByName)
    expect(result).toEqual({ ambiguous: true })
  })

  it("prefers a canonical-name hit over an alias hit when both exist", () => {
    const canonicalByName = new Map([["kosher salt", new Set(["canon-1"])]])
    const aliasByName = new Map([["kosher salt", new Set(["canon-2"])]])
    const result = resolveExactMatch("kosher salt", canonicalByName, aliasByName)
    expect(result).toEqual({ canonicalIngredientId: "canon-1" })
  })
})

describe("resolveAutoMatchMode", () => {
  it("defaults to off when the variable is unset", () => {
    expect(resolveAutoMatchMode(undefined)).toBe("off")
  })

  it("defaults to off for an empty or whitespace-only value", () => {
    expect(resolveAutoMatchMode("")).toBe("off")
    expect(resolveAutoMatchMode("   ")).toBe("off")
  })

  it("reads the two enabling values", () => {
    expect(resolveAutoMatchMode("shadow")).toBe("shadow")
    expect(resolveAutoMatchMode("on")).toBe("on")
  })

  it("is case- and whitespace-insensitive", () => {
    expect(resolveAutoMatchMode("  ON  ")).toBe("on")
    expect(resolveAutoMatchMode("Shadow")).toBe("shadow")
  })

  it("fails safe to off on anything unrecognised", () => {
    // A typo must never be read as consent to write. "true"/"1"/"yes" are
    // the plausible near-misses an operator would reach for, and none of
    // them are the documented vocabulary.
    for (const raw of ["true", "1", "yes", "enabled", "live", "of", "shadowed"]) {
      expect(resolveAutoMatchMode(raw)).toBe("off")
    }
  })
})
