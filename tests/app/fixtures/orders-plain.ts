import { buildOrderPlain, buildOrdersPlain } from "@/lib/counter/orders-plain"

/** The plain sections for the page fixtures, built by the real builders. */
export const ORDERS_PLAIN = buildOrdersPlain({
  orders: 187,
  netSales: 5_432.1,
  ticket: 29.05,
  fees: 412.5,
  thirdPartyCount: 120,
  thirdPartyNetSales: 3_600,
  estimatedPct: 0,
  unpriced: 0,
  undrained: 0,
  vs: { text: "▲ 5.1% on last week", tone: "is-up" },
  latest: [],
})

export const ORDER_PLAIN = buildOrderPlain({
  platform: "DoorDash",
  house: false,
  ticket: 38.4,
  commission: 9.6,
  rate: 0.25,
  keep: 28.8,
  cost: 11.2,
  uncosted: 0,
})
