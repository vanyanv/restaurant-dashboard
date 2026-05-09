import { describe, expect, it } from "vitest"
import {
  aggregateRawSubItemRows,
  attachSubItemMappings,
  type RawSubItemRow,
  type SubItemAggregateRow,
} from "@/lib/otter-subitem-aggregation"

function row(overrides: Partial<RawSubItemRow> = {}): RawSubItemRow {
  return {
    skuId: "sku-1",
    name: "Add Pickle",
    subHeader: "Add Toppings",
    quantity: 1,
    parentQuantity: 1,
    storeId: "store-1",
    referenceTimeLocal: new Date("2026-01-01T12:00:00Z"),
    ...overrides,
  }
}

describe("aggregateRawSubItemRows", () => {
  it("sums occurrences as subQuantity * parentQuantity (weighted)", () => {
    const result = aggregateRawSubItemRows([
      row({ quantity: 2, parentQuantity: 3 }), // contributes 6
      row({ quantity: 1, parentQuantity: 4 }), // contributes 4
    ])
    expect(result).toHaveLength(1)
    expect(result[0].occurrences).toBe(10)
  })

  it("treats missing quantities as 1 when summing occurrences", () => {
    const result = aggregateRawSubItemRows([
      row({ quantity: null, parentQuantity: null }),
      row({ quantity: null, parentQuantity: 2 }),
    ])
    expect(result[0].occurrences).toBe(1 + 2)
  })

  it("picks the most-common name weighted by uses (not raw row count)", () => {
    const result = aggregateRawSubItemRows([
      // 5 weighted votes for "Add Pickles"
      row({ name: "Add Pickles", quantity: 5, parentQuantity: 1 }),
      // 2 weighted votes for "Add Pickle"
      row({ name: "Add Pickle", quantity: 1, parentQuantity: 1 }),
      row({ name: "Add Pickle", quantity: 1, parentQuantity: 1 }),
    ])
    expect(result[0].mostCommonName).toBe("Add Pickles")
  })

  it("picks the most-common subHeader and preserves null when null wins", () => {
    const winsNull = aggregateRawSubItemRows([
      row({ subHeader: null, quantity: 4, parentQuantity: 1 }),
      row({ subHeader: "Toppings", quantity: 1, parentQuantity: 1 }),
    ])
    expect(winsNull[0].mostCommonHeader).toBeNull()

    const winsStr = aggregateRawSubItemRows([
      row({ subHeader: null, quantity: 1, parentQuantity: 1 }),
      row({ subHeader: "Toppings", quantity: 4, parentQuantity: 1 }),
    ])
    expect(winsStr[0].mostCommonHeader).toBe("Toppings")
  })

  it("collects distinct store IDs across the rows", () => {
    const result = aggregateRawSubItemRows([
      row({ storeId: "store-a" }),
      row({ storeId: "store-b" }),
      row({ storeId: "store-a" }),
    ])
    expect(result[0].storeIds.sort()).toEqual(["store-a", "store-b"])
  })

  it("tracks firstSeen and lastSeen as min/max referenceTimeLocal", () => {
    const t1 = new Date("2026-01-01T00:00:00Z")
    const t2 = new Date("2026-02-15T00:00:00Z")
    const t3 = new Date("2026-03-30T00:00:00Z")
    const result = aggregateRawSubItemRows([
      row({ referenceTimeLocal: t2 }),
      row({ referenceTimeLocal: t1 }),
      row({ referenceTimeLocal: t3 }),
    ])
    expect(result[0].firstSeen?.getTime()).toBe(t1.getTime())
    expect(result[0].lastSeen?.getTime()).toBe(t3.getTime())
  })

  it("groups by skuId and skips rows with null skuId", () => {
    const result = aggregateRawSubItemRows([
      row({ skuId: "a", name: "Apple" }),
      row({ skuId: "b", name: "Banana" }),
      row({ skuId: null, name: "Garbage" }),
    ])
    const skuIds = result.map((r) => r.skuId).sort()
    expect(skuIds).toEqual(["a", "b"])
  })

  it("sorts results by occurrences descending", () => {
    const result = aggregateRawSubItemRows([
      row({ skuId: "low", quantity: 1, parentQuantity: 1 }),
      row({ skuId: "high", quantity: 10, parentQuantity: 1 }),
      row({ skuId: "mid", quantity: 5, parentQuantity: 1 }),
    ])
    expect(result.map((r) => r.skuId)).toEqual(["high", "mid", "low"])
  })
})

describe("attachSubItemMappings", () => {
  function agg(overrides: Partial<SubItemAggregateRow> = {}): SubItemAggregateRow {
    return {
      skuId: "sku-1",
      occurrences: 5,
      mostCommonName: "Add Pickle",
      mostCommonHeader: "Toppings",
      firstSeen: new Date("2026-01-01"),
      lastSeen: new Date("2026-02-01"),
      storeIds: ["store-1"],
      ...overrides,
    }
  }

  it("attaches mapped recipe fields when a mapping for the SKU exists", () => {
    const result = attachSubItemMappings(
      [agg({ skuId: "sku-x" })],
      [{ skuId: "sku-x", recipeId: "rec-1", recipeName: "Pickle Recipe" }]
    )
    expect(result[0].mappedRecipeId).toBe("rec-1")
    expect(result[0].mappedRecipeName).toBe("Pickle Recipe")
  })

  it("leaves recipe fields null when no mapping matches", () => {
    const result = attachSubItemMappings([agg({ skuId: "sku-x" })], [])
    expect(result[0].mappedRecipeId).toBeNull()
    expect(result[0].mappedRecipeName).toBeNull()
  })

  it("preserves the input order (sorted) of the aggregate rows", () => {
    const result = attachSubItemMappings(
      [
        agg({ skuId: "first", occurrences: 100 }),
        agg({ skuId: "second", occurrences: 50 }),
      ],
      []
    )
    expect(result.map((r) => r.skuId)).toEqual(["first", "second"])
  })

  it("uses the first mapping when duplicates exist for the same SKU", () => {
    const result = attachSubItemMappings(
      [agg({ skuId: "sku-x" })],
      [
        { skuId: "sku-x", recipeId: "rec-A", recipeName: "First" },
        { skuId: "sku-x", recipeId: "rec-B", recipeName: "Second" },
      ]
    )
    expect(result[0].mappedRecipeId).toBe("rec-A")
    expect(result[0].mappedRecipeName).toBe("First")
  })
})
