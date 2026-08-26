/**
 * The Orders adapter's contract.
 *
 * Five things these tests exist to catch, and every one of them is a figure
 * that would look plausible on the page while being wrong:
 *
 * 1. **A total row that does not add up its own column.** The items table's
 *    total is the sum of the rows drawn above it. Reading `OtterOrder.total`
 *    instead prints a figure that disagrees with the lines a reader is
 *    looking at — the exact defect the cascade discipline exists to prevent.
 * 2. **A margin printed on a comped line.** `(keep − cost) / keep` with a
 *    zero `keep` is a division by zero; `Infinity%` or `NaN%` on a table cell
 *    is worse than an em dash.
 * 3. **Tax subtracted.** The prototype drew tax as an operation and then did
 *    not apply it (its own comment at line 6600 records the repair). Tax is
 *    stated in prose and is never a `MathRow`.
 * 4. **An empty queue drawn as a queue.** "Needs you" with nothing in it is a
 *    section with no content, not a list of length zero.
 * 5. **A meter under a figure nothing published a target for** (ruling O-R2),
 *    and **`$0.00` of commission on an in-house order**, which is the same lie
 *    `channel-mix.ts` refuses to tell about Grubhub.
 */
import { describe, it, expect, vi } from "vitest"

// Both actions import `@/lib/prisma` at module load, which throws without a
// DATABASE_URL — the same reason the adapters take their data as arguments.
vi.mock("@/app/actions/order-actions", () => ({
  getOrdersList: vi.fn(),
  getOrderDetail: vi.fn(),
}))
vi.mock("@/app/actions/hourly-orders-actions", () => ({
  getHourlyPatternsForRange: vi.fn(),
}))
vi.mock("@/lib/recipe-cost-batch", () => ({ batchRecipeCosts: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import type { OrderDetail, OrderListResponse } from "@/app/actions/order-actions"
import type { HourlyOrderPoint, OrderPatternsHourlyComparison } from "@/types/analytics"
import { resolveLineCosts, type LineCost } from "@/lib/counter/order-costs"
import { comparisonContext, type ComparisonContext } from "@/lib/counter/comparison"
import { hasData } from "@/lib/counter/section-data"
import {
  buildNeedsYou,
  buildOrderHead,
  buildOrderItems,
  buildOrderKeep,
  buildOrderPlatform,
  buildOrderStrip,
  buildOrderTimeline,
  buildOrdersByHour,
  buildOrdersList,
  buildOrdersStrip,
  buildRecipeBySku,
  commissionRateOf,
  flattenOrderLines,
  type OrderLine,
} from "@/lib/counter/adapters/orders"

/* ── Fixtures ─────────────────────────────────────────────────────────── */

const DASH = "—"

/**
 * 9:32pm on Aug 21 2026, as `referenceTimeLocal` actually holds it: the STORE's
 * wall clock encoded as a UTC instant. Read with `getUTCHours`, it is 9:32pm
 * in Hollywood; read with `getHours` it is 9:32pm wherever the server happens
 * to be, which is the monitoring bug this project has already shipped once.
 */
const PLACED = new Date(Date.UTC(2026, 7, 21, 21, 32, 4))

function listRow(over: Partial<OrderListResponse["rows"][number]> = {}) {
  return {
    id: "o1",
    otterOrderId: "OTTER-1",
    externalDisplayId: "4821",
    storeId: "st1",
    storeName: "Hollywood",
    platform: "doordash",
    referenceTimeLocal: PLACED,
    fulfillmentMode: "DELIVERY",
    orderStatus: "COMPLETED",
    customerName: "Sam",
    itemCount: 3,
    subtotal: 36.65,
    tax: 3.3,
    tip: 0,
    discount: 0,
    total: 39.95,
    detailsFetched: true,
    commission: 9.16,
    ...over,
  }
}

function listResponse(over: Partial<OrderListResponse> = {}): OrderListResponse {
  return {
    rows: [listRow()],
    nextCursor: null,
    platforms: ["css-pos", "doordash", "ubereats"],
    totalCount: 187,
    undrainedCount: 0,
    totals: { netSales: 4_812.5, commission: 684, thirdPartyNetSales: 2_935.6 },
    ...over,
  }
}

const noComparison: ComparisonContext = comparisonContext("none", null)

function order(over: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: "o1",
    otterOrderId: "OTTER-1",
    externalDisplayId: "4821",
    storeName: "Hollywood",
    platform: "doordash",
    referenceTimeLocal: PLACED,
    fulfillmentMode: "DELIVERY",
    orderStatus: "COMPLETED",
    acceptanceStatus: "ACCEPTED",
    customerName: "Sam",
    subtotal: 20.75,
    tax: 1.87,
    tip: 0,
    commission: 5.19,
    discount: 0,
    total: 22.62,
    detailsFetchedAt: new Date(Date.UTC(2026, 7, 21, 23, 2, 0)),
    syncedAt: new Date(Date.UTC(2026, 7, 21, 23, 2, 0)),
    items: [
      {
        id: "i1",
        skuId: "SKU-SLIDER",
        name: "Double Slider",
        quantity: 1,
        price: 12.0,
        subItems: [
          {
            id: "s1",
            skuId: "SKU-ONION",
            name: "Add Grilled Onion",
            quantity: 1,
            price: 0.75,
            subHeader: "Extras",
          },
        ],
      },
      { id: "i2", skuId: "SKU-FRIES", name: "Cheese Fries", quantity: 1, price: 8.0, subItems: [] },
    ],
    ...over,
  }
}

/** The lines of `order()`, costed: the slider and the fries priced, the modifier not. */
function costsFor(o: OrderDetail, opts: { commissionRate?: number } = {}): LineCost[] {
  const lines = flattenOrderLines(o)
  const rate = opts.commissionRate ?? commissionRateOf(o)
  return resolveLineCosts({
    lines,
    recipeBySku: new Map([
      ["SKU-SLIDER", "r-slider"],
      ["SKU-FRIES", "r-fries"],
    ]),
    costByRecipe: new Map([
      ["r-slider", { totalCost: 3.1, partial: false }],
      ["r-fries", { totalCost: 1.4, partial: false }],
    ]),
    commissionRate: rate,
  })
}

/** A number back out of a formatted money string, for a sum assertion. */
function cash(s: string): number {
  const negative = s.startsWith("(") || s.startsWith("−")
  const n = Number(s.replace(/[()$,−]/g, ""))
  return negative ? -n : n
}

/* ── The orders list ──────────────────────────────────────────────────── */

describe("buildOrdersStrip", () => {
  it("draws the prototype's five cells and judges none of them (ruling O-R2)", () => {
    const cells = buildOrdersStrip(listResponse(), null, noComparison)

    expect(cells).toHaveLength(5)
    expect(cells.map((c) => c.label)).toEqual([
      "Orders",
      "Net sales",
      "Avg ticket",
      "Marketplace fees",
      "Details not drained",
    ])
    // Nothing in this schema publishes a per-order target, a fee ceiling or a
    // ticket floor. A reference here would be a meter built from a constant.
    for (const cell of cells) expect(cell.reference).toBeUndefined()
  })

  it("reads its figures off the whole matched range, never off the returned page", () => {
    // One row on the page, 187 matched. A strip that summed `rows` would say 1.
    const cells = buildOrdersStrip(listResponse(), null, noComparison)
    expect(cells[0].value).toBe("187")
    expect(cells[1].value).toBe("$4,813")
    // 4812.50 / 187
    expect(cells[2].value).toBe("$25.74")
  })

  it("states the fee cell as a share of third-party sales, and the drain as a count", () => {
    const cells = buildOrdersStrip(listResponse(), null, noComparison)
    expect(cells[3].value).toBe("$684")
    // 684 / 2935.60
    expect(cells[3].delta).toBe("23.3% of 3P")
    expect(cells[4].value).toBe("0")
    expect(cells[4].delta).toBe("all drained")

    const pending = buildOrdersStrip(
      listResponse({ undrainedCount: 12 }),
      null,
      noComparison,
    )
    expect(pending[4].value).toBe("12")
    expect(pending[4].delta).toBe("12 pending")
  })

  it("compares against the comparison range when there is one", () => {
    const cmp = comparisonContext("prev", null)
    const on: ComparisonContext = { ...cmp, on: true }
    const cells = buildOrdersStrip(
      listResponse(),
      listResponse({
        totalCount: 170,
        totals: { netSales: 4_400, commission: 600, thirdPartyNetSales: 2_700 },
      }),
      on,
    )
    expect(cells[0].delta).toBe("▲ 10.0% vs the prior period")
    expect(cells[1].delta).toBe("▲ 9.4% vs the prior period")
  })
})

describe("buildOrdersList", () => {
  it("prints the fee of an in-house order as an em dash, not $0.00", () => {
    const list = buildOrdersList(
      listResponse({
        rows: [
          listRow({ id: "h1", platform: "css-pos", commission: 0, subtotal: 14.2 }),
          listRow({ id: "d1", platform: "doordash", commission: 3.55, subtotal: 14.2 }),
        ],
      }),
      { search: "", platform: null },
    )

    expect(list.rows[0].fees).toBe(DASH)
    expect(list.rows[0].channel.label).toBe("In-house")
    // The channel that DID take a share still states what it took.
    expect(list.rows[1].fees).toBe("$3.55")
  })

  it("reads the clock off the store's own wall time, not the server's", () => {
    const list = buildOrdersList(listResponse(), { search: "", platform: null })
    expect(list.rows[0].time).toBe("9:32pm")
    expect(list.rows[0].id).toBe("#4821")
    expect(list.rows[0].href).toBe("/dashboard/orders/o1")
  })

  it("counts what is shown of what matched, and offers a toggle per platform on file", () => {
    const list = buildOrdersList(listResponse(), { search: "", platform: "doordash" })
    expect(list.count).toBe("1 of 187")
    expect(list.toggles.map((t) => t.id)).toEqual(["css-pos", "doordash", "ubereats"])
    expect(list.toggles.map((t) => t.pressed)).toEqual([false, true, false])
    expect(list.toggles[1].tint).toBe("--ch-dd")
  })
})

describe("buildOrdersByHour", () => {
  it("names the baseline from the range's own weekday and never hardcodes one", () => {
    const hourly: HourlyOrderPoint[] = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      label: `${h}`,
      orderCount: h,
      totalSales: h * 20,
      avgOrderCount: h * 0.9,
      avgTotalSales: h * 18,
    }))
    const cmp = { weekdayLabel: "Fri" } as OrderPatternsHourlyComparison

    // 2026-08-21 is a Friday; 2026-08-20 a Thursday.
    const friday = buildOrdersByHour(hourly, cmp, {
      start: new Date(2026, 7, 21),
      end: new Date(2026, 7, 21),
    })
    expect(friday.meta).toBe("baseline = the last four Fridays")

    const thursday = buildOrdersByHour(hourly, cmp, {
      start: new Date(2026, 7, 20),
      end: new Date(2026, 7, 20),
    })
    expect(thursday.meta).toBe("baseline = the last four Thursdays")

    expect(friday.chart.type).toBe("bars")
    expect(friday.chart.series[0].data).toHaveLength(24)
  })

  it("draws no baseline line when there is nothing to compare against", () => {
    const hourly: HourlyOrderPoint[] = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      label: `${h}`,
      orderCount: h,
      totalSales: 0,
      avgOrderCount: 0,
      avgTotalSales: 0,
    }))
    const spec = buildOrdersByHour(hourly, null, {
      start: new Date(2026, 7, 17),
      end: new Date(2026, 7, 23),
    })
    expect(spec.chart.series).toHaveLength(1)
    expect(spec.meta).toBe("no baseline for this range")
  })
})

