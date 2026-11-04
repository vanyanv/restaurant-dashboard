// Packaging is out of food cost (owner, 2026-11-03). One rule decides which
// `DailyCogsItem` rows are food cost; these pin the rule and that the
// statement's two readers — the dashboard P&L and the assistant's P&L — go
// through it rather than summing every row.
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  FOOD_COST_ROWS,
  PACKAGING_CATEGORY,
  PACKAGING_IN_FOOD_COST,
  isFoodCostRow,
} from "@/lib/counter/food-cost-scope"

describe("food-cost scope", () => {
  it("leaves packaging out for now", () => {
    expect(PACKAGING_IN_FOOD_COST).toBe(false)
    expect(FOOD_COST_ROWS).toEqual({ category: { not: PACKAGING_CATEGORY } })
  })

  it("keeps every menu row and drops the Packaging - * rows", () => {
    const rows = [
      { itemName: "Classic Slider", category: "A La Carte", lineCost: 1.2 },
      { itemName: "Packaging - 9x6", category: "Packaging", lineCost: 0.31 },
      { itemName: "Fries", category: "On The Side", lineCost: 0.5 },
    ]
    const cost = rows.filter(isFoodCostRow).reduce((t, r) => t + r.lineCost, 0)
    expect(cost).toBeCloseTo(1.7, 6)
  })

  // Every reader that turns `DailyCogsItem` into a food-cost figure. A new one
  // that sums `lineCost` straight off the table belongs on this list.
  const READERS = [
    "src/app/actions/store/pnl-actions.ts", // P&L, Overview, Analytics, prime cost
    "src/lib/chat/tools/pnl.ts", // the assistant's P&L
    "src/lib/counter/cogs.ts", // the COGS page
    "src/app/actions/forecasts/menu-engineering-actions.ts", // menu engineering coverage
  ]
  it.each(READERS)("%s reads its rows through FOOD_COST_ROWS", (file) => {
    const src = readFileSync(join(process.cwd(), file), "utf8")
    const reads = src.match(/dailyCogsItem\.(findMany|aggregate|groupBy)\(/g) ?? []
    const scoped = src.match(/\.\.\.FOOD_COST_ROWS/g) ?? []
    expect(reads.length).toBeGreaterThan(0)
    expect(scoped.length).toBeGreaterThanOrEqual(1)
    expect(src).not.toMatch(/category: \{ not: "Packaging" \}/)
  })
})
