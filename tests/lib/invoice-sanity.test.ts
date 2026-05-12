import { describe, expect, it } from "vitest"
import type { InvoiceExtraction } from "@/types/invoice"
import {
  findPackShapeAnomalies,
  normalizeCatchWeightMeatLines,
  normalizeCountPackLines,
  parsePerCaseWeights,
} from "@/lib/invoice-sanity"

function extraction(
  overrides: Partial<InvoiceExtraction> = {}
): InvoiceExtraction {
  return {
    vendorName: "Premier Meats & Crystal Bay",
    invoiceNumber: "2262871",
    invoiceDate: "2026-05-07",
    dueDate: null,
    deliveryAddress: "5539 SUNSET BLVD, HOLLYWOOD, CA 90028",
    lineItems: [
      {
        lineNumber: 1,
        sku: "0014046-01",
        productName: "GROUND BEEF FINE GRND 73/27 CREEKSTONE",
        description: null,
        category: "Meat",
        quantity: 6,
        unit: "CS",
        packSize: null,
        unitSize: null,
        unitSizeUom: null,
        unitPrice: 4.34,
        extendedPrice: 1851.01,
      },
    ],
    subtotal: 1851.01,
    taxAmount: null,
    totalAmount: 1851.01,
    isReturn: false,
    ...overrides,
  }
}

describe("parsePerCaseWeights", () => {
  it("returns null for null or empty descriptions", () => {
    expect(parsePerCaseWeights(null)).toBeNull()
    expect(parsePerCaseWeights("")).toBeNull()
  })

  it("extracts a comma-separated weight list from a Premier Meats description", () => {
    const result = parsePerCaseWeights(
      "EDIT PER REP 71.05, 71.25, 71.05, 71.05, 71.05, 71.05\n" +
        "*Pork CA Prop12 Compliant* *Veal CA Prop12 Compliant* Thank you for your Business!!"
    )
    expect(result).toEqual([71.05, 71.25, 71.05, 71.05, 71.05, 71.05])
  })

  it("handles a leading 'Weights:' label", () => {
    expect(parsePerCaseWeights("Weights: 71.25, 71.25, 71.25, 71.25, 71.05, 69.85")).toEqual([
      71.25, 71.25, 71.25, 71.25, 71.05, 69.85,
    ])
  })

  it("returns the longest comma-separated run when there are interspersed numbers", () => {
    expect(
      parsePerCaseWeights("70.45, 70.45, 71.05, 70.25, 70.45, 70.25, 70.45, 70.65, 70.45")
    ).toEqual([70.45, 70.45, 71.05, 70.25, 70.45, 70.25, 70.45, 70.65, 70.45])
  })

  it("returns null when only one weight is present", () => {
    expect(parsePerCaseWeights("Weight: 70.45 lb. Thanks!")).toBeNull()
  })

  it("returns null when no weight-like numbers are present", () => {
    expect(parsePerCaseWeights("*Pork CA Prop12 Compliant* Thank you for your Business!!")).toBeNull()
  })

  it("rejects runs containing numbers outside the [0.25, 200] plausible weight range", () => {
    // Wildly oversized numbers — not realistic per-case weights
    expect(parsePerCaseWeights("Item ids: 9999, 9999, 9999")).toBeNull()
  })
})

