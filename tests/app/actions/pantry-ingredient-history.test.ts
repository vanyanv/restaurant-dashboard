// getPantryIngredientHistory — the data behind an expanded ledger row.
//
// The load-bearing behaviour is SKU grouping. One canonical ingredient can
// span several products: `lamb potato fry ss 1/4 stealth` carries four SKUs
// across three brands, and its deliveries must show the RAW invoice product
// name so an owner can see that "IMPLOT POTATO FRY" and "LAMB POTATO FRY
// STEALTH" are not the same thing.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth-scope", () => ({ getAuthScope: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/app/actions/canonical-ingredient-actions", () => ({
  listCanonicalIngredients: vi.fn(),
}))
vi.mock("@/lib/canonical-spend-batch", () => ({ batchCanonicalSpend: vi.fn() }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    canonicalIngredient: { findFirst: vi.fn() },
    invoiceLineItem: { findMany: vi.fn() },
    recipeIngredient: { findMany: vi.fn() },
  },
}))

import { getAuthScope } from "@/lib/auth-scope"
import { prisma } from "@/lib/prisma"
import { getPantryIngredientHistory } from "@/app/actions/pantry-ledger-actions"

const line = (over: Record<string, unknown> = {}) => ({
  unitPrice: 38,
  unit: "CS",
  quantity: 14,
  extendedPrice: 532,
  sku: "2141760",
  productName: "LAMB POTATO FRY SS 1/4 STEALTH",
  invoiceId: "inv-1",
  invoice: {
    vendorName: "Sysco",
    invoiceDate: new Date("2026-03-01"),
    invoiceNumber: "1001",
  },
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthScope).mockResolvedValue({ ownerId: "u1", accountId: "acct-1" })
  vi.mocked(prisma.canonicalIngredient.findFirst).mockResolvedValue({
    id: "c1",
    recipeUnit: "lb",
    costPerRecipeUnit: 1.73,
  } as never)
  vi.mocked(prisma.recipeIngredient.findMany).mockResolvedValue([] as never)
})

