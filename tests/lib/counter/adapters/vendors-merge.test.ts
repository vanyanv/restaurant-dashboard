// vendors adapter — the row identity the Vendors table folds on.
//
// `loadVendors` folded its rows on `normalizeVendorName`, which
// `vendor-normalize.ts`'s own docblock describes as a DISPLAY normalizer:
// "unknown vendors fall through with their raw casing intact. That made it
// unsafe as a database key." The Vendors table was using it as an identity
// anyway, so two casings of a vendor the alias table does not carry occupied
// two rows and split that vendor's spend, its invoice count and its cadence
// between them — the exact split `vendorMatchKey` was written to close.
//
// Every spelling in the alias table already folded correctly and still does;
// these tests pin the case the alias table cannot reach.

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
import { hasData, type SectionData } from "@/lib/counter/section-data"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const RANGE = { start: new Date("2026-01-01"), end: new Date("2026-01-31") }
const TODAY = new Date("2026-01-31T00:00:00Z")

/** One invoice whose goods lines tie out to its subtotal, so nothing is flagged. */
function invoice(vendorName: string, day: number, total: number) {
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

function dataOfOrThrow<T>(sd: SectionData<T>): T {
  if (!hasData(sd)) throw new Error(`section is ${sd.status}, not ready`)
  return sd.data
}

function run() {
  return getVendorsSectionPromises({
    storeId: null,
    accountId: "acct_ours",
    range: RANGE,
    today: TODAY,
  })
}

describe("vendors adapter · one row per vendor", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    asMock(getScopedStores).mockResolvedValue([{ id: "store_a" }])
    asMock(loadVendorBasketWeeks).mockResolvedValue([])
  })

  it("folds casing-only spellings of a vendor the alias table does not carry", async () => {
    asMock(prisma.invoice.findMany).mockResolvedValue([
      invoice("Bear State Kitchen", 5, 2000),
      invoice("BEAR STATE KITCHEN", 12, 1400),
      invoice("Sysco", 6, 500),
    ])

    const table = dataOfOrThrow(await run().table)

    // Two vendors, not three: the two Bear State spellings are one supplier.
    expect(table.rows).toHaveLength(2)
    const bear = table.rows.find((r) => String(r.cells.vendor).toLowerCase().startsWith("bear"))
    expect(bear).toBeDefined()
    // $3,400, not $2,000 in one row and $1,400 in another.
    expect(bear!.cells.spend).toBe("$3,400")
    expect(bear!.cells.invoices).toBe("2")
  })

  it("counts the merged vendor once in the strip and names the spellings behind it", async () => {
    asMock(prisma.invoice.findMany).mockResolvedValue([
      invoice("Bear State Kitchen", 5, 2000),
      invoice("BEAR STATE KITCHEN", 12, 1400),
    ])

    const headline = dataOfOrThrow(await run().headline)
    const vendors = headline.cells.find((c) => c.label === "Vendors")

    expect(vendors?.value).toBe("1")
    expect(vendors?.delta).toBe("2 names on the invoices")
  })

  it("still folds every alias-table spelling exactly as it did before", async () => {
    asMock(prisma.invoice.findMany).mockResolvedValue([
      invoice("Sysco", 5, 1000),
      invoice("Sysco Los Angeles, Inc.", 6, 500),
      invoice("Premier Meats", 7, 300),
      invoice("Premier Meats & Crystal Bay", 8, 200),
    ])

    const table = dataOfOrThrow(await run().table)
    const names = table.rows.map((r) => r.cells.vendor)

    expect(names).toEqual(["Sysco", "Premier Meats & Crystal Bay"])
    expect(table.rows[0].cells.spend).toBe("$1,500")
    expect(table.rows[1].cells.spend).toBe("$500")
  })

  it("keeps two genuinely different suppliers apart", async () => {
    asMock(prisma.invoice.findMany).mockResolvedValue([
      invoice("Premier Meats & Crystal Bay", 5, 1000),
      invoice("Premier Deli Services, Inc.", 6, 500),
    ])

    const table = dataOfOrThrow(await run().table)
    expect(table.rows.map((r) => r.cells.vendor)).toEqual([
      "Premier Meats & Crystal Bay",
      "Premier Deli Services, Inc.",
    ])
  })

  it("links a merged row at the display name its detail page answers to", async () => {
    asMock(prisma.invoice.findMany).mockResolvedValue([
      invoice("BEAR STATE KITCHEN", 5, 2000),
      invoice("Bear State Kitchen", 6, 1000),
      invoice("Bear State Kitchen", 7, 1000),
    ])

    const table = dataOfOrThrow(await run().table)
    // The spelling on most of the invoices wins the row, not whichever
    // arrived first.
    expect(table.rows[0].cells.vendor).toBe("Bear State Kitchen")
    expect(table.rows[0].href).toBe(
      `/dashboard/operations/vendors/${encodeURIComponent("Bear State Kitchen")}`,
    )
  })
})
