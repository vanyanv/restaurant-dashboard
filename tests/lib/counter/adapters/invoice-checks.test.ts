// invoice adapter · "What we checked".
//
// The checklist is computed from the same `gap` and line rows the money lines
// print, so the two cannot disagree: a gap is a failed tie-out row, an
// unmatched goods line is a warning, and a stored reason that only restates
// the tie-out is not listed twice.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: { invoice: { findFirst: vi.fn() } },
}))

import { prisma } from "@/lib/prisma"
import { getInvoiceSectionPromises } from "@/lib/counter/adapters/invoice"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const stored = (lineNumber: number, productName: string, extendedPrice: number, matched: string | null = "Ground beef") => ({
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
  matchSource: matched ? "sku" : null,
  canonicalIngredient: matched ? { name: matched } : null,
})

function row(lineItems: ReturnType<typeof stored>[], subtotal: number, reviewReasons: unknown = null) {
  return {
    id: "inv_1",
    invoiceNumber: "448812",
    vendorName: "Sysco",
    invoiceDate: new Date("2026-10-21T00:00:00Z"),
    dueDate: null,
    status: "REVIEW",
    totalAmount: subtotal,
    subtotal,
    taxAmount: 0,
    isReturn: false,
    reviewReasons,
    matchConfidence: 0.98,
    emailSubject: "Invoice 448812",
    emailReceivedAt: new Date("2026-10-23T10:00:00Z"),
    attachmentName: "448812.pdf",
    pdfBlobPathname: "invoices/abc_-def.pdf",
    pdfSize: 300_000,
    extractionModel: "gemini",
    rawExtractionJson: null,
    store: { name: "Van Nuys" },
    lineItems,
  }
}

async function checksOf(r: unknown) {
  asMock(prisma.invoice.findFirst).mockResolvedValue(r)
  const s = await getInvoiceSectionPromises({ invoiceId: "inv_1", accountId: "acct_ours" }).reasons
  if (s.status !== "ready") throw new Error(`reasons section was ${s.status}`)
  return s.data.checks
}

describe("invoice adapter · what we checked", () => {
  beforeEach(() => vi.clearAllMocks())

  it("passes both rows when the lines tie out and every line is matched", async () => {
    const checks = await checksOf(row([stored(1, "Beef", 100), stored(2, "Buns", 50)], 150))
    expect(checks.map((c) => [c.key, c.tone])).toEqual([
      ["ties", "good"],
      ["matched", "good"],
    ])
  })

  it("fails the tie-out with the gap the money lines print, and does not repeat the stored reason", async () => {
    const checks = await checksOf(
      row([stored(1, "Beef", 100)], 312.4, [
        { kind: "total_reconciliation", message: "Lines sum to 100.00, subtotal 312.40" },
        { kind: "pack_shape", message: "Pack looks wrong", lineNumbers: [1] },
      ]),
    )
    expect(checks[0]).toMatchObject({ key: "ties", tone: "bad", title: "The lines are $212.40 short" })
    expect(checks.filter((c) => c.key.startsWith("total_reconciliation"))).toHaveLength(0)
    expect(checks.at(-1)).toMatchObject({ tone: "warn", title: "A pack shape looks wrong (line 1)" })
  })

  it("warns about goods lines that reach no ingredient, and names them", async () => {
    const checks = await checksOf(row([stored(1, "Beef", 100), stored(2, "GLOVE NITRILE LG", 50, null)], 150))
    expect(checks[1]).toMatchObject({ key: "matched", tone: "warn", title: "1 line matches no ingredient" })
    expect(checks[1].body).toMatch(/glove nitrile lg/i)
  })
})
