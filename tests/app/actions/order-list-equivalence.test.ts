// The Orders list's range figures, old queries against the one grouped read.
//
// `getOrdersList` answered "how much, how many, what fee" with six queries
// (whole-range aggregate, marketplace aggregate, with-a-fee count, fee groups
// twice). It now reads one `GROUP BY GROUPING SETS` and derives the same
// figures. Both are fed the SAME orders here — the old shape through the
// Prisma semantics the old calls had, the new through what the SQL returns for
// them — and the totals must be equal. (The SQL itself was run against both
// forms on a 66,000-order Postgres; this pins the JS that reads its rows.)

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findMany: vi.fn() },
    otterOrder: { findMany: vi.fn(), count: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { getOrdersList } from "@/app/actions/order-actions"
import { HOUSE_PLATFORMS } from "@/lib/counter/channel-mix"
import { fulfillmentKind, totalCommission, type OrderFeeGroup, type StoreCommissionRates } from "@/lib/counter/commission-core"

type O = {
  storeId: string
  platform: string
  mode: string | null
  status: string | null
  subtotal: number
  discount: number
  commission: number
}
const stores = [
  { id: "s1", name: "Hollywood", isActive: true, doordashCommissionRate: 0.25, uberCommissionRate: 0.27, doordashPickupCommissionRate: 0.06 },
  { id: "s2", name: "Beach", isActive: true, doordashCommissionRate: 0.2, uberCommissionRate: 0.3 },
]
const D = "FULFILLMENT_MODE_OFO_DELIVERY"
const P = "FULFILLMENT_MODE_PICKUP"
const orders: O[] = [
  { storeId: "s1", platform: "doordash", mode: D, status: "FULFILLED", subtotal: 40, discount: -4, commission: -10 },
  { storeId: "s1", platform: "doordash", mode: D, status: "FULFILLED", subtotal: 30, discount: 0, commission: 0 },
  { storeId: "s1", platform: "doordash", mode: P, status: null, subtotal: 20, discount: -2, commission: 0 },
  { storeId: "s1", platform: "doordash", mode: D, status: "OFO_STATUS_CANCELED", subtotal: 50, discount: 0, commission: 0 },
  { storeId: "s1", platform: "doordash", mode: D, status: "OFO_STATUS_CANCELED", subtotal: 60, discount: 0, commission: -15 },
  { storeId: "s2", platform: "ubereats", mode: D, status: "FULFILLED", subtotal: 100, discount: -10, commission: -27 },
  { storeId: "s2", platform: "ubereats", mode: D, status: "FULFILLED", subtotal: 80, discount: 0, commission: 0 },
  { storeId: "s2", platform: "grubhub", mode: D, status: "FULFILLED", subtotal: 25, discount: 0, commission: 0 }, // no rate: unpriced
  { storeId: "s2", platform: "css-pos", mode: null, status: "FULFILLED", subtotal: 15, discount: 0, commission: 0 },
  { storeId: "s2", platform: "bnm-web", mode: null, status: null, subtotal: 12, discount: -1, commission: 0 },
]

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const house = (o: O) => HOUSE_PLATFORMS.includes(o.platform)
const live = (o: O) => o.status === null || o.status !== "OFO_STATUS_CANCELED"

/** What the six old queries returned for `rows`, and what the old code made of it. */
function legacyTotals(rows: O[]) {
  const agg = (xs: O[]) => ({
    _count: xs.length,
    _sum: { subtotal: sum(xs.map((o) => o.subtotal)), discount: sum(xs.map((o) => o.discount)), commission: sum(xs.map((o) => o.commission)) },
  })
  const overall = agg(rows)
  // Cancelled orders are rows in the list but not orders: since 2026-11-20 the
  // count, net sales and the marketplace denominators leave them out, the way
  // the fee groups always did.
  const liveAgg = agg(rows.filter(live))
  const tp = agg(rows.filter((o) => !house(o) && live(o)))
  const withFees = rows.filter((o) => !house(o) && live(o) && o.commission !== 0).length
  const groupBy = (xs: O[]) => {
    const m = new Map<string, O[]>()
    for (const o of xs) {
      const k = [o.storeId, o.platform, o.mode].join("|")
      m.set(k, [...(m.get(k) ?? []), o])
    }
    return [...m.values()].map((g) => ({ g, ...agg(g) }))
  }
  const base = rows.filter((o) => !house(o) && live(o))
  const rec = groupBy(base.filter((o) => o.commission !== 0)).map((x) => ({ x, recorded: true }))
  const unrec = groupBy(base.filter((o) => o.commission === 0)).map((x) => ({ x, recorded: false }))
  const groups: OrderFeeGroup[] = [...rec, ...unrec].map(({ x, recorded }) => ({
    storeId: x.g[0].storeId,
    day: "",
    platform: x.g[0].platform,
    mode: fulfillmentKind(x.g[0].mode),
    recorded,
    orders: x._count,
    fee: Math.max(0, -x._sum.commission),
    ticket: Math.max(0, x._sum.subtotal + x._sum.discount),
  }))
  const fees = totalCommission(groups, new Map<string, StoreCommissionRates>(stores.map((s) => [s.id, s as never])))
  return {
    totalCount: overall._count,
    totals: {
      orders: liveAgg._count,
      netSales: liveAgg._sum.subtotal + liveAgg._sum.discount,
      commission: fees.amount,
      commissionRecorded: fees.recorded,
      commissionEstimated: fees.estimated,
      thirdPartyEstimatedCount: fees.ordersEstimated,
      thirdPartyUnknownCount: fees.unknownOrders,
      thirdPartyNetSales: tp._sum.subtotal + tp._sum.discount,
      thirdPartyCount: tp._count,
      thirdPartyWithFees: withFees,
    },
  }
}

/** What `rangeFigures` returns for `rows`: the SQL, done in JS. */
function sqlRows(rows: O[]) {
  const liveRows = rows.filter(live)
  const tpRows = rows.filter((o) => !house(o) && live(o))
  const groups = new Map<string, O[]>()
  for (const o of rows) {
    const k = [o.storeId, o.platform, o.mode, live(o), o.commission !== 0, !house(o)].join("|")
    groups.set(k, [...(groups.get(k) ?? []), o])
  }
  const row = (xs: O[]) => ({
    n: xs.length,
    subtotal: xs.length ? sum(xs.map((o) => o.subtotal)) : null,
    discount: xs.length ? sum(xs.map((o) => o.discount)) : null,
    commission: xs.length ? sum(xs.map((o) => o.commission)) : null,
  })
  return [
    {
      total_row: 1, storeId: null, platform: null, fulfillmentMode: null, live: null, recorded: null, tp: null,
      ...row(rows),
      live_n: liveRows.length,
      live_subtotal: liveRows.length ? sum(liveRows.map((o) => o.subtotal)) : null,
      live_discount: liveRows.length ? sum(liveRows.map((o) => o.discount)) : null,
      tp_n: tpRows.length,
      tp_subtotal: tpRows.length ? sum(tpRows.map((o) => o.subtotal)) : null,
      tp_discount: tpRows.length ? sum(tpRows.map((o) => o.discount)) : null,
      tp_fee_n: tpRows.filter((o) => live(o) && o.commission !== 0).length,
    },
    ...[...groups.values()].map((g) => ({
      total_row: 0, storeId: g[0].storeId, platform: g[0].platform, fulfillmentMode: g[0].mode,
      live: live(g[0]), recorded: g[0].commission !== 0, tp: !house(g[0]),
      ...row(g), live_n: 0, live_subtotal: null, live_discount: null, tp_n: 0, tp_subtotal: null, tp_discount: null, tp_fee_n: 0,
    })),
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: "u1", accountId: "acct-A" } } as never)
  vi.mocked(prisma.store.findMany).mockResolvedValue(stores as never)
  vi.mocked(prisma.otterOrder.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.otterOrder.count).mockResolvedValue(0)
})

