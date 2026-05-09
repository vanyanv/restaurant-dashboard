import { describe, expect, it } from "vitest"
import {
  shapeTopProducts,
  type RawProductAggregateRow,
} from "@/lib/product-analytics-aggregation"

function row(overrides: Partial<RawProductAggregateRow> = {}): RawProductAggregateRow {
  return {
    productName: "Burger Bun",
    sku: "BUN-001",
    category: "Bakery",
    unit: "case",
    totalQuantity: 10,
    totalSpend: 200,
    avgUnitPrice: 20,
    invoiceCount: 4,
    ...overrides,
  }
}

describe("shapeTopProducts", () => {
  it("returns an empty list for empty input", () => {
    expect(shapeTopProducts([], 20)).toEqual([])
  })

  it("sorts rows by totalSpend descending regardless of input order", () => {
    const result = shapeTopProducts(
      [
        row({ productName: "Cheap", totalSpend: 50 }),
        row({ productName: "Pricey", totalSpend: 500 }),
        row({ productName: "Mid", totalSpend: 250 }),
      ],
      20
    )
    expect(result.map((r) => r.productName)).toEqual(["Pricey", "Mid", "Cheap"])
  })

  it("caps the result at the requested limit", () => {
    const rows: RawProductAggregateRow[] = []
    for (let i = 0; i < 50; i++) {
      rows.push(row({ productName: `P${i}`, totalSpend: i }))
    }
    const result = shapeTopProducts(rows, 20)
    expect(result).toHaveLength(20)
    expect(result[0].productName).toBe("P49") // highest spend
  })

  it("passes through nullable sku, category, and unit", () => {
    const result = shapeTopProducts(
      [row({ productName: "Generic", sku: null, category: null, unit: null })],
      20
    )
    expect(result[0].sku).toBeNull()
    expect(result[0].category).toBeNull()
    expect(result[0].unit).toBeNull()
  })

  it("coerces bigint counts (Prisma raw rows) to plain numbers", () => {
    const result = shapeTopProducts(
      [
        {
          productName: "BigCount",
          sku: null,
          category: null,
          unit: null,
          totalQuantity: 5,
          totalSpend: 100,
          avgUnitPrice: 20,
          invoiceCount: BigInt(7) as unknown as number,
        },
      ],
      20
    )
    expect(typeof result[0].invoiceCount).toBe("number")
    expect(result[0].invoiceCount).toBe(7)
  })
})
