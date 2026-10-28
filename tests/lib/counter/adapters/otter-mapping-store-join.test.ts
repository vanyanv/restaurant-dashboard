// Sold-volume joins through `OtterItemMapping` — one order line, one count.
//
// `OtterItemMapping` is unique on `(storeId, otterItemName)`: each store maps
// its own POS names. The recipes list, the recipe detail and the ingredient
// detail joined order lines to mappings on the NAME alone, so a line sold at
// Hollywood matched Hollywood's mapping AND Glendale's mapping of the same
// name — counted once per store that maps it. With two stores mapping "Double
// Slider", every Double Slider sold read twice in `sold` and `revenue`.
//
// The fix is `o."storeId" = m."storeId"` on the join. The ingredient test
// holds it by reading the SQL text the adapter sent.
//
// The recipes list and the recipe detail no longer join the order feed to
// mappings at all: their sold, collected and margin figures come from
// `item-economics.ts`, which reads `DailyCogsItem` — one row per store, day
// and POS name, already resolved to the recipe COGS booked it against — so
// there is no mapping fan-out to double a line through. Those two tests hold
// that instead: no mapping join, and two stores mapping the same name count
// each store's sales once.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    recipe: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    canonicalIngredient: { findFirst: vi.fn(), findMany: vi.fn() },
    ingredientSkuMatch: { findMany: vi.fn() },
    recipeIngredient: { findMany: vi.fn() },
    stockCountLine: { count: vi.fn() },
    dailyCogsItem: { groupBy: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))
vi.mock("@/lib/account-stores", () => ({ getScopedStores: vi.fn() }))
// The price move is `@/lib/counter/price-move`'s, tested on its own; this
// file is about other queries, so it reads no moves.
vi.mock("@/lib/counter/price-move", async (orig) => ({
  ...(await orig<typeof import("@/lib/counter/price-move")>()),
  loadPriceMoves: vi.fn(async () => ({ moves: new Map(), unpriceable: 0, totalCanonicals: 0 })),
}))
vi.mock("@/lib/recipe-cost", () => ({ batchRecipeCosts: vi.fn() }))

import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { batchRecipeCosts } from "@/lib/recipe-cost"
import { getRecipesSectionPromises } from "@/lib/counter/adapters/recipes"
import { getRecipeSectionPromises } from "@/lib/counter/adapters/recipe"
import { getIngredientSectionPromises } from "@/lib/counter/adapters/ingredient"
import { cogsGroupBy, cogsRow } from "../fixtures/item-economics"

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
  // Both stores map "Double Slider" to the recipe; each sold 10 at $8.
  asMock(prisma.dailyCogsItem.groupBy).mockImplementation(
    cogsGroupBy(
      ["store_a", "store_b"].map((storeId) =>
        cogsRow({
          storeId,
          itemName: "Double Slider",
          category: "Slider",
          recipeId: "r_slider",
          qtySold: 10,
          salesRevenue: 80,
          lineCost: 20,
        }),
      ),
    ),
  )
})

describe("OtterItemMapping joins match the order's own store", () => {
  it("recipes list", async () => {
    const sections = getRecipesSectionPromises({
      storeId: null,
      accountId: "acct_ours",
      range: RANGE,
      today: TODAY,
    })
    const components = await sections.catalogue
    expect(mappingJoins()).toHaveLength(0)
    if (components.status !== "ready") throw new Error(components.status)
    const row = components.data.rows.find((r) => r.key === "r_slider")!
    // $160 over 20 plates: each store's ten once, not twice.
    expect(row.cells.price).toBe("$8.00")
    expect(asMock(prisma.dailyCogsItem.groupBy).mock.calls[0][0].where).toMatchObject({
      store: { accountId: "acct_ours" },
    })
  })

  it("recipe detail", async () => {
    const sections = getRecipeSectionPromises({
      recipeId: "r_slider",
      storeId: null,
      accountId: "acct_ours",
      range: RANGE,
      today: TODAY,
    })
    const [head] = await Promise.all([sections.head, ...Object.values(sections)])
    expect(mappingJoins()).toHaveLength(0)
    if (head.status !== "ready") throw new Error(head.status)
    const sold = head.data.cells.find((c) => c.label === "Sold in range")!
    expect(sold.value).toBe("20")
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
