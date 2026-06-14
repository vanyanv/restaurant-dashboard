// Batching invariants for the orders sync write path (2026-06-12 perf audit).
//
// Task 1: Phase 1 of runOrdersSync must NOT do a findUnique + create/update per
// order. It resolves existing ids with a single findMany and writes via chunked
// INSERT ... ON CONFLICT ($executeRaw) — so per-order create/update never fire,
// and created/updated counts still come out right.
//
// Task 2: persistOrderItems must replace an order's items with a fixed number
// of bulk writes (deleteMany + one createMany for items + one for sub-items),
// regardless of how many items/sub-items there are — no create-per-item loop.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/otter", () => ({
  queryMetrics: vi.fn(),
  buildCustomerOrdersBody: vi.fn(() => ({})),
  fetchOrderDetails: vi.fn(async () => null),
  withConcurrency: async <T>(tasks: Array<() => Promise<T>>) =>
    Promise.all(tasks.map((t) => t())),
}))

vi.mock("@/lib/monitoring/job-run", () => ({
  withJobRun: vi.fn(
    async (
      _name: string,
      _opts: unknown,
      fn: (ctx: { jobRunId: string; addRows: (n: number) => void }) => Promise<unknown>,
    ) => fn({ jobRunId: "jr", addRows: () => {} }),
  ),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    otterStore: { findMany: vi.fn() },
    otterOrder: {
      findMany: vi.fn(),
      count: vi.fn(async () => 0),
      create: vi.fn(),
      update: vi.fn(),
    },
    $executeRaw: vi.fn(async () => 1),
  },
}))

import { prisma } from "@/lib/prisma"
import { queryMetrics } from "@/lib/otter"
import { runOrdersSync, persistOrderItems } from "@/lib/otter-orders-sync"

const UUID_A = "uuid-A"
const STORE_A = "store-A"

function orderRow(id: string) {
  return {
    store_id: UUID_A,
    order_id: id,
    external_order_display_id: `D-${id}`,
    ofo_slug: "doordash",
    reference_time_local_without_tz: "2026-06-10T12:00:00.000Z",
    fulfillment_mode: "delivery",
    order_status: "COMPLETED",
    acceptance_status: "ACCEPTED",
    subtotal: 10,
    tax: 1,
    tip: 2,
    adjusted_commission: 3,
    restaurant_funded_discount: 0,
    ofo_funded_discount: 0,
    total_with_tip: 13,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.otterStore.findMany).mockResolvedValue([
    { otterStoreId: UUID_A, storeId: STORE_A, store: { id: STORE_A, isActive: true } },
  ] as never)
  vi.mocked(prisma.otterOrder.count).mockResolvedValue(0 as never)
  vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as never)
})

describe("runOrdersSync — Phase 1 batches order upserts", () => {
  it("resolves existence with one findMany and writes via $executeRaw, never per-order create/update", async () => {
    const existing = new Set(["order-1"])
    vi.mocked(prisma.otterOrder.findMany).mockImplementation((async (args: {
      where?: { otterOrderId?: { in?: string[] }; detailsFetchedAt?: null }
    }) => {
      const ids = args?.where?.otterOrderId?.in
      if (ids) {
        // Existence check: return only the ids we declare as already present.
        return ids.filter((id) => existing.has(id)).map((id) => ({ otterOrderId: id }))
      }
      // Phase 2 pending lookup — nothing to enrich in this test.
      return []
    }) as never)

    vi.mocked(queryMetrics).mockResolvedValue([
      orderRow("order-1"),
      orderRow("order-2"),
      orderRow("order-3"),
    ] as never)

    const result = await runOrdersSync(1, undefined, { triggeredBy: "manual" })

    // One existence findMany covering all three ids.
    const existenceCalls = vi
      .mocked(prisma.otterOrder.findMany)
      .mock.calls.filter(([a]) => (a as { where?: { otterOrderId?: unknown } })?.where?.otterOrderId)
    expect(existenceCalls).toHaveLength(1)
    expect(
      (existenceCalls[0][0] as { where: { otterOrderId: { in: string[] } } }).where.otterOrderId.in,
    ).toEqual(expect.arrayContaining(["order-1", "order-2", "order-3"]))

    // Writes go through batched raw SQL, never the per-row ORM helpers.
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
    expect(prisma.otterOrder.create).not.toHaveBeenCalled()
    expect(prisma.otterOrder.update).not.toHaveBeenCalled()

    // Counts: order-1 already existed (update), the other two are new (create).
    expect(result.ordersCreated).toBe(2)
    expect(result.ordersUpdated).toBe(1)
    expect(result.ordersFetched).toBe(3)
  })

  it("skips the existence lookup and writes entirely when no rows come back", async () => {
    vi.mocked(prisma.otterOrder.findMany).mockResolvedValue([] as never)
    vi.mocked(queryMetrics).mockResolvedValue([] as never)

    const result = await runOrdersSync(1, undefined, { triggeredBy: "manual" })

    expect(prisma.$executeRaw).not.toHaveBeenCalled()
    expect(result.ordersCreated).toBe(0)
    expect(result.ordersUpdated).toBe(0)
  })
})