describe("getPantryIngredientHistory", () => {
  it("returns empty history without a session and never queries", async () => {
    vi.mocked(getAuthScope).mockResolvedValue(null)
    const h = await getPantryIngredientHistory("c1")
    expect(h).toEqual({ series: [], deliveries: [], products: [], recipes: [] })
    expect(prisma.invoiceLineItem.findMany).not.toHaveBeenCalled()
  })

  it("returns empty history when the ingredient is not in the caller's account", async () => {
    vi.mocked(prisma.canonicalIngredient.findFirst).mockResolvedValue(null as never)
    const h = await getPantryIngredientHistory("someone-elses")
    expect(h.series).toEqual([])
    expect(prisma.invoiceLineItem.findMany).not.toHaveBeenCalled()
  })

  it("orders the price series oldest first", async () => {
    vi.mocked(prisma.invoiceLineItem.findMany).mockResolvedValue([
      line({ invoice: { vendorName: "Sysco", invoiceDate: new Date("2026-08-01"), invoiceNumber: "3" } }),
      line({ invoice: { vendorName: "Sysco", invoiceDate: new Date("2026-03-01"), invoiceNumber: "1" } }),
      line({ invoice: { vendorName: "Sysco", invoiceDate: new Date("2026-06-01"), invoiceNumber: "2" } }),
    ] as never)

    const h = await getPantryIngredientHistory("c1")
    expect(h.series.map((p) => p.date)).toEqual(["2026-03-01", "2026-06-01", "2026-08-01"])
  })

  it("caps the series at the 60 most recent points", async () => {
    const many = Array.from({ length: 90 }, (_, n) =>
      line({
        invoice: {
          vendorName: "Sysco",
          invoiceDate: new Date(2026, 0, n + 1),
          invoiceNumber: String(n),
        },
      })
    )
    vi.mocked(prisma.invoiceLineItem.findMany).mockResolvedValue(many as never)

    const h = await getPantryIngredientHistory("c1")
    expect(h.series).toHaveLength(60)
    // Kept the tail, not the head.
    expect(h.series[h.series.length - 1].date).toBe("2026-03-31")
  })

  it("returns the 8 most recent deliveries, newest first, with the raw product name", async () => {
    const many = Array.from({ length: 12 }, (_, n) =>
      line({
        productName: `PRODUCT ${n}`,
        invoice: {
          vendorName: "Sysco",
          invoiceDate: new Date(2026, 0, n + 1),
          invoiceNumber: String(n),
        },
      })
    )
    vi.mocked(prisma.invoiceLineItem.findMany).mockResolvedValue(many as never)

    const h = await getPantryIngredientHistory("c1")
    expect(h.deliveries).toHaveLength(8)
    expect(h.deliveries[0].productName).toBe("PRODUCT 11")
    expect(h.deliveries[0].invoiceId).toBe("inv-1")
    expect(h.deliveries[0].invoiceNumber).toBe("11")
  })

  it("groups products by SKU with the newest price in each group", async () => {
    vi.mocked(prisma.invoiceLineItem.findMany).mockResolvedValue([
      line({
        sku: "OLD",
        productName: "LAMB POTATO FRY",
        unitPrice: 38,
        extendedPrice: 380,
        invoice: { vendorName: "Sysco", invoiceDate: new Date("2026-03-01"), invoiceNumber: "1" },
      }),
      line({
        sku: "NEW",
        productName: "IMPLOT POTATO FRY",
        unitPrice: 28,
        extendedPrice: 280,
        invoice: { vendorName: "Sysco", invoiceDate: new Date("2026-06-19"), invoiceNumber: "2" },
      }),
      line({
        sku: "NEW",
        productName: "SIMPLOT POTATO FRY",
        unitPrice: 46.75,
        extendedPrice: 467.5,
        invoice: { vendorName: "Sysco", invoiceDate: new Date("2026-08-15"), invoiceNumber: "3" },
      }),
    ] as never)

    const h = await getPantryIngredientHistory("c1")
    expect(h.products).toHaveLength(2)
    const bySku = Object.fromEntries(h.products.map((p) => [p.sku, p]))
    expect(bySku.NEW).toMatchObject({
      productName: "SIMPLOT POTATO FRY",
      firstAt: "2026-06-19",
      lastAt: "2026-08-15",
      lastUnitPrice: 46.75,
      spend: 747.5,
    })
    expect(bySku.OLD).toMatchObject({ lastUnitPrice: 38, spend: 380 })
    // Ranked by spend so the product carrying the money leads.
    expect(h.products[0].sku).toBe("NEW")
  })

  it("costs each recipe per serving and reports null when units cannot reconcile", async () => {
    vi.mocked(prisma.invoiceLineItem.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.recipeIngredient.findMany).mockResolvedValue([
      { quantity: 8, unit: "oz", recipe: { itemName: "Straight Cut Fries", servingSize: 1 } },
      { quantity: 2, unit: "sheet", recipe: { itemName: "Nonsense", servingSize: 1 } },
      { quantity: 32, unit: "oz", recipe: { itemName: "Family Fries", servingSize: 4 } },
    ] as never)

    const h = await getPantryIngredientHistory("c1")
    const byName = Object.fromEntries(h.recipes.map((r) => [r.recipeName, r]))
    // 8 oz = 0.5 lb at $1.73/lb
    expect(byName["Straight Cut Fries"].costPerServing).toBeCloseTo(0.865, 3)
    // 32 oz = 2 lb at $1.73/lb, divided across 4 servings
    expect(byName["Family Fries"].costPerServing).toBeCloseTo(0.865, 3)
    expect(byName["Nonsense"].costPerServing).toBeNull()
  })

  it("reports no per-serving cost when the ingredient itself has no price", async () => {
    vi.mocked(prisma.canonicalIngredient.findFirst).mockResolvedValue({
      id: "c1",
      recipeUnit: null,
      costPerRecipeUnit: null,
    } as never)
    vi.mocked(prisma.invoiceLineItem.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.recipeIngredient.findMany).mockResolvedValue([
      { quantity: 8, unit: "oz", recipe: { itemName: "Straight Cut Fries", servingSize: 1 } },
    ] as never)

    const h = await getPantryIngredientHistory("c1")
    expect(h.recipes[0].costPerServing).toBeNull()
  })
})
