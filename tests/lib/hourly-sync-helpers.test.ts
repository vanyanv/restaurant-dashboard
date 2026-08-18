// Pins the per-order net-sales derivation used by the hourly-sync bucket math.
//
// The Otter customer_orders dataset DOES expose `net_sales` — it is returned
// whenever the field is listed in `CUSTOMER_ORDER_COLUMNS`. An earlier version
// read `row.net_sales` without requesting the column, got undefined, and
// "fixed" it by deriving `subtotal − restaurant_funded_discount −
// ofo_funded_discount`. That derivation is wrong: Otter returns both discount
// fields ALREADY NEGATIVE, so subtracting them added the discount back instead
// of removing it, inflating hourly net sales by ~1.6× on discount-heavy 3P
// channels (verified against OtterDailySummary, 2026-08-18).

import { describe, it, expect } from "vitest"
import { computeOrderNetSales } from "@/lib/hourly-sync-helpers"

describe("computeOrderNetSales", () => {
  it("uses the dataset's net_sales field when present", () => {
    expect(computeOrderNetSales({ subtotal: 50, net_sales: 42.5 })).toBeCloseTo(42.5, 2)
  })

  it("matches a real UberEats row (discounts arrive negative)", () => {
    // Aggregated from the live 2026-08-10 pull: subtotal 4852.16,
    // restaurant_funded_discount −1434.03, ofo_funded_discount −79.40,
    // net_sales 3418.32. The old formula produced 6365.59.
    expect(
      computeOrderNetSales({
        subtotal: 4852.16,
        restaurant_funded_discount: -1434.03,
        ofo_funded_discount: -79.4,
        net_sales: 3418.32,
      })
    ).toBeCloseTo(3418.32, 2)
  })

  it("returns subtotal when there are no discounts and no net_sales", () => {
    expect(computeOrderNetSales({ subtotal: 33.38 })).toBeCloseTo(33.38, 2)
  })

  it("fallback REDUCES subtotal by negative discounts", () => {
    expect(
      computeOrderNetSales({
        subtotal: 50,
        restaurant_funded_discount: -5,
        ofo_funded_discount: -2.5,
      })
    ).toBeCloseTo(42.5, 2)
  })

  it("fallback is sign-agnostic — positive discounts also reduce", () => {
    expect(
      computeOrderNetSales({
        subtotal: 50,
        restaurant_funded_discount: 5,
        ofo_funded_discount: 2.5,
      })
    ).toBeCloseTo(42.5, 2)
  })

  it("never returns a negative figure", () => {
    expect(
      computeOrderNetSales({ subtotal: 10, restaurant_funded_discount: -999 })
    ).toBe(0)
  })

  it("treats null / undefined fields as zero", () => {
    expect(
      computeOrderNetSales({
        subtotal: null,
        restaurant_funded_discount: undefined,
        ofo_funded_discount: null,
      })
    ).toBe(0)
    expect(computeOrderNetSales({})).toBe(0)
  })

  it("ignores non-numeric inputs without throwing", () => {
    expect(
      computeOrderNetSales({
        subtotal: "33.38" as unknown as number,
        restaurant_funded_discount: "1" as unknown as number,
      })
    ).toBe(0)
  })
})
