// Sold-volume joins through `OtterItemMapping` — one order line, one count.
//
// `OtterItemMapping` is unique on `(storeId, otterItemName)`: each store maps
// its own POS names. The recipes list, the recipe detail and the ingredient
// detail joined order lines to mappings on the NAME alone, so a line sold at
// Hollywood matched Hollywood's mapping AND Glendale's mapping of the same
// name — counted once per store that maps it. With two stores mapping "Double
// Slider", every Double Slider sold read twice in `sold` and `revenue`.
//
// The fix is `o."storeId" = m."storeId"` on the join. These tests hold it on
// all three queries by reading the SQL text each adapter sent.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    recipe: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    canonicalIngredient: { findFirst: vi.fn(), findMany: vi.fn() },
    ingredientSkuMatch: { findMany: vi.fn() },
    recipeIngredient: { findMany: vi.fn() },
    stockCountLine: { count: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))
vi.mock("@/lib/account-stores", () => ({ getScopedStores: vi.fn() }))
vi.mock("@/lib/recipe-cost", () => ({ batchRecipeCosts: vi.fn() }))

import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { batchRecipeCosts } from "@/lib/recipe-cost"
import { getRecipesSectionPromises } from "@/lib/counter/adapters/recipes"
import { getRecipeSectionPromises } from "@/lib/counter/adapters/recipe"
import { getIngredientSectionPromises } from "@/lib/counter/adapters/ingredient"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const RANGE = { start: new Date("2026-08-01"), end: new Date("2026-08-26") }
const TODAY = new Date("2026-08-26")

/** The SQL text of every raw query that joins order lines to a mapping. */
function mappingJoins(): string[] {
  return asMock(prisma.$queryRaw)
    .mock.calls.map((c) => (c[0] as TemplateStringsArray).join("?"))
    .filter((t) => t.includes('"OtterItemMapping" m') && t.includes('"OtterOrderItem" oi'))
}

beforeEach(() => {
  vi.clearAllMocks()
  asMock(getScopedStores).mockResolvedValue([{ id: "store_a" }, { id: "store_b" }])
  asMock(batchRecipeCosts).mockResolvedValue(new Map())
  asMock(prisma.$queryRaw).mockResolvedValue([])
  asMock(prisma.recipe.findMany).mockResolvedValue([
    {
      id: "r_slider",
      itemName: "Double Slider",
      category: "Slider",
      isSellable: true,
      isConfirmed: true,
      _count: { ingredients: 3 },
    },
  ])
  asMock(prisma.recipe.count).mockResolvedValue(0)
  asMock(prisma.recipe.findFirst).mockResolvedValue({
    id: "r_slider",
    itemName: "Double Slider",
    category: "Slider",
    isSellable: true,
    isConfirmed: true,
    servingSize: 1,
    foodCostOverride: null,
    notes: null,
    ingredients: [],
  })
  asMock(prisma.canonicalIngredient.findMany).mockResolvedValue([])
  asMock(prisma.canonicalIngredient.findFirst).mockResolvedValue({
    id: "ci_beef",
    name: "ground beef",
    recipeUnit: "lb",
    category: "Meat",
    costPerRecipeUnit: 4.39,
    costSource: "invoice",
    costLocked: false,
    caseUnit: "CS",
    recipeUnitsPerCase: 40,
    innerPackUnit: null,
    innerPacksPerCase: null,
  })
  asMock(prisma.ingredientSkuMatch.findMany).mockResolvedValue([])
  asMock(prisma.recipeIngredient.findMany).mockResolvedValue([
    {
      quantity: 4,
      unit: "oz",
      recipe: { id: "r_slider", itemName: "Double Slider", category: "Slider", isSellable: true },
    },
  ])
  asMock(prisma.stockCountLine.count).mockResolvedValue(0)
})

describe("OtterItemMapping joins match the order's own store", () => {
  it("recipes list", async () => {
    await getRecipesSectionPromises({
      storeId: null,
      accountId: "acct_ours",
      range: RANGE,
      today: TODAY,
    }).headline
    const joins = mappingJoins()
    expect(joins).toHaveLength(1)
    expect(joins[0]).toContain('o."storeId" = m."storeId"')
  })

  it("recipe detail", async () => {
    const sections = getRecipeSectionPromises({
      recipeId: "r_slider",
      storeId: null,
      accountId: "acct_ours",
      range: RANGE,
      today: TODAY,
    })
    await Promise.all(Object.values(sections))
    const joins = mappingJoins()
    expect(joins).toHaveLength(1)
    expect(joins[0]).toContain('o."storeId" = m."storeId"')
  })

  it("ingredient detail", async () => {
    const sections = getIngredientSectionPromises({
      ingredientId: "ci_beef",
      storeId: null,
      accountId: "acct_ours",
      range: RANGE,
      today: TODAY,
    })
    await Promise.all(Object.values(sections))
    const joins = mappingJoins()
    expect(joins).toHaveLength(1)
    expect(joins[0]).toContain('o."storeId" = m."storeId"')
  })
})
