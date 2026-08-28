// computeFoodCogsRows — the per-day COGS materialization core. Pins the
// three-status decision (COSTED / UNMAPPED / MISSING_COST), the mapping
// precedence (explicit OtterItemMapping beats case-insensitive recipe-name
// fallback), the qty-share modifier allocation across same-item category
// rows, and the costSource provenance summary.

import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import {
  buildModifierUsage,
  computeFoodCogsRows,
  type ModifierUsage,
} from "@/lib/cogs-materializer"
import type { RecipeCostResult, RecipeCostLine } from "@/lib/recipe-cost"

const DATE = new Date("2026-07-20T00:00:00Z")
const STORE = "store-1"

type MenuRow = {
  itemName: string
  category: string
  fpQuantitySold: number | null
  tpQuantitySold: number | null
  fpTotalSales: number | null
  tpTotalSales: number | null
}

function menuRow(overrides: Partial<MenuRow> & { itemName: string }): MenuRow {
  return {
    category: "Sliders",
    fpQuantitySold: 0,
    tpQuantitySold: 0,
    fpTotalSales: 0,
    tpTotalSales: 0,
    ...overrides,
  }
}

function costLine(overrides: Partial<RecipeCostLine> = {}): RecipeCostLine {
  return {
    kind: "ingredient",
    refId: "ing-1",
    name: "Beef",
    quantity: 1,
    unit: "oz",
    unitCost: 1,
    lineCost: 1,
    missingCost: false,
    costSource: "invoice",
    ...overrides,
  }
}

function costResult(overrides: Partial<RecipeCostResult> = {}): RecipeCostResult {
  return {
    recipeId: "r-1",
    itemName: "Recipe 1",
    totalCost: 2.5,
    lines: [costLine()],
    partial: false,
    emptyWalk: false,
    ...overrides,
  }
}

function compute(input: {
  menuRows: MenuRow[]
  mappingByName?: Map<string, string>
  recipeByName?: Map<string, string>
  modifierUsageByItem?: Map<string, ModifierUsage>
  costFor?: (recipeId: string) => Promise<RecipeCostResult | null>
}) {
  return computeFoodCogsRows({
    storeId: STORE,
    date: DATE,
    menuRows: input.menuRows,
    mappingByName: input.mappingByName ?? new Map(),
    recipeByName: input.recipeByName ?? new Map(),
    modifierUsageByItem: input.modifierUsageByItem ?? new Map(),
    costFor: input.costFor ?? (async () => costResult()),
  })
}

