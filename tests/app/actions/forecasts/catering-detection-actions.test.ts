// getCateringDetection — bulk-order outliers vs per-(store, platform) median.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findFirst: vi.fn() },
    otterOrder: { findMany: vi.fn() },
  },
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { getCateringDetection } from "@/app/actions/forecasts/catering-detection-actions"

const sessionWith = (overrides: Record<string, unknown> = {}) => ({
  user: { id: "u1", accountId: "acct-A", ...overrides },
})

beforeEach(() => {
  vi.clearAllMocks()
})

interface OrderFx {
  id: string
  storeId?: string
  platform?: string
  refTime: string
  syncedAt?: string
  subtotal: number
  total?: number
  customerName?: string | null
  itemQty?: number
  externalDisplayId?: string | null
}

function order(o: OrderFx) {
  const items: { id: string; quantity: number }[] = []
  const totalQty = o.itemQty ?? Math.max(1, Math.round(o.subtotal / 15))
  // Distribute into a few line items
  const lines = Math.min(totalQty, 5)
  for (let i = 0; i < lines; i++) {
    items.push({ id: `${o.id}-i${i}`, quantity: totalQty / lines })
  }
  return {
    id: o.id,
    externalDisplayId: o.externalDisplayId ?? `D-${o.id}`,
    storeId: o.storeId ?? "store-A",
    platform: o.platform ?? "doordash",
    referenceTimeLocal: new Date(o.refTime),
    syncedAt: new Date(o.syncedAt ?? o.refTime),
    customerName: o.customerName ?? null,
    subtotal: o.subtotal,
    total: o.total ?? o.subtotal * 1.1,
    items,
  }
}

describe("getCateringDetection", () => {
  it("returns null without a session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    expect(await getCateringDetection({})).toBeNull()
  })

  it("guards cross-account storeId", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findFirst).mockResolvedValue(null as never)
    expect(await getCateringDetection({ storeId: "stranger" })).toEqual({
      ok: false,
      error: "store_not_in_account",
    })
  })

  it("returns no_data when no orders are in window", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.otterOrder.findMany).mockResolvedValue([] as never)
    expect(await getCateringDetection({})).toEqual({
      ok: false,
      error: "no_data",
    })
  })

  it("flags an order ≥ 3× the per-(store, platform) median subtotal", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    // 9 normal orders @ $25 → median = $25. 1 outlier @ $300.
    const fixtures: OrderFx[] = []
    for (let i = 0; i < 9; i++) {
      fixtures.push({
        id: `n${i}`,
        refTime: "2026-05-01T18:00:00Z",
        subtotal: 25,
        itemQty: 2,
      })
    }
    fixtures.push({
      id: "big-1",
      refTime: "2026-05-05T18:00:00Z",
      subtotal: 300,
      itemQty: 8,
    })
    vi.mocked(prisma.otterOrder.findMany).mockResolvedValue(
      fixtures.map(order) as never,
    )
    const result = await getCateringDetection({
      asOf: new Date("2026-05-08T00:00:00Z"),
    })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.orders.map((o) => o.orderId)).toEqual(["big-1"])
    const o = result.data.orders[0]
    expect(o.subtotalMultiplier).toBeCloseTo(12, 5) // 300/25
    expect(o.triggers).toContain("subtotal_multiplier")
    expect(o.triggers).toContain("subtotal_absolute")
  })

  it("flags an order solely on item-quantity threshold even when subtotal isn't extreme", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    // High-volume cheap items: 20 sodas @ $3 each = $60 subtotal.
    // Median over fixtures including this is $60 → multiplier = 1.0,
    // subtotal isn't above $200, but itemQuantity=20 ≥ 12.
    const fixtures: OrderFx[] = []
    for (let i = 0; i < 5; i++) {
      fixtures.push({
        id: `n${i}`,
        refTime: "2026-05-01T18:00:00Z",
        subtotal: 60,
        itemQty: 4,
      })
    }
    fixtures.push({
      id: "bulk-soda",
      refTime: "2026-05-03T18:00:00Z",
      subtotal: 60,
      itemQty: 20,
    })
    vi.mocked(prisma.otterOrder.findMany).mockResolvedValue(
      fixtures.map(order) as never,
    )
    const result = await getCateringDetection({
      asOf: new Date("2026-05-08T00:00:00Z"),
    })
    if (!result || !result.ok) throw new Error("expected ok")
    const flagged = result.data.orders
    expect(flagged.map((o) => o.orderId)).toContain("bulk-soda")
    const bulk = flagged.find((o) => o.orderId === "bulk-soda")!
    expect(bulk.triggers).toEqual(["item_quantity"])
  })

  it("computes leadHours when the order has a future reference time vs sync", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.otterOrder.findMany).mockResolvedValue(
      [
        order({
          id: "scheduled-1",
          refTime: "2026-05-08T18:00:00Z",
          syncedAt: "2026-05-07T12:00:00Z", // 30h before
          subtotal: 250,
          itemQty: 15,
        }),
      ] as never,
    )
    const result = await getCateringDetection({
      asOf: new Date("2026-05-09T00:00:00Z"),
    })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.orders).toHaveLength(1)
    expect(result.data.orders[0].leadHours).toBeCloseTo(30, 1)
  })

  it("isolates per-(store, platform) medians so a quiet platform's outlier still flags", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    // doordash is busy, average $30. ubereats is quiet, average $15.
    // A $50 ubereats order should still flag (3.3× median for that platform).
    const fixtures: OrderFx[] = []
    for (let i = 0; i < 8; i++)
      fixtures.push({
        id: `dd${i}`,
        platform: "doordash",
        refTime: "2026-05-01T18:00:00Z",
        subtotal: 30,
        itemQty: 2,
      })
    for (let i = 0; i < 5; i++)
      fixtures.push({
        id: `ue${i}`,
        platform: "ubereats",
        refTime: "2026-05-01T18:00:00Z",
        subtotal: 15,
        itemQty: 1,
      })
    fixtures.push({
      id: "ue-big",
      platform: "ubereats",
      refTime: "2026-05-05T18:00:00Z",
      subtotal: 50,
      itemQty: 3,
    })
    vi.mocked(prisma.otterOrder.findMany).mockResolvedValue(
      fixtures.map(order) as never,
    )
    const result = await getCateringDetection({
      asOf: new Date("2026-05-08T00:00:00Z"),
      minSubtotalAbsolute: 999, // disable the absolute trigger so we test the multiplier path
      minItemCount: 999, // disable item-qty trigger
    })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.orders.map((o) => o.orderId)).toEqual(["ue-big"])
  })
})
