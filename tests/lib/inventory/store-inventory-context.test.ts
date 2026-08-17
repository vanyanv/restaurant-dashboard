// The inventory dashboard used to call computeRunningOnHand +
// computeDailyDepletionRate once per ingredient, ~10 queries each. The batched
// readers in store-inventory-context.ts run the same arithmetic against one
// store-wide prefetch. These tests pin the two properties that matter:
// walkRecipeForIngredientSync agrees with the async walk it replaces, and the
// batched readers reproduce the per-ingredient formulas exactly.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    recipe: { findUnique: vi.fn(), findMany: vi.fn() },
  },
}))

import { prisma } from "@/lib/prisma"
import {
  walkRecipeForIngredient,
  walkRecipeForIngredientSync,
  RecipeWalkCycleError,
  type RecipeGraph,
} from "@/lib/inventory/recipe-walk"
import {
  runningOnHandFromContext,
  dailyDepletionRateFromContext,
  type StoreInventoryContext,
} from "@/lib/inventory/store-inventory-context"
import { depletionWindow, sumDeliveries } from "@/lib/inventory/usage-math"

beforeEach(() => {
  vi.clearAllMocks()
})

const line = (
  quantity: number,
  unit: string,
  ids: { canonicalIngredientId?: string; componentRecipeId?: string } = {},
) => ({
  quantity,
  unit,
  canonicalIngredientId: ids.canonicalIngredientId ?? null,
  componentRecipeId: ids.componentRecipeId ?? null,
})

describe("walkRecipeForIngredientSync", () => {
  it("matches the async walk on a nested recipe tree", async () => {
    const graph: RecipeGraph = new Map([
      ["burger", [line(2, "oz", { canonicalIngredientId: "beef" }), line(3, "ea", { componentRecipeId: "sauce" })]],
      ["sauce", [line(0.5, "oz", { canonicalIngredientId: "beef" })]],
    ])
    // async path reads the same tree one node at a time
    vi.mocked(prisma.recipe.findUnique).mockImplementation((async (args: {
      where: { id: string }
    }) => {
      const lines = graph.get(args.where.id)
      return lines ? { ingredients: lines } : null
    }) as never)

    const asyncQty = await walkRecipeForIngredient("burger", "beef", "oz")
    const syncQty = walkRecipeForIngredientSync(graph, "burger", "beef", "oz")

    expect(syncQty).toBe(asyncQty)
    expect(syncQty).toBeCloseTo(2 + 0.5 * 3, 10)
  })

  it("returns 0 for a recipe missing from the graph, like a null findUnique", () => {
    expect(walkRecipeForIngredientSync(new Map(), "gone", "beef", "oz")).toBe(0)
  })

  it("throws on a cycle rather than recursing forever", () => {
    const graph: RecipeGraph = new Map([
      ["a", [line(1, "ea", { componentRecipeId: "b" })]],
      ["b", [line(1, "ea", { componentRecipeId: "a" })]],
    ])
    expect(() => walkRecipeForIngredientSync(graph, "a", "x", "oz")).toThrow(
      RecipeWalkCycleError,
    )
  })
})

const INGREDIENT = { id: "beef", name: "Ground beef", recipeUnit: "oz" }
const ASOF = new Date("2026-08-17T20:00:00.000Z")

function ctx(overrides: Partial<StoreInventoryContext> = {}): StoreInventoryContext {
  return {
    storeId: "store-1",
    asOf: ASOF,
    lookbackDays: 14,
    recipeGraph: new Map([
      ["burger", [line(2, "oz", { canonicalIngredientId: "beef" })]],
    ]),
    recipeByItemName: new Map([["Burger", "burger"]]),
    sales: [],
    lastCountByIngredient: new Map(),
    deliveriesByIngredient: new Map(),
    adjustmentsByIngredient: new Map(),
    ...overrides,
  }
}

