// The sync's self-healing helpers (2026-10-28): drop a line read twice, and
// describe what a first read got wrong so a second read can fix it.

import { describe, expect, it } from "vitest"
import type { InvoiceExtraction } from "@/types/invoice"
import { describeMoneyProblems, dropDuplicatedLines, findLineMathMismatches, fixCreditLineSigns, moneyProblemScore } from "@/lib/invoice-sanity"

const line = (lineNumber: number, productName: string, extendedPrice: number, quantity = 1) => ({
  lineNumber,
  sku: "0014046-01",
  productName,
  description: null,
  category: "Meat",
  quantity,
  unit: "LB",
  packSize: null,
  unitSize: null,
  unitSizeUom: null,
  unitPrice: extendedPrice / quantity,
  extendedPrice,
})

const extraction = (o: Partial<InvoiceExtraction>): InvoiceExtraction => ({
  vendorName: "Premier Meats & Crystal Bay",
  invoiceNumber: "2250793",
  invoiceDate: "2026-04-23",
  dueDate: null,
  deliveryAddress: null,
  lineItems: [],
  subtotal: null,
  taxAmount: null,
  totalAmount: 0,
  isReturn: false,
  ...o,
})

describe("dropDuplicatedLines", () => {
  it("drops the Premier 2250793 return note read as a second line", () => {
    const e = extraction({
      isReturn: true,
      subtotal: -2691.45,
      totalAmount: -2691.45,
      lineItems: [
        line(1, "GROUND BEEF FINE GRND 73/27 CREEKSTONE", -2691.45, -623.02),
        line(2, "GROUND BEEF FINE GRND 73/27 CREEKSTONE Return/Cancelled Order", -2691.45, -623.02),
      ],
    })
    const { extraction: out, dropped } = dropDuplicatedLines(e)
    expect(dropped).toEqual([2])
    expect(out.lineItems).toHaveLength(1)
  })

  it("keeps two identical lines the document really prints", () => {
    const e = extraction({
      subtotal: 200,
      totalAmount: 200,
      lineItems: [line(1, "BUNS", 100), line(2, "BUNS", 100)],
    })
    expect(dropDuplicatedLines(e).dropped).toEqual([])
  })
})

describe("describeMoneyProblems", () => {
  it("is empty when the read adds up", () => {
    const e = extraction({ subtotal: 100, totalAmount: 100, lineItems: [line(1, "BEEF", 100)] })
    expect(describeMoneyProblems(e)).toEqual([])
    expect(moneyProblemScore(e)).toBe(0)
  })

  it("names a missing line, and scores an empty read worst", () => {
    const short = extraction({ subtotal: 150, totalAmount: 150, lineItems: [line(1, "BEEF", 100)] })
    expect(describeMoneyProblems(short)[0]).toMatch(/add up to \$100\.00 but the invoice prints a subtotal of \$150\.00/)
    const empty = extraction({ subtotal: 150, totalAmount: 150, lineItems: [] })
    expect(describeMoneyProblems(empty)[0]).toMatch(/No priced line items/)
    expect(moneyProblemScore(empty)).toBeGreaterThan(moneyProblemScore(short))
  })
})

describe("dropDuplicatedLines · never pairs different products", () => {
  it("leaves lines with no SKU alone", () => {
    const noSku = (n: number) => ({ ...line(n, "BEEF", 50), sku: null })
    const e = extraction({ subtotal: 50, totalAmount: 50, lineItems: [noSku(1), noSku(2)] })
    expect(dropDuplicatedLines(e).dropped).toEqual([])
  })
})

describe("fixCreditLineSigns", () => {
  const base = {
    vendorName: "Vitco Foodservice",
    invoiceNumber: "323469-0A",
    invoiceDate: null,
    subtotal: -118.71,
    taxAmount: 0,
    totalAmount: -118.71,
  }
  const line = (over: Record<string, unknown>) => ({
    lineNumber: 1,
    sku: "15725",
    productName: "Chris & Eddy's House Sauce",
    quantity: 1,
    unit: "CS",
    unitPrice: 118.71,
    extendedPrice: -118.71,
    ...over,
  })

  it("gives a credit line's quantity the amount's minus sign", () => {
    const ex = { ...base, lineItems: [line({})] } as unknown as InvoiceExtraction
    const { extraction, flipped } = fixCreditLineSigns(ex)
    expect(flipped).toEqual([1])
    expect(extraction.lineItems[0].quantity).toBe(-1)
    expect(findLineMathMismatches(extraction.lineItems)).toEqual([])
  })

  it("leaves a line whose size does not match quantity × price", () => {
    const ex = { ...base, lineItems: [line({ quantity: 3 })] } as unknown as InvoiceExtraction
    const { extraction, flipped } = fixCreditLineSigns(ex)
    expect(flipped).toEqual([])
    expect(extraction).toBe(ex)
  })

  it("leaves ordinary and already-negative lines alone", () => {
    const ex = {
      ...base,
      lineItems: [line({ extendedPrice: 118.71 }), line({ lineNumber: 2, quantity: -1 })],
    } as unknown as InvoiceExtraction
    expect(fixCreditLineSigns(ex).flipped).toEqual([])
  })
})
