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
    },
  },
}))
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { getOrdersList } from "@/app/actions/order-actions"

const session = { user: { id: "u1", accountId: "acct-A" } }

/** A single aggregate result shape, matching what `.aggregate` resolves to. */
function sums(subtotal: number, discount: number, commission: number) {
  return { _sum: { subtotal, discount, commission } }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getServerSession).mockResolvedValue(session as never)
  vi.mocked(prisma.store.findMany).mockResolvedValue([
    { id: "s1", name: "Hollywood" },
  ] as never)
  vi.mocked(prisma.otterOrder.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.otterOrder.count).mockResolvedValue(0)
  vi.mocked(prisma.otterOrder.aggregate).mockResolvedValue(
    sums(0, 0, 0) as never
  )
})

describe("getOrdersList — early returns still satisfy OrderListResponse", () => {
  it("returns undrainedCount and totals of zero without a session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    const result = await getOrdersList()
    expect(result.undrainedCount).toBe(0)
    expect(result.totals).toEqual({
      netSales: 0,
      commission: 0,
      thirdPartyNetSales: 0,
    })
  })

  it("returns undrainedCount and totals of zero when the account has no stores", async () => {
    vi.mocked(prisma.store.findMany).mockResolvedValue([] as never)
    const result = await getOrdersList()
    expect(result.undrainedCount).toBe(0)
    expect(result.totals).toEqual({
      netSales: 0,
      commission: 0,
      thirdPartyNetSales: 0,
    })
  })

  it("returns undrainedCount and totals of zero for a cross-account storeId", async () => {
    const result = await getOrdersList({ storeId: "not-mine" })
    expect(result.undrainedCount).toBe(0)
    expect(result.totals).toEqual({
      netSales: 0,
      commission: 0,
      thirdPartyNetSales: 0,
    })
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
    vi.mocked(prisma.otterOrder.count).mockResolvedValueOnce(41).mockResolvedValueOnce(7)

    const result = await getOrdersList()
    expect(result.totalCount).toBe(41)
    expect(result.undrainedCount).toBe(7)

    // Second count call must scope detailsFetchedAt: null under the same where.
    const secondCall = vi.mocked(prisma.otterOrder.count).mock.calls[1]?.[0] as {
      where?: { detailsFetchedAt?: unknown }
    }
    expect(secondCall?.where?.detailsFetchedAt).toEqual(null)
  })
})

describe("getOrdersList — totals is a range aggregate, not a page sum", () => {
  it("computes netSales and commission from aggregate, independent of how many rows are returned", async () => {
    // Page has only 1 row, but the range aggregate reports many more dollars —
    // proving totals isn't derived from `rows`.
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
        commission: 5,
        detailsFetchedAt: new Date("2026-08-20T13:00:00Z"),
        _count: { items: 2 },
      },
    ] as never)
    vi.mocked(prisma.otterOrder.aggregate)
      // Discount and commission are stored NEGATIVE — see
      // `src/lib/counter/order-signs.ts`. This fixture used positive figures
      // until 2026-08-26, a shape the database has zero rows of, and it is why
      // `Σsubtotal − Σdiscount` passed review while inflating every range's net
      // sales by twice the discounts given.
      .mockResolvedValueOnce(sums(50000, -1200, -8000) as never) // overall
      .mockResolvedValueOnce(sums(30000, -500, -8000) as never) // 3P-only

    const result = await getOrdersList()
    expect(result.totals.netSales).toBe(48800)
    // Reported positive: it is a fee, not a negative number.
    expect(result.totals.commission).toBe(8000)
    expect(result.totals.thirdPartyNetSales).toBe(29500)
  })

  it("excludes the in-house platform from the thirdPartyNetSales aggregate", async () => {
    await getOrdersList()

    // aggregate is called twice: once for the whole range, once excluding
    // the in-house platform (css-pos) for thirdPartyNetSales.
    const calls = vi.mocked(prisma.otterOrder.aggregate).mock.calls
    expect(calls.length).toBe(2)
    const thirdPartyCall = calls[1][0] as { where?: { platform?: unknown } }
    // The in-house platform must be excluded via a `not` (or `notIn`)
    // condition, not simply absent.
    expect(JSON.stringify(thirdPartyCall.where)).toMatch(/css-pos/)
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
  })

  it("still honours a single `platform` for callers that pass one", async () => {
    await getOrdersList({ platform: "doordash" })
    expect(whereOf().platform).toBe("doordash")
  })

  it("lets a non-empty set supersede a single `platform`", async () => {
    await getOrdersList({ platform: "doordash", platforms: ["grubhub"] })
    expect(whereOf().platform).toEqual({ in: ["grubhub"] })
  })

  it("keeps the platform filter inside the third-party aggregate", async () => {
    // `thirdPartyNetSales` is what "X% of 3P" is a percentage OF. Spreading
    // `...where` and then re-keying `platform` DROPPED the reader's own filter
    // from that aggregate: filter to DoorDash and the strip would divide
    // DoorDash fees by every marketplace's sales. Both conditions have to hold.
    await getOrdersList({ platforms: ["doordash"] })
    const calls = vi.mocked(prisma.otterOrder.aggregate).mock.calls
    expect(calls.length).toBe(2)
    const thirdParty = JSON.stringify(calls[1][0])
    expect(thirdParty).toMatch(/doordash/)
    expect(thirdParty).toMatch(/css-pos/)
  })
})
