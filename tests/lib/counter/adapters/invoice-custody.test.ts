// invoice adapter — the custody check between the stored extraction and the
// stored lines.
//
// `Invoice.rawExtractionJson` is `JSON.stringify(extraction)`, the same object
// whose `lineItems` the sync writes out as `InvoiceLineItem` rows, carrying
// `lineNumber` across verbatim (`src/app/api/invoices/sync/route.ts`, and again
// in `scripts/reprocess-invoices.ts`). So a line number in the raw output with
// no line item behind it is a row that was read and never persisted.
//
// The adapter already counted those rows. It never said what they were WORTH,
// which is the figure that decides whether a dropped row matters — and the
// `InvoiceDocument.rows` KV it built the counts into was rendered by neither
// surface, so the only place any of it reached a reader was the note.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: { invoice: { findFirst: vi.fn() } },
}))

import { prisma } from "@/lib/prisma"
import { getInvoiceSectionPromises } from "@/lib/counter/adapters/invoice"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

/** One row as the extractor emits it, and as the sync then stores it. */
const rawRow = (lineNumber: number, productName: string, extendedPrice: number) => ({
  lineNumber,
  sku: null,
  productName,
  description: null,
  category: null,
  quantity: 1,
  unit: "CS",
  packSize: null,
  unitSize: null,
  unitSizeUom: null,
  unitPrice: extendedPrice,
  extendedPrice,
})

const storedRow = (lineNumber: number, productName: string, extendedPrice: number) => ({
  lineNumber,
  sku: null,
  productName,
  quantity: 1,
  unit: "CS",
  unitPrice: extendedPrice,
  extendedPrice,
  packSize: null,
  unitSize: null,
  unitSizeUom: null,
  matchSource: null,
  canonicalIngredient: null,
})

interface InvoiceOverrides {
  rawLineItems?: ReturnType<typeof rawRow>[] | null
  lineItems?: ReturnType<typeof storedRow>[]
  subtotal?: number | null
  emailSubject?: string | null
}

function invoiceRow(o: InvoiceOverrides = {}) {
  const rawLineItems = o.rawLineItems === undefined
    ? [rawRow(1, "Beef", 100), rawRow(2, "Lettuce", 312.5), rawRow(3, "Buns", 100)]
    : o.rawLineItems
  const lineItems = o.lineItems ?? [storedRow(1, "Beef", 100)]
  return {
    id: "inv_1",
    invoiceNumber: "G95788-00",
    vendorName: "Sysco",
    invoiceDate: new Date("2026-08-20T00:00:00Z"),
    dueDate: new Date("2026-09-19T00:00:00Z"),
    status: "MATCHED",
    totalAmount: 512.5,
    subtotal: o.subtotal === undefined ? 512.5 : o.subtotal,
    taxAmount: 0,
    isReturn: false,
    reviewReasons: null,
    matchConfidence: 0.99,
    emailSubject: o.emailSubject === undefined ? "Order: G95788-00" : o.emailSubject,
    emailReceivedAt: new Date("2026-08-20T10:00:00Z"),
    attachmentName: "invoice.pdf",
    pdfBlobPathname: "invoices/abc_-def.pdf",
    pdfSize: 248_000,
    extractionModel: "gemini",
    rawExtractionJson:
      rawLineItems === null ? null : JSON.stringify({ lineItems: rawLineItems }),
    store: { name: "Hollywood" },
    lineItems,
  }
}

async function documentOf(row: unknown) {
  asMock(prisma.invoice.findFirst).mockResolvedValue(row)
  const sections = getInvoiceSectionPromises({ invoiceId: "inv_1", accountId: "acct_ours" })
  const d = await sections.document
  if (d.status !== "ready") throw new Error(`document section was ${d.status}`)
  return d.data
}

