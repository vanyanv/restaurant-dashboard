import { describe, expect, it } from "vitest"
import type { InvoiceExtraction } from "@/types/invoice"
import {
  findPackShapeAnomalies,
  normalizeCatchWeightMeatLines,
  normalizeCountPackLines,
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

describe("normalizeCatchWeightMeatLines", () => {
  it("converts Premier/Crystal Bay carton-count meat mistakes to implied LB weight", () => {
    const result = normalizeCatchWeightMeatLines(extraction())
    const line = result.lineItems[0]

    expect(line.quantity).toBeCloseTo(426.5, 3)
    expect(line.unit).toBe("LB")
    expect(line.packSize).toBeNull()
    expect(line.unitSize).toBeNull()
    expect(line.unitSizeUom).toBeNull()
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

  it("preserves a negative implied LB quantity on return meat lines", () => {
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
