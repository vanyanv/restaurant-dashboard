// usage-math — the one function units sold comes from.
//
// `(fpQuantitySold ?? 0) + (tpQuantitySold ?? 0)` was written inline, six
// times, independently, across `src/lib/inventory/**` and
// `src/lib/counter/adapters/menu-*.ts`. Consolidated into `unitsSold` per
// CLAUDE.md's shared-figure rule; this pins the behaviour every call site
// depended on so a future edit to one caller can't quietly drift from the
// other five.

import { describe, it, expect } from "vitest"
import { unitsSold } from "@/lib/inventory/usage-math"

describe("unitsSold", () => {
  it("adds first-party and third-party quantity", () => {
    expect(unitsSold({ fpQuantitySold: 12, tpQuantitySold: 3 })).toBe(15)
  })

  it("treats a null channel as zero, on either side", () => {
    expect(unitsSold({ fpQuantitySold: null, tpQuantitySold: 3 })).toBe(3)
    expect(unitsSold({ fpQuantitySold: 12, tpQuantitySold: null })).toBe(12)
    expect(unitsSold({ fpQuantitySold: null, tpQuantitySold: null })).toBe(0)
  })
})