/* ── One order ────────────────────────────────────────────────────────── */

describe("flattenOrderLines", () => {
  it("puts each modifier directly under the item that carries it", () => {
    const lines = flattenOrderLines(order())
    expect(lines.map((l) => l.name)).toEqual([
      "Double Slider",
      "Add Grilled Onion",
      "Cheese Fries",
    ])
    expect(lines.map((l) => l.modifier)).toEqual([false, true, false])
  })
})

describe("buildRecipeBySku", () => {
  it("falls back to the item NAME when OtterItemMapping.skuId is null", () => {
    const lines: OrderLine[] = flattenOrderLines(order())

    const map = buildRecipeBySku(
      lines,
      [
        // A legacy row: mapped before Otter SKUs were stored, so it identifies
        // its item by name alone.
        { skuId: null, otterItemName: "Double Slider", recipeId: "r-slider" },
        { skuId: "SKU-FRIES", otterItemName: "Cheese Fries", recipeId: "r-fries" },
      ],
      [{ skuId: "SKU-ONION", recipeId: "r-onion" }],
    )

    expect(map.get("SKU-SLIDER")).toBe("r-slider")
    expect(map.get("SKU-FRIES")).toBe("r-fries")
    expect(map.get("SKU-ONION")).toBe("r-onion")
  })

  it("prefers a sku match over a name match when both exist", () => {
    const lines: OrderLine[] = flattenOrderLines(order())
    const map = buildRecipeBySku(
      lines,
      [
        { skuId: "SKU-SLIDER", otterItemName: "Double Slider (2026)", recipeId: "r-new" },
        { skuId: null, otterItemName: "Double Slider", recipeId: "r-legacy" },
      ],
      [],
    )
    expect(map.get("SKU-SLIDER")).toBe("r-new")
  })

  it("leaves a line with neither match out of the map entirely", () => {
    const map = buildRecipeBySku(flattenOrderLines(order()), [], [])
    expect(map.size).toBe(0)
  })
})

