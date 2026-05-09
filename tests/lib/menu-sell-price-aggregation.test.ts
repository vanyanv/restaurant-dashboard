import { describe, expect, it } from "vitest"
import {
  mergeSellPrices,
  type PrimarySellPriceRow,
  type FallbackSellPriceRow,
} from "@/lib/menu-sell-price-aggregation"

describe("mergeSellPrices", () => {
  it("returns an empty map for empty input", () => {
    const out = mergeSellPrices([], [])
    expect(out.size).toBe(0)
  })

  it("computes avgPrice as totalSales / totalQty for primary rollups", () => {
    const out = mergeSellPrices(
      [{ itemName: "Burger", totalQty: 10, totalSales: 120 }],
      []
    )
    const burger = out.get("burger")
    expect(burger).toEqual({ avgPrice: 12, qtySold: 10 })
  })

  it("lowercases keys for case-insensitive lookup", () => {
    const out = mergeSellPrices(
      [{ itemName: "BURGER", totalQty: 5, totalSales: 50 }],
      []
    )
    expect(out.has("burger")).toBe(true)
    expect(out.has("BURGER")).toBe(false)
  })

  it("drops primary rows with non-positive qty or sales", () => {
    const out = mergeSellPrices(
      [
        { itemName: "Free", totalQty: 5, totalSales: 0 },
        { itemName: "Phantom", totalQty: 0, totalSales: 50 },
        { itemName: "Real", totalQty: 5, totalSales: 25 },
      ],
      []
    )
    expect(out.size).toBe(1)
    expect(out.has("real")).toBe(true)
  })

  it("uses fallback rows only for items absent from primary rollups", () => {
    const out = mergeSellPrices(
      [{ itemName: "Burger", totalQty: 10, totalSales: 120 }],
      [
        { name: "Burger", price: 99, quantity: 1 },
        { name: "Salad", price: 8, quantity: 1 },
      ]
    )
    expect(out.get("burger")?.avgPrice).toBe(12)
    expect(out.get("salad")?.avgPrice).toBe(8)
  })

  it("treats fallback price as a unit price when quantity > 0", () => {
    const out = mergeSellPrices(
      [],
      [{ name: "Combo", price: 30, quantity: 3 }]
    )
    expect(out.get("combo")).toEqual({ avgPrice: 10, qtySold: 3 })
  })

  it("falls back to raw price when fallback quantity is zero or negative", () => {
    const out = mergeSellPrices(
      [],
      [{ name: "Misc", price: 12, quantity: 0 }]
    )
    expect(out.get("misc")?.avgPrice).toBe(12)
  })

  it("coerces bigint primary sums to plain numbers", () => {
    const out = mergeSellPrices(
      [
        {
          itemName: "BigCount",
          totalQty: BigInt(10) as unknown as number,
          totalSales: BigInt(120) as unknown as number,
        },
      ],
      []
    )
    const v = out.get("bigcount")!
    expect(typeof v.qtySold).toBe("number")
    expect(v.avgPrice).toBe(12)
  })
})

void (null as unknown as PrimarySellPriceRow)
void (null as unknown as FallbackSellPriceRow)
