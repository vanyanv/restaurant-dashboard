// Pack-shape rules as rewritten on 2026-10-28, pinned on the real lines from
// the invoice audit. Under the old "any case over 50" rule every one of the
// "real case" lines below was held for review — 19 of the account's 25
// pack-shape holds — while the misreads at the bottom are the ones the
// account actually needed caught.

import { describe, expect, it } from "vitest"
import type { InvoiceExtractionLineItem } from "@/types/invoice"
import { findPackShapeAnomalies } from "@/lib/invoice-sanity"
import { buildPackShapePriors, lineMatchesPrior } from "@/lib/invoice-pack-prior"

const line = (o: Partial<InvoiceExtractionLineItem>): InvoiceExtractionLineItem => ({
  lineNumber: 1,
  sku: null,
  productName: "Item",
  description: null,
  category: null,
  quantity: 1,
  unit: "CS",
  packSize: null,
  unitSize: null,
  unitSizeUom: null,
  unitPrice: 10,
  extendedPrice: 10,
  ...o,
})

describe("findPackShapeAnomalies · real cases are not flagged", () => {
  it.each([
    ["Sysco sugar packets, 200 × 2.85 GS (grams)", line({ productName: "Sys Cls Sugar Packet", category: "Dry Goods", packSize: 200, unitSize: 2.85, unitSizeUom: "GS" })],
    ["Vitco house sauce, 180 cups a case", line({ productName: "CHRIS & EDDY'S HOUSE SCE", category: "Sauces", packSize: 180, unitSize: 1.5, unitSizeUom: "OZ" })],
    ["IFS can liners, 100 a case", line({ productName: "Can Liner 40x46 1.5 mil Black Coreless", packSize: 100, unitSize: 1, unitSizeUom: "EA" })],
    ["IFS napkins, 6,000 a case", line({ productName: "Napkin Disp 2 Ply White", packSize: 6000, unitSize: 1, unitSizeUom: "CT" })],
    ["IFS forks, 1,000 a case", line({ productName: "Cutlery Fork Full Size Extra Heavy Black PP", packSize: 100, unitSize: 10, unitSizeUom: "CT" })],
    ["Sysco sanitiser by the gallon", line({ productName: "keyston sanitizer multi quat liquid", category: "cleaning", packSize: 2, unitSize: 1, unitSizeUom: "GAL" })],
    ["Premier catch-weight beef, 9 cartons by the pound", line({ productName: "GROUND BEEF FINE GRND 73/27 CREEKSTONE", unit: "LB", packSize: 9, unitSize: 71.27, unitSizeUom: "LB" })],
    ["Fries in a bag, 6 × 5 lb", line({ productName: "FRIES SHOESTRING 6/5 LB BAG", category: "Frozen", packSize: 6, unitSize: 5, unitSizeUom: "LB" })],
    ["Hamburger rolls, 12 × 4 oz", line({ productName: "HAMBURGER ROLL", category: "Bakery", packSize: 12, unitSize: 4, unitSizeUom: "OZ" })],
    ["Catch-weight beef plate by the pound", line({ productName: "BEEF PLATE", unit: "LB", packSize: 2, unitSize: 10, unitSizeUom: "LB" })],
    ["IFS bagasse containers, 200 a case", line({ productName: "VB Container Hinged No PFAS 9X9X3 Bagasse", packSize: 200, unitSize: 1, unitSizeUom: "CT" })],
    ["IFS ketchup packets", line({ productName: "Ketchup Packets Foil 1000/9GR", packSize: 1000, unitSize: 9, unitSizeUom: "GR" })],
  ])("%s", (_, l) => {
    expect(findPackShapeAnomalies([l])).toEqual([])
  })
})

describe("findPackShapeAnomalies · misreads are still flagged", () => {
  it.each([
    ["KEVIDKO fork case read as 1,000,000", line({ productName: "BLACK HEAVY DUTY FORK", packSize: 1_000_000 })],
    ["IFS can liner read as 100 × 55 gal", line({ productName: "CAN LINER 22X14X58 1.5 MIL CLR", packSize: 100, unitSize: 55, unitSizeUom: "GAL" })],
    ["Sysco cup with its 20 oz name copied into the pack", line({ productName: "GREENO CUP PET 20 OZ C&D PET", packSize: 100, unitSize: 20, unitSizeUom: "OZ" })],
    ["IFS paper tray read as 250 lb", line({ productName: "Tray Food Paper #50 White/Red Check", packSize: 4, unitSize: 250, unitSizeUom: "LB" })],
    ["Sysco lettuce fused 112 × 1 CT", line({ productName: "Boston Lettuce", category: "Produce", packSize: 112, unitSize: 1, unitSizeUom: "CT" })],
  ])("%s", (_, l) => {
    expect(findPackShapeAnomalies([l])).toHaveLength(1)
  })
})

describe("findPackShapeAnomalies · history beats the heuristics", () => {
  const history = Array.from({ length: 4 }, () => ({
    vendorName: "Individual FoodService",
    sku: "PP5",
    productName: "Ppr Patty Dry Wax",
    category: null,
    unit: "CS",
    packSize: 1,
    unitSize: 1000,
    unitSizeUom: "CT",
  }))
  const priors = buildPackShapePriors(history)
  const isConfirmed = (l: InvoiceExtractionLineItem) => lineMatchesPrior("Individual FoodService", l, priors)

  it("exempts a line whose shape this SKU has shipped and been accepted three times or more", () => {
    // The same 1,000 sheets written as 1000 × 1 — would trip the lettuce rule
    // on a food line, and is fine here because history says so.
    const l = line({ sku: "PP5", productName: "Ppr Patty Dry Wax", category: "Produce", packSize: 1000, unitSize: 1, unitSizeUom: "CT" })
    expect(findPackShapeAnomalies([l])).toHaveLength(1)
    expect(findPackShapeAnomalies([l], { isConfirmed })).toEqual([])
  })

  it("does not exempt a shape the history disagrees with", () => {
    const l = line({ sku: "PP5", productName: "Ppr Patty Dry Wax", category: "Produce", packSize: 24, unitSize: 1, unitSizeUom: "CT" })
    expect(findPackShapeAnomalies([l], { isConfirmed })).toHaveLength(1)
  })
})
