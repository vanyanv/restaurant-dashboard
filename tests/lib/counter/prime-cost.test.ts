import { describe, expect, it } from "vitest"
import { PRIME_CEILING_PCT, primeCost } from "@/lib/counter/prime-cost"

describe("primeCost", () => {
  it("is food plus the whole wage bill over gross sales", () => {
    const p = primeCost({ grossSales: 100_000, cogsValue: 30_000, laborValue: 26_000 })
    expect(p.primeValue).toBe(56_000)
    expect(p.cogsPct).toBe(30)
    expect(p.laborPct).toBe(26)
    expect(p.primePct).toBe(56)
  })

  it("reports room against the ceiling, positive when under", () => {
    const p = primeCost({ grossSales: 100_000, cogsValue: 30_000, laborValue: 26_000 })
    expect(p.ceilingPct).toBe(PRIME_CEILING_PCT)
    expect(p.roomPp).toBe(4)
    expect(p.overCeiling).toBe(false)
  })

  it("reports negative room and flags a breach when over", () => {
    const p = primeCost({ grossSales: 100_000, cogsValue: 34_000, laborValue: 29_000 })
    expect(p.primePct).toBe(63)
    expect(p.roomPp).toBe(-3)
    expect(p.overCeiling).toBe(true)
  })

  it("does not flag a breach exactly AT the ceiling", () => {
    const p = primeCost({ grossSales: 100_000, cogsValue: 30_000, laborValue: 30_000 })
    expect(p.primePct).toBe(60)
    expect(p.roomPp).toBe(0)
    expect(p.overCeiling).toBe(false)
  })

  it("rounds percentages to one decimal, because that is what the page prints", () => {
    const p = primeCost({ grossSales: 33_333, cogsValue: 10_000, laborValue: 9_000 })
    expect(p.primePct).toBe(57)
    expect(p.cogsPct).toBe(30)
  })

  it("returns null percentages, NOT zero, for a store with no sales", () => {
    // A pre-open store has costs and no revenue. Its prime cost is not 0% —
    // 0% is a store running at zero food and zero labour, which reads as
    // spectacular. There is no answer, and null is how the formatters print
    // an em-dash.
    const p = primeCost({ grossSales: 0, cogsValue: 1_200, laborValue: 4_000 })
    expect(p.primePct).toBeNull()
    expect(p.cogsPct).toBeNull()
    expect(p.laborPct).toBeNull()
    expect(p.roomPp).toBeNull()
    expect(p.overCeiling).toBe(false)
    expect(p.primeValue).toBe(5_200)
  })

  it("treats negative gross sales as no answer rather than an inverted one", () => {
    // A range of pure refunds. Dividing by it flips every sign and prints a
    // negative prime cost that looks like a triumph.
    const p = primeCost({ grossSales: -500, cogsValue: 100, laborValue: 200 })
    expect(p.primePct).toBeNull()
    expect(p.overCeiling).toBe(false)
  })

  it("keeps the dollar figures it was handed, un-rounded", () => {
    const p = primeCost({ grossSales: 100, cogsValue: 30.456, laborValue: 20.544 })
    expect(p.cogsValue).toBe(30.456)
    expect(p.laborValue).toBe(20.544)
    expect(p.primeValue).toBeCloseTo(51, 10)
  })

  it("computes roomPp from the already-rounded percentage to match what's displayed", () => {
    // A case where unrounded and rounded percentages would produce different
    // roomPp values. The unrounded prime is 56.05%, which rounds to 56.1%.
    // Correct: roomPp = 60 - 56.1 = 3.9
    // Wrong (unrounded): roomPp = 60 - 56.05 = 3.95 → 4.0
    const p = primeCost({ grossSales: 1000, cogsValue: 300, laborValue: 260.5 })
    expect(p.primePct).toBe(56.1)
    expect(p.roomPp).toBe(3.9)
  })
})
