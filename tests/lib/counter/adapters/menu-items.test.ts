// Menu items + New menu item adapters, with Prisma mocked.
//
// What is pinned: a dish is a recipe (three POS names, one row); figures are
// the booked DailyCogsItem sums, not recomputed; an UNMAPPED name that has
// since been mapped stops showing as "not costed"; an old ingredient price
// lands in Needs you; every query is filtered by accountId.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    recipe: { findMany: vi.fn() },
    dailyCogsItem: { findMany: vi.fn() },
    otterItemMapping: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))
vi.mock("@/lib/account-stores", () => ({ getScopedStores: vi.fn() }))

import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { loadMenuItems } from "@/lib/counter/adapters/menu-items"
import { loadMenuItemStart } from "@/lib/counter/adapters/menu-item-start"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const NOW = new Date("2026-10-28T12:00:00Z")
const RANGE = { start: new Date("2026-09-28"), end: new Date("2026-10-27") }

const RECIPES = [
  {
    id: "r_double",
    itemName: "Double Slider",
    category: "Sliders",
    isSellable: true,
    foodCostOverride: null,
    ingredients: [
      { canonicalIngredientId: "ci_beef", componentRecipeId: null },
      { canonicalIngredientId: "ci_cheese", componentRecipeId: null },
    ],
    _count: { ingredients: 2 },
  },
  {
    id: "r_reverse",
    itemName: "The Reverse Bun",
    category: "Sliders",
    isSellable: true,
    foodCostOverride: null,
    ingredients: [],
    _count: { ingredients: 0 },
  },
  {
    id: "r_mod",
    itemName: "Chris's Way",
    category: "Modifier",
    isSellable: true,
    foodCostOverride: null,
    ingredients: [{ canonicalIngredientId: "ci_sauce", componentRecipeId: null }],
    _count: { ingredients: 1 },
  },
]

function cogs(itemName: string, recipeId: string | null, qty: number, rev: number, cost: number, extra = {}) {
  return {
    recipeId,
    itemName,
    category: recipeId ? "Sliders" : "Desserts",
    qtySold: qty,
    salesRevenue: rev,
    lineCost: cost,
    status: recipeId ? "COSTED" : "UNMAPPED",
    partialCost: false,
    costSource: "invoice",
    ...extra,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  asMock(getScopedStores).mockResolvedValue([{ id: "s_hw", name: "Hollywood" }])
  asMock(prisma.recipe.findMany).mockResolvedValue(RECIPES)
  asMock(prisma.dailyCogsItem.findMany).mockResolvedValue([
    cogs("Double Slider", "r_double", 100, 800, 150),
    cogs("Chris N Eddy's Slider", "r_double", 50, 400, 75),
    cogs("The Reverse Bun", "r_reverse", 10, 90, 0, { status: "MISSING_COST" }),
    cogs("CVT Ice Cream - Vanilla", null, 2, 10, 0),
    cogs("Shake Special", null, 4, 30, 0),
    cogs("Open item 4.99", null, 1, 5, 0),
  ])
  asMock(prisma.otterItemMapping.findMany).mockResolvedValue([
    { recipeId: "r_double", otterItemName: "Double Slider" },
    { recipeId: "r_double", otterItemName: "Chris N Eddy's Slider" },
    // Linked after the last COGS run: its rows still say UNMAPPED.
    { recipeId: "r_double", otterItemName: "Shake Special" },
  ])
  asMock(prisma.$queryRaw).mockResolvedValue([
    { id: "ci_cheese", name: "American Cheese", vendor: "Premier Deli", last: new Date("2026-04-08") },
    { id: "ci_beef", name: "Ground Beef", vendor: "Premier Meats", last: new Date("2026-10-20") },
  ])
})

describe("loadMenuItems", () => {
  it("groups POS names under their recipe and reads the booked figures", async () => {
    const d = await loadMenuItems({ range: RANGE, storeId: null, accountId: "acc_1", now: NOW })
    const double = d.items.find((i) => i.id === "r_double")!
    expect(double.sold).toBe(150)
    expect(double.posNames).toBe(3)
    expect(double.plateCost).toBe("$1.50") // (150 + 75) / 150, as booked
    expect(double.photo?.thumb).toContain("chris-n-eddy-s-slider-chris")
    // Modifiers are add-ons, not dishes on the menu.
    expect(d.items.map((i) => i.id)).not.toContain("r_mod")
  })

  it("lists what needs the owner and skips names linked since the last run", async () => {
    const d = await loadMenuItems({ range: RANGE, storeId: null, accountId: "acc_1", now: NOW })
    const keys = d.needs.map((n) => n.key)
    expect(keys).toContain("pos:CVT Ice Cream - Vanilla:Desserts")
    expect(keys).toContain("empty:r_reverse")
    expect(keys).toContain("stale:ci_cheese")
    expect(keys).not.toContain("stale:ci_beef")
    expect(keys.some((k) => k.includes("Shake Special"))).toBe(false)
    expect(keys.some((k) => k.toLowerCase().includes("open item"))).toBe(false)
    const pos = d.needs.find((n) => n.key.startsWith("pos:"))!
    expect(pos.act.href).toBe("/dashboard/menu/items/new?pos=CVT%20Ice%20Cream%20-%20Vanilla")
    expect(d.items.find((i) => i.id === "r_double")!.glyph).toBe("open")
    expect(d.items.find((i) => i.id === "r_reverse")!.glyph).toBe("miss")
  })

  it("filters every query by accountId", async () => {
    await loadMenuItems({ range: RANGE, storeId: null, accountId: "acc_1", now: NOW })
    expect(getScopedStores).toHaveBeenCalledWith("acc_1", null)
    expect(asMock(prisma.recipe.findMany).mock.calls[0][0].where).toMatchObject({ accountId: "acc_1" })
    expect(asMock(prisma.dailyCogsItem.findMany).mock.calls[0][0].where.storeId).toEqual({ in: ["s_hw"] })
    expect(asMock(prisma.otterItemMapping.findMany).mock.calls[0][0].where.recipe).toEqual({ accountId: "acc_1" })
    const sql = asMock(prisma.$queryRaw).mock.calls[0]
    expect(sql[0].join("?")).toContain('i."accountId" =')
    expect(sql.slice(1)).toContain("acc_1")
  })
})

describe("loadMenuItemStart", () => {
  it("offers what is selling with no recipe, empty recipes, and dishes to copy", async () => {
    const d = await loadMenuItemStart({ accountId: "acc_1", now: NOW })
    expect(d.selling.map((s) => s.name)).toEqual(["CVT Ice Cream - Vanilla"])
    expect(d.empty.map((r) => r.id)).toEqual(["r_reverse"])
    expect(d.copy.map((r) => r.id)).toEqual(["r_double"])
    expect(d.copy[0]).toMatchObject({ lines: 2, sold: 150 })
    expect(d.categories).toEqual(["Sliders"])
    expect(asMock(prisma.recipe.findMany).mock.calls[0][0].where).toMatchObject({ accountId: "acc_1" })
    expect(getScopedStores).toHaveBeenCalledWith("acc_1", null)
  })
})
