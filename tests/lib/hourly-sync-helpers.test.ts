// Pins the per-order net-sales formula used by the hourly-sync bucket math.
// The Otter customer_orders dataset has no `net_sales` field — we derive it
// from `subtotal − restaurant_funded_discount − ofo_funded_discount` to match
// otter-orders-sync.ts:189-193 (which stores subtotal + a combined discount).

import { describe, it, expect } from "vitest"
import { computeOrderNetSales } from "@/lib/hourly-sync-helpers"

describe("computeOrderNetSales", () => {
  it("returns subtotal when no discounts present", () => {
    expect(
      computeOrderNetSales({ subtotal: 33.38 })
    ).toBeCloseTo(33.38, 2)
  })

  it("subtracts both restaurant- and platform-funded discounts", () => {
    expect(
      computeOrderNetSales({
        subtotal: 50,
        restaurant_funded_discount: 5,
        ofo_funded_discount: 2.5,
      })
    ).toBeCloseTo(42.5, 2)
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

  it("does NOT read the (non-existent) net_sales field", () => {
    // Guard against regression: pre-fix code read row.net_sales which is
    // undefined on customer_orders rows. The helper must derive instead.
    expect(
      computeOrderNetSales({
        subtotal: 20,
        net_sales: 999 as unknown as number,
      } as never)
    ).toBeCloseTo(20, 2)
  })
})
