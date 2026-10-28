// `tieOut` — the one rule for "do the lines add up", read by the sync, the
// Approve gate, Needs you and the vendor pages. Cases are the invoices the
// 2026-10-28 audit found locked out of Approve under the old 2¢ exact-name rule.

import { describe, expect, it } from "vitest"
import { isFeeRow, tieOut, TIE_OUT_TOLERANCE } from "@/lib/invoice-charges"

const goods = (...prices: number[]) => prices.map((p, i) => ({ productName: `Item ${i}`, sku: `S${i}`, extendedPrice: p }))
const fee = (productName: string, extendedPrice: number) => ({ productName, sku: null, extendedPrice })

describe("tieOut", () => {
  it("ties out IFS's new layout: Freight/Misc. outside the subtotal (43526940)", () => {
    const t = tieOut([...goods(1000, 107.31), fee("Freight/Misc.", 7.75)], { subtotal: 1107.31, taxAmount: 11.49, totalAmount: 1126.55 })
    expect(t.reconciles).toBe(true)
    expect(t.goods).toBeCloseTo(1107.31, 2)
    expect([...t.outside]).toEqual([2])
  })

  it("ties out Sysco's fuel surcharge INSIDE the subtotal", () => {
    const t = tieOut([...goods(1740.41), fee("Fuel Surcharge", 10)], { subtotal: 1750.41, taxAmount: 3.73, totalAmount: 1754.14 })
    expect(t.reconciles).toBe(true)
    expect(t.outside.size).toBe(0)
  })

  it("ties out a Sysco invoice with one fee inside and one outside (945679552)", () => {
    const t = tieOut(
      [...goods(95, 94.43, 154.99), fee("CHGS FOR FUEL SURCHARGE", 0.84), fee("Miscellaneous Charge", 8.95)],
      { subtotal: 353.37, taxAmount: 34.45, totalAmount: 387.82 },
    )
    expect(t.reconciles).toBe(true)
  })

  it("does not move a product line to make the sum work", () => {
    // A $7.75 line with a SKU is goods, never a fee moved outside the
    // subtotal. Against the subtotal the gap stands; it ties only because the
    // printed total less tax agrees to the cent (the group-subtotal case below).
    const t = tieOut(goods(100, 52.8, 7.75), { subtotal: 152.8, taxAmount: 12.2, totalAmount: 172.75 })
    expect(t.outside.size).toBe(0)
    expect(t.goods).toBeCloseTo(160.55, 2)
    expect(t.referenceKind).toBe("total less tax")
    const offByFiveCents = tieOut(goods(100, 52.8, 7.75), { subtotal: 152.8, taxAmount: 12.2, totalAmount: 172.8 })
    expect(offByFiveCents.reconciles).toBe(false)
    expect(offByFiveCents.gap).toBeCloseTo(7.75, 2)
  })

  it("flags a credit whose one line was read twice (Premier 2250793)", () => {
    const t = tieOut(goods(-2691.45, -2691.45), { subtotal: -2691.45, taxAmount: null, totalAmount: -2691.45 })
    expect(t.reconciles).toBe(false)
    expect(t.gap).toBeCloseTo(-2691.45, 2)
  })

  it("compares against total less tax when no subtotal is printed", () => {
    const t = tieOut(goods(100), { subtotal: null, taxAmount: 9.5, totalAmount: 109.5 })
    expect(t).toMatchObject({ reconciles: true, referenceKind: "total less tax", reference: 109.5 - 9.5 })
  })

  it("holds the line at a dollar, in whole cents", () => {
    expect(tieOut(goods(101), { subtotal: 100, taxAmount: null, totalAmount: 100 }).reconciles).toBe(true)
    expect(tieOut(goods(101.01), { subtotal: 100, taxAmount: null, totalAmount: 100 }).reconciles).toBe(false)
    expect(TIE_OUT_TOLERANCE).toBe(1)
  })

  it("reports a header with no lines as the whole subtotal short", () => {
    const t = tieOut([], { subtotal: 1474.06, taxAmount: 61.75, totalAmount: 1543.56 })
    expect(t.reconciles).toBe(false)
    expect(t.gap).toBeCloseTo(-1474.06, 2)
  })
})

describe("isFeeRow", () => {
  it.each(["Freight/Misc.", "Fuel Charge", "FUELSURCHARGE", "CHGS For Fuel Surcharge", "Pallet Charge", "Miscellaneous Charge", "Total SALES TAX"])(
    "treats %s with no SKU as a fee",
    (name) => expect(isFeeRow({ productName: name, sku: null })).toBe(true),
  )

  it("keeps the four exact names as fees even with a SKU, and nothing else", () => {
    expect(isFeeRow({ productName: "Fuel Charge", sku: "FUEL" })).toBe(true)
    expect(isFeeRow({ productName: "Fuel Surcharge", sku: "123" })).toBe(false)
  })

  it("leaves products alone", () => {
    expect(isFeeRow({ productName: "Soda Sprite Mexican Glass CRV Inc", sku: null })).toBe(false)
    expect(isFeeRow({ productName: "Miso Paste", sku: null })).toBe(false)
  })
})

describe("tieOut: a group subtotal read as the invoice's", () => {
  // Sysco 945683569 (2026-03-05): fries $380 + rolls $232.50 + onions $83.10,
  // tax $8.95, total $704.55 — but the subtotal was read as $612.50, the first
  // two groups only.
  const head = { subtotal: 612.5, taxAmount: 8.95, totalAmount: 704.55 }

  it("ties out against total less tax when every line is a catalogue item", () => {
    const t = tieOut(goods(380, 232.5, 83.1), head)
    expect(t.reconciles).toBe(true)
    expect(t.referenceKind).toBe("total less tax")
    expect(t.reference).toBeCloseTo(695.6, 2)
  })

  it("keeps the subtotal reading when the extra line has no SKU", () => {
    const t = tieOut([...goods(380, 232.5), { productName: "Item 2", sku: null, extendedPrice: 83.1 }], head)
    expect(t.reconciles).toBe(false)
    expect(t.referenceKind).toBe("subtotal")
  })

  it("needs the total to tie to the cent, not within the dollar tolerance", () => {
    const t = tieOut(goods(380, 232.5, 83.6), head)
    expect(t.reconciles).toBe(false)
    expect(t.referenceKind).toBe("subtotal")
  })
})