describe("computeFoodCogsRows — status decision", () => {
  it("emits an UNMAPPED diagnostic row with sales preserved when no mapping or recipe-name match exists", async () => {
    const rows = await compute({
      menuRows: [
        menuRow({
          itemName: "3 Slider Combo",
          fpQuantitySold: 4,
          tpQuantitySold: 6,
          fpTotalSales: 40,
          tpTotalSales: 66,
        }),
      ],
      costFor: async () => {
        throw new Error("costFor must not be called for unmapped items")
      },
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      storeId: STORE,
      date: DATE,
      itemName: "3 Slider Combo",
      recipeId: null,
      qtySold: 10, // fp + tp
      salesRevenue: 106, // fp + tp
      unitCost: null,
      lineCost: 0,
      status: "UNMAPPED",
      partialCost: false,
      costSource: null,
    })
  })

  it("prefers the explicit OtterItemMapping over the case-insensitive recipe-name fallback", async () => {
    const seen: string[] = []
    const rows = await compute({
      menuRows: [menuRow({ itemName: "Double Slider", fpQuantitySold: 1 })],
      mappingByName: new Map([["Double Slider", "r-mapped"]]),
      recipeByName: new Map([["double slider", "r-by-name"]]),
      costFor: async (recipeId) => {
        seen.push(recipeId)
        return costResult({ recipeId })
      },
    })

    expect(seen).toEqual(["r-mapped"])
    expect(rows[0].recipeId).toBe("r-mapped")
  })

  it("falls back to a case-insensitive recipe-name match when there is no explicit mapping", async () => {
    const rows = await compute({
      menuRows: [menuRow({ itemName: "DOUBLE Slider", fpQuantitySold: 1 })],
      recipeByName: new Map([["double slider", "r-by-name"]]),
    })

    expect(rows[0].recipeId).toBe("r-by-name")
    expect(rows[0].status).toBe("COSTED")
  })

  it("marks a mapped item COSTED with lineCost = unit cost × qty", async () => {
    const rows = await compute({
      menuRows: [
        menuRow({ itemName: "Fries", fpQuantitySold: 8, tpQuantitySold: 2, fpTotalSales: 32, tpTotalSales: 10 }),
      ],
      mappingByName: new Map([["Fries", "r-fries"]]),
      costFor: async () => costResult({ totalCost: 1.5 }),
    })

    expect(rows[0]).toMatchObject({
      status: "COSTED",
      recipeId: "r-fries",
      unitCost: 1.5,
      lineCost: 15, // 1.5 × 10
      partialCost: false,
      costSource: "invoice",
    })
  })

  it("marks a mapped item MISSING_COST (partial, lineCost from modifiers only) when the recipe walks to $0", async () => {
    const rows = await compute({
      menuRows: [menuRow({ itemName: "Shake", fpQuantitySold: 5, fpTotalSales: 30 })],
      mappingByName: new Map([["Shake", "r-shake"]]),
      costFor: async () => costResult({ totalCost: 0, lines: [] }),
    })

    expect(rows[0]).toMatchObject({
      status: "MISSING_COST",
      recipeId: "r-shake",
      // With qty > 0 the blended division still runs: 0 lineCost / qty = 0.
      unitCost: 0,
      lineCost: 0,
      partialCost: true,
      costSource: null,
    })
  })

  it("marks MISSING_COST when costFor resolves null (recipe walk failed)", async () => {
    const rows = await compute({
      menuRows: [menuRow({ itemName: "Shake", fpQuantitySold: 5 })],
      mappingByName: new Map([["Shake", "r-shake"]]),
      costFor: async () => null,
    })

    expect(rows[0].status).toBe("MISSING_COST")
    expect(rows[0].partialCost).toBe(true)
  })

  it("keeps COSTED but flags partialCost when the recipe result is partial", async () => {
    const rows = await compute({
      menuRows: [menuRow({ itemName: "Burger", fpQuantitySold: 2 })],
      mappingByName: new Map([["Burger", "r-burger"]]),
      costFor: async () => costResult({ totalCost: 3, partial: true }),
    })

    expect(rows[0].status).toBe("COSTED")
    expect(rows[0].partialCost).toBe(true)
  })

  it("flags partialCost when a modifier bucket has missing mappings, even if fully costed", async () => {
    const rows = await compute({
      menuRows: [menuRow({ itemName: "Burger", fpQuantitySold: 2 })],
      mappingByName: new Map([["Burger", "r-burger"]]),
      modifierUsageByItem: new Map([
        ["Burger", { extraLineCost: 0, missingMappings: true, breakdown: [] }],
      ]),
    })

    expect(rows[0].status).toBe("COSTED")
    expect(rows[0].partialCost).toBe(true)
  })
})

describe("computeFoodCogsRows — modifier allocation", () => {
  it("allocates modifier dollars across same-item category rows by qty share, applied exactly once", async () => {
    const rows = await compute({
      menuRows: [
        menuRow({ itemName: "Burger", category: "Sliders", fpQuantitySold: 30, fpTotalSales: 300 }),
        menuRow({ itemName: "Burger", category: "Specials", fpQuantitySold: 10, fpTotalSales: 100 }),
      ],
      mappingByName: new Map([["Burger", "r-burger"]]),
      modifierUsageByItem: new Map([
        ["Burger", { extraLineCost: 4, missingMappings: false, breakdown: [] }],
      ]),
      costFor: async () => costResult({ totalCost: 2 }),
    })

    const sliders = rows.find((r) => r.category === "Sliders")!
    const specials = rows.find((r) => r.category === "Specials")!
    // base 2×30 + 4×(30/40) = 63 ; base 2×10 + 4×(10/40) = 21
    expect(sliders.lineCost).toBeCloseTo(63)
    expect(specials.lineCost).toBeCloseTo(21)
    expect(sliders.lineCost + specials.lineCost).toBeCloseTo(2 * 40 + 4)
    expect(sliders.unitCost).toBeCloseTo(63 / 30)
    expect(specials.unitCost).toBeCloseTo(21 / 10)
  })

  it("splits modifier cost evenly by row count when all rows have zero qty, and unitCost falls back to base", async () => {
    const rows = await compute({
      menuRows: [
        menuRow({ itemName: "Burger", category: "A", fpQuantitySold: 0 }),
        menuRow({ itemName: "Burger", category: "B", fpQuantitySold: 0 }),
      ],
      mappingByName: new Map([["Burger", "r-burger"]]),
      modifierUsageByItem: new Map([
        ["Burger", { extraLineCost: 4, missingMappings: false, breakdown: [] }],
      ]),
      costFor: async () => costResult({ totalCost: 2 }),
    })

    for (const row of rows) {
      expect(row.lineCost).toBeCloseTo(2) // 0 base + 4 × (1/2)
      expect(row.unitCost).toBe(2) // qty 0 → falls back to base unit cost
      expect(row.status).toBe("COSTED")
    }
  })
})

