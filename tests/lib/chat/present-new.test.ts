/*
 * The eleven builders added 2026-09-19. Each one turns rows a tool already
 * returned into the picture the answer shows, so the thing worth asserting is
 * that a figure cannot be RETYPED on the way: a percent that arrives as a
 * fraction and a percent that arrives already multiplied must not both be
 * multiplied again.
 */
import { describe, it, expect } from "vitest"
import { presentFor, SHOWABLE_TOOLS } from "@/lib/chat/present"

describe("presentFor — the 2026-09-19 builders", () => {
  it("getRatings draws the DISTRIBUTION, not the mean", () => {
    const p = presentFor("getRatings", {}, {
      view: "summary",
      summary: { distribution: [3, 1, 0, 8, 40], count: 52, average: 4.6 },
    })
    expect(p?.kind).toBe("chart")
    if (p?.kind !== "chart") return
    expect(p.spec.type).toBe("bars")
    expect(p.spec.labels).toEqual(["1★", "2★", "3★", "4★", "5★"])
    expect(p.spec.series[0].data).toEqual([3, 1, 0, 8, 40])
    expect(p.fmt).toBe("count")
  })

  it("getRatings refuses a distribution that is not five buckets", () => {
    expect(
      presentFor("getRatings", {}, { view: "summary", summary: { distribution: [1, 2] } }),
    ).toBeNull()
  })

  it("getRatings review rows say so when a rating carries no words", () => {
    const p = presentFor("getRatings", {}, {
      view: "reviews",
      reviews: [
        { reviewedAt: "2026-09-10", rating: 1, platform: "DoorDash", reviewText: null },
        { reviewedAt: "2026-09-11", rating: 2, platform: "UberEats", reviewText: "cold" },
      ],
    })
    expect(p?.kind).toBe("table")
    if (p?.kind !== "table") return
    expect(p.rows[0].cells.review).toBe("(no text)")
    expect(p.rows[1].cells.review).toBe("cold")
  })

  it("getRatings truncates a long review rather than letting it set the row height", () => {
    const long = "x".repeat(400)
    const p = presentFor("getRatings", {}, {
      view: "reviews",
      reviews: [
        { reviewedAt: "2026-09-10", rating: 1, platform: "DoorDash", reviewText: long },
        { reviewedAt: "2026-09-11", rating: 1, platform: "DoorDash", reviewText: "ok" },
      ],
    })
    if (p?.kind !== "table") throw new Error("expected a table")
    expect(p.rows[0].cells.review.length).toBeLessThanOrEqual(140)
    expect(p.rows[0].cells.review.endsWith("…")).toBe(true)
  })

  it("getChannelMix treats netRatePct as the FRACTION it is", () => {
    const p = presentFor("getChannelMix", {}, {
      rows: [
        { platform: "doordash", netRatePct: 0.72 },
        { platform: "ubereats", netRatePct: 0.7 },
      ],
    })
    if (p?.kind !== "chart") throw new Error("expected a chart")
    expect(p.fmt).toBe("pct")
    // 0.72, not 72 — `pct()` multiplies, and a pre-scaled value here would
    // render as 7200%.
    expect(p.spec.series[0].data).toEqual([0.72, 0.7])
  })

  it("rankRecipes treats marginPct as the ALREADY-MULTIPLIED percent it is", () => {
    const p = presentFor("rankRecipes", {}, [
      { itemName: "Double Slider", recipeCost: 1.4, avgSellingPrice: 7, marginPct: 80 },
      { itemName: "Fries", recipeCost: 0.5, avgSellingPrice: 3, marginPct: 83.3 },
    ])
    if (p?.kind !== "table") throw new Error("expected a table")
    expect(p.rows[0].cells.margin).toBe("80.0%")
  })

  it("rankRecipes prints an unknown cost as a dash, never as zero dollars", () => {
    const p = presentFor("rankRecipes", {}, [
      { itemName: "A", recipeCost: null, avgSellingPrice: null, marginPct: null },
      { itemName: "B", recipeCost: 1, avgSellingPrice: 3, marginPct: 66.7 },
    ])
    if (p?.kind !== "table") throw new Error("expected a table")
    expect(p.rows[0].cells.cost).toBe("—")
    expect(p.rows[0].cells.price).toBe("—")
  })

  it("getForecastQuality always prints the baseline beside the score", () => {
    const p = presentFor("getForecastQuality", {}, {
      evaluations: [
        { storeName: "Hollywood", target: "REVENUE", wape: 0.12, baselineWape: 0.2, sampleSize: 14 },
        { storeName: "Glendale", target: "REVENUE", wape: 0.25, baselineWape: 0.2, sampleSize: 14 },
      ],
    })
    if (p?.kind !== "table") throw new Error("expected a table")
    expect(p.columns.map((c) => c.key)).toContain("baseline")
    expect(p.rows[0].cells.wape).toBe("12.0%")
    expect(p.rows[0].cells.baseline).toBe("20.0%")
  })

  it("getInventoryStatus prints an unknown days-of-cover as a dash, not as zero days left", () => {
    const p = presentFor("getInventoryStatus", {}, {
      rows: [
        { ingredientName: "beef", recipeUnit: "lb", onHand: 12, daysOfCover: null, status: "unknown" },
        { ingredientName: "cheese", recipeUnit: "lb", onHand: 4, daysOfCover: 2.5, status: "reorder_now" },
      ],
    })
    if (p?.kind !== "table") throw new Error("expected a table")
    expect(p.rows[0].cells.cover).toBe("—")
    expect(p.rows[1].cells.cover).toBe("2.5")
  })

  it("getWasteRootCauses prints the pattern label verbatim", () => {
    // The label is a pattern, never an accusation, and the prose and the
    // table must not diverge on the word.
    const p = presentFor("getWasteRootCauses", {}, [
      { ingredientName: "beef", label: "theft_or_unrecorded", annualizedDollarExposure: 4200 },
      { ingredientName: "lettuce", label: "expiry_driven", annualizedDollarExposure: 900 },
    ])
    if (p?.kind !== "table") throw new Error("expected a table")
    expect(p.rows[0].cells.label).toBe("theft_or_unrecorded")
    // Biggest exposure first.
    expect(p.rows[0].cells.ingredient).toBe("beef")
  })

  it("getLostSales ranks by dollars lost, not by date", () => {
    const p = presentFor("getLostSales", {}, {
      events: [
        { itemName: "small", gapStart: "2026-09-01", gapEnd: "2026-09-03", gapDays: 3, estimatedLostRevenue: 100 },
        { itemName: "big", gapStart: "2026-09-10", gapEnd: "2026-09-14", gapDays: 5, estimatedLostRevenue: 900 },
      ],
    })
    if (p?.kind !== "table") throw new Error("expected a table")
    expect(p.rows[0].cells.item).toBe("big")
  })

  it("getMenuEngineering ranks by contribution and keeps the quadrant", () => {
    const p = presentFor("getMenuEngineering", {}, {
      rows: [
        { itemName: "Puzzle", quadrant: "PUZZLE", soldQty: 10, totalContribution: 50 },
        { itemName: "Star", quadrant: "STAR", soldQty: 400, totalContribution: 2000 },
      ],
    })
    if (p?.kind !== "table") throw new Error("expected a table")
    expect(p.rows[0].cells.item).toBe("Star")
    expect(p.rows[0].cells.quadrant).toBe("STAR")
  })

  it("getMenuItemElasticity puts the most price-sensitive item first", () => {
    const p = presentFor("getMenuItemElasticity", {}, [
      { itemSkuId: "mild", elasticity: -0.4, confidence: "high", sampleSize: 90 },
      { itemSkuId: "sharp", elasticity: -2.1, confidence: "medium", sampleSize: 60 },
    ])
    if (p?.kind !== "table") throw new Error("expected a table")
    expect(p.rows[0].cells.item).toBe("sharp")
    expect(p.rows[0].cells.elasticity).toBe("-2.10")
  })

  it("getIngredientPriceHistory draws the series in the order the tool returned it", () => {
    const p = presentFor("getIngredientPriceHistory", {}, {
      name: "ground beef",
      rows: [
        { invoiceDate: "2026-09-01", unitPrice: 3.1 },
        { invoiceDate: "2026-09-08", unitPrice: 3.4 },
        { invoiceDate: "2026-09-15", unitPrice: 3.9 },
      ],
    })
    if (p?.kind !== "chart") throw new Error("expected a chart")
    expect(p.spec.series[0].data).toEqual([3.1, 3.4, 3.9])
    expect(p.title).toContain("ground beef")
  })

  it("getAlerts leads with severity", () => {
    const p = presentFor("getAlerts", {}, {
      alerts: [
        { severity: "CRITICAL", title: "Revenue down", storeName: "Hollywood", occurredOn: "2026-09-18" },
        { severity: "WATCH", title: "Beef price up", storeName: "Glendale", occurredOn: "2026-09-17" },
      ],
    })
    if (p?.kind !== "table") throw new Error("expected a table")
    expect(p.columns[0].key).toBe("severity")
    expect(p.rows[0].cells.severity).toBe("CRITICAL")
  })

  it("never throws on a shape it did not expect", () => {
    for (const tool of SHOWABLE_TOOLS) {
      expect(() => presentFor(tool, {}, null)).not.toThrow()
      expect(() => presentFor(tool, {}, {})).not.toThrow()
      expect(() => presentFor(tool, {}, [])).not.toThrow()
      expect(() => presentFor(tool, {}, "nonsense")).not.toThrow()
      expect(() => presentFor(tool, {}, [{ nothing: "useful" }])).not.toThrow()
    }
  })

  it("returns null for a tool with no picture", () => {
    expect(presentFor("listStores", {}, [{ id: "s1", name: "Hollywood" }])).toBeNull()
  })

  it("a one-row table is not a table", () => {
    // One row is a sentence, and the verdict already carries it.
    expect(
      presentFor("getAlerts", {}, {
        alerts: [{ severity: "CRITICAL", title: "x", storeName: "y", occurredOn: "2026-09-18" }],
      }),
    ).toBeNull()
  })
})
