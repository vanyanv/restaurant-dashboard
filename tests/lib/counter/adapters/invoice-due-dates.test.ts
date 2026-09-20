// invoices adapter — the due date, which the list could not show.
//
// `Invoice.dueDate` is written by the sync from the extractor's own `dueDate`
// and, before this, was read by exactly one query in the Counter layer
// (`loadInvoice`, for the detail page) and rendered by nothing. The list — the
// only screen that holds more than one invoice — did not even select it, so an
// owner could not see what is due when.
//
// The date is the one the VENDOR printed. Nothing in this schema records a
// payment, so "past due" here means past the printed date and nothing more;
// the list's note has to say so.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: { invoice: { findMany: vi.fn() } },
}))
vi.mock("@/lib/account-stores", () => ({ getScopedStores: vi.fn() }))

import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { getInvoicesSectionPromises } from "@/lib/counter/adapters/invoices"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const TODAY = new Date("2026-09-20T20:00:00.000Z")

const line = (productName: string, extendedPrice: number) => ({
  productName,
  canonicalIngredientId: "ing_1",
  canonicalIngredient: { name: "beef" },
  quantity: 1,
  unit: "CS",
  unitPrice: extendedPrice,
  extendedPrice,
})

/** Every row reconciles, so nothing here is pulled in as an out-of-window stray. */
const invoice = (id: string, number: string, dueDate: Date | null) => ({
  id,
  invoiceNumber: number,
  vendorName: "Sysco",
  invoiceDate: new Date("2026-09-15T00:00:00.000Z"),
  dueDate,
  totalAmount: 100,
  subtotal: 100,
  status: "MATCHED",
  pdfBlobPathname: "invoices/a_-b.pdf",
  reviewReasons: null,
  lineItems: [line("Beef", 100)],
})

const ROWS = [
  invoice("i_past", "PAST-1", new Date("2026-09-10T00:00:00.000Z")),
  invoice("i_soon", "SOON-1", new Date("2026-09-24T00:00:00.000Z")),
  invoice("i_later", "LATER-1", new Date("2026-10-30T00:00:00.000Z")),
  invoice("i_none", "NONE-1", null),
]

async function listSection(rows = ROWS) {
  asMock(prisma.invoice.findMany).mockResolvedValue(rows)
  asMock(getScopedStores).mockResolvedValue([{ id: "store_a" }])
  const sections = getInvoicesSectionPromises({
    range: { start: new Date("2026-09-14T00:00:00.000Z"), end: new Date("2026-09-20T00:00:00.000Z") },
    presetId: "d7",
    storeId: null,
    accountId: "acct_ours",
    today: TODAY,
  })
  const l = await sections.list
  if (l.status !== "ready") throw new Error(`list section was ${l.status}`)
  return l.data
}

describe("invoices adapter · the due date on the list", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("selects dueDate, scoped to the account and its stores", async () => {
    await listSection()
    const args = asMock(prisma.invoice.findMany).mock.calls[0][0]
    expect(args.select.dueDate).toBe(true)
    expect(args.where.accountId).toBe("acct_ours")
    expect(args.where.storeId).toEqual({ in: ["store_a"] })
  })

  it("prints the printed due date on every row, and names what has none", async () => {
    const list = await listSection()
    const by = new Map(list.rows.map((r) => [r.id, r]))
    expect(by.get("i_past")!.due).toBe("Sep 10")
    expect(by.get("i_soon")!.due).toBe("Sep 24")
    expect(by.get("i_later")!.due).toBe("Oct 30")
    expect(by.get("i_none")!.due).toBe("not printed")
  })

  it("marks a date already past as bad and one inside a week as warn", async () => {
    const list = await listSection()
    const by = new Map(list.rows.map((r) => [r.id, r]))
    expect(by.get("i_past")!.dueTone).toBe("bad")
    expect(by.get("i_soon")!.dueTone).toBe("warn")
    expect(by.get("i_later")!.dueTone).toBeNull()
    expect(by.get("i_none")!.dueTone).toBeNull()
  })

  it("says the date is the vendor's and that no payment is recorded", async () => {
    const list = await listSection()
    expect(list.dueNote).toContain("no payment")
    expect(list.dueNote).toContain("1 is past the date it prints")
    expect(list.dueNote).toContain("1 prints no due date")
  })
})