describe("buildOrderItems", () => {
  it("totals the rows drawn above it, not the order's own total column", () => {
    // The lines say 20.75; the order's `total` column says 39.95 (it carries
    // tax, and on a real order it can simply disagree). The table has to add
    // up the column a reader can see.
    const o = order()
    const items = buildOrderItems(o, costsFor(o))

    expect(items.rows).toHaveLength(3)
    const drawn = items.rows.reduce((t, r) => t + cash(r.price), 0)
    expect(cash(items.total.price)).toBeCloseTo(drawn, 2)
    expect(cash(items.total.price)).toBeCloseTo(20.75, 2)
    expect(items.total.price).not.toBe("$22.62")
  })

  it("still totals its own lines when the order's column is a cent out", () => {
    const o = order({ total: 20.76, subtotal: 20.76 })
    const items = buildOrderItems(o, costsFor(o))
    expect(cash(items.total.price)).toBeCloseTo(20.75, 2)
  })

  it("totals the keep and the food cost the same way", () => {
    const o = order()
    const items = buildOrderItems(o, costsFor(o))
    const keep = items.rows.reduce((t, r) => t + cash(r.keep), 0)
    expect(cash(items.total.keep)).toBeCloseTo(keep, 2)
    // Only the two mapped lines have a cost: 3.10 + 1.40.
    expect(cash(items.total.cost)).toBeCloseTo(4.5, 2)
  })

  it("prints no margin when keep is zero", () => {
    const o = order({
      items: [
        { id: "i1", skuId: "SKU-SLIDER", name: "Comped Slider", quantity: 1, price: 0, subItems: [] },
      ],
    })
    const costs = resolveLineCosts({
      lines: flattenOrderLines(o),
      recipeBySku: new Map([["SKU-SLIDER", "r-slider"]]),
      costByRecipe: new Map([["r-slider", { totalCost: 3.1, partial: false }]]),
      commissionRate: 0,
    })
    const items = buildOrderItems(o, costs)

    expect(items.rows[0].keep).toBe("$0.00")
    expect(items.rows[0].margin).toBe(DASH)
    // And the total row divides by the same zero.
    expect(items.total.margin).toBe(DASH)
  })

  it("marks an uncosted line rather than pricing it at zero", () => {
    const o = order()
    const items = buildOrderItems(o, costsFor(o))
    const modifier = items.rows[1]
    expect(modifier.modifier).toBe(true)
    expect(modifier.uncosted).toBe(true)
    expect(modifier.cost).toBe("not costed")
    expect(modifier.margin).toBe(DASH)
  })

  it("says so when the line detail has not been drained", () => {
    const o = order({ items: [], detailsFetchedAt: null })
    const items = buildOrderItems(o, [])
    expect(items.rows).toHaveLength(0)
    expect(items.meta).toBe("line detail not drained yet")
  })
})