describe("invoice adapter · custody of the extracted rows", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("scopes the load to the account, not the owner or the store", async () => {
    await documentOf(invoiceRow())
    const where = asMock(prisma.invoice.findFirst).mock.calls[0][0].where
    expect(where).toEqual({ id: "inv_1", accountId: "acct_ours" })
  })

  it("says what the rows that never became line items are worth", async () => {
    const doc = await documentOf(invoiceRow())
    // Two of the extractor's three rows — $312.50 and $100.00 — have no line
    // item behind them.
    expect(doc.note).toContain("$412.50")
    expect(doc.custody.missing).toBe(2)
    expect(doc.custody.missingValue).toBeCloseTo(412.5, 2)
    expect(doc.custody.rawRows).toBe(3)
    expect(doc.custody.storedRows).toBe(1)
  })

  it("counts a line item the extraction does not account for as surplus", async () => {
    const doc = await documentOf(
      invoiceRow({
        rawLineItems: [rawRow(1, "Beef", 100)],
        lineItems: [storedRow(1, "Beef", 100), storedRow(1, "Beef", 100)],
      }),
    )
    expect(doc.custody.missing).toBe(0)
    expect(doc.custody.surplus).toBe(1)
    expect(doc.custody.surplusValue).toBeCloseTo(100, 2)
    expect(doc.note).toContain("stored twice")
  })

  it("calls the figure a floor when one of several missing rows carries no usable price", async () => {
    const doc = await documentOf(
      invoiceRow({
        rawLineItems: [
          rawRow(1, "Beef", 100),
          rawRow(2, "Lettuce", 312.5),
          { ...rawRow(3, "Buns", 0), extendedPrice: null as unknown as number },
        ],
      }),
    )
    expect(doc.custody.missing).toBe(2)
    expect(doc.custody.missingValue).toBeCloseTo(312.5, 2)
    expect(doc.custody.missingValueIsFloor).toBe(true)
    expect(doc.note).toContain("at least $312.50")
  })

  it("states no amount at all when the only missing row carries no price", async () => {
    const doc = await documentOf(
      invoiceRow({
        rawLineItems: [
          rawRow(1, "Beef", 100),
          { ...rawRow(2, "Lettuce", 0), extendedPrice: null as unknown as number },
        ],
      }),
    )
    expect(doc.custody.missing).toBe(1)
    expect(doc.custody.missingValue).toBe(0)
    expect(doc.custody.missingValueIsFloor).toBe(true)
    // "at least $0.00" is a number standing in for "we cannot say".
    expect(doc.note).not.toContain("$0.00")
    expect(doc.note).toContain("worth an amount the stored extraction does not state")
  })

  it("says the check cannot run when no raw extraction is stored", async () => {
    const doc = await documentOf(invoiceRow({ rawLineItems: null }))
    expect(doc.custody.rawRows).toBeNull()
    expect(doc.note).toContain("No raw extraction is stored")
    expect(doc.note).not.toContain("never stored")
  })

  // `Invoice.pdfSize` is written by the sync and by both PDF backfill scripts,
  // and the storage panel printed "not recorded" about it because the loader
  // never selected the column.
  it("prints the stored object's size, which the schema does record", async () => {
    asMock(prisma.invoice.findFirst).mockResolvedValue(invoiceRow())
    const sections = getInvoiceSectionPromises({ invoiceId: "inv_1", accountId: "acct_ours" })
    const p = await sections.panels
    if (p.status !== "ready") throw new Error(`panels section was ${p.status}`)
    const size = p.data.storage.rows.find((r) => r.label === "Size")
    expect(size?.value).toBe("248 KB")
    // Page count really is not stored — no column holds it.
    expect(p.data.storage.rows.find((r) => r.label === "Pages")?.value).toBe("not recorded")
  })

  it("says all of them survived when the two agree", async () => {
    const doc = await documentOf(
      invoiceRow({
        rawLineItems: [rawRow(1, "Beef", 100)],
        lineItems: [storedRow(1, "Beef", 100)],
        subtotal: 100,
      }),
    )
    expect(doc.custody.missing).toBe(0)
    expect(doc.custody.surplus).toBe(0)
    expect(doc.custody.missingValue).toBe(0)
  })
})
