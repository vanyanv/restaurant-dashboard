// A price trend is only meaningful within one SKU. The fry canonical merges
// four SKUs across three products (Lamb Weston $38 → a Vitco fry $33.12 →
// Simplot $28 → $46.75); comparing its first and last price reports a supplier
// switch as inflation.

import { describe, it, expect } from "vitest"
import { computeTrendForPoints, type TrendPoint } from "@/lib/canonical-trend"

const NOW = Date.parse("2026-08-17T00:00:00Z")
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000)

const pt = (over: Partial<TrendPoint> & { date: Date; price: number }): TrendPoint => ({
  vendor: "Sysco",
  unit: "CS",
  sku: "A",
  ...over,
})

describe("computeTrendForPoints", () => {
  it("returns no trend when there is no baseline older than 30 days", () => {
    const r = computeTrendForPoints(
      [pt({ date: daysAgo(2), price: 10 }), pt({ date: daysAgo(1), price: 20 })],
      NOW
    )
    expect(r.trend).toBeNull()
  })

  it("compares latest against the most recent point at least 30 days old", () => {
    const r = computeTrendForPoints(
      [
        pt({ date: daysAgo(60), price: 10 }),
        pt({ date: daysAgo(35), price: 20 }),
        pt({ date: daysAgo(1), price: 30 }),
      ],
      NOW
    )
    expect(r.trend?.baselinePrice).toBe(20)
    expect(r.trend?.latestPrice).toBe(30)
    expect(r.trend?.pctChange).toBeCloseTo(50)
  })

  it("never compares across a SKU change", () => {
    // Old product at $38, new product at $46.75. A SKU-blind comparison reports
    // +23%; there is no valid within-SKU comparison here, so the answer is null.
    const r = computeTrendForPoints(
      [
        pt({ date: daysAgo(90), price: 38, sku: "OLD" }),
        pt({ date: daysAgo(1), price: 46.75, sku: "NEW" }),
      ],
      NOW
    )
    expect(r.trend).toBeNull()
    expect(r.skuCount).toBe(2)
  })

  it("reports the real within-SKU move when one exists alongside a switch", () => {
    const r = computeTrendForPoints(
      [
        pt({ date: daysAgo(120), price: 38, sku: "OLD" }),
        pt({ date: daysAgo(40), price: 28, sku: "NEW" }),
        pt({ date: daysAgo(1), price: 46.75, sku: "NEW" }),
      ],
      NOW
    )
    expect(r.trend?.sku).toBe("NEW")
    expect(r.trend?.baselinePrice).toBe(28)
    expect(r.trend?.latestPrice).toBe(46.75)
    expect(r.trend?.pctChange).toBeCloseTo(66.96, 1)
    expect(r.skuCount).toBe(2)
  })

  it("keeps vendor and unit in the bucket key", () => {
    // Same SKU, different unit — a case price and a pound price are not comparable.
    const r = computeTrendForPoints(
      [
        pt({ date: daysAgo(40), price: 38, unit: "CS" }),
        pt({ date: daysAgo(1), price: 4.33, unit: "LB" }),
      ],
      NOW
    )
    expect(r.trend).toBeNull()
  })

  it("picks the largest absolute move when several SKUs each have a valid trend", () => {
    const r = computeTrendForPoints(
      [
        pt({ date: daysAgo(40), price: 100, sku: "A" }),
        pt({ date: daysAgo(1), price: 105, sku: "A" }),
        pt({ date: daysAgo(40), price: 10, sku: "B" }),
        pt({ date: daysAgo(1), price: 14, sku: "B" }),
      ],
      NOW
    )
    expect(r.trend?.sku).toBe("B")
    expect(r.trend?.pctChange).toBeCloseTo(40)
  })

  it("ignores non-positive baselines and counts null SKUs as one bucket", () => {
    const r = computeTrendForPoints(
      [
        pt({ date: daysAgo(40), price: 0, sku: null }),
        pt({ date: daysAgo(1), price: 5, sku: null }),
      ],
      NOW
    )
    expect(r.trend).toBeNull()
    expect(r.skuCount).toBe(1)
  })

  it("returns skuCount 0 and no trend for empty input", () => {
    expect(computeTrendForPoints([], NOW)).toEqual({ trend: null, skuCount: 0 })
  })
})