describe("buildOrderKeep", () => {
  it("states the tax and never subtracts it", () => {
    const o = order()
    const keep = buildOrderKeep(o, costsFor(o))

    for (const row of keep.rows) {
      expect(row.label.toLowerCase()).not.toContain("tax")
      expect(row.key).not.toBe("tax")
    }
    expect(keep.note).toContain("$1.87")
    expect(keep.note).toContain("never yours")
  })

  it("draws the chain the prototype draws, in its order", () => {
    const o = order()
    const keep = buildOrderKeep(o, costsFor(o))
    expect(keep.rows.map((r) => r.key)).toEqual([
      "ticket",
      "commission",
      "net",
      "food",
      "contribution",
    ])
    // Every row is a term that IS summed into the figure below it.
    const ticket = cash(keep.rows[0].value)
    const commission = cash(keep.rows[1].value)
    const net = cash(keep.rows[2].value)
    expect(net).toBeCloseTo(ticket + commission, 2)
  })

  it("warns that a contribution built on an uncosted line is generous", () => {
    const o = order()
    const keep = buildOrderKeep(o, costsFor(o))
    expect(keep.note).toContain("generous")
  })

  it("draws no food or contribution row when nothing on the order is costed", () => {
    const o = order()
    const costs = resolveLineCosts({
      lines: flattenOrderLines(o),
      recipeBySku: new Map(),
      costByRecipe: new Map(),
      commissionRate: 0.25,
    })
    const keep = buildOrderKeep(o, costs)
    expect(keep.rows.map((r) => r.key)).toEqual(["ticket", "commission", "net"])
  })
})

