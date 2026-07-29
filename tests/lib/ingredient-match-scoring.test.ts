import { describe, it, expect } from "vitest"
import {
  classifyCandidates, buildMatchQueryText, THRESHOLDS,
  type MatchCandidate,
} from "@/lib/ingredient-match-scoring"

const c = (name: string, score: number): MatchCandidate => ({
  canonicalIngredientId: `id-${name}`, name, score,
})

describe("classifyCandidates", () => {
  it("auto-links a clear winner above HIGH with sufficient margin", () => {
    const r = classifyCandidates([c("Ground Beef 73/27", 0.95), c("Ground Beef 80/20", 0.80)])
    expect(r.kind).toBe("auto")
    if (r.kind === "auto") {
      expect(r.candidate.name).toBe("Ground Beef 73/27")
      expect(r.margin).toBeCloseTo(0.15)
    }
  })

  it("refuses to auto-link a near-tie even when both score very high", () => {
    // The load-bearing guard: "GRND BEEF 73/27" must not silently pick a grade.
    // Margin (0.005) is deliberately well under MARGIN (0.01), not sitting on
    // the boundary — the boundary itself is pinned separately below.
    const r = classifyCandidates([c("Ground Beef 73/27", 0.85), c("Ground Beef 80/20", 0.845)])
    expect(r.kind).toBe("ambiguous")
  })

  it("sends the mid band to the adjudicator", () => {
    // Below HIGH (0.72) but above FLOOR (0.48) — the real ambiguous band.
    const r = classifyCandidates([c("Ground Beef 73/27", 0.60), c("Chuck Roll", 0.50)])
    expect(r.kind).toBe("ambiguous")
  })

  it("reports 'new' when every candidate is below FLOOR", () => {
    const r = classifyCandidates([c("Ground Beef 73/27", 0.40), c("Chuck Roll", 0.30)])
    expect(r.kind).toBe("new")
  })

  it("reports 'new' for an empty pantry", () => {
    expect(classifyCandidates([]).kind).toBe("new")
  })

  it("auto-links a lone high-scoring candidate (no runner-up to tie with)", () => {
    expect(classifyCandidates([c("Kosher Salt", 0.97)]).kind).toBe("auto")
  })

  it("does not assume input is sorted", () => {
    const r = classifyCandidates([c("Chuck Roll", 0.40), c("Kosher Salt", 0.97)])
    expect(r.kind).toBe("auto")
    if (r.kind === "auto") expect(r.candidate.name).toBe("Kosher Salt")
  })

  it("caps the ambiguous shortlist at five candidates", () => {
    const many = Array.from({ length: 12 }, (_, i) => c(`ing-${i}`, 0.80 - i * 0.001))
    const r = classifyCandidates(many)
    expect(r.kind).toBe("ambiguous")
    if (r.kind === "ambiguous") expect(r.candidates).toHaveLength(5)
  })

  it("honours injected thresholds", () => {
    const strict = { ...THRESHOLDS, HIGH: 0.99 }
    expect(classifyCandidates([c("Kosher Salt", 0.95)], strict).kind).toBe("ambiguous")
  })

  describe("threshold boundary pins (explicit literals to catch regressions)", () => {
    it("auto-links at exactly HIGH (0.72) with sufficient margin", () => {
      // Pins `top.score >= HIGH` (not `>`). Literal 0.72, not computed from THRESHOLDS.
      const r = classifyCandidates([c("candidate", 0.72), c("runner-up", 0.70)])
      expect(r.kind).toBe("auto")
    })

    it("rejects just below HIGH (0.7199) even with sufficient margin", () => {
      // Pins `>= HIGH` boundary. Literal 0.7199.
      const r = classifyCandidates([c("candidate", 0.7199), c("runner-up", 0.60)])
      expect(r.kind).toBe("ambiguous")
    })

    it("auto-links with margin exactly at MARGIN threshold (0.01)", () => {
      // Pins `margin >= MARGIN` (not `>`). Use 0.73 - 0.72: verified in Node
      // this evaluates to 0.010000000000000009 (>= 0.01), not the kind of
      // float pair (like 0.95 - 0.90) that lands a hair under the literal.
      const r = classifyCandidates([c("candidate", 0.73), c("runner-up", 0.72)])
      expect(r.kind).toBe("auto")
      if (r.kind === "auto") expect(r.margin).toBeCloseTo(0.01)
    })

    it("rejects margin just below MARGIN threshold (0.0099)", () => {
      // Pins `>= MARGIN` boundary. 0.75 - 0.7401 verified in Node as
      // 0.00990000000000002, strictly below 0.01. Both scores stay above
      // HIGH so the rejection is attributable to MARGIN alone.
      const r = classifyCandidates([c("candidate", 0.75), c("runner-up", 0.7401)])
      expect(r.kind).toBe("ambiguous")
    })

    it("does not treat exactly FLOOR (0.48) as 'new'", () => {
      // Pins `top.score < FLOOR` (not `<=`). Literal 0.48. Must not be new,
      // goes to ambiguous since it's also below HIGH with no runner-up margin.
      const r = classifyCandidates([c("candidate", 0.48)])
      expect(r.kind).toBe("ambiguous")
    })

    it("treats just below FLOOR (0.4799) as 'new'", () => {
      // Pins `< FLOOR` boundary. Literal 0.4799.
      const r = classifyCandidates([c("candidate", 0.4799)])
      expect(r.kind).toBe("new")
    })
  })

  describe("immutability: input array is never mutated", () => {
    it("preserves input array order after sorting internally", () => {
      // Snapshot input order by id. If classifyCandidates does candidates.sort()
      // in place rather than [...candidates].sort(), this test fails loudly.
      const input = [
        c("zebra", 0.60),
        c("alpha", 0.95),
        c("beta", 0.85),
      ]
      const originalOrder = input.map(x => x.canonicalIngredientId)

      classifyCandidates(input)

      const afterOrder = input.map(x => x.canonicalIngredientId)
      expect(afterOrder).toEqual(originalOrder)
    })
  })
})

describe("buildMatchQueryText", () => {
  it("includes product, vendor and unit", () => {
    const t = buildMatchQueryText({
      productName: "GRND BEEF 73/27", vendorName: "Sysco", unit: "CS",
    })
    expect(t).toContain("GRND BEEF 73/27")
    expect(t).toContain("Sysco")
    expect(t).toContain("CS")
  })

  it("omits a null unit without leaving a dangling separator", () => {
    const t = buildMatchQueryText({ productName: "Kosher Salt", vendorName: "Sysco", unit: null })
    expect(t).not.toMatch(/\|\s*$/)
  })
})
