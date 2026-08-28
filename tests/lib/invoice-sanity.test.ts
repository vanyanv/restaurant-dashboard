import { describe, expect, it } from "vitest"
import type { InvoiceExtraction } from "@/types/invoice"
import {
  composeReviewReasons,
  findLineMathMismatches,
  findPackShapeAnomalies,
  findEmptyExtraction,
  findTotalReconciliationMismatch,
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

describe("findTotalReconciliationMismatch", () => {
  const li = (lineNumber: number, extendedPrice: number, productName?: string) => ({
    lineNumber,
    sku: null,
    productName: productName ?? `Line ${lineNumber}`,
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

  it("passes when lines sum to the subtotal (fee rows not extracted as lines)", () => {
    const result = findTotalReconciliationMismatch(
      extraction({
        lineItems: [li(1, 100), li(2, 52.8)],
        subtotal: 152.8,
        taxAmount: 12.2,
        totalAmount: 172.75, // subtotal + tax + $7.75 fuel charge in header only
      })
    )
    expect(result).toBeNull()
  })

  it("passes when a NAMED charge row is extracted as a line below the subtotal", () => {
    // The IFS shape. "Fuel Charge" is one of the four names in
    // @/lib/invoice-charges, so it comes off the goods side and the remaining
    // $152.80 ties to the printed subtotal exactly.
    const result = findTotalReconciliationMismatch(
      extraction({
        lineItems: [li(1, 100), li(2, 52.8), li(3, 7.75, "Fuel Charge")],
        subtotal: 152.8,
        taxAmount: 12.2,
        totalAmount: 172.75,
      })
    )
    expect(result).toBeNull()
  })

  it("flags an UNNAMED extra line of the same size, which the old rule let through", () => {
    // Identical arithmetic to the test above with one word changed. The old
    // rule passed a sum landing near any of {subtotal, total − tax, total},
    // so $160.55 found `total − tax` and escaped. On this account that
    // three-reference escape hatch let 223 of 226 invoices through and the
    // rule flagged neither of the two worth $4,166 between them.
    const result = findTotalReconciliationMismatch(
      extraction({
        lineItems: [li(1, 100), li(2, 52.8), li(3, 7.75)],
        subtotal: 152.8,
        taxAmount: 12.2,
        totalAmount: 172.75,
      })
    )
    expect(result).not.toBeNull()
    expect(result!.closestReference).toBeCloseTo(152.8, 2)
    expect(result!.gap).toBeCloseTo(7.75, 2)
  })

  it("flags the Premier Meats 2250793 shape: one credit line extracted twice", () => {
    // A $2,691.45 credit memo for 623 lb of Creekstone beef whose single
    // return line was stored twice. Anything reading lines rather than the
    // header sees 1,246 lb returned. It sat MATCHED with no reason attached.
    const result = findTotalReconciliationMismatch(
      extraction({
        lineItems: [li(1, -2691.45), li(2, -2691.45)],
        subtotal: -2691.45,
        taxAmount: null,
        totalAmount: -2691.45,
        isReturn: true,
      })
    )
    expect(result).not.toBeNull()
    expect(result!.lineSum).toBeCloseTo(-5382.9, 2)
    expect(result!.gap).toBeCloseTo(2691.45, 2)
  })

  it("falls back to total less tax only when the vendor prints no subtotal", () => {
    const result = findTotalReconciliationMismatch(
      extraction({
        lineItems: [li(1, 152.8)],
        subtotal: null,
        taxAmount: 12.2,
        totalAmount: 165,
      })
    )
    expect(result).toBeNull()
  })

  it("flags the IFS I28402-00 shape: correct header, ~$120 of lines dropped", () => {
    // Extraction dropped the Coke quantity ($94) and halved the ketchup line
    // ($26) while capturing the printed totals correctly.
    const result = findTotalReconciliationMismatch(
      extraction({
        lineItems: [li(1, 37.31), li(2, 43.01), li(3, 43.01), li(4, 917.23), li(5, 7.75)],
        subtotal: 1152.8,
        taxAmount: 32.2,
        totalAmount: 1192.75,
      })
    )
    expect(result).not.toBeNull()
    expect(result!.lineSum).toBeCloseTo(1048.31, 2)
    expect(result!.gap).toBeGreaterThan(100)
  })

  it("tolerates small rounding drift within 2% of the total", () => {
    const result = findTotalReconciliationMismatch(
      extraction({
        lineItems: [li(1, 99.5)],
        subtotal: 100,
        taxAmount: null,
        totalAmount: 100,
      })
    )
    expect(result).toBeNull()
  })

  it("uses the $1 floor for small invoices instead of a sub-dollar 2% band", () => {
    const result = findTotalReconciliationMismatch(
      extraction({
        lineItems: [li(1, 19.2)],
        subtotal: 20,
        taxAmount: null,
        totalAmount: 20,
      })
    )
    expect(result).toBeNull() // gap $0.80 ≤ $1 floor even though 2% would be $0.40
  })

  it("handles credit memos with negative totals", () => {
    const result = findTotalReconciliationMismatch(
      extraction({
        lineItems: [li(1, -43.01)],
        subtotal: -43.01,
        taxAmount: null,
        totalAmount: -43.01,
        isReturn: true,
      })
    )
    expect(result).toBeNull()
  })

  it("leaves the no-lines shape to findEmptyExtraction, which is a bigger defect", () => {
    expect(
      findTotalReconciliationMismatch(
        extraction({ lineItems: [], subtotal: null, taxAmount: null, totalAmount: 100 })
      )
    ).toBeNull()
    expect(
      findTotalReconciliationMismatch(
        extraction({ lineItems: [li(1, 50)], subtotal: null, taxAmount: null, totalAmount: 0 })
      )
    ).toBeNull()
  })
})

describe("findEmptyExtraction", () => {
  const li = (lineNumber: number, extendedPrice: number | null, productName = `Line ${lineNumber}`) => ({
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
    unitPrice: extendedPrice ?? 0,
    extendedPrice: extendedPrice as number,
  })

  it("flags the IFS G95788-00 shape: a header with no lines under it", () => {
    // $1,474.06 of goods, zero lines stored, status MATCHED, no rule with an
    // opinion — because the reconciliation check returned early on an empty
    // line list. Every ingredient and price on that delivery is absent while
    // the invoice total makes the books look complete.
    const result = findEmptyExtraction(extraction({ lineItems: [], totalAmount: 1543.56 }))
    expect(result).not.toBeNull()
    expect(result!.storedLines).toBe(0)
  })

  it("flags an invoice whose only stored lines carry no readable price", () => {
    const result = findEmptyExtraction(
      extraction({ lineItems: [li(1, null), li(2, null)], totalAmount: 400 })
    )
    expect(result).not.toBeNull()
    expect(result!.storedLines).toBe(2)
  })

  it("flags an invoice whose only stored lines are charge rows", () => {
    // Surcharges alone are not a delivery. Nothing here reaches the catalogue.
    const result = findEmptyExtraction(
      extraction({
        lineItems: [li(1, 7.75, "Fuel Charge"), li(2, 6.5, "Pallet Charge")],
        totalAmount: 900,
      })
    )
    expect(result).not.toBeNull()
  })

  it("passes an invoice with at least one priced goods line", () => {
    expect(
      findEmptyExtraction(extraction({ lineItems: [li(1, 50)], totalAmount: 50 }))
    ).toBeNull()
  })

  it("ignores zero-total rows, which carry no claim to be missing anything", () => {
    expect(findEmptyExtraction(extraction({ lineItems: [], totalAmount: 0 }))).toBeNull()
  })
})

describe("composeReviewReasons", () => {
  const base = {
    dateSuspect: false,
    mathMismatches: [] as ReturnType<typeof findLineMathMismatches>,
    packAnomalies: [] as ReturnType<typeof findPackShapeAnomalies>,
    totalMismatch: null,
    emptyExtraction: null,
    matchConfidence: 1,
    matched: true,
  }

  it("returns nothing for a clean, confidently matched invoice", () => {
    expect(composeReviewReasons(base)).toEqual([])
  })

  it("leads with no_lines, which subsumes every line-level reason under it", () => {
    const reasons = composeReviewReasons({
      ...base,
      emptyExtraction: { totalAmount: 1543.56, storedLines: 0 },
      matched: false,
      matchConfidence: null,
    })
    expect(reasons[0].kind).toBe("no_lines")
    expect(reasons[0].message).toContain("$1,543.56")
    // A store-match reason would be noise next to "none of it arrived".
    expect(reasons.map((r) => r.kind)).not.toContain("no_store_match")
  })

  it("carries line numbers on line-math reasons so rows can be flagged", () => {
    const mismatches = findLineMathMismatches([
      {
        lineNumber: 7,
        sku: null,
        productName: "GREENO CUP",
        description: null,
        category: null,
        quantity: 1,
        unit: "CS",
        packSize: null,
        unitSize: null,
        unitSizeUom: null,
        unitPrice: 96.55,
        extendedPrice: 66.55,
      },
    ])
    const reasons = composeReviewReasons({ ...base, mathMismatches: mismatches })
    expect(reasons).toHaveLength(1)
    expect(reasons[0].kind).toBe("line_math")
    expect(reasons[0].lineNumbers).toEqual([7])
    expect(reasons[0].message).toContain("Line 7")
    expect(reasons[0].message).toContain("$66.55")
  })

  it("explains a total-reconciliation gap in dollars", () => {
    const mismatch = findTotalReconciliationMismatch(
      extraction({
        lineItems: [
          { ...extraction().lineItems[0], extendedPrice: 1000, unitPrice: 1000, quantity: 1 },
        ],
        subtotal: 1851.01,
        totalAmount: 1851.01,
      })
    )
    expect(mismatch).not.toBeNull()
    const reasons = composeReviewReasons({ ...base, totalMismatch: mismatch })
    expect(reasons).toHaveLength(1)
    expect(reasons[0].kind).toBe("total_reconciliation")
    expect(reasons[0].message).toContain("$1,000.00")
    expect(reasons[0].message).toContain("$1,851.01")
  })

  it("falls back to match-quality reasons only when no sanity issue exists", () => {
    const unmatched = composeReviewReasons({ ...base, matched: false, matchConfidence: null })
    expect(unmatched.map((r) => r.kind)).toEqual(["no_store_match"])

    const lowConf = composeReviewReasons({ ...base, matchConfidence: 0.6 })
    expect(lowConf.map((r) => r.kind)).toEqual(["low_match_confidence"])
    expect(lowConf[0].message).toContain("60%")

    const withSanity = composeReviewReasons({
      ...base,
      dateSuspect: true,
      matchConfidence: 0.6,
    })
    expect(withSanity.map((r) => r.kind)).toEqual(["date_suspect"])
  })
})