describe("buildOrderStrip", () => {
  it("draws five cells and judges none of them (ruling O-R2)", () => {
    const o = order()
    const cells = buildOrderStrip(o, costsFor(o))
    expect(cells.map((c) => c.label)).toEqual([
      "Ticket",
      "Commission",
      "You keep",
      "Food cost",
      "Contribution",
    ])
    for (const cell of cells) expect(cell.reference).toBeUndefined()
  })

  it("prints an in-house order's commission as an em dash, not $0.00", () => {
    const o = order({ platform: "css-pos", commission: 0 })
    const cells = buildOrderStrip(o, costsFor(o, { commissionRate: 0 }))
    expect(cells[1].value).toBe(DASH)
  })

  it("names how many lines are not costed", () => {
    const o = order()
    const cells = buildOrderStrip(o, costsFor(o))
    expect(cells[3].delta).toBe("1 line not costed")
  })
})

describe("buildOrderHead / timeline / platform", () => {
  it("heads the page with the order's own id and the channel that took it", () => {
    const head = buildOrderHead(order())
    expect(head.title).toBe("Order #4821")
    expect(head.sub).toBe("DoorDash · Aug 21, 9:32pm · 2 items")
  })

  it("prints the placed time on the store's clock and the sync time as an instant", () => {
    const rows = buildOrderTimeline(order())
    const byLabel = new Map(rows.map((r) => [r.label, r.value]))
    expect(byLabel.get("Placed")).toBe("Aug 21, 9:32pm")
    expect(String(byLabel.get("Synced to us"))).toContain("UTC")
  })

  it("states the platform facts it has and em-dashes the ones it does not", () => {
    const rows = buildOrderPlatform(order({ externalDisplayId: null }))
    const byLabel = new Map(rows.map((r) => [r.label, r.value]))
    expect(byLabel.get("Channel")).toBe("DoorDash")
    expect(byLabel.get("External id")).toBe(DASH)
    expect(byLabel.get("Fulfilment")).toBe("DELIVERY")
  })
})

