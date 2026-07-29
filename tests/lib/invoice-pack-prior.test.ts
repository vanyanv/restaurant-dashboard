import { describe, expect, it } from "vitest"
import type { InvoiceExtraction, InvoiceExtractionLineItem } from "@/types/invoice"
import {
  PRIOR_MIN_SUPPORT,
  applyPackShapePriors,
  buildPackShapePriors,
  derivePackShapePrior,
  priorKey,
  type PriorShapeRow,
} from "@/lib/invoice-pack-prior"

function row(overrides: Partial<PriorShapeRow> = {}): PriorShapeRow {
  return {
    vendorName: "Sysco",
    sku: "7370699",
    productName: "GREENO CUP PET 20 OZ C&D PET",
    category: "Paper/Supplies",
    unit: "CS",
    packSize: 1,
    unitSize: 1000,
    unitSizeUom: "CT",
    ...overrides,
  }
}

function lineItem(
  overrides: Partial<InvoiceExtractionLineItem> = {}
): InvoiceExtractionLineItem {
  return {
    lineNumber: 1,
    sku: "7370699",
    productName: "GREENO CUP PET 20 OZ C&D PET",
    description: null,
    category: "Paper/Supplies",
    quantity: 1,
    unit: "CS",
    packSize: 100,
    unitSize: 20,
    unitSizeUom: "OZ",
    unitPrice: 96.55,
    extendedPrice: 96.55,
    ...overrides,
  }
}

function extraction(lineItems: InvoiceExtractionLineItem[]): InvoiceExtraction {
  return {
    vendorName: "Sysco",
    invoiceNumber: "145137147",
    invoiceDate: "2026-07-23",
    dueDate: null,
    deliveryAddress: null,
    lineItems,
    subtotal: null,
    taxAmount: null,
    totalAmount: 96.55,
    isReturn: false,
  }
}

describe("derivePackShapePrior", () => {
  it("derives the modal shape from consistent history", () => {
    const prior = derivePackShapePrior([row(), row(), row()])
    expect(prior).toEqual({
      unit: "CS",
      packSize: 1,
      unitSize: 1000,
      unitSizeUom: "CT",
      support: 3,
      eligible: 3,
    })
  })

  it("returns null below the minimum support threshold", () => {
    const rows = Array.from({ length: PRIOR_MIN_SUPPORT - 1 }, () => row())
    expect(derivePackShapePrior(rows)).toBeNull()
  })

  it("treats CT / EA / null unitSizeUom as the same count class when voting", () => {
    const prior = derivePackShapePrior([
      row({ packSize: 2, unitSize: 100, unitSizeUom: "CT", productName: "CONT FOAM 1-COMP BAGGED" }),
      row({ packSize: 2, unitSize: 100, unitSizeUom: "CT", productName: "CONT FOAM 1-COMP BAGGED" }),
      row({ packSize: 2, unitSize: 100, unitSizeUom: "EA", productName: "CONT FOAM 1-COMP BAGGED" }),
      row({ packSize: 2, unitSize: 100, unitSizeUom: null, productName: "CONT FOAM 1-COMP BAGGED" }),
    ])
    expect(prior).not.toBeNull()
    expect(prior!.packSize).toBe(2)
    expect(prior!.unitSize).toBe(100)
    // Modal raw uom among the winning group.
    expect(prior!.unitSizeUom).toBe("CT")
    expect(prior!.support).toBe(4)
  })

  it("treats arithmetically equivalent splits (10×100 vs 1×1000) as agreeing votes", () => {
    const prior = derivePackShapePrior([
      row({ packSize: 1, unitSize: 1000 }),
      row({ packSize: 1, unitSize: 1000 }),
      row({ packSize: 10, unitSize: 100 }),
    ])
    expect(prior).not.toBeNull()
    expect(prior!.support).toBe(3)
    // Representative shape is the modal exact split.
    expect(prior!.packSize).toBe(1)
    expect(prior!.unitSize).toBe(1000)
  })

  it("excludes name-leaked volume shapes on count-pack paper goods from voting", () => {
    // The Greeno cup scenario: OZ shapes derived from "20 OZ" in the product
    // name must not out-vote the real CT count shapes.
    const prior = derivePackShapePrior([
      row({ packSize: 1, unitSize: 1000, unitSizeUom: "CT" }),
      row({ packSize: 1, unitSize: 1000, unitSizeUom: "CT" }),
      row({ packSize: 10, unitSize: 100, unitSizeUom: "CT" }),
      row({ packSize: 1, unitSize: 20, unitSizeUom: "OZ" }),
      row({ packSize: 10, unitSize: 20, unitSizeUom: "OZ" }),
      row({ packSize: 20, unitSize: 1, unitSizeUom: "OZ" }),
      row({ packSize: 100, unitSize: 20, unitSizeUom: "OZ" }),
    ])
    expect(prior).not.toBeNull()
    expect(prior!.unitSizeUom).toBe("CT")
    expect(prior!.packSize * prior!.unitSize).toBe(1000)
  })

  it("keeps volume shapes eligible for non-paper products", () => {
    const prior = derivePackShapePrior([
      row({ productName: "WATER CRYSTAL GEYSER SPRING", category: "Beverages", packSize: 35, unitSize: 16.9, unitSizeUom: "OZ" }),
      row({ productName: "WATER CRYSTAL GEYSER SPRING", category: "Beverages", packSize: 35, unitSize: 16.9, unitSizeUom: "OZ" }),
      row({ productName: "WATER CRYSTAL GEYSER SPRING", category: "Beverages", packSize: 35, unitSize: 16.9, unitSizeUom: "OZ" }),
    ])
    expect(prior).not.toBeNull()
    expect(prior!.unitSizeUom).toBe("OZ")
    expect(prior!.unitSize).toBe(16.9)
  })

  it("returns null when no shape reaches a majority", () => {
    const prior = derivePackShapePrior([
      row({ packSize: 1, unitSize: 1000 }),
      row({ packSize: 1, unitSize: 1000 }),
      row({ packSize: 1, unitSize: 500 }),
      row({ packSize: 1, unitSize: 500 }),
    ])
    expect(prior).toBeNull()
  })

  it("never derives a prior from catch-weight lines (unit === unitSizeUom class)", () => {
    const prior = derivePackShapePrior([
      row({ productName: "GROUND BEEF FINE GRND", category: "Meat", unit: "LB", packSize: 6, unitSize: 70.45, unitSizeUom: "LB" }),
      row({ productName: "GROUND BEEF FINE GRND", category: "Meat", unit: "LB", packSize: 6, unitSize: 70.45, unitSizeUom: "LB" }),
      row({ productName: "GROUND BEEF FINE GRND", category: "Meat", unit: "LB", packSize: 6, unitSize: 70.45, unitSizeUom: "LB" }),
    ])
    expect(prior).toBeNull()
  })

  it("ignores rows with missing pack fields", () => {
    const prior = derivePackShapePrior([
      row({ packSize: null, unitSize: null, unitSizeUom: null }),
      row({ packSize: null, unitSize: null, unitSizeUom: null }),
      row({ packSize: null, unitSize: null, unitSizeUom: null }),
    ])
    expect(prior).toBeNull()
  })
})

