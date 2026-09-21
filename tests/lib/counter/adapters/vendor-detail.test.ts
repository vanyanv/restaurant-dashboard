// vendor detail adapter — the two sections that reported a state they were
// not in, and the identity the page looks a vendor up by.
//
//   - "The basket" printed, whenever this vendor had no second-sourced item,
//     "Seven of the account's 75 priced ingredients have a second source at
//     all." Neither figure is computed anywhere in this adapter: both were
//     measured by hand on 2026-08-28 and frozen into the string. A sentence
//     under a table has to be true of the code beside it, and a count that
//     cannot change when the data does is not.
//   - "Spend" read `no delivery in the range` when `weekly` was empty. It
//     cannot be: `loadVendor` returns null (and the page 404s) unless at least
//     one invoice in the range belongs to this vendor. `weekly` is empty when
//     those invoices carry no `invoiceDate` — a missing DATE, not a missing
//     delivery — and the chart then degraded to a one-cell strip reading "—".
//   - `loadVendor` matched invoices with `normalizeVendorName(...) === vendor`,
//     the display normalizer, while the list's rows are one per real vendor.
//     A vendor merged only by casing therefore linked to a detail page holding
//     a subset of its own invoices.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: { invoice: { findMany: vi.fn(), groupBy: vi.fn() }, $queryRaw: vi.fn() },
}))
vi.mock("@/lib/account-stores", () => ({ getScopedStores: vi.fn() }))
vi.mock("@/lib/counter/vendor-basket", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/counter/vendor-basket")>()
  return { ...actual, getVendorBasketTrends: vi.fn() }
})

import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { getVendorBasketTrends } from "@/lib/counter/vendor-basket"
import { getVendorName, getVendorSectionPromises } from "@/lib/counter/adapters/vendor"
import { hasData, type SectionData } from "@/lib/counter/section-data"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const RANGE = { start: new Date("2026-01-01"), end: new Date("2026-01-31") }
const TODAY = new Date("2026-01-31T00:00:00Z")

function invoice(vendorName: string, day: number | null, total: number) {
  return {
    id: `inv_${vendorName}_${day}`,
    invoiceNumber: `I${day ?? 0}`,
    vendorName,
    invoiceDate: day === null ? null : new Date(Date.UTC(2026, 0, day)),
    totalAmount: total,
    subtotal: total,
    status: "MATCHED",
    pdfBlobPathname: null,
    lineItems: [{ productName: "Beef", extendedPrice: total }],
  }
}

function dataOfOrThrow<T>(sd: SectionData<T>): T {
  if (!hasData(sd)) throw new Error(`section is ${sd.status}, not ready`)
  return sd.data
}

function run(vendor: string) {
  return getVendorSectionPromises({
    vendor,
    storeId: null,
    accountId: "acct_ours",
    range: RANGE,
    today: TODAY,
  })
}

describe("vendor detail adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    asMock(getScopedStores).mockResolvedValue([{ id: "store_a" }])
    asMock(getVendorBasketTrends).mockResolvedValue({ weekly: [], trend: new Map() })
    asMock(prisma.$queryRaw).mockResolvedValue([])
  })

  it("does not print a hand-measured ingredient count the adapter never computes", async () => {
    asMock(prisma.invoice.findMany).mockResolvedValue([invoice("Sysco", 5, 1000)])
    asMock(prisma.$queryRaw).mockResolvedValue([
      { cid: "ci_beef", name: "Beef", vendor: "Sysco", px: 4, unit: "LB", n: 3 },
      { cid: "ci_bun", name: "Bun", vendor: "Sysco", px: 1, unit: "EA", n: 2 },
    ])

    const basket = dataOfOrThrow(await run("Sysco").basket)

    expect(basket.rows).toHaveLength(0)
    expect(basket.note).not.toContain("Seven of the account's 75")
    // What it says instead is a figure this load actually holds: the two
    // canonicals above come from Sysco alone.
    expect(basket.note).toContain("2")
  })

  it("does not claim there was no delivery when the delivery simply has no date", async () => {
    asMock(prisma.invoice.findMany).mockResolvedValue([
      invoice("Sysco", null, 1000),
      invoice("Sysco", null, 400),
    ])

    const spend = dataOfOrThrow(await run("Sysco").spend)

    expect(spend.chart.labels).toHaveLength(0)
    expect(spend.meta).not.toBe("no delivery in the range")
    expect(spend.note).toContain("date")
  })

  it("leaves the weekly chart alone when the invoices are dated", async () => {
    asMock(prisma.invoice.findMany).mockResolvedValue([invoice("Sysco", 5, 1000)])

    const spend = dataOfOrThrow(await run("Sysco").spend)

    expect(spend.chart.labels).toHaveLength(1)
    expect(spend.meta).toBe("1 week")
    expect(spend.note).toContain("One bar per week")
  })

  it("gathers every casing of the vendor's name, the way the list's row does", async () => {
    asMock(prisma.invoice.findMany).mockResolvedValue([
      invoice("Bear State Kitchen", 5, 2000),
      invoice("BEAR STATE KITCHEN", 6, 1400),
    ])

    const head = dataOfOrThrow(await run("Bear State Kitchen").head)

    expect(head.sub).toContain("2 invoices")
    expect(head.sub).toContain("bills under 2 names")
    const spend = head.cells.find((c) => c.label === "Spend")
    expect(spend?.value).toBe("$3,400")
  })

  it("resolves a vendor whose URL segment differs only in casing", async () => {
    asMock(prisma.invoice.findMany).mockResolvedValue([
      { vendorName: "Bear State Kitchen" },
    ])

    await expect(getVendorName("BEAR STATE KITCHEN", "acct_ours")).resolves.toEqual({
      name: "Bear State Kitchen",
    })
  })

  it("still 404s a vendor nothing folds to", async () => {
    asMock(prisma.invoice.findMany).mockResolvedValue([{ vendorName: "Sysco" }])

    await expect(getVendorName("Nobody At All", "acct_ours")).resolves.toBeNull()
  })

  it("titles the page with the spelling on the MOST invoices, the same rule the list's row uses", async () => {
    // Two casings fold to one vendor. The old code took `rows.find(...)` over
    // an unordered `distinct` read, which could print either one. `getVendorName`
    // now counts, the way `adapters/vendors`'s `displayName` does for the row
    // that links here, so the title always matches what the list called it.
    asMock(prisma.invoice.findMany).mockResolvedValue([
      { vendorName: "BEAR STATE KITCHEN" },
      { vendorName: "Bear State Kitchen" },
    ])
    asMock(prisma.invoice.groupBy).mockResolvedValue([
      { vendorName: "BEAR STATE KITCHEN", _count: { vendorName: 1 } },
      { vendorName: "Bear State Kitchen", _count: { vendorName: 5 } },
    ])

    await expect(getVendorName("Bear State Kitchen", "acct_ours")).resolves.toEqual({
      name: "Bear State Kitchen",
    })
    // The count query is scoped to the account and to only the candidate
    // spellings, not every invoice on it.
    expect(asMock(prisma.invoice.groupBy)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          accountId: "acct_ours",
          vendorName: { in: ["BEAR STATE KITCHEN", "Bear State Kitchen"] },
        }),
      }),
    )
  })

  it("skips the count query entirely when only one casing folds to the vendor", async () => {
    asMock(prisma.invoice.findMany).mockResolvedValue([{ vendorName: "Sysco" }])

    await expect(getVendorName("Sysco", "acct_ours")).resolves.toEqual({ name: "Sysco" })
    expect(asMock(prisma.invoice.groupBy)).not.toHaveBeenCalled()
  })
})
