// getOrdersList — Task 3a/3c additions. An order row now carries `commission`
// (the marketplace's own column, previously not selected), the response
// carries `undrainedCount` (orders still waiting on OrderDetails), and
// `totals` — the Orders strip's "Net sales" / "Marketplace fees" / "3P net
// sales" figures, which must be summed over the WHOLE matched range via
// `prisma.otterOrder.aggregate`, not over the single page of `rows` that
// `findMany` + `take` returns. A strip that summed `rows` would silently
// report page totals as if they were range totals.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findMany: vi.fn() },
    otterOrder: {
      findMany: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
      groupBy: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}))
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/generated/prisma/client"
import { getOrdersList } from "@/app/actions/order-actions"

const session = { user: { id: "u1", accountId: "acct-A" } }

const ZERO = {
  orders: 0,
  netSales: 0,
  commission: 0,
  commissionRecorded: 0,
  commissionEstimated: 0,
  thirdPartyEstimatedCount: 0,
  thirdPartyUnknownCount: 0,
  thirdPartyNetSales: 0,
  thirdPartyCount: 0,
  thirdPartyWithFees: 0,
}

/**
 * The grouped range read's rows (`rangeFigures` in `order-actions.ts`): one
 * `total_row: 1` row over the whole matched range, and one row per
 * (store, platform, mode, not-cancelled, fee-recorded) group.
 */
type FigureTotal = {
  n?: number
  subtotal?: number
  discount?: number
  commission?: number
  live_n?: number
  live_subtotal?: number
  live_discount?: number
  tp_n?: number
  tp_subtotal?: number
  tp_discount?: number
  tp_fee_n?: number
}
type FigureGroup = {
  platform: string
  mode: string | null
  n: number
  subtotal: number
  discount: number
  commission: number
  recorded: boolean
  live?: boolean
  tp?: boolean
}
function figs(total: FigureTotal = {}, groups: FigureGroup[] = []) {
  return [
    {
      total_row: 1,
      storeId: null,
      platform: null,
      fulfillmentMode: null,
      live: null,
      recorded: null,
      tp: null,
      n: total.n ?? 0,
      subtotal: total.subtotal ?? null,
      discount: total.discount ?? null,
      commission: total.commission ?? null,
      // Not-cancelled orders; a fixture that names none has none cancelled.
      live_n: total.live_n ?? total.n ?? 0,
      live_subtotal: total.live_subtotal ?? total.subtotal ?? null,
      live_discount: total.live_discount ?? total.discount ?? null,
      tp_n: total.tp_n ?? 0,
      tp_subtotal: total.tp_subtotal ?? null,
      tp_discount: total.tp_discount ?? null,
      tp_fee_n: total.tp_fee_n ?? 0,
    },
    ...groups.map((g) => ({
      total_row: 0,
      storeId: "s1",
      platform: g.platform,
      fulfillmentMode: g.mode,
      live: g.live ?? true,
      recorded: g.recorded,
      tp: g.tp ?? true,
      n: g.n,
      subtotal: g.subtotal,
      discount: g.discount,
      commission: g.commission,
      live_n: 0,
      live_subtotal: null,
      live_discount: null,
      tp_n: 0,
      tp_subtotal: null,
      tp_discount: null,
      tp_fee_n: 0,
    })),
  ]
}

/** The grouped read as the driver gets it: nested fragments flattened, `?` for each value. */
function rawQuery(): { sql: string; values: unknown[] } {
  const [strings, ...values] = vi.mocked(prisma.$queryRaw).mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]]
  const q = Prisma.sql(strings, ...values)
  return { sql: q.sql, values: q.values }
}
const rawSqlText = () => rawQuery().sql
const rawValues = () => rawQuery().values

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getServerSession).mockResolvedValue(session as never)
  vi.mocked(prisma.store.findMany).mockResolvedValue([
    { id: "s1", name: "Hollywood", isActive: true, doordashCommissionRate: 0.25, uberCommissionRate: 0.27 },
  ] as never)
  vi.mocked(prisma.otterOrder.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.otterOrder.groupBy).mockResolvedValue([] as never)
  vi.mocked(prisma.otterOrder.count).mockResolvedValue(0)
  vi.mocked(prisma.otterOrder.aggregate).mockResolvedValue({ _count: 0, _sum: {} } as never)
  vi.mocked(prisma.$queryRaw).mockResolvedValue(figs() as never)
})

