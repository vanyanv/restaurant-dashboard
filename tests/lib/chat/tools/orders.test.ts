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

import { getOrderById, listOrdersByDay } from "@/lib/chat/tools/orders"
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
