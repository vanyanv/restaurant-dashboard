// Three live tiles render "$0.00" today because sub-cent unit prices go
// through toFixed(2) — Soda Orange Fanta, Soda Sprite and Ketchup Packets all
// read as free. A price that exists must never display as zero.

import { describe, it, expect } from "vitest"
import { formatMoney, formatUnitPrice, isMaterialImpact, MATERIAL_IMPACT_USD } from "@/lib/pantry-format"

describe("formatUnitPrice", () => {
  it("uses two decimals at or above a dollar", () => {
    expect(formatUnitPrice(4.331)).toBe("$4.33")
    expect(formatUnitPrice(1)).toBe("$1.00")
    expect(formatUnitPrice(46.75)).toBe("$46.75")
  })

  it("adds precision below a dollar rather than rounding to zero", () => {
    expect(formatUnitPrice(0.326)).toBe("$0.326")
    expect(formatUnitPrice(0.0036)).toBe("$0.0036")
    expect(formatUnitPrice(0.00012)).toBe("$0.00012")
  })

  it("never returns $0.00 for a non-zero price", () => {
    for (const p of [0.004, 0.0004, 0.00004, 0.000004]) {
      expect(formatUnitPrice(p)).not.toBe("$0.00")
    }
  })

  it("still shows a genuine zero as zero", () => {
    expect(formatUnitPrice(0)).toBe("$0.00")
  })

  it("returns null for an unknown price so callers render a dash, not a number", () => {
    expect(formatUnitPrice(null)).toBeNull()
  })
})

describe("isMaterialImpact", () => {
  it("treats a quarterly dollar impact at or above the threshold as material", () => {
    expect(isMaterialImpact(MATERIAL_IMPACT_USD)).toBe(true)
    expect(isMaterialImpact(7299)).toBe(true)
  })

  it("counts a fall as material too — a big saving is also news", () => {
    expect(isMaterialImpact(-8676)).toBe(true)
  })

  it("ignores small moves however large their percentage", () => {
    // Sanitizer moved +5.2%, which is worth $26 a quarter.
    expect(isMaterialImpact(26)).toBe(false)
    expect(isMaterialImpact(-26)).toBe(false)
  })

  it("treats an unmeasured move as not material", () => {
    expect(isMaterialImpact(null)).toBe(false)
  })
})

describe("formatMoney", () => {
  it("renders whole dollars with thousands separators", () => {
    expect(formatMoney(175226)).toBe("$175,226")
    expect(formatMoney(4133)).toBe("$4,133")
    expect(formatMoney(0)).toBe("$0")
  })

  it("rounds to the dollar rather than showing cents", () => {
    // Ledger totals are for scale, not reconciliation; cents on a $57k figure
    // are noise, and the invoice page is where exact math lives.
    expect(formatMoney(57695.62)).toBe("$57,696")
  })
})
