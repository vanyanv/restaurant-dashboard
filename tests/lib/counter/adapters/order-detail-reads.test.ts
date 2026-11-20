// The order page reads the order ONCE.
//
// `getOrderSections` loaded the order (with items and sub-items) through
// `getOrderDetail`, then read the same `OtterOrder` row again by id for the
// one column the detail does not carry, the store's id. The id now comes back
// with the detail, from the account-scoped read, and nothing else touches
// `OtterOrder` by id.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/app/actions/order-actions", () => ({
  getOrdersList: vi.fn(),
  getOrderDetailWithStoreId: vi.fn(),
}))
vi.mock("@/app/actions/hourly-orders-actions", () => ({ getHourlyPatternsForRange: vi.fn() }))
vi.mock("@/lib/recipe-cost-batch", () => ({ batchRecipeCosts: vi.fn() }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    otterOrder: { findUnique: vi.fn(), findFirst: vi.fn() },
    otterItemMapping: { findMany: vi.fn() },
    otterSubItemMapping: { findMany: vi.fn() },
    otterOrderItem: { groupBy: vi.fn() },
    otterOrderSubItem: { groupBy: vi.fn() },
  },
}))

import { prisma } from "@/lib/prisma"
import { getOrderDetailWithStoreId, type OrderDetail } from "@/app/actions/order-actions"
import { batchRecipeCosts } from "@/lib/recipe-cost-batch"
import { getOrderSections } from "@/lib/counter/adapters/orders"
import { hasData } from "@/lib/counter/section-data"

const order: OrderDetail = {
  id: "o1",
  otterOrderId: "OTTER-1",
  externalDisplayId: "4821",
  storeName: "Hollywood",
  platform: "doordash",
  referenceTimeLocal: new Date("2026-08-21T18:00:00Z"),
  fulfillmentMode: "DELIVERY",
  orderStatus: "COMPLETED",
  acceptanceStatus: null,
  customerName: "Sam",
  subtotal: 30,
  tax: 3,
  tip: 0,
  commission: -7,
  discount: 0,
  total: 33,
  detailsFetchedAt: new Date("2026-08-21T19:00:00Z"),
  syncedAt: new Date("2026-08-21T19:00:00Z"),
  items: [
    {
      id: "i1",
      skuId: "sku-1",
      name: "Burger",
      quantity: 1,
      price: 30,
      subItems: [{ id: "s1", skuId: "sub-1", name: "Bacon", quantity: 1, price: 0, subHeader: null }],
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrderDetailWithStoreId).mockResolvedValue({ order, storeId: "st1" })
  vi.mocked(prisma.otterItemMapping.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.otterSubItemMapping.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.otterOrderItem.groupBy).mockResolvedValue([] as never)
  vi.mocked(prisma.otterOrderSubItem.groupBy).mockResolvedValue([] as never)
  vi.mocked(batchRecipeCosts).mockResolvedValue(new Map() as never)
})

describe("getOrderSections — one read of the order", () => {
  it("loads the order once and never reads OtterOrder again for the store id", async () => {
    const s = await getOrderSections({ orderId: "o1", accountId: "acct-A", today: new Date("2026-08-22T00:00:00Z") })
    expect(getOrderDetailWithStoreId).toHaveBeenCalledTimes(1)
    expect(getOrderDetailWithStoreId).toHaveBeenCalledWith("o1")
    expect(prisma.otterOrder.findUnique).not.toHaveBeenCalled()
    expect(prisma.otterOrder.findFirst).not.toHaveBeenCalled()
    expect(hasData(s.head)).toBe(true)
  })

  it("keys the recipe mappings on the store id that came with the order", async () => {
    await getOrderSections({ orderId: "o1", accountId: "acct-A", today: new Date("2026-08-22T00:00:00Z") })
    const item = vi.mocked(prisma.otterItemMapping.findMany).mock.calls[0][0] as { where: { storeId: string } }
    const sub = vi.mocked(prisma.otterSubItemMapping.findMany).mock.calls[0][0] as { where: { storeId: string } }
    expect(item.where.storeId).toBe("st1")
    expect(sub.where.storeId).toBe("st1")
    expect(batchRecipeCosts).toHaveBeenCalledWith("acct-A")
  })

  it("answers an order outside the account as empty, with no mapping read", async () => {
    vi.mocked(getOrderDetailWithStoreId).mockResolvedValue(null)
    const s = await getOrderSections({ orderId: "nope", accountId: "acct-A" })
    expect(s.head.status).toBe("empty")
    expect(prisma.otterItemMapping.findMany).not.toHaveBeenCalled()
  })
})
