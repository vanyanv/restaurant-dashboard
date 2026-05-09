import { describe, expect, it } from "vitest"
import {
  shapeMenuCategoryAnalytics,
  type CategoryAggregateRow,
  type ItemAggregateRow,
} from "@/lib/menu-category-analytics-aggregation"

function cat(overrides: Partial<CategoryAggregateRow> = {}): CategoryAggregateRow {
  return {
    category: "Mains",
    fpQuantitySold: 10,
    fpTotalInclModifiers: 110,
    fpTotalSales: 100,
    tpQuantitySold: 5,
    tpTotalInclModifiers: 55,
    tpTotalSales: 50,
    ...overrides,
  }
}

function item(overrides: Partial<ItemAggregateRow> = {}): ItemAggregateRow {
  return {
    category: "Mains",
    itemName: "Burger",
    fpQuantitySold: 6,
    fpTotalInclModifiers: 66,
    fpTotalSales: 60,
    tpQuantitySold: 3,
    tpTotalInclModifiers: 33,
    tpTotalSales: 30,
    ...overrides,
  }
}

describe("shapeMenuCategoryAnalytics", () => {
  it("returns empty categories and zero totals for empty input", () => {
    const result = shapeMenuCategoryAnalytics([], [])
    expect(result.categories).toEqual([])
    expect(result.totals).toEqual({
      fpQuantitySold: 0,
      fpTotalSales: 0,
      tpQuantitySold: 0,
      tpTotalSales: 0,
      totalQuantitySold: 0,
      totalSales: 0,
    })
  })

  it("computes totalQuantitySold and totalSales as fp+tp on each category", () => {
    const result = shapeMenuCategoryAnalytics(
      [cat({ category: "Mains", fpQuantitySold: 10, tpQuantitySold: 5, fpTotalSales: 100, tpTotalSales: 50 })],
      []
    )
    expect(result.categories[0].totalQuantitySold).toBe(15)
    expect(result.categories[0].totalSales).toBe(150)
  })

  it("sorts categories by totalQuantitySold descending", () => {
    const result = shapeMenuCategoryAnalytics(
      [
        cat({ category: "Sides", fpQuantitySold: 1, tpQuantitySold: 1 }),
        cat({ category: "Mains", fpQuantitySold: 50, tpQuantitySold: 50 }),
        cat({ category: "Drinks", fpQuantitySold: 20, tpQuantitySold: 5 }),
      ],
      []
    )
    expect(result.categories.map((c) => c.category)).toEqual(["Mains", "Drinks", "Sides"])
  })

  it("nests items under matching category sorted by totalQuantitySold descending", () => {
    const result = shapeMenuCategoryAnalytics(
      [cat({ category: "Mains" })],
      [
        item({ itemName: "Salad", fpQuantitySold: 1, tpQuantitySold: 0 }),
        item({ itemName: "Burger", fpQuantitySold: 10, tpQuantitySold: 5 }),
        item({ itemName: "Wrap", fpQuantitySold: 4, tpQuantitySold: 2 }),
      ]
    )
    expect(result.categories[0].items.map((i) => i.itemName)).toEqual(["Burger", "Wrap", "Salad"])
  })

  it("drops items whose category has no matching aggregate row", () => {
    const result = shapeMenuCategoryAnalytics(
      [cat({ category: "Mains" })],
      [
        item({ category: "Mains", itemName: "Burger" }),
        item({ category: "Sides", itemName: "Fries" }),
      ]
    )
    expect(result.categories).toHaveLength(1)
    expect(result.categories[0].items.map((i) => i.itemName)).toEqual(["Burger"])
  })

  it("computes totals as the sum across all categories", () => {
    const result = shapeMenuCategoryAnalytics(
      [
        cat({ category: "Mains", fpQuantitySold: 10, tpQuantitySold: 5, fpTotalSales: 100, tpTotalSales: 50 }),
        cat({ category: "Sides", fpQuantitySold: 4, tpQuantitySold: 1, fpTotalSales: 16, tpTotalSales: 4 }),
      ],
      []
    )
    expect(result.totals).toEqual({
      fpQuantitySold: 14,
      fpTotalSales: 116,
      tpQuantitySold: 6,
      tpTotalSales: 54,
      totalQuantitySold: 20,
      totalSales: 170,
    })
  })

  it("coerces bigint sums (Prisma raw) to plain numbers", () => {
    const result = shapeMenuCategoryAnalytics(
      [
        {
          category: "Mains",
          fpQuantitySold: BigInt(10) as unknown as number,
          fpTotalInclModifiers: BigInt(110) as unknown as number,
          fpTotalSales: BigInt(100) as unknown as number,
          tpQuantitySold: BigInt(5) as unknown as number,
          tpTotalInclModifiers: BigInt(55) as unknown as number,
          tpTotalSales: BigInt(50) as unknown as number,
        },
      ],
      []
    )
    expect(typeof result.categories[0].fpQuantitySold).toBe("number")
    expect(result.categories[0].totalQuantitySold).toBe(15)
  })
})