describe("computeFoodCogsRows — costSource summary", () => {
  const cases: Array<{
    name: string
    lines: RecipeCostLine[]
    expected: string
  }> = [
    {
      name: "all-invoice lines → invoice",
      lines: [costLine(), costLine({ refId: "ing-2" })],
      expected: "invoice",
    },
    {
      name: "invoice + manual lines → mixed",
      lines: [costLine(), costLine({ refId: "ing-2", costSource: "manual" })],
      expected: "mixed",
    },
    {
      name: "manual-only lines → manual",
      lines: [costLine({ costSource: "manual" })],
      expected: "manual",
    },
    {
      name: "positive total with no per-line costs → override (foodCostOverride)",
      lines: [],
      expected: "override",
    },
  ]

  for (const { name, lines, expected } of cases) {
    it(name, async () => {
      const rows = await compute({
        menuRows: [menuRow({ itemName: "Burger", fpQuantitySold: 1 })],
        mappingByName: new Map([["Burger", "r-burger"]]),
        costFor: async () => costResult({ totalCost: 2, lines }),
      })
      expect(rows[0].costSource).toBe(expected)
    })
  }
})

describe("buildModifierUsage — order sub-item bucketing", () => {
  const sub = (over: {
    skuId?: string | null
    name?: string
    quantity?: number | null
    parentName?: string | null
    parentQty?: number | null
  }) => ({
    skuId: over.skuId === undefined ? "sku-1" : over.skuId,
    name: over.name ?? "Add Cheese",
    quantity: over.quantity === undefined ? 1 : over.quantity,
    orderItem: {
      name: over.parentName === undefined ? "Burger" : over.parentName,
      quantity: over.parentQty === undefined ? 1 : over.parentQty,
    },
  })

  it("multiplies sub quantity by parent quantity and prices by the mapped recipe", async () => {
    const usage = await buildModifierUsage({
      subItems: [sub({ quantity: 1, parentQty: 2 })], // 2 burgers, +cheese each
      subRecipeBySku: new Map([["sku-1", "r-cheese"]]),
      costFor: async () => costResult({ totalCost: 0.5 }),
    })

    const bucket = usage.get("Burger")!
    expect(bucket.extraLineCost).toBeCloseTo(1) // 0.5 × (1×2)
    expect(bucket.missingMappings).toBe(false)
    expect(bucket.breakdown[0]).toMatchObject({ uses: 2, unitCost: 0.5 })
  })

  it("treats an intentionally-empty $0 modifier recipe as costed, not missing", async () => {
    // "Mod: Remove Cheese" — zero ingredients, no override: legitimate $0.
    const usage = await buildModifierUsage({
      subItems: [sub({ name: "Remove Cheese" })],
      subRecipeBySku: new Map([["sku-1", "r-remove-cheese"]]),
      costFor: async () => costResult({ totalCost: 0, lines: [], partial: false }),
    })

    const bucket = usage.get("Burger")!
    expect(bucket.missingMappings).toBe(false)
    expect(bucket.extraLineCost).toBe(0)
    expect(bucket.breakdown[0]).toMatchObject({ unitCost: 0 })
  })

  it("flags partial recipe walks and unmapped/costless SKUs as missing", async () => {
    const usage = await buildModifierUsage({
      subItems: [
        sub({ skuId: "sku-partial", name: "Loaded" }),
        sub({ skuId: "sku-unknown", name: "Mystery Mod" }),
        sub({ skuId: null, name: "No Sku Mod" }),
        sub({ skuId: "sku-dead", name: "Dead Recipe" }),
      ],
      subRecipeBySku: new Map([
        ["sku-partial", "r-partial"],
        ["sku-dead", "r-dead"],
      ]),
      costFor: async (id) =>
        id === "r-partial" ? costResult({ totalCost: 1, partial: true }) : null,
    })

    const bucket = usage.get("Burger")!
    expect(bucket.missingMappings).toBe(true)
    // The partial recipe's dollars still count; unmapped ones contribute 0.
    expect(bucket.extraLineCost).toBeCloseTo(1)
    const unmapped = bucket.breakdown.filter((b) => b.unitCost == null)
    expect(unmapped).toHaveLength(3)
  })

  it("skips sub-items with no parent name or non-positive uses", async () => {
    const usage = await buildModifierUsage({
      subItems: [
        sub({ parentName: null }),
        sub({ quantity: 0 }),
        sub({ quantity: null, parentQty: null }), // null×null → 1×1 = 1 use
      ],
      subRecipeBySku: new Map([["sku-1", "r-cheese"]]),
      costFor: async () => costResult({ totalCost: 0.5 }),
    })

    const bucket = usage.get("Burger")!
    expect(bucket.breakdown).toHaveLength(1)
    expect(bucket.extraLineCost).toBeCloseTo(0.5)
  })
})
