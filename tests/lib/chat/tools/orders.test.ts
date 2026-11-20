/*
 * The chat's order tools, and the money they hand an LLM.
 *
 * `OtterOrder.discount` and `.commission` are stored as SIGNED DEDUCTIONS —
 * negative numbers ADDED to reach a net (0 of 40,055 discount rows positive,
 * 0 of 25,648 commission rows positive, counted 2026-08-26). These tools
 * returned both at their raw sign with no sign contract anywhere the model
 * could read it: `describe-schema.ts` never mentions `OtterOrder`, and the
 * system prompt's only sign paragraph is scoped to `getPnlSummary`.
 *
 * On the real row below the model derived a $112.41 ticket where every one of
 * the four Orders surfaces says $37.47. The fix is that the columns do not
 * leave the tool.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/chat/owner-scope", () => ({
  assertOwnerOwnsStores: vi.fn(async () => ["s1"]),
}))

import { getOrderById, getOrderItemFrequency, listOrdersByDay } from "@/lib/chat/tools/orders"
import type { ChatToolContext } from "@/lib/chat/tools/types"

/** `3926DEFE` — a real 50%-off DoorDash order, read from the database. */
const REAL = {
  id: "o1",
  storeId: "s1",
  platform: "doordash",
  externalDisplayId: "3926DEFE",
  referenceTimeLocal: new Date("2026-07-12T19:32:00.000Z"),
  fulfillmentMode: "DELIVERY",
  orderStatus: "COMPLETED",
  customerName: "Sam",
  subtotal: 74.94,
  discount: -37.47,
  commission: -9.37,
  tax: 3.37,
  tip: 0,
  total: 41.4,
}

function ctx(order: Record<string, unknown> | null): ChatToolContext {
  return {
    ownerId: "u1",
    accountId: "acct-A",
    prisma: {
      otterOrder: {
        findFirst: vi.fn(async () => order),
        findMany: vi.fn(async () => (order ? [order] : [])),
      },
    } as unknown as ChatToolContext["prisma"],
  }
}

describe("getOrderById — the money the model is handed", () => {
  const run = () =>
    getOrderById.execute({ orderId: "3926DEFE" }, ctx({ ...REAL, items: [] }))

  it("hands over the ticket rather than two columns and a sign convention", async () => {
    const r = await run()
    expect(r.ticket).toBeCloseTo(37.47, 2)
    // The derivation the model reached for, and what it cost.
    expect(r.ticket).not.toBeCloseTo(REAL.subtotal - REAL.discount, 2)
  })

  it("states every deduction as a positive amount", async () => {
    const r = await run()
    expect(r.discountGiven).toBeCloseTo(37.47, 2)
    expect(r.marketplaceFee).toBeCloseTo(9.37, 2)
    // "a commission of −$9.37" reads as a credit. It was a charge.
    expect(r.marketplaceFee).toBeGreaterThan(0)
  })

  it("nets the order down, and reads DoorDash's own rate off the discounted ticket", async () => {
    const r = await run()
    expect(r.netToRestaurant).toBeCloseTo(28.1, 2)
    expect((r.marketplaceFeeRate ?? 0) * 100).toBeCloseTo(25, 1)
  })

  it("does not expose the raw signed columns at all", async () => {
    const r = (await run()) as Record<string, unknown>
    // A contract the model must apply correctly is weaker than a number that
    // is already right — so there is nothing here to apply it to.
    expect(r).not.toHaveProperty("commission")
    expect(r).not.toHaveProperty("discount")
  })

  it("still says so when the order is not the owner's", async () => {
    expect(await getOrderById.execute({ orderId: "nope" }, ctx(null))).toEqual({ found: false })
  })
})

describe("listOrdersByDay — a subtotal is not a ticket", () => {
  it("carries the ticket beside the pre-discount subtotal", async () => {
    const [row] = await listOrdersByDay.execute(
      { dateRange: { from: "2026-07-12", to: "2026-07-12" }, limit: 25, sortBy: "totalDesc" },
      ctx({ ...REAL, _count: { items: 3 } }),
    )
    expect(row.subtotal).toBeCloseTo(74.94, 2)
    expect(row.ticket).toBeCloseTo(37.47, 2)
    expect(row.marketplaceFee).toBeCloseTo(9.37, 2)
    expect(row.netToRestaurant).toBeCloseTo(28.1, 2)
  })
})

describe("getOrderItemFrequency — grouped in SQL", () => {
  type Grouped = { itemName: string; orderCount: number; totalQty: number; totalRevenue: number }
  function setup(grouped: Grouped[]) {
    const $queryRaw = vi.fn(async (..._a: unknown[]) => grouped)
    const findMany = vi.fn()
    return {
      $queryRaw,
      findMany,
      ctx: {
        ownerId: "u1",
        accountId: "acct-A",
        prisma: { $queryRaw, otterOrderItem: { findMany } } as unknown as ChatToolContext["prisma"],
      },
    }
  }
  const args = { dateRange: { from: "2026-08-01", to: "2026-08-31" }, minOrders: 3, limit: 7 }

  it("never loads the order lines, and pushes range, minOrders and limit into one statement", async () => {
    const t = setup([])
    await getOrderItemFrequency.execute(args, t.ctx)
    expect(t.findMany).not.toHaveBeenCalled()
    expect(t.$queryRaw).toHaveBeenCalledTimes(1)
    const q = t.$queryRaw.mock.calls[0][0] as { sql: string; values: unknown[] }
    expect(q.sql).toMatch(/GROUP BY i\."name"/)
    expect(q.sql).toMatch(/HAVING count\(DISTINCT i\."orderId"\) >= \?/)
    expect(q.sql).toMatch(/"referenceTimeLocal" >= \?::date/)
    expect(q.sql).toMatch(/"referenceTimeLocal" < \(\?::date \+ 1\)/)
    expect(q.values).toEqual(expect.arrayContaining(["s1", "2026-08-01", "2026-08-31", 3, 7]))
  })

  it("returns the same row shape: weighted avgPrice = revenue / qty, 0 for no quantity", async () => {
    const t = setup([
      { itemName: "Fries", orderCount: 2, totalQty: 7, totalRevenue: 76 },
      { itemName: "Free", orderCount: 1, totalQty: 0, totalRevenue: 0 },
    ])
    const rows = await getOrderItemFrequency.execute(args, t.ctx)
    expect(rows).toEqual([
      { itemName: "Fries", orderCount: 2, totalQty: 7, totalRevenue: 76, avgPrice: 76 / 7 },
      { itemName: "Free", orderCount: 1, totalQty: 0, totalRevenue: 0, avgPrice: 0 },
    ])
    expect(Object.keys(rows[0])).toEqual(["itemName", "orderCount", "totalQty", "totalRevenue", "avgPrice"])
  })

  it("coerces bigint/decimal-ish driver values to numbers", async () => {
    const t = setup([{ itemName: "Fries", orderCount: "4", totalQty: "8", totalRevenue: "16" } as unknown as Grouped])
    const [row] = await getOrderItemFrequency.execute(args, t.ctx)
    expect(row).toMatchObject({ orderCount: 4, totalQty: 8, totalRevenue: 16, avgPrice: 2 })
  })
})