describe("normalizeCatchWeightMeatLines", () => {
  it("converts Premier/Crystal Bay carton-count meat mistakes to implied LB weight and infers pack fields from the original carton count", () => {
    const result = normalizeCatchWeightMeatLines(extraction())
    const line = result.lineItems[0]

    expect(line.quantity).toBeCloseTo(426.5, 3)
    expect(line.unit).toBe("LB")
    // Carton count (6 CS) is preserved as packSize; unitSize derived from total/count.
    expect(line.packSize).toBe(6)
    expect(line.unitSize).toBeCloseTo(71.083, 2)
    expect(line.unitSizeUom).toBe("LB")
  })

  it("uses per-case weights from description when available (invoice 2262868 verbatim)", () => {
    const result = normalizeCatchWeightMeatLines(
      extraction({
        invoiceNumber: "2262868",
        subtotal: 2753.51,
        totalAmount: 2753.51,
        lineItems: [
          {
            lineNumber: 1,
            sku: "0014046-01",
            productName: "GROUND BEEF FINE GRND 73/27 CREEKSTONE",
            description:
              "70.45, 70.45, 71.05, 70.25, 70.45, 70.25, 70.45, 70.65, 70.45\n" +
              "*Pork CA Prop12 Compliant* *Veal CA Prop12 Compliant* Thank you for your Business!!",
            category: "Meat",
            quantity: 9,
            unit: "CS",
            packSize: null,
            unitSize: null,
            unitSizeUom: null,
            unitPrice: 4.34,
            extendedPrice: 2753.51,
          },
        ],
      })
    )

    const line = result.lineItems[0]
    expect(line.quantity).toBeCloseTo(634.45, 2)
    expect(line.unit).toBe("LB")
    expect(line.packSize).toBe(9)
    expect(line.unitSize).toBeCloseTo(70.494, 2)
    expect(line.unitSizeUom).toBe("LB")
  })

  it("falls back to packSize=null when the original quantity is not a plausible case count and description has no weights", () => {
    // Quantity of 99 cases isn't a plausible carton count for a single line.
    const result = normalizeCatchWeightMeatLines(
      extraction({
        lineItems: [
          {
            lineNumber: 1,
            sku: "0014046-01",
            productName: "GROUND BEEF FINE GRND 73/27 CREEKSTONE",
            description: null,
            category: "Meat",
            quantity: 99,
            unit: "CS",
            packSize: null,
            unitSize: null,
            unitSizeUom: null,
            unitPrice: 4.34,
            extendedPrice: 1851.01,
          },
        ],
      })
    )

    expect(result.lineItems[0].unit).toBe("LB")
    expect(result.lineItems[0].packSize).toBeNull()
    expect(result.lineItems[0].unitSize).toBeNull()
    expect(result.lineItems[0].unitSizeUom).toBeNull()
  })

  it("does not touch non-meat lines even when math doesn't reconcile", () => {
    const result = normalizeCatchWeightMeatLines(
      extraction({
        vendorName: "Sysco",
        lineItems: [
          {
            lineNumber: 1,
            sku: "1763432",
            productName: "Imported Fresh Tomato Bulk 5x6",
            description: null,
            category: "Produce",
            quantity: 1,
            unit: "CS",
            packSize: 1,
            unitSize: 25,
            unitSizeUom: "LB",
            unitPrice: 38.5,
            extendedPrice: 38.5,
          },
        ],
      })
    )

    expect(result.lineItems[0]).toMatchObject({
      quantity: 1,
      unit: "CS",
      packSize: 1,
      unitSize: 25,
      unitSizeUom: "LB",
    })
  })

  it("leaves already-correct catch-weight meat unchanged", () => {
    const result = normalizeCatchWeightMeatLines(
      extraction({
        lineItems: [
          {
            lineNumber: 1,
            sku: "0014046-01",
            productName: "GROUND BEEF FINE GRND 73/27 CREEKSTONE",
            description: null,
            category: "Meat",
            quantity: 694.27,
            unit: "LB",
            packSize: null,
            unitSize: null,
            unitSizeUom: null,
            unitPrice: 4.32,
            extendedPrice: 2999.25,
          },
        ],
      })
    )

    expect(result.lineItems[0]).toMatchObject({
      quantity: 694.27,
      unit: "LB",
      packSize: null,
      unitSize: null,
      unitSizeUom: null,
    })
  })

  it("preserves a negative implied LB quantity on return meat lines and infers absolute pack count", () => {
    const result = normalizeCatchWeightMeatLines(
      extraction({
        isReturn: true,
        totalAmount: -2691.45,
        subtotal: -2691.45,
        lineItems: [
          {
            lineNumber: 1,
            sku: "0014046-01",
            productName: "GROUND BEEF FINE GRND 73/27 CREEKSTONE",
            description: null,
            category: "Meat",
            quantity: -6,
            unit: "CS",
            packSize: null,
            unitSize: null,
            unitSizeUom: null,
            unitPrice: 4.32,
            extendedPrice: -2691.45,
          },
        ],
      })
    )

    expect(result.lineItems[0].quantity).toBeCloseTo(-623.021, 3)
    expect(result.lineItems[0].unit).toBe("LB")
    // Pack count is always positive even on returns.
    expect(result.lineItems[0].packSize).toBe(6)
    expect(result.lineItems[0].unitSize).toBeCloseTo(103.836, 2)
    expect(result.lineItems[0].unitSizeUom).toBe("LB")
  })
})

describe("findPackShapeAnomalies", () => {
  it("does not flag small gram packet cases like IFS mustard", () => {
    const anomalies = findPackShapeAnomalies([
      {
        lineNumber: 10,
        sku: "G106",
        productName: "Mustard Packets 5.5 Gram",
        description: null,
        category: "Dry Goods",
        quantity: 1,
        unit: "CS",
        packSize: 200,
        unitSize: 5.5,
        unitSizeUom: "GRM",
        unitPrice: 11.68,
        extendedPrice: 11.68,
      },
    ])

    expect(anomalies).toEqual([])
  })

  it("still flags real fused case-pack shapes", () => {
    const anomalies = findPackShapeAnomalies([
      {
        lineNumber: 1,
        sku: "2717106",
        productName: "Boston Lettuce",
        description: null,
        category: "Produce",
        quantity: 1,
        unit: "CS",
        packSize: 112,
        unitSize: 1,
        unitSizeUom: "CT",
        unitPrice: 24,
        extendedPrice: 24,
      },
    ])

    expect(anomalies).toHaveLength(1)
    expect(anomalies[0].reasons.join(" ")).toContain("fused")
  })

  it("does not flag legitimate large paper count packs like bath tissue", () => {
    const anomalies = findPackShapeAnomalies([
      {
        lineNumber: 7,
        sku: "30394",
        productName: "Emboss Bath Tissue 2ply Recy Ind Wrp",
        description: null,
        category: "Paper/Supplies",
        quantity: 1,
        unit: "CS",
        packSize: 96,
        unitSize: 500,
        unitSizeUom: null,
        unitPrice: 62.14,
        extendedPrice: 62.14,
      },
    ])

    expect(anomalies).toEqual([])
  })
})

describe("normalizeCountPackLines", () => {
  it("normalizes single-count paper cases captured as packSize=N and unitSize=1", () => {
    const result = normalizeCountPackLines(
      extraction({
        vendorName: "Individual FoodService",
        lineItems: [
          {
            lineNumber: 5,
            sku: "18676",
            productName: "Bag T-shirt White 17 Micron with Warning",
            description: null,
            category: "Paper/Supplies",
            quantity: 1,
            unit: "CS",
            packSize: 540,
            unitSize: 1,
            unitSizeUom: null,
            unitPrice: 19.75,
            extendedPrice: 19.75,
          },
        ],
      })
    )

    expect(result.lineItems[0]).toMatchObject({
      packSize: 1,
      unitSize: 540,
      unitSizeUom: "CT",
    })
  })
})