describe("buildNeedsYou", () => {
  it("is empty — not a queue of length zero — when every line is costed", () => {
    const o = order()
    const lines = flattenOrderLines(o)
    const costs = resolveLineCosts({
      lines,
      recipeBySku: new Map([
        ["SKU-SLIDER", "r-slider"],
        ["SKU-ONION", "r-onion"],
        ["SKU-FRIES", "r-fries"],
      ]),
      costByRecipe: new Map([
        ["r-slider", { totalCost: 3.1, partial: false }],
        ["r-onion", { totalCost: 0.08, partial: false }],
        ["r-fries", { totalCost: 1.4, partial: false }],
      ]),
      commissionRate: 0.25,
    })

    const sd = buildNeedsYou(lines, costs, new Map())
    expect(sd.status).toBe("empty")
    expect(sd).toMatchObject({ status: "empty", reason: "no_match" })
    expect(hasData(sd)).toBe(false)
  })

  it("raises one item per distinct unmapped sku, leading with how often it sells", () => {
    const o = order()
    const lines = flattenOrderLines(o)
    const costs = costsFor(o)

    const sd = buildNeedsYou(lines, costs, new Map([["SKU-ONION", 188]]))
    expect(hasData(sd)).toBe(true)
    const items = hasData(sd) ? sd.data : []
    expect(items).toHaveLength(1)
    expect(items[0].key).toBe("SKU-ONION")
    expect(items[0].lead).toBe("188")
    expect(items[0].unit).toBe("orders")
    expect(items[0].title).toContain("Add Grilled Onion")
    // A function cannot cross the RSC boundary, so the adapter never wires one.
    expect(items[0].act).toBeUndefined()
  })

  it("counts a sku once however many lines carry it", () => {
    const o = order({
      items: [
        {
          id: "i1",
          skuId: "SKU-SLIDER",
          name: "Double Slider",
          quantity: 1,
          price: 12,
          subItems: [
            { id: "s1", skuId: "SKU-ONION", name: "Add Grilled Onion", quantity: 1, price: 0.75, subHeader: null },
          ],
        },
        {
          id: "i2",
          skuId: "SKU-SLIDER",
          name: "Double Slider",
          quantity: 1,
          price: 12,
          subItems: [
            { id: "s2", skuId: "SKU-ONION", name: "Add Grilled Onion", quantity: 1, price: 0.75, subHeader: null },
          ],
        },
      ],
    })
    const lines = flattenOrderLines(o)
    const costs = resolveLineCosts({
      lines,
      recipeBySku: new Map([["SKU-SLIDER", "r-slider"]]),
      costByRecipe: new Map([["r-slider", { totalCost: 3.1, partial: false }]]),
      commissionRate: 0.25,
    })
    const sd = buildNeedsYou(lines, costs, new Map())
    const items = hasData(sd) ? sd.data : []
    expect(items).toHaveLength(1)
    // No count on file is an em dash, never a zero.
    expect(items[0].lead).toBe(DASH)
  })
})

/*
 * The bug this file could not see.
 *
 * Every fixture above has `subtotal − discount` COINCIDENTALLY equal to
 * `Σ line.price`, so for a long time the list computed the ticket one way and
 * the detail the other and all 32 tests passed. It took a reviewer reading both
 * call sites. A partially-drained order is where they part company, and it is
 * the ordinary case: Otter delivers the order first and its lines later.
 */
describe("one order, one ticket", () => {
  const PARTIAL = {
    subtotal: 36.65,
    discount: 0,
    commission: 9.16,
    // Only ONE of the three lines has been drained from Otter so far.
    items: [
      { id: "i1", skuId: "SKU-SLIDER", name: "Double Slider", quantity: 1, price: 12.0, subItems: [] },
    ],
  }

  function ticketOnDetail() {
    const o = order(PARTIAL)
    const lines = flattenOrderLines(o)
    const costs = resolveLineCosts({
      lines,
      recipeBySku: new Map(),
      costByRecipe: new Map(),
      commissionRate: commissionRateOf(o),
    })
    return buildOrderStrip(o, costs).find((c) => c.label === "Ticket")?.value
  }

  function ticketOnList() {
    const res = listResponse({
      rows: [listRow({ subtotal: PARTIAL.subtotal, discount: PARTIAL.discount, commission: PARTIAL.commission })],
    })
    return buildOrdersList(res, { platform: null, search: "" }).rows[0].ticket
  }

  it("prints the same ticket on the list and on the order's own page", () => {
    expect(ticketOnDetail()).toBe(ticketOnList())
  })

  it("reads the ticket off the order's columns, not off the lines drained so far", () => {
    // Σ line.price is $12.00 here. The customer was charged $36.65.
    expect(ticketOnDetail()).toBe("$36.65")
  })
})

describe("a margin nothing can be believed about", () => {
  it("renders an em dash rather than a flattering figure when keep is negative", () => {
    // A rate above 1 is reachable on a partially-drained order whose recorded
    // commission exceeds the lines on file. `(keep − cost) / keep` then divides
    // by a negative and returns a finite 400.0% — the kind of wrong number a
    // reader acts on because nothing about it looks wrong.
    const o = order({ subtotal: 10, discount: 0, commission: 14 })
    const lines = flattenOrderLines(o)
    const costs: LineCost[] = lines.map((l, i) => ({
      key: l.key, name: l.name, modifier: l.modifier, quantity: l.quantity,
      price: l.price, keep: -1, cost: i === 0 ? 3 : null,
      uncostedReason: i === 0 ? null : ("unmapped" as const),
    }))
    for (const row of buildOrderItems(o, costs).rows) {
      expect(row.margin).toBe(DASH)
    }
  })
})