describe("getOrdersList — early returns still satisfy OrderListResponse", () => {
  it("returns undrainedCount and totals of zero without a session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    const result = await getOrdersList()
    expect(result.undrainedCount).toBe(0)
    expect(result.totals).toEqual(ZERO)
  })

  it("returns undrainedCount and totals of zero when the account has no stores", async () => {
    vi.mocked(prisma.store.findMany).mockResolvedValue([] as never)
    const result = await getOrdersList()
    expect(result.undrainedCount).toBe(0)
    expect(result.totals).toEqual(ZERO)
  })

  it("returns undrainedCount and totals of zero for a cross-account storeId", async () => {
    const result = await getOrdersList({ storeId: "not-mine" })
    expect(result.undrainedCount).toBe(0)
    expect(result.totals).toEqual(ZERO)
  })
})

describe("getOrdersList — the commission estimate", () => {
  it("leaves cancelled orders out of the commission groups", async () => {
    // The groups the fee estimate folds are the marketplace's, not-cancelled
    // ones: a cancelled order's group is in the read but never priced.
    vi.mocked(prisma.$queryRaw).mockResolvedValue(
      figs({ n: 12 }, [
        { platform: "doordash", mode: "FULFILLMENT_MODE_OFO_DELIVERY", n: 10, subtotal: 1000, discount: 0, commission: 0, recorded: false },
        { platform: "doordash", mode: "FULFILLMENT_MODE_OFO_DELIVERY", n: 2, subtotal: 400, discount: 0, commission: 0, recorded: false, live: false },
      ]) as never,
    )
    const result = await getOrdersList()
    expect(result.totals.thirdPartyEstimatedCount).toBe(10)
    expect(rawSqlText()).toContain("OFO_STATUS_CANCELED")
  })

  it("leaves in-house orders out of the commission groups", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue(
      figs({ n: 9 }, [
        { platform: "css-pos", mode: null, n: 9, subtotal: 900, discount: 0, commission: 0, recorded: false, tp: false },
      ]) as never,
    )
    const result = await getOrdersList()
    expect(result.totals.thirdPartyEstimatedCount).toBe(0)
    expect(result.totals.thirdPartyUnknownCount).toBe(0)
  })

  it("prices pickup at the pickup rate and reports a platform with no rate as unpriced, not free", async () => {
    vi.mocked(prisma.store.findMany).mockResolvedValue([
      { id: "s1", name: "Hollywood", isActive: true, doordashCommissionRate: 0.25, uberCommissionRate: 0.27, doordashPickupCommissionRate: 0.06, grubhubCommissionRate: null },
    ] as never)
    vi.mocked(prisma.$queryRaw).mockResolvedValue(
      figs({}, [
        { platform: "doordash", mode: "FULFILLMENT_MODE_PICKUP", n: 10, subtotal: 1000, discount: 0, commission: 0, recorded: false },
        { platform: "grubhub", mode: "FULFILLMENT_MODE_OFO_DELIVERY", n: 5, subtotal: 500, discount: 0, commission: 0, recorded: false },
      ]) as never,
    )
    const result = await getOrdersList()
    expect(result.totals.commission).toBeCloseTo(60)
    expect(result.totals.thirdPartyUnknownCount).toBe(5)
  })

  it("is null, never zero, when no marketplace order could be priced", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue(
      figs({}, [{ platform: "chownow", mode: null, n: 7, subtotal: 700, discount: 0, commission: 0, recorded: false }]) as never,
    )
    const result = await getOrdersList()
    expect(result.totals.commission).toBeNull()
  })
})