describe("runningOnHandFromContext", () => {
  it("is base + deliveries − depletion − adjustments", () => {
    const countedAt = new Date("2026-08-10T00:00:00.000Z")
    const result = runningOnHandFromContext(
      ctx({
        lastCountByIngredient: new Map([["beef", { qtyInRecipeUnit: 100, countedAt }]]),
        deliveriesByIngredient: new Map([
          ["beef", [{ quantity: 40, unit: "oz", invoiceDate: new Date("2026-08-12T00:00:00.000Z") }]],
        ]),
        sales: [
          {
            date: new Date("2026-08-13T00:00:00.000Z"),
            itemName: "Burger",
            fpQuantitySold: 5,
            tpQuantitySold: 3,
          },
        ],
        adjustmentsByIngredient: new Map([
          ["beef", [{ qty: 6, occurredAt: new Date("2026-08-14T00:00:00.000Z") }]],
        ]),
      }),
      INGREDIENT,
    )

    // 100 + 40 − (8 sold × 2 oz) − 6
    expect(result.onHand).toBeCloseTo(118, 10)
    expect(result.baseAt).toEqual(countedAt)
    expect(result.partial).toBe(false)
  })

  it("ignores deliveries, sales and adjustments from before the anchoring count", () => {
    const countedAt = new Date("2026-08-10T00:00:00.000Z")
    const before = new Date("2026-08-01T00:00:00.000Z")
    const result = runningOnHandFromContext(
      ctx({
        lastCountByIngredient: new Map([["beef", { qtyInRecipeUnit: 50, countedAt }]]),
        deliveriesByIngredient: new Map([
          ["beef", [{ quantity: 999, unit: "oz", invoiceDate: before }]],
        ]),
        sales: [
          { date: before, itemName: "Burger", fpQuantitySold: 100, tpQuantitySold: 0 },
        ],
        adjustmentsByIngredient: new Map([["beef", [{ qty: 999, occurredAt: before }]]]),
      }),
      INGREDIENT,
    )
    expect(result.onHand).toBe(50)
  })

  it("counts everything all-time when the ingredient has never been counted", () => {
    const result = runningOnHandFromContext(
      ctx({
        deliveriesByIngredient: new Map([
          ["beef", [{ quantity: 25, unit: "oz", invoiceDate: new Date("2020-01-01T00:00:00.000Z") }]],
        ]),
      }),
      INGREDIENT,
    )
    expect(result.baseAt).toBeNull()
    expect(result.onHand).toBe(25)
  })

  it("flags partial when a delivery unit will not convert", () => {
    const result = runningOnHandFromContext(
      ctx({
        deliveriesByIngredient: new Map([
          ["beef", [{ quantity: 3, unit: "crate", invoiceDate: ASOF }]],
        ]),
      }),
      INGREDIENT,
    )
    expect(result.partial).toBe(true)
    expect(result.deliveriesQty).toBe(0)
  })

  it("returns an empty reading for an ingredient with no activity", () => {
    const result = runningOnHandFromContext(ctx(), INGREDIENT)
    expect(result.onHand).toBe(0)
    expect(result.deliveriesQty).toBe(0)
    expect(result.depletionQty).toBe(0)
  })
})

describe("dailyDepletionRateFromContext", () => {
  it("divides windowed depletion by the window length", () => {
    const result = dailyDepletionRateFromContext(
      ctx({
        sales: [
          {
            date: new Date("2026-08-16T00:00:00.000Z"),
            itemName: "Burger",
            fpQuantitySold: 7,
            tpQuantitySold: 0,
          },
        ],
      }),
      INGREDIENT,
    )
    expect(result.windowDays).toBe(14)
    expect(result.depletionQty).toBeCloseTo(14, 10)
    expect(result.ratePerDay).toBeCloseTo(1, 10)
  })

  it("anchors the window to a count inside the lookback", () => {
    const countedAt = new Date("2026-08-13T20:00:00.000Z")
    const result = dailyDepletionRateFromContext(
      ctx({
        lastCountByIngredient: new Map([["beef", { qtyInRecipeUnit: 0, countedAt }]]),
      }),
      INGREDIENT,
    )
    expect(result.windowStart).toEqual(countedAt)
    expect(result.windowDays).toBe(4)
  })

  it("ignores sales that predate the window", () => {
    const result = dailyDepletionRateFromContext(
      ctx({
        sales: [
          {
            date: new Date("2026-01-01T00:00:00.000Z"),
            itemName: "Burger",
            fpQuantitySold: 500,
            tpQuantitySold: 0,
          },
        ],
      }),
      INGREDIENT,
    )
    expect(result.depletionQty).toBe(0)
    expect(result.ratePerDay).toBe(0)
  })
})

describe("usage-math helpers", () => {
  it("clamps the depletion window to at least one day", () => {
    const { windowDays } = depletionWindow(ASOF, ASOF, 14)
    expect(windowDays).toBe(1)
  })

  it("sums convertible deliveries and reports unconvertible ones as partial", () => {
    const { deliveriesQty, partial } = sumDeliveries(
      [
        { quantity: 2, unit: "lb" },
        { quantity: 5, unit: "oz" },
        { quantity: 1, unit: "pallet" },
      ],
      "oz",
    )
    expect(deliveriesQty).toBeCloseTo(37, 6)
    expect(partial).toBe(true)
  })
})
