// The vendor basket, and which invoice its prices come from.
//
// The SQL returns one row per RAW vendor spelling, each already carrying that
// spelling's newest price (`ARRAY_AGG(... ORDER BY invoiceDate DESC)[1]`) —
// the comment above it promises "the newest price any OTHER vendor charged".
// The fold onto normalized vendor names then kept whichever row had the most
// invoices behind it, which throws that recency away. When a vendor bills
// under two spellings and the rarer one carries the more recent invoice, the
// older price is presented as current — as `mine` on the page, and as the
// `cheapest` that the gap percentage is measured against.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: { invoice: { findMany: vi.fn() }, $queryRaw: vi.fn() },
}))
vi.mock("@/lib/account-stores", () => ({ getScopedStores: vi.fn() }))
vi.mock("@/lib/counter/vendor-basket", () => ({ getVendorBasketTrends: vi.fn() }))

import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { getVendorBasketTrends } from "@/lib/counter/vendor-basket"
import { getVendorSectionPromises } from "@/lib/counter/adapters/vendor"
import { hasData } from "@/lib/counter/section-data"

const range = { start: new Date(2026, 7, 1), end: new Date(2026, 7, 31) }

function invoice(id: string, vendorName: string, day: string, totalAmount = 1_000) {
  return {
    id,
    vendorName,
    totalAmount,
    subtotal: totalAmount,
    invoiceDate: new Date(`${day}T00:00:00.000Z`),
    status: "APPROVED",
    storeId: "holly",
    invoiceNumber: id,
    pdfBlobPathname: null,
    lineItems: [],
  }
}

/** A priced row as the basket query returns it: one per RAW spelling. */
function priced(vendor: string, px: number, n: number, last: string) {
  return {
    cid: "ci_beef",
    name: "Ground beef",
    vendor,
    px,
    unit: "LB",
    n,
    last: new Date(`${last}T00:00:00.000Z`),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getScopedStores).mockResolvedValue([{ id: "holly", name: "Hollywood" }] as never)
  vi.mocked(getVendorBasketTrends).mockResolvedValue({ trend: new Map() } as never)
  vi.mocked(prisma.invoice.findMany).mockResolvedValue([
    invoice("i1", "Sysco Los Angeles", "2026-08-10"),
  ] as never)
})

async function basketRow(rows: ReturnType<typeof priced>[]) {
  vi.mocked(prisma.$queryRaw).mockResolvedValue(rows as never)
  const s = getVendorSectionPromises({
    vendor: "Sysco",
    accountId: "acct_1",
    storeId: null,
    range,
    today: new Date(2026, 7, 31),
  })
  const basket = await s.basket
  if (!hasData(basket)) throw new Error("basket")
  return basket.data.rows[0]
}

describe("vendor basket — folding a vendor's spellings", () => {
  it("takes the price off the most recent invoice, not the commonest spelling", async () => {
    const row = await basketRow([
      // The everyday spelling, forty invoices, but none since June.
      priced("Sysco Los Angeles", 4.0, 40, "2026-06-02"),
      // One invoice under a second spelling — and it is this month's price.
      priced("SYSCO CORP", 5.5, 1, "2026-08-18"),
      // A row only appears in the basket once there is someone to compare to.
      priced("Restaurant Depot", 4.5, 5, "2026-08-19"),
    ])
    // $4.00 was the June price. Sysco charges $5.50 now, which also flips the
    // gap: the page used to say Sysco was the cheaper of the two.
    expect(row.cells.mine).toBe("$5.50 / lb")
    expect(row.cells.best).toBe("$4.50 / lb")
  })

  it("measures the gap against another vendor's newest price too", async () => {
    const row = await basketRow([
      priced("Sysco Los Angeles", 5.0, 10, "2026-08-18"),
      priced("Restaurant Depot", 4.0, 20, "2026-05-01"),
      priced("RESTAURANT DEPOT INC", 2.5, 1, "2026-08-20"),
    ])
    // Restaurant Depot's current price is $2.50, not the $4.00 it charged in
    // May under the spelling that appears more often.
    expect(row.cells.best).toBe("$2.50 / lb")
    expect(row.cells.who).toBe("Restaurant Depot")
  })

  it("still folds the spellings into one vendor", async () => {
    const row = await basketRow([
      priced("Sysco Los Angeles", 4.0, 40, "2026-08-18"),
      priced("SYSCO CORP", 2.0, 1, "2026-06-02"),
      priced("Restaurant Depot", 4.5, 5, "2026-08-19"),
    ])
    // Sysco's own older spelling is not a rival vendor to undercut itself
    // with: the cheapest OTHER vendor is Restaurant Depot at $4.50.
    expect(row.cells.who).toBe("Restaurant Depot")
    expect(row.cells.best).toBe("$4.50 / lb")
    expect(row.cells.mine).toBe("$4.00 / lb")
  })
})
