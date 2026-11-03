import { describe, expect, it } from "vitest"
import type { InvoiceExtraction } from "@/types/invoice"
import {
  isLinePriceable,
  unpricedLineNumbers,
  verifyInvoice,
} from "@/lib/invoice-verify"

type Line = InvoiceExtraction["lineItems"][number]

function line(n: number, over: Partial<Line> = {}): Line {
  return {
    lineNumber: n,
    sku: `SKU${n}`,
    productName: `Item ${n}`,
    description: null,
    category: "Produce",
    quantity: 2,
    unit: "CS",
    packSize: 1,
    unitSize: 10,
    unitSizeUom: "LB",
    unitPrice: 25,
    extendedPrice: 50,
    ...over,
  }
}

function invoice(lines: Line[], over: Partial<InvoiceExtraction> = {}) {
  const goods = lines.reduce((t, l) => t + l.extendedPrice, 0)
  return { lineItems: lines, subtotal: goods, taxAmount: 0, totalAmount: goods, ...over }
}

const verifiedStore = { confidence: 1 }

describe("verifyInvoice", () => {
  it("verifies a clean invoice at a proved store", () => {
    const r = verifyInvoice({ extraction: invoice([line(1), line(2)]), dateSuspect: false, match: verifiedStore })
    expect(r).toEqual({ status: "MATCHED", reviewReasons: [], unpricedLines: [] })
  })

  it("verifies an invoice whose one line's arithmetic is off but whose total ties — and keeps that line out of prices", () => {
    // 10 × $3.70 printed as $37.99 (Sysco gloves, 2026-05-16): the subtotal is
    // the printed $37.99 plus the rest, so the money is proved by the total.
    const lines = [line(1), line(2, { quantity: 10, unitPrice: 3.7, extendedPrice: 37.99 })]
    const r = verifyInvoice({ extraction: invoice(lines), dateSuspect: false, match: verifiedStore })
    expect(r.status).toBe("MATCHED")
    expect(r.unpricedLines).toEqual([2])
    expect(r.reviewReasons).toHaveLength(1)
    expect(r.reviewReasons[0]).toMatchObject({ kind: "line_math", lineNumbers: [2] })
    expect(r.reviewReasons[0].message).toContain("not used for any recipe cost")
  })

  it("verifies an invoice with an unprovable pack shape, keeping that line out of prices", () => {
    // A lettuce-bug shape on food: 24 × 1 CT. Not a money problem.
    const lines = [line(1), line(2, { productName: "Romaine", unitSize: 1, unitSizeUom: "CT", packSize: 24 })]
    const r = verifyInvoice({ extraction: invoice(lines), dateSuspect: false, match: verifiedStore })
    expect(r.status).toBe("MATCHED")
    expect(r.unpricedLines).toEqual([2])
    expect(r.reviewReasons[0]).toMatchObject({ kind: "pack_shape", lineNumbers: [2] })
  })

  it("lets the SKU's accepted history clear a pack shape", () => {
    const lines = [line(1, { productName: "Romaine", unitSize: 1, unitSizeUom: "CT", packSize: 24 })]
    const r = verifyInvoice({
      extraction: invoice(lines),
      dateSuspect: false,
      match: verifiedStore,
      isPackConfirmed: () => true,
    })
    expect(r).toEqual({ status: "MATCHED", reviewReasons: [], unpricedLines: [] })
  })

  it("holds an invoice whose lines do not tie to the printed subtotal", () => {
    const r = verifyInvoice({
      extraction: invoice([line(1), line(2)], { subtotal: 224.68, totalAmount: 224.68 }),
      dateSuspect: false,
      match: verifiedStore,
    })
    expect(r.status).toBe("REVIEW")
    expect(r.reviewReasons.map((x) => x.kind)).toContain("total_reconciliation")
  })

  it("holds an invoice with nothing read under its total", () => {
    const r = verifyInvoice({
      extraction: { lineItems: [], subtotal: null, taxAmount: null, totalAmount: 1474.06 },
      dateSuspect: false,
      match: verifiedStore,
    })
    expect(r.status).toBe("REVIEW")
    expect(r.reviewReasons[0].kind).toBe("no_lines")
  })

  it("holds an invoice whose printed date cannot be right", () => {
    const r = verifyInvoice({ extraction: invoice([line(1)]), dateSuspect: true, match: verifiedStore })
    expect(r.status).toBe("REVIEW")
    expect(r.reviewReasons[0].kind).toBe("date_suspect")
  })

  it("holds an invoice whose store could not be proved", () => {
    const r = verifyInvoice({ extraction: invoice([line(1)]), dateSuspect: false, match: { confidence: 0.75 } })
    expect(r.status).toBe("REVIEW")
    expect(r.reviewReasons.at(-1)?.kind).toBe("low_match_confidence")
  })

  it("leaves an invoice with no store match PENDING", () => {
    const r = verifyInvoice({ extraction: invoice([line(1)]), dateSuspect: false, match: null })
    expect(r.status).toBe("PENDING")
  })
})

describe("isLinePriceable", () => {
  const notes = [
    { kind: "pack_shape", message: "…", lineNumbers: [3] },
    { kind: "line_math", message: "…", lineNumbers: [5] },
    { kind: "low_match_confidence", message: "…" },
  ]

  it("prices only lines on verified invoices", () => {
    for (const status of ["REVIEW", "PENDING", "REJECTED"]) {
      expect(isLinePriceable({ status, reviewReasons: null }, 1)).toBe(false)
    }
    expect(isLinePriceable({ status: "MATCHED", reviewReasons: null }, 1)).toBe(true)
    expect(isLinePriceable({ status: "APPROVED", reviewReasons: null }, 1)).toBe(true)
  })

  it("keeps the sync's marked lines out on a MATCHED invoice", () => {
    expect(isLinePriceable({ status: "MATCHED", reviewReasons: notes }, 3)).toBe(false)
    expect(isLinePriceable({ status: "MATCHED", reviewReasons: notes }, 5)).toBe(false)
    expect(isLinePriceable({ status: "MATCHED", reviewReasons: notes }, 4)).toBe(true)
  })

  it("trusts every line of an invoice the owner approved", () => {
    expect(isLinePriceable({ status: "APPROVED", reviewReasons: notes }, 3)).toBe(true)
  })

  it("reads only line-note kinds and ignores junk", () => {
    expect([...unpricedLineNumbers(notes)].sort()).toEqual([3, 5])
    expect(unpricedLineNumbers("nope").size).toBe(0)
    expect(unpricedLineNumbers([null, { kind: "pack_shape", lineNumbers: "3" }]).size).toBe(0)
  })
})

describe("verifyInvoice: missing printed total", () => {
  it("holds an invoice whose total could not be read", async () => {
    const { verifyInvoice } = await import("@/lib/invoice-verify")
    const r = verifyInvoice({
      extraction: {
        totalAmount: undefined,
        lineItems: [{ lineNumber: 1, productName: "Fries", quantity: 1, unitPrice: 10, extendedPrice: 10 }],
      },
      match: { storeId: "s1", confidence: 1 },
      dateSuspect: false,
    } as never)
    expect(r.status).toBe("REVIEW")
    expect(r.reviewReasons[0].message).toContain("printed total could not be read")
  })
})
