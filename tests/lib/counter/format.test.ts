import { describe, it, expect } from "vitest"
import { money, moneyCompact, pct, delta, deltaSign, count, points, TABULAR } from "@/lib/counter/format"

describe("format", () => {
  it("money is whole dollars by default — cents are noise at a glance", () => {
    expect(money(7468)).toBe("$7,468")
    expect(money(7468.42)).toBe("$7,468")
  })

  it("money keeps cents when asked, for figures a reader will reconcile", () => {
    expect(money(19.86, { cents: true })).toBe("$19.86")
    expect(money(2002.7, { cents: true })).toBe("$2,002.70")
  })

  it("money renders a negative as a parenthesised figure, the ledger convention", () => {
    expect(money(-2208)).toBe("($2,208)")
  })

  it("moneyCompact is for axis ticks only", () => {
    expect(moneyCompact(14000)).toBe("$14K")
    expect(moneyCompact(950)).toBe("$950")
    expect(moneyCompact(1500000)).toBe("$1.5M")
  })

  it("moneyCompact rounds BEFORE picking a tier, so a value that rounds into the next magnitude is labelled correctly", () => {
    // 999,999 rounds to 1000.0 inside the K tier — that's really 1M, not "1000K".
    expect(moneyCompact(999999)).toBe("$1M")
    // 999.6 rounds to 1000 whole dollars — that's really 1K, not the literal "$1000".
    expect(moneyCompact(999.6)).toBe("$1K")
  })

  it("pct carries one decimal, because a tenth of a point moves prime cost", () => {
    expect(pct(0.314)).toBe("31.4%")
    expect(pct(0.6)).toBe("60.0%")
  })

  it("pct accepts an already-scaled value when told", () => {
    expect(pct(31.4, { scaled: true })).toBe("31.4%")
  })

  it("delta signs the number and never says +0.0%", () => {
    expect(delta(0.114)).toBe("▲ 11.4%")
    expect(delta(-0.028)).toBe("▼ 2.8%")
    expect(delta(0)).toBe("flat")
  })

  it("deltaSign points the same way delta prints, at the same threshold", () => {
    // Two readers of one number: the arrow a reader SEES and the tone it is
    // painted in. If these could disagree, a figure could print ▼ in the
    // colour of a rise — which is exactly the defect `.headline .d` and
    // `.mhead .d` carried until the sheet was corrected.
    expect(deltaSign(0.114)).toBe(1)
    expect(deltaSign(-0.028)).toBe(-1)
    expect(deltaSign(0)).toBe(0)
    expect(deltaSign(null)).toBeNull()
    expect(deltaSign(NaN)).toBeNull()
    expect(deltaSign(31.4, { scaled: true })).toBe(1)

    // The "flat" window is ONE constant. Sampled either side of it, the sign
    // and the text agree on whether the figure moved at all.
    for (const v of [0.0004, -0.0004, 0.0006, -0.0006, 0.05, -0.05]) {
      expect(deltaSign(v) === 0, `deltaSign(${v})`).toBe(delta(v) === "flat")
    }
  })

  it("count is plain and grouped", () => {
    expect(count(376)).toBe("376")
    expect(count(1652)).toBe("1,652")
  })


  it("points is a movement in points, not a percentage change of a percentage", () => {
    // 29.0% to 30.6% is 1.6 POINTS. Printing its percentage change — 5.5% —
    // is a figure no operator acts on.
    expect(points(30.6 - 29.0)).toBe("▲ 1.6 pts")
    expect(points(-2.4)).toBe("▼ 2.4 pts")
  })

  it("points calls flat exactly what delta calls flat", () => {
    // One threshold, read by both, so a movement one page prints as an arrow
    // cannot be flat on the other.
    for (const v of [0.04, -0.04, 0.05, -0.05, 0.06]) {
      expect(points(v) === "flat", `points(${v})`).toBe(delta(v, { scaled: true }) === "flat")
    }
  })

  it("points has no reading for an absent change", () => {
    expect(points(null)).toBe("—")
    expect(points(NaN)).toBe("—")
  })

  it("TABULAR is the class every figure carries", () => {
    expect(TABULAR).toBe("tabular-nums lining-nums")
  })

  it("a null figure is an em-dash, not a zero — absent is not the same as none", () => {
    expect(money(null)).toBe("—")
    expect(pct(null)).toBe("—")
    expect(count(null)).toBe("—")
    expect(delta(null)).toBe("—")
  })

  it("a non-finite figure is an em-dash too — NaN/Infinity are not values a reader should ever see", () => {
    // pct(0/0) and money(Infinity) are exactly what an adapter computing
    // pct(a/b) with b === 0 will produce, across any of the 53 pages that
    // will eventually call this module.
    expect(pct(0 / 0)).toBe("—")
    expect(pct(Infinity)).toBe("—")
    expect(money(Infinity)).toBe("—")
    expect(money(-Infinity)).toBe("—")
    expect(delta(NaN)).toBe("—")
    expect(count(NaN)).toBe("—")
    expect(count(Infinity)).toBe("—")
  })
})