describe("getOrdersList — commission on the row", () => {
  it("selects and maps commission onto each row", async () => {
    vi.mocked(prisma.otterOrder.findMany).mockResolvedValue([
      {
        id: "o1",
        otterOrderId: "oo1",
        externalDisplayId: "#1",
        storeId: "s1",
        platform: "doordash",
        referenceTimeLocal: new Date("2026-08-20T12:00:00Z"),
        fulfillmentMode: "delivery",
        orderStatus: "COMPLETED",
        customerName: "Jane",
        subtotal: 20,
        tax: 2,
        tip: 3,
        discount: 0,
        total: 25,
        commission: -5,
        detailsFetchedAt: new Date("2026-08-20T13:00:00Z"),
        _count: { items: 2 },
      },
    ] as never)

    const result = await getOrdersList()
    // The ROW carries the column RAW, negative sign and all. Only the range
    // `totals` are normalised here, because they are sums the caller cannot
    // re-derive. A row's sign is the adapter's to interpret, through
    // `src/lib/counter/order-signs.ts` — one place that knows the convention,
    // rather than an action that silently flips it and an adapter that cannot
    // tell whether it already has.
    expect(result.rows[0].commission).toBe(-5)
  })
})

describe("getOrdersList — undrainedCount", () => {
  it("counts orders in the same scope missing details, separately from totalCount", async () => {
    // totalCount is the grouped read's whole-range row; undrainedCount is its
    // own query, because `detailsFetchedAt: null` is a different predicate
    // (and not a column of the covering index the grouped read stays inside).
    vi.mocked(prisma.$queryRaw).mockResolvedValue(figs({ n: 41 }) as never)
    vi.mocked(prisma.otterOrder.count).mockResolvedValueOnce(7)

    const result = await getOrdersList()
    expect(result.totalCount).toBe(41)
    expect(result.undrainedCount).toBe(7)

    // The first count call must scope detailsFetchedAt: null under the same where.
    const firstCall = vi.mocked(prisma.otterOrder.count).mock.calls[0]?.[0] as {
      where?: { detailsFetchedAt?: unknown }
    }
    expect(firstCall?.where?.detailsFetchedAt).toEqual(null)
  })
})

