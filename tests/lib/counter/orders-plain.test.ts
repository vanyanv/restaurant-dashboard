import { describe, expect, it } from "vitest"
import { buildOrderPlain, buildOrdersPlain, LATEST_SHOWN, type OrderPlainInput, type OrdersPlainInput } from "@/lib/counter/orders-plain"

const row = (i: number) => ({
  key: `o${i}`,
  href: `/dashboard/orders/o${i}`,
  id: `#48${i}`,
  time: "9:32pm",
  channel: { label: "DoorDash" },
  items: "3 items",
  ticket: "$27.49",
  net: "$18.33",
})

const range = (over: Partial<OrdersPlainInput> = {}): OrdersPlainInput => ({
  orders: 187,
  netSales: 5_432,
  ticket: 29.05,
  fees: 412,
  thirdPartyCount: 120,
  thirdPartyNetSales: 3_600,
  estimatedPct: 0,
  unpriced: 0,
  undrained: 0,
  vs: { text: "▲ 5.1% on last week", tone: "is-up" },
  latest: Array.from({ length: 8 }, (_, i) => row(i)),
  ...over,
})

describe("buildOrdersPlain", () => {
  it("says the count, the comparison, the sales, the ticket and the app fees in one sentence", () => {
    const p = buildOrdersPlain(range())
    expect(p.sentence).toBe(
      "187 orders (▲ 5.1% on last week) brought in $5,432, an average ticket of $29.05. Delivery apps took $412 in fees, 11.4% of their sales.",
    )
    expect(p.vs).toEqual({ text: "▲ 5.1% on last week", tone: "up" })
    expect(p.statuses).toEqual([
      { tone: "off", text: "More orders than the comparison" },
      { tone: "good", text: "Every order has its details" },
    ])
  })

  it("lists only the latest few, worded for a card", () => {
    const p = buildOrdersPlain(range())
    expect(p.latest).toHaveLength(LATEST_SHOWN)
    expect(p.latest[0]).toEqual({ key: "o0", href: "/dashboard/orders/o0", what: "9:32pm · DoorDash", sub: "#480 · 3 items", ticket: "$27.49", net: "$18.33" })
  })

  it("labels fees not on file and missing details rather than counting them as nothing", () => {
    const p = buildOrdersPlain(range({ fees: null, undrained: 3, estimatedPct: 40, unpriced: 2, vs: { text: "▼ 4% on last week", tone: "is-down" } }))
    expect(p.sentence).toContain("App fees are not on file for these orders yet.")
    expect(p.statuses[0].tone).toBe("off")
    expect(p.sentence).toContain("3 orders are still missing item details.")
    expect(p.statuses.map((s) => s.text)).toEqual([
      "Fewer orders than the comparison",
      "App fees estimated on 40% of app orders",
      "2 app orders with no fee or rate",
      "3 orders missing item details",
    ])
  })

  it("says plainly when nothing came in, and makes no comparison claim", () => {
    const p = buildOrdersPlain(range({ orders: 0, netSales: 0, ticket: null, fees: null, thirdPartyCount: 0, latest: [] }))
    expect(p.sentence).toBe("No orders came in for this range yet.")
    expect(p.statuses).toEqual([])
    expect(p.sub).toBe("")
  })

  it("says the fees are about when some are estimated", () => {
    expect(buildOrdersPlain(range({ estimatedPct: 30 })).sentence).toContain("Delivery apps took about $412 in fees")
  })

  it("leaves the app-fee sentence out when no app orders came in", () => {
    expect(buildOrdersPlain(range({ thirdPartyCount: 0 })).sentence).not.toContain("Delivery apps")
  })
})

const one = (over: Partial<OrderPlainInput> = {}): OrderPlainInput => ({
  platform: "DoorDash",
  house: false,
  ticket: 38.4,
  commission: 9.6,
  rate: 0.25,
  keep: 28.8,
  cost: 11.2,
  uncosted: 0,
  ...over,
})

describe("buildOrderPlain", () => {
  it("walks the money from what the guest paid to what is left", () => {
    const p = buildOrderPlain(one())
    expect(p.sentence).toBe("The guest paid $38.40. DoorDash took $9.60. Food cost $11.20, so $17.60 is left.")
    expect(p.lines.map((l) => [l.label, l.value])).toEqual([
      ["Paid", "$38.40"],
      ["DoorDash fee (25.0%)", "−$9.60"],
      ["Food (recipe cost)", "−$11.20"],
      ["Left after fees and food", "$17.60"],
    ])
    expect(p.big.value).toBe("$17.60")
    expect(p.statuses).toEqual([{ tone: "good", text: "Every line costed" }])
  })

  it("labels food not costed instead of treating it as $0", () => {
    const p = buildOrderPlain(one({ cost: null, uncosted: 3 }))
    expect(p.sentence).toBe("The guest paid $38.40. DoorDash took $9.60. You keep $28.80 before food, which is not costed for this order.")
    expect(p.lines.find((l) => l.key === "food")!.value).toBe("not costed")
    expect(p.big).toMatchObject({ label: "You keep, before food", value: "$28.80", missing: "food not costed" })
    expect(p.statuses).toEqual([{ tone: "warn", text: "Food not costed" }])
  })

  it("says when some lines are not costed, and when the order lost money", () => {
    const p = buildOrderPlain(one({ cost: 30, uncosted: 1 }))
    expect(p.sentence).toContain("the order lost $1.20")
    expect(p.sentence).toContain("1 line not costed, so the true figure is lower.")
    expect(p.statuses.map((s) => s.text)).toEqual(["1 line not costed", "Lost money on this order"])
  })

  it("draws no fee line on a house order", () => {
    const p = buildOrderPlain(one({ platform: "Website", house: true, commission: 0, rate: 0, keep: 38.4 }))
    expect(p.lines.map((l) => l.key)).toEqual(["paid", "food", "left"])
    expect(p.statuses.map((s) => s.text)).toContain("No app fee")
  })
})