describe("getOrdersList — the grouped read gives the totals the six queries did", () => {
  for (const [name, rows] of [
    ["every order", orders],
    ["one store", orders.filter((o) => o.storeId === "s1")],
    ["marketplace only", orders.filter((o) => !house(o))],
    ["in-house only (no marketplace order at all)", orders.filter(house)],
    ["nothing matched", [] as O[]],
  ] as const) {
    it(name, async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValue(sqlRows(rows) as never)
      const got = await getOrdersList()
      const want = legacyTotals(rows)
      expect(got.totalCount).toBe(want.totalCount)
      expect(got.totals).toEqual(want.totals)
    })
  }

  it("leaves cancelled orders out of the order count, net sales and avg ticket's inputs", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue(sqlRows(orders) as never)
    const got = await getOrdersList()
    // Ten rows in the list, two of them cancelled ($50 and $60).
    expect(got.totalCount).toBe(10)
    expect(got.totals.orders).toBe(8)
    expect(got.totals.netSales).toBe(40 - 4 + 30 + 20 - 2 + 100 - 10 + 80 + 25 + 15 + 12 - 1)
    // Marketplace orders: six live (the two cancelled DoorDash out), house out.
    expect(got.totals.thirdPartyCount).toBe(6)
  })

  it("filters the comparison range's summary load to not-cancelled orders", async () => {
    vi.mocked(prisma.otterOrder.aggregate).mockResolvedValue({
      _count: 8,
      _sum: { subtotal: 322, discount: -17, commission: -37 },
    } as never)
    const got = await getOrdersList({ summaryOnly: true, search: "abc" })
    const arg = vi.mocked(prisma.otterOrder.aggregate).mock.calls[0][0] as { where: { AND: unknown[] } }
    expect(arg.where.AND).toHaveLength(2)
    // The search's own OR survives inside the first half of the AND.
    expect((arg.where.AND[0] as { OR?: unknown[] }).OR).toHaveLength(3)
    expect(arg.where.AND[1]).toEqual({
      OR: [{ orderStatus: null }, { orderStatus: { not: "OFO_STATUS_CANCELED" } }],
    })
    expect(got.totals.orders).toBe(8)
    expect(got.totals.netSales).toBe(305)
  })

  it("reads active stores only, like the P&L", async () => {
    vi.mocked(prisma.store.findMany).mockResolvedValue([
      ...stores,
      { id: "s3", name: "Closed", isActive: false },
    ] as never)
    vi.mocked(prisma.$queryRaw).mockResolvedValue(sqlRows([]) as never)
    await getOrdersList()
    const where = vi.mocked(prisma.otterOrder.findMany).mock.calls[0][0] as { where: { storeId: { in: string[] } } }
    expect(where.where.storeId.in).toEqual(["s1", "s2"])
  })
})