describe("getOrdersList — totals is a range aggregate, not a page sum", () => {
  const onePageRow = {
    id: "o1",
    otterOrderId: "oo1",
    externalDisplayId: "#1",
    storeId: "s1",
    platform: "doordash",
    referenceTimeLocal: new Date("2026-08-20T12:00:00Z"),
    fulfillmentMode: "delivery",
    orderStatus: "COMPLETED",
    customerName: "Jane",
    subtotal: 20,
    tax: 2,
    tip: 3,
    discount: 0,
    total: 25,
    commission: -5,
    detailsFetchedAt: new Date("2026-08-20T13:00:00Z"),
    _count: { items: 2 },
  }

  it("computes netSales and commission from the grouped read, independent of how many rows are returned", async () => {
    // Page has only 1 row, but the range read reports many more dollars —
    // proving totals isn't derived from `rows`.
    vi.mocked(prisma.otterOrder.findMany).mockResolvedValue([onePageRow] as never)
    // Discount and commission are stored NEGATIVE — see
    // `src/lib/counter/order-signs.ts`. This fixture used positive figures
    // until 2026-08-26, a shape the database has zero rows of, and it is why
    // `Σsubtotal − Σdiscount` passed review while inflating every range's net
    // sales by twice the discounts given.
    vi.mocked(prisma.$queryRaw).mockResolvedValue(
      figs(
        // Whole range, then the marketplace share of it and the marketplace
        // orders carrying a fee.
        { n: 120, subtotal: 50000, discount: -1200, commission: -8000, tp_n: 80, tp_subtotal: 30000, tp_discount: -500, tp_fee_n: 36 },
        // 36 orders with a recorded $8,000, and 44 without one on a $9,800
        // discounted ticket, priced at the store's 25% DoorDash rate.
        [
          { platform: "doordash", mode: "FULFILLMENT_MODE_OFO_DELIVERY", n: 36, subtotal: 20000, discount: -300, commission: -8000, recorded: true },
          { platform: "doordash", mode: "FULFILLMENT_MODE_OFO_DELIVERY", n: 44, subtotal: 10000, discount: -200, commission: 0, recorded: false },
        ],
      ) as never,
    )

    const result = await getOrdersList()
    expect(result.totals.netSales).toBe(48800)
    expect(result.totals.orders).toBe(120)
    // Reported positive: it is a fee, not a negative number. Recorded where
    // there is one, the store's rate on the after-discount ticket where not.
    expect(result.totals.commissionRecorded).toBe(8000)
    expect(result.totals.commissionEstimated).toBeCloseTo(2450)
    expect(result.totals.commission).toBeCloseTo(10450)
    expect(result.totals.thirdPartyEstimatedCount).toBe(44)
    expect(result.totals.thirdPartyNetSales).toBe(29500)
    // The strip cannot tell a complete fee bill from a fraction of one without
    // these two — `adjusted_commission`'s coverage ran 43.7% in April 2026 and
    // 0% in May, and the cell printed a confident total on both.
    expect(result.totals.thirdPartyCount).toBe(80)
    expect(result.totals.thirdPartyWithFees).toBe(36)
    expect(result.totalCount).toBe(120)
  })

  it("answers every range figure in ONE grouped read, not six queries", async () => {
    await getOrdersList()
    // The page of rows, the undrained count, and the one grouped read. The
    // whole-range and marketplace aggregates, the with-a-fee count and the two
    // commission group-bys are gone.
    // (`findMany` twice: the page, and the account's platform list, which is
    // `unstable_cache`d for an hour in production and passes through here.)
    expect(prisma.otterOrder.findMany).toHaveBeenCalledTimes(2)
    expect(prisma.otterOrder.count).toHaveBeenCalledTimes(1)
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
    expect(prisma.otterOrder.aggregate).not.toHaveBeenCalled()
    expect(prisma.otterOrder.groupBy).not.toHaveBeenCalled()
  })

  it("splits marketplace from in-house by the in-house slugs EXCLUDED, never matched", async () => {
    await getOrdersList()
    // The platform test is `NOT IN (...)` and the slugs ride as values, so the
    // inversion that would divide marketplace fees by IN-HOUSE sales (`IN`) is
    // visible by name.
    expect(rawSqlText()).toContain('"platform" NOT IN (')
    expect(rawValues()).toEqual(expect.arrayContaining(["css-pos", "bnm-web"]))
  })

  it("counts the fee coverage over MARKETPLACE orders that are not cancelled", async () => {
    // A ratio whose halves are drawn from different populations is not a
    // coverage: the numerator is marketplace AND not-cancelled AND fee-recorded.
    await getOrdersList()
    expect(rawSqlText()).toMatch(/COUNT\(\*\) FILTER \(WHERE tp AND live AND recorded\)/)
    expect(rawSqlText()).toContain('(o."commission" <> 0) AS recorded')
  })
})

/**
 * Task 4b: a filter that can express "In-house".
 *
 * `css-pos` and `bnm-web` are both the `house` channel, so a per-channel
 * toggle cannot be said with the single `platform` string. `platforms` widens
 * it to a set — and an EMPTY set means "every channel", which is what a reader
 * who has deselected every toggle (or pressed Clear) is asking for. A naive
 * `in: []` gets that backwards and returns nothing at all.
 */