describe("buildPackShapePriors / priorKey", () => {
  it("pools vendor-name variants under the same vendor stem", () => {
    const rows = [
      row({ vendorName: "Sysco" }),
      row({ vendorName: "Sysco Los Angeles, Inc." }),
      row({ vendorName: "Sysco Los Angeles, Inc." }),
    ]
    const priors = buildPackShapePriors(rows)
    const key = priorKey("Sysco", "7370699")
    expect(key).not.toBeNull()
    expect(priors.get(key!)).toMatchObject({ packSize: 1, unitSize: 1000, unitSizeUom: "CT" })
    // Both vendor-name variants resolve to the same key.
    expect(priorKey("Sysco Los Angeles, Inc.", "7370699")).toBe(key)
  })

  it("keeps different vendors with the same sku separate", () => {
    const rows = [
      row({ vendorName: "Sysco" }),
      row({ vendorName: "Sysco" }),
      row({ vendorName: "Sysco" }),
      row({ vendorName: "Individual FoodService", packSize: 4, unitSize: 250, unitSizeUom: "CT" }),
    ]
    const priors = buildPackShapePriors(rows)
    expect(priors.get(priorKey("Sysco", "7370699")!)).toMatchObject({ unitSize: 1000 })
    expect(priors.has(priorKey("Individual FoodService", "7370699")!)).toBe(false)
  })

  it("returns null keys for missing vendor or sku", () => {
    expect(priorKey(null, "7370699")).toBeNull()
    expect(priorKey("Sysco", null)).toBeNull()
  })
})

describe("applyPackShapePriors", () => {
  const priors = buildPackShapePriors([row(), row(), row()])

  it("overrides a name-leaked shape with the historical prior and reports the correction", () => {
    const input = extraction([lineItem({ packSize: 100, unitSize: 20, unitSizeUom: "OZ" })])
    const { extraction: out, corrections } = applyPackShapePriors(input, priors)

    expect(out.lineItems[0]).toMatchObject({
      packSize: 1,
      unitSize: 1000,
      unitSizeUom: "CT",
    })
    expect(corrections).toHaveLength(1)
    expect(corrections[0]).toMatchObject({
      lineNumber: 1,
      sku: "7370699",
      from: { packSize: 100, unitSize: 20, unitSizeUom: "OZ" },
      to: { packSize: 1, unitSize: 1000, unitSizeUom: "CT" },
    })
    // Input is not mutated.
    expect(input.lineItems[0].packSize).toBe(100)
  })

  it("leaves an arithmetically equivalent split untouched", () => {
    const input = extraction([lineItem({ packSize: 10, unitSize: 100, unitSizeUom: "CT" })])
    const { extraction: out, corrections } = applyPackShapePriors(input, priors)
    expect(out).toBe(input)
    expect(corrections).toHaveLength(0)
  })

  it("skips lines whose order unit disagrees with the prior", () => {
    const input = extraction([lineItem({ unit: "EA" })])
    const { extraction: out, corrections } = applyPackShapePriors(input, priors)
    expect(out).toBe(input)
    expect(corrections).toHaveLength(0)
  })

  it("skips lines with no sku or no matching prior", () => {
    const input = extraction([
      lineItem({ sku: null }),
      lineItem({ lineNumber: 2, sku: "9999999" }),
    ])
    const { extraction: out, corrections } = applyPackShapePriors(input, priors)
    expect(out).toBe(input)
    expect(corrections).toHaveLength(0)
  })
})
