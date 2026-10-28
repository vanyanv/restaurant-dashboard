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
    // An unnamed extra $7.75 line with a SKU is goods, so the gap stands.
    const t = tieOut(goods(100, 52.8, 7.75), { subtotal: 152.8, taxAmount: 12.2, totalAmount: 172.75 })
    expect(t.reconciles).toBe(false)
    expect(t.gap).toBeCloseTo(7.75, 2)
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

  it("never treats a line with a SKU as a fee", () => {
    expect(isFeeRow({ productName: "Fuel Charge", sku: "123" })).toBe(false)
  })

  it("leaves products alone", () => {
    expect(isFeeRow({ productName: "Soda Sprite Mexican Glass CRV Inc", sku: null })).toBe(false)
    expect(isFeeRow({ productName: "Miso Paste", sku: null })).toBe(false)
  })
})