describe("persistOrderItems — bulk item writes", () => {
  function fakeTx() {
    return {
      otterOrderItem: {
        deleteMany: vi.fn(async (_a: { where: unknown }) => ({})),
        createMany: vi.fn(async (_a: { data: unknown[] }) => ({})),
      },
      otterOrderSubItem: {
        createMany: vi.fn(async (_a: { data: unknown[] }) => ({})),
      },
    }
  }

  it("writes N items + their sub-items in a fixed number of bulk calls", async () => {
    const tx = fakeTx()
    const items = [
      {
        skuId: "sku-1",
        name: "Burger",
        quantity: 1,
        price: 10,
        subItems: [
          { skuId: "s-1a", name: "Cheese", quantity: 1, price: 1, subHeader: "Add-ons" },
          { skuId: "s-1b", name: "Bacon", quantity: 1, price: 2, subHeader: "Add-ons" },
        ],
      },
      { skuId: "sku-2", name: "Fries", quantity: 1, price: 4, subItems: [] },
      {
        skuId: "sku-3",
        name: "Shake",
        quantity: 2,
        price: 6,
        subItems: [{ skuId: "s-3a", name: "Whip", quantity: 1, price: 0, subHeader: null }],
      },
    ]

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await persistOrderItems(tx as any, "order-X", items)

    // Exactly: 1 deleteMany, 1 createMany for items, 1 createMany for sub-items —
    // independent of item count (no create-per-item round-trips).
    expect(tx.otterOrderItem.deleteMany).toHaveBeenCalledTimes(1)
    expect(tx.otterOrderItem.createMany).toHaveBeenCalledTimes(1)
    expect(tx.otterOrderSubItem.createMany).toHaveBeenCalledTimes(1)

    const itemData = tx.otterOrderItem.createMany.mock.calls[0][0].data as Array<{
      id: string
      orderId: string
    }>
    expect(itemData).toHaveLength(3)
    expect(itemData.every((r) => r.orderId === "order-X")).toBe(true)
    const itemIds = itemData.map((r) => r.id)
    expect(new Set(itemIds).size).toBe(3) // ids are unique

    // Sub-items reference the pre-generated parent ids and are fully flattened.
    const subData = tx.otterOrderSubItem.createMany.mock.calls[0][0].data as Array<{
      orderItemId: string
    }>
    expect(subData).toHaveLength(3)
    expect(subData.every((r) => itemIds.includes(r.orderItemId))).toBe(true)
  })

  it("clears items and makes no inserts when the order has no items", async () => {
    const tx = fakeTx()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await persistOrderItems(tx as any, "order-Y", [])
    expect(tx.otterOrderItem.deleteMany).toHaveBeenCalledTimes(1)
    expect(tx.otterOrderItem.createMany).not.toHaveBeenCalled()
    expect(tx.otterOrderSubItem.createMany).not.toHaveBeenCalled()
  })
})
