import { describe, expect, it } from "vitest"
import { buildProfitPlain } from "@/lib/counter/menu-profit-plain"
import type { MenuEngineeringData, MenuEngineeringRow, MenuQuadrant } from "@/app/actions/forecasts/menu-engineering-actions"

const row = (itemName: string, quadrant: MenuQuadrant, soldQty: number, marginPct: number | null = 60): MenuEngineeringRow => ({
  itemName,
  category: "Burgers",
  recipeId: "r",
  soldQty,
  revenue: 0,
  cogs: 0,
  unitPrice: 0,
  unitCost: 0,
  unitMargin: 0,
  totalContribution: 0,
  marginPct,
  quadrant,
  elasticity: null,
  elasticityConfidence: null,
})

const data = (rows: MenuEngineeringRow[], foodCostPct: number | null = 28.8, coveragePct = 94): MenuEngineeringData =>
  ({
    storeId: null,
    storeName: null,
    windowStart: new Date(),
    windowEnd: new Date(),
    medianVelocity: 0,
    medianUnitMargin: 0,
    rows,
    counts: { STAR: 0, PLOWHORSE: 0, PUZZLE: 0, DOG: 0 },
    totalContribution: 0,
    coverage: { costedRevenue: 0, unmappedRevenue: 0, missingCostRevenue: 0, partialCostRevenue: 0, coveragePct },
    menu: { cost: 0, revenue: 0, collected: 0, discount: 0, marginPct: foodCostPct === null ? null : 100 - foodCostPct, foodCostPct, items: 0 },
  }) as MenuEngineeringData

describe("buildProfitPlain", () => {
  it("names the four corners in words, best sellers first", () => {
    const p = buildProfitPlain(
      data([row("Combo #1", "STAR", 900), row("Slider", "STAR", 1300), row("Milkshake", "PLOWHORSE", 700), row("Double", "PUZZLE", 90), row("Triple", "DOG", 4)]),
    )
    expect(p.sentence).toBe("Food cost was 28.8% of costed menu sales, after deals. Push Slider, which sells a lot and keeps a lot. Look at Milkshake, which sells a lot but keeps little.")
    expect(p.groups.map((g) => [g.title, g.names])).toEqual([
      ["Keep selling", ["Slider", "Combo #1"]],
      ["Look at price", ["Milkshake"]],
      ["Push more", ["Double"]],
      ["Think about", ["Triple"]],
    ])
    expect(p.big.missing).toBe("6.0% of sales not costed")
  })

  it("never sorts an uncosted item into a group", () => {
    const p = buildProfitPlain(data([row("Halal Slider", "STAR", 5000, null)]))
    expect(p.groups[0].names).toEqual([])
  })
})
