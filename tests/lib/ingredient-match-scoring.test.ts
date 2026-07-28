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
    const r = classifyCandidates([c("Ground Beef 73/27", 0.93), c("Ground Beef 80/20", 0.92)])
    expect(r.kind).toBe("ambiguous")
  })

  it("sends the mid band to the adjudicator", () => {
    const r = classifyCandidates([c("Ground Beef 73/27", 0.80), c("Chuck Roll", 0.60)])
    expect(r.kind).toBe("ambiguous")
  })

  it("reports 'new' when every candidate is below FLOOR", () => {
    const r = classifyCandidates([c("Ground Beef 73/27", 0.51), c("Chuck Roll", 0.40)])
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
