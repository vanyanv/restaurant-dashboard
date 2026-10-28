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
  removalCreditPerUse,
  removalMatchFor,
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
    batchCost: 2.5,
    servingSize: 1,
    yieldUnit: null,
    lines: [costLine()],
    partial: false,
    emptyWalk: false,
    hasLines: true,
    overrideApplied: false,
    computedCost: 2.5,
    ...overrides,
  }
}

function compute(input: {
  menuRows: MenuRow[]
  mappingByName?: Map<string, string>
  recipeByNameAndCategory?: Map<string, string>
  recipeByName?: Map<string, string | null>
  modifierUsageByItem?: Map<string, ModifierUsage>
  costFor?: (recipeId: string) => Promise<RecipeCostResult | null>
}) {
  return computeFoodCogsRows({
    storeId: STORE,
    date: DATE,
    menuRows: input.menuRows,
    mappingByName: input.mappingByName ?? new Map(),
    recipeByNameAndCategory: input.recipeByNameAndCategory,
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

  it("resolves a name shared by two recipes using the POS row's own category, instead of refusing", async () => {
    // "Fries" the side and "Fries" the modifier collide on name alone
    // (recipeByName is null for "fries"), but each POS row carries its own
    // category, which is the exact tuple Recipe is unique on.
    const rows = await compute({
      menuRows: [
        menuRow({ itemName: "Fries", category: "Sides", fpQuantitySold: 5 }),
        menuRow({ itemName: "Fries", category: "Modifiers", fpQuantitySold: 2 }),
      ],
      recipeByNameAndCategory: new Map([
        ["fries:::sides", "r-fries-side"],
        ["fries:::modifiers", "r-fries-modifier"],
      ]),
      recipeByName: new Map([["fries", null]]),
    })

    const bySides = rows.find((r) => r.category === "Sides")!
    const byModifiers = rows.find((r) => r.category === "Modifiers")!
    expect(bySides.recipeId).toBe("r-fries-side")
    expect(byModifiers.recipeId).toBe("r-fries-modifier")
    expect(bySides.status).toBe("COSTED")
    expect(byModifiers.status).toBe("COSTED")
  })

  it("still refuses to guess when the name is ambiguous even after trying the POS row's category", async () => {
    // No recipe shares this POS row's exact (name, category) pair, and the
    // name alone is ambiguous — neither map has an answer, so it's UNMAPPED
    // rather than an arbitrary pick.
    const rows = await compute({
      menuRows: [menuRow({ itemName: "Fries", category: "Combos", fpQuantitySold: 1 })],
      recipeByNameAndCategory: new Map([
        ["fries:::sides", "r-fries-side"],
        ["fries:::modifiers", "r-fries-modifier"],
      ]),
      recipeByName: new Map([["fries", null]]),
      costFor: async () => {
        throw new Error("costFor must not be called for an unresolved item")
      },
    })

    expect(rows[0].recipeId).toBeNull()
    expect(rows[0].status).toBe("UNMAPPED")
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

describe("removal modifiers — Remove Cheese takes the parent's cheese off", () => {
  const cheese = (lineCost: number) =>
    costLine({ refId: "ing-cheese", name: "american cheese yellow 160", lineCost, unitCost: 0.12 })
  const beef = costLine({ refId: "ing-beef", name: "ground beef 73/27", lineCost: 0.69 })
  const doubleSlider = costResult({
    recipeId: "r-double",
    itemName: "Double Slider",
    totalCost: 0.93,
    lines: [beef, cheese(0.24)],
  })
  const removeCheese = costResult({
    recipeId: "r-remove-cheese",
    itemName: "Mod: Remove Cheese",
    totalCost: 0,
    lines: [],
    emptyWalk: true,
    hasLines: false,
  })
  const combo = costResult({
    recipeId: "r-combo",
    itemName: "2 Slider Combo",
    totalCost: 2.76,
    lines: [
      costLine({ kind: "component", refId: "r-double", name: "Double Slider", quantity: 2, lineCost: 1.86 }),
      costLine({ refId: "ing-fries", name: "potato fry", lineCost: 0.9 }),
    ],
  })
  const recipes: Record<string, RecipeCostResult> = {
    "r-double": doubleSlider,
    "r-remove-cheese": removeCheese,
    "r-combo": combo,
  }
  const costFor = async (id: string) => recipes[id] ?? null

  it("recognises Remove/No names and derives the word to match", () => {
    expect(removalMatchFor(removeCheese)).toEqual({ ingredientIds: [], token: "cheese" })
    expect(removalMatchFor(costResult({ itemName: "Mod: No Pickles", lines: [] }))).toEqual({
      ingredientIds: [],
      token: "pickles",
    })
    expect(removalMatchFor(costResult({ itemName: "Mod: Add Cheese" }))).toBeNull()
    // Explicit lines win over the name.
    expect(
      removalMatchFor(costResult({ itemName: "Mod: Remove Cheese", lines: [cheese(0.12)] })),
    ).toEqual({ ingredientIds: ["ing-cheese"], token: null })
  })

  it("credits the parent's own cheese, or one sub-recipe's worth on a combo", async () => {
    const match = removalMatchFor(removeCheese)!
    expect(await removalCreditPerUse(doubleSlider, match, costFor)).toBeCloseTo(0.24)
    // One use on a two-slider combo is ONE slider's cheese.
    expect(await removalCreditPerUse(combo, match, costFor)).toBeCloseTo(0.24)
    const noMatch = { ingredientIds: [], token: "tomato" }
    expect(await removalCreditPerUse(doubleSlider, noMatch, costFor)).toBe(0)
  })

  it("matches whole words, singular or plural — never a substring", async () => {
    const plate = (name: string) =>
      costResult({ itemName: "Plate", lines: [costLine({ refId: "x", name, lineCost: 1 })] })
    const credit = (token: string, name: string) =>
      removalCreditPerUse(plate(name), { ingredientIds: [], token }, costFor)
    expect(await credit("pickles", "pickle chips sandwich cut")).toBe(1)
    expect(await credit("fries", "straight cut fries")).toBe(1)
    expect(await credit("bread", "martins bread potato roll")).toBe(1)
    expect(await credit("ice", "rice pilaf")).toBe(0)
    expect(await credit("ham", "hamburger patty")).toBe(0)
  })

  it("books the credit against the item's line cost, never below zero", async () => {
    const usage = await buildModifierUsage({
      subItems: [
        {
          skuId: "sku-rc",
          name: "Remove Cheese",
          quantity: 1,
          orderItem: { name: "Signature Slider", quantity: 2 },
        },
      ],
      subRecipeBySku: new Map([["sku-rc", "r-remove-cheese"]]),
      costFor,
    })
    const bucket = usage.get("Signature Slider")!
    expect(bucket.extraLineCost).toBe(0)
    expect(bucket.removals).toHaveLength(1)
    expect(bucket.missingMappings).toBe(false)

    const [row] = await compute({
      menuRows: [menuRow({ itemName: "Signature Slider", tpQuantitySold: 10, tpTotalSales: 134.9 })],
      mappingByName: new Map([["Signature Slider", "r-double"]]),
      modifierUsageByItem: usage,
      costFor,
    })
    // 10 × $0.93, less two sliders' cheese (2 × $0.24).
    expect(row.lineCost).toBeCloseTo(9.3 - 0.48)
    expect(row.partialCost).toBe(false)
  })

  it("keeps a negative modifier fallback as a credit", async () => {
    const usage = await buildModifierUsage({
      subItems: [
        { skuId: "sku-lp", name: "Loaded Plain", quantity: 1, orderItem: { name: "Fries", quantity: 1 } },
      ],
      subRecipeBySku: new Map([["sku-lp", "r-lp"]]),
      costFor: async () => costResult({ itemName: "Mod: Loaded Plain", totalCost: -0.07, lines: [] }),
    })
    expect(usage.get("Fries")!.extraLineCost).toBeCloseTo(-0.07)
  })
})
