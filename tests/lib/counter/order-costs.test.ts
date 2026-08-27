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
  // No discount: the lines reach the ticket exactly, so `lineScale` is 1 and
  // these four cases read as they did before the scale existed.
  ticket: 10,
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
      ticket: 30,
      lines: [{ key: "a", name: "Double Slider", modifier: false, skuId: "SKU-SLIDER", quantity: 3, price: 30 }],
    })
    expect(l.cost).toBeCloseTo(7.5)
  })

  it("reports an unmapped sku as not costed rather than as zero", () => {
    const [l] = resolveLineCosts({
      ...base,
      ticket: 0.95,
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

/*
 * The discount, and where it has to land.
 *
 * `keep = line.price × (1 − commissionRate)` had the RATE right and the PRICE
 * wrong: `commissionRateOf` divides by `ticketOf`, but `line.price` is the
 * pre-discount menu figure on 324 of the 500 most recently drained orders.
 * 315 of those 500 carry an order-level discount, and on them the line total
 * runs a median 24.95% (max 100.15%) above the ticket — so every per-line
 * margin was inflated by the discount, directly beneath an order-level
 * Contribution computed correctly from `netOf`.
 */
describe("an order-level discount the lines do not carry", () => {
  const line = (price: number) => ({
    key: "a", name: "Double Slider", modifier: false, skuId: "SKU-SLIDER", quantity: 1, price,
  })

  it("charges the line only what the customer paid for it", () => {
    // $10 of menu price on an order the customer paid $5 for: half off.
    const [l] = resolveLineCosts({ ...base, ticket: 5, lines: [line(10)] })
    expect(l.price).toBe(10)
    expect(l.charged).toBeCloseTo(5)
    expect(l.keep).toBeCloseTo(4)
  })

  it("spreads it in proportion, so the lines still sum to the ticket", () => {
    const costs = resolveLineCosts({
      ...base,
      ticket: 15,
      lines: [line(10), { ...line(20), key: "b" }],
    })
    expect(costs.map((c) => c.charged)).toEqual([5, 10])
    expect(costs.reduce((t, c) => t + c.charged, 0)).toBeCloseTo(15)
  })

  it("leaves an already-discounted line alone rather than discounting it twice", () => {
    // 98 of 500 orders arrive with the discount already inside the lines.
    // `Σ price === ticket` there, and the scale has to be 1.
    const [l] = resolveLineCosts({ ...base, ticket: 10, lines: [line(10)] })
    expect(l.charged).toBeCloseTo(10)
    expect(l.keep).toBeCloseTo(8)
  })

  it("never scales a line UP to cover the lines that are missing", () => {
    // A partially drained order: $10 on file against a $36.65 ticket. Scaling
    // to the ticket would credit this line with $36.65 of revenue it did not
    // take. The shortfall is the Items table's to state, not this line's.
    const [l] = resolveLineCosts({ ...base, ticket: 36.65, lines: [line(10)] })
    expect(l.charged).toBeCloseTo(10)
    expect(l.keep).toBeCloseTo(8)
  })

  it("leaves a comped order's lines alone rather than dividing by its zero ticket", () => {
    const [l] = resolveLineCosts({ ...base, ticket: 0, lines: [line(10)] })
    expect(l.charged).toBeCloseTo(10)
  })
})