describe("getOrdersList — the platforms filter", () => {
  function whereOf(): { platform?: unknown } {
    const call = vi.mocked(prisma.otterOrder.findMany).mock.calls[0][0] as {
      where?: { platform?: unknown }
    }
    return call.where ?? {}
  }
  it("matches any slug in the set, so one channel can mean two platforms", async () => {
    await getOrdersList({ platforms: ["css-pos", "bnm-web"] })
    expect(whereOf().platform).toEqual({ in: ["css-pos", "bnm-web"] })
  })

  it("treats an empty set as no platform filter at all, not as matching nothing", async () => {
    await getOrdersList({ platforms: [] })
    expect(whereOf().platform).toBeUndefined()
    // …and the grouped read agrees with the list: no platform predicate besides
    // the in-house split.
    expect(rawSqlText()).not.toContain('o."platform" IN')
    expect(rawSqlText()).not.toContain('o."platform" =')
  })

  it("still honours a single `platform` for callers that pass one", async () => {
    await getOrdersList({ platform: "doordash" })
    expect(whereOf().platform).toBe("doordash")
    expect(rawSqlText()).toContain('o."platform" = ?')
    expect(rawValues()).toContain("doordash")
  })

  it("lets a non-empty set supersede a single `platform`", async () => {
    await getOrdersList({ platform: "doordash", platforms: ["grubhub"] })
    expect(whereOf().platform).toEqual({ in: ["grubhub"] })
    expect(rawValues()).toContain("grubhub")
    expect(rawValues()).not.toContain("doordash")
  })

  it("keeps the platform filter inside the grouped read, with the marketplace split on top", async () => {
    // `thirdPartyNetSales` is what "X% of 3P" is a percentage OF. Dropping the
    // reader's own platform filter from it would divide DoorDash fees by every
    // marketplace's sales. Both conditions hold: the WHERE carries the filter,
    // and `tp` (not in-house) is a column of the rows it keeps.
    await getOrdersList({ platforms: ["doordash"] })
    expect(rawSqlText()).toContain('o."platform" IN (?)')
    expect(rawSqlText()).toContain('(o."platform" NOT IN (')
    expect(rawValues()).toContain("doordash")
  })
})

describe("getOrdersList — the grouped read matches the list's filters", () => {
  it("scopes the read to the account's stores, or to the one store asked for", async () => {
    await getOrdersList()
    expect(rawSqlText()).toContain('o."storeId" IN (?)')
    const values = rawValues()
    expect(values).toContain("s1")

    vi.clearAllMocks()
    vi.mocked(prisma.store.findMany).mockResolvedValue([
      { id: "s1", name: "Hollywood", isActive: true },
      { id: "s2", name: "Beach", isActive: true },
    ] as never)
    vi.mocked(prisma.otterOrder.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.otterOrder.count).mockResolvedValue(0)
    vi.mocked(prisma.$queryRaw).mockResolvedValue(figs() as never)
    await getOrdersList({ storeId: "s2" })
    expect(rawSqlText()).toContain('o."storeId" = ?')
    expect(rawSqlText()).not.toContain('o."storeId" IN')
  })

  it("applies the date range and the search to the totals as it does to the rows", async () => {
    await getOrdersList({ startDate: "2026-08-01", endDate: "2026-08-31", search: " 1042 ", detailsOnly: true })
    const text = rawSqlText()
    expect(text).toContain('o."referenceTimeLocal" >= ?')
    expect(text).toContain('o."referenceTimeLocal" <= ?')
    expect(text).toContain('o."detailsFetchedAt" IS NOT NULL')
    expect(text).toContain('(o."externalDisplayId" ILIKE ? OR o."customerName" ILIKE ? OR o."otterOrderId" ILIKE ?)')
    const values = rawValues()
    // Prisma's `contains` is `ILIKE '%term%'`, trimmed, with no escaping.
    expect(values.filter((v) => v === "%1042%")).toHaveLength(3)
    expect(values).toContainEqual(new Date("2026-08-01T00:00:00"))
    expect(values).toContainEqual(new Date("2026-08-31T23:59:59"))
  })

  it("reads a summary load (the comparison range) with ONE aggregate and no grouped read", async () => {
    vi.mocked(prisma.otterOrder.aggregate).mockResolvedValue({
      _count: 5,
      _sum: { subtotal: 100, discount: -10, commission: -3 },
    } as never)
    const r = await getOrdersList({ summaryOnly: true })
    expect(r.totalCount).toBe(5)
    expect(r.totals.orders).toBe(5)
    expect(r.totals.netSales).toBe(90)
    expect(prisma.otterOrder.aggregate).toHaveBeenCalledTimes(1)
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
    expect(prisma.otterOrder.findMany).not.toHaveBeenCalled()
  })
})
