import { describe, expect, it } from "vitest"
import {
  bucketDailyToWeekly,
  shapeCategoryBreakdown,
  type DailyOtterRow,
  type DailyInvoiceRow,
  type CategoryAggregateRow,
} from "@/lib/operational-analytics-aggregation"

function d(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`)
}

describe("bucketDailyToWeekly", () => {
  it("returns no buckets when both inputs are empty", () => {
    expect(bucketDailyToWeekly([], [])).toEqual([])
  })

  it("collapses days within the same ISO week into one bucket", () => {
    // 2026-03-02 (Mon) and 2026-03-04 (Wed) are both ISO week 10 of 2026.
    const otter: DailyOtterRow[] = [
      { date: d("2026-03-02"), revenue: 100, orders: 10 },
      { date: d("2026-03-04"), revenue: 50, orders: 5 },
    ]
    const inv: DailyInvoiceRow[] = [
      { date: d("2026-03-03"), spending: 40 },
    ]
    const out = bucketDailyToWeekly(otter, inv)
    expect(out).toHaveLength(1)
    expect(out[0].totalRevenue).toBe(150)
    expect(out[0].totalOrders).toBe(15)
    expect(out[0].totalSpending).toBe(40)
  })

  it("computes costPerOrder, grossMarginPct, cogsRatioPct per bucket", () => {
    const out = bucketDailyToWeekly(
      [{ date: d("2026-03-02"), revenue: 1000, orders: 100 }],
      [{ date: d("2026-03-02"), spending: 200 }]
    )
    expect(out[0].costPerOrder).toBe(2)
    expect(out[0].grossMarginPct).toBe(80)
    expect(out[0].cogsRatioPct).toBe(20)
  })

  it("returns null margin/cogs ratios when revenue is zero", () => {
    const out = bucketDailyToWeekly(
      [],
      [{ date: d("2026-03-02"), spending: 100 }]
    )
    expect(out[0].grossMarginPct).toBeNull()
    expect(out[0].cogsRatioPct).toBeNull()
    expect(out[0].costPerOrder).toBe(0)
  })

  it("sorts buckets by ISO week-year ascending", () => {
    const out = bucketDailyToWeekly(
      [
        { date: d("2026-03-09"), revenue: 1, orders: 1 }, // W11
        { date: d("2026-02-23"), revenue: 1, orders: 1 }, // W09
        { date: d("2026-03-02"), revenue: 1, orders: 1 }, // W10
      ],
      []
    )
    expect(out.map((b) => b.weekLabel)).toEqual(["W09", "W10", "W11"])
  })
})

describe("shapeCategoryBreakdown", () => {
  it("returns empty list for empty input", () => {
    expect(shapeCategoryBreakdown([])).toEqual([])
  })

  it("computes percentOfTotal across categories and sorts by spend desc", () => {
    const rows: CategoryAggregateRow[] = [
      { category: "Produce", totalSpend: 250 },
      { category: "Meat", totalSpend: 750 },
    ]
    const out = shapeCategoryBreakdown(rows)
    expect(out.map((c) => c.category)).toEqual(["Meat", "Produce"])
    expect(out[0].percentOfTotal).toBe(75)
    expect(out[1].percentOfTotal).toBe(25)
  })

  it('coalesces null categories into "Other"', () => {
    const out = shapeCategoryBreakdown([
      { category: null, totalSpend: 100 },
      { category: "Other", totalSpend: 50 },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].category).toBe("Other")
    expect(out[0].totalSpend).toBe(150)
  })

  it("coerces bigint sums to plain numbers", () => {
    const out = shapeCategoryBreakdown([
      { category: "Bulk", totalSpend: BigInt(500) as unknown as number },
    ])
    expect(typeof out[0].totalSpend).toBe("number")
    expect(out[0].totalSpend).toBe(500)
  })
})
