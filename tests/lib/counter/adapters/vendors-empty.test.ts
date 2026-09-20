// vendors adapter — the two sections that rendered nothing and called it data.
//
// `getVendorsSectionPromises` classifies ONE load and maps every section off
// it, so the only emptiness it could express was "no invoice in the range".
// Two sections can be empty while that load is full, and both of them drew an
// empty box rather than a state:
//
//   - "Worth a call" built its items from what the range shows. A range in
//     which nothing is rising and every invoice ties out produced `items: []`
//     and rendered `<Queue items={[]} />` — a bordered panel with a head, a
//     "0 things to do" qualifier and no body. An empty worklist is GOOD NEWS
//     and has to read as good news; that is what `all_clear` is for, and the
//     COGS, labour and orders adapters already resolve it this way.
//   - "Price trend" draws the vendors that appear in BOTH the page's range and
//     the eight-week basket window. With no overlap it handed `Chart` a spec
//     with no labels and no series, which takes `Chart`'s "a single reading is
//     not a chart" path and emits an empty `.strip.strip--fit` — nothing at
//     all — under a note explaining how Premier Meats and Vitco are indexed.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: { invoice: { findMany: vi.fn() } },
}))
vi.mock("@/lib/account-stores", () => ({ getScopedStores: vi.fn() }))
vi.mock("@/lib/counter/vendor-basket", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/counter/vendor-basket")>()
  return { ...actual, loadVendorBasketWeeks: vi.fn() }
})

import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { loadVendorBasketWeeks } from "@/lib/counter/vendor-basket"
import { getVendorsSectionPromises } from "@/lib/counter/adapters/vendors"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const RANGE = { start: new Date("2026-01-01"), end: new Date("2026-01-31") }
const TODAY = new Date("2026-01-31T00:00:00Z")

/** An invoice whose goods lines tie out to its subtotal: nothing to flag. */
function clean(vendorName: string, day: number, total: number) {
  return {
    id: `inv_${vendorName}_${day}`,
    vendorName,
    invoiceDate: new Date(Date.UTC(2026, 0, day)),
    totalAmount: total,
    subtotal: total,
    status: "MATCHED",
    lineItems: [{ productName: "Beef", extendedPrice: total }],
  }
}

/** An invoice whose goods lines do NOT tie out: the reconcile item fires. */
function short(vendorName: string, day: number, total: number) {
  return { ...clean(vendorName, day, total), lineItems: [{ productName: "Beef", extendedPrice: total - 50 }] }
}

function run() {
  return getVendorsSectionPromises({
    storeId: null,
    accountId: "acct_ours",
    range: RANGE,
    today: TODAY,
  })
}

describe("vendors adapter · Worth a call", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    asMock(getScopedStores).mockResolvedValue([{ id: "store_a" }])
    asMock(loadVendorBasketWeeks).mockResolvedValue([])
  })

  it("is all_clear when nothing is rising and every invoice ties out", async () => {
    asMock(prisma.invoice.findMany).mockResolvedValue([
      clean("Sysco", 5, 1000),
      clean("Sysco", 9, 900),
    ])

    const work = await run().work
    expect(work.status).toBe("empty")
    expect(work).toMatchObject({ status: "empty", reason: "all_clear" })
  })

  it("still reports the work when an invoice does not reconcile", async () => {
    asMock(prisma.invoice.findMany).mockResolvedValue([
      clean("Sysco", 5, 1000),
      short("Sysco", 9, 900),
    ])

    const work = await run().work
    expect(work.status).toBe("ready")
    expect(work).toMatchObject({ status: "ready", data: { meta: "1 thing to do" } })
  })
})

describe("vendors adapter · Price trend", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    asMock(getScopedStores).mockResolvedValue([{ id: "store_a" }])
  })

  it("says nothing has been received when the basket window holds no priced line", async () => {
    asMock(loadVendorBasketWeeks).mockResolvedValue([])
    asMock(prisma.invoice.findMany).mockResolvedValue([clean("Sysco", 5, 1000)])

    const trend = await run().trend
    expect(trend).toMatchObject({ status: "empty", reason: "nothing_received" })
  })

  it("says nothing matched when the window holds weeks, but for other vendors", async () => {
    asMock(loadVendorBasketWeeks).mockResolvedValue([
      { wk: new Date(Date.UTC(2026, 0, 5)), vendor: "US Foods", px: 10 },
      { wk: new Date(Date.UTC(2026, 0, 12)), vendor: "US Foods", px: 12 },
    ])
    asMock(prisma.invoice.findMany).mockResolvedValue([clean("Sysco", 5, 1000)])

    const trend = await run().trend
    expect(trend).toMatchObject({ status: "empty", reason: "no_match" })
  })

  it("draws the chart when a vendor on the page has weeks in the window", async () => {
    asMock(loadVendorBasketWeeks).mockResolvedValue([
      { wk: new Date(Date.UTC(2026, 0, 5)), vendor: "Sysco", px: 10 },
      { wk: new Date(Date.UTC(2026, 0, 12)), vendor: "Sysco", px: 12 },
    ])
    asMock(prisma.invoice.findMany).mockResolvedValue([clean("Sysco", 5, 1000)])

    const trend = await run().trend
    expect(trend.status).toBe("ready")
    if (trend.status !== "ready") throw new Error("unreachable")
    expect(trend.data.chart.series).toHaveLength(1)
    // The qualifier no longer carries a branch for a chart that cannot be drawn.
    expect(trend.data.meta).not.toContain("no priced delivery")
  })
})
