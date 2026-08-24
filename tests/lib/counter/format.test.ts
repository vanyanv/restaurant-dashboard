import { describe, it, expect } from "vitest"
import { money, moneyCompact, pct, delta, count, TABULAR } from "@/lib/counter/format"

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

  it("count is plain and grouped", () => {
    expect(count(376)).toBe("376")
    expect(count(1652)).toBe("1,652")
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
})
