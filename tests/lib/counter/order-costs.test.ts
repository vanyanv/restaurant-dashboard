// resolveLineCosts turns a flattened order-line list into per-line keep/cost
// figures. It is a pure function: no Prisma, no session — the adapter that
// will call it (a later task) is responsible for building recipeBySku and
// costByRecipe from the database and handing this function plain data.

import { describe, it, expect } from "vitest"
import { resolveLineCosts } from "@/lib/counter/order-costs"

const base = {
  recipeBySku: new Map([["SKU-SLIDER", "r1"]]),
  costByRecipe: new Map([["r1", { totalCost: 2.5, partial: false }]]),
  commissionRate: 0.2,
}

describe("resolveLineCosts", () => {
  it("keeps each line net of the channel's own rate", () => {
    const [l] = resolveLineCosts({
      ...base,
      lines: [{ key: "a", name: "Double Slider", modifier: false, skuId: "SKU-SLIDER", quantity: 1, price: 10 }],
    })
    expect(l.keep).toBeCloseTo(8)
  })

  it("costs a quantity of three as three portions", () => {
    const [l] = resolveLineCosts({
      ...base,
      lines: [{ key: "a", name: "Double Slider", modifier: false, skuId: "SKU-SLIDER", quantity: 3, price: 30 }],
    })
    expect(l.cost).toBeCloseTo(7.5)
  })

  it("reports an unmapped sku as not costed rather than as zero", () => {
    const [l] = resolveLineCosts({
      ...base,
      lines: [{ key: "a", name: "Add Grilled Onion", modifier: true, skuId: "SKU-ONION", quantity: 1, price: 0.95 }],
    })
    expect(l.cost).toBeNull()
    expect(l.uncostedReason).toBe("unmapped")
  })

  it("refuses a partial recipe's cost instead of flattering the margin", () => {
    const [l] = resolveLineCosts({
      ...base,
      costByRecipe: new Map([["r1", { totalCost: 2.5, partial: true }]]),
      lines: [{ key: "a", name: "Double Slider", modifier: false, skuId: "SKU-SLIDER", quantity: 1, price: 10 }],
    })
    expect(l.cost).toBeNull()
    expect(l.uncostedReason).toBe("partial")
  })
})
