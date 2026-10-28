/*
 * One definition of per-item price, discount, plate cost and margin.
 *
 * The owner's ask: "everything unified through the whole dashboard instead of
 * being calculated in multiple different ways." Before `item-economics.ts`
 * three menu pages took the deals off and five did not, two costed a plate at
 * today's account-wide price while the rest read what COGS booked, and the
 * words "Blended margin" sat over three different numbers on three pages.
 *
 * The first block pins the rule itself. The second runs ONE fixture — a BOGO
 * slider, an ordinary side, an unmapped item and a box — through every screen
 * and chat tool that prints these figures and holds them to the same answer:
 * the slider's food cost is 22.98% of what it collected (never the 11.49% the
 * rung-up price implied), an uncosted item is never 0% or 100%, and the three
 * Blended margin cells are one number.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => ({ user: { id: "u1", accountId: "acct-A" } })),
}))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findMany: vi.fn() },
    dailyCogsItem: { groupBy: vi.fn(), findMany: vi.fn(), aggregate: vi.fn() },
    otterMenuItem: { findMany: vi.fn() },
    otterItemMapping: { findMany: vi.fn(), findFirst: vi.fn() },
    otterSubItemMapping: { findMany: vi.fn() },
    otterOrder: { count: vi.fn() },
    recipe: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
    canonicalIngredient: { findMany: vi.fn() },
    menuItemElasticity: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))
vi.mock("@/lib/counter/item-discounts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/counter/item-discounts")>()),
  getItemDiscounts: vi.fn(),
}))
vi.mock("@/lib/recipe-cost", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/recipe-cost")>()),
  batchRecipeCosts: vi.fn(),
  computeRecipeCost: vi.fn(),
}))
vi.mock("@/lib/recipe-cost-batch", () => ({ batchRecipeCosts: vi.fn() }))
vi.mock("@/app/actions/mapping-proposal-actions", () => ({ listMappingProposals: vi.fn(async () => []) }))
vi.mock("@/lib/cache/cached", () => ({
  cached: (_key: string, _ttl: number, _tags: string[], fn: () => unknown) => fn(),
  monthTags: () => [],
  stableKey: (o: unknown) => JSON.stringify(o),
}))
vi.mock("@/lib/counter/statement", () => ({
  loadStatement: vi.fn(async () => ({ rows: [], grossSales: 0 })),
  rowValues: vi.fn(() => []),
}))
vi.mock("@/lib/chat/owner-scope", () => ({ assertOwnerOwnsStores: vi.fn(async () => ["s1"]) }))

import { prisma } from "@/lib/prisma"
import { getItemDiscounts } from "@/lib/counter/item-discounts"
import { batchRecipeCosts, computeRecipeCost } from "@/lib/recipe-cost"
import { batchRecipeCosts as batchForChat } from "@/lib/recipe-cost-batch"
import {
  foldItemEconomics,
  menuMargin,
  rollUpByRecipe,
} from "@/lib/counter/item-economics"
import { pct } from "@/lib/counter/format"
import { hasData } from "@/lib/counter/section-data"
import { getMenuCatalogSectionPromises } from "@/lib/counter/adapters/menu-catalog"
import { getMenuItemSectionPromises } from "@/lib/counter/adapters/menu-item"
import { loadMenuItems } from "@/lib/counter/adapters/menu-items"
import { getMenuHubSectionPromises } from "@/lib/counter/adapters/menu-hub"
import { getProductMixSectionPromises } from "@/lib/counter/adapters/product-mix"
import { getMenuProfitSectionPromises } from "@/lib/counter/adapters/menu-profit"
import { getRecipesSectionPromises } from "@/lib/counter/adapters/recipes"
import { getRecipeSectionPromises } from "@/lib/counter/adapters/recipe"
import { getMenuEngineering } from "@/app/actions/forecasts/menu-engineering-actions"
import { loadCogs } from "@/lib/counter/cogs"
import { getCogsByItem } from "@/lib/chat/tools/cogs"
import { getMenuMargin, rankRecipes } from "@/lib/chat/tools/recipes"
import type { ChatToolContext } from "@/lib/chat/tools/types"
import {
  BOGO_ROWS,
  bogoDiscounts,
  cogsAggregate,
  cogsFindMany,
  cogsGroupBy,
  cogsRow,
  FIXTURE_MENU_MARGIN,
  FRIES,
  MYSTERY,
  SLIDER,
  SLIDER_FOOD_COST,
  SLIDER_FOOD_COST_PRE_DISCOUNT,
} from "./fixtures/item-economics"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

/* ── The rule ─────────────────────────────────────────────────────────── */

describe("item economics — the rule", () => {
  const { items, packagingCost } = foldItemEconomics(BOGO_ROWS, bogoDiscounts())

  it("puts a BOGO item's food cost over what it collected", () => {
    const s = items.get(SLIDER)!
    expect(s.units).toBe(100)
    expect(s.revenue).toBeCloseTo(1349)
    expect(s.collected).toBeCloseTo(674.5)
    expect(s.discount).toBeCloseTo(674.5)
    expect(s.dealRunning).toBe(true)
    expect(s.plateCost).toBeCloseTo(1.55)
    expect(s.foodCostPct).toBeCloseTo(SLIDER_FOOD_COST)
    expect(s.foodCostPct).not.toBeCloseTo(SLIDER_FOOD_COST_PRE_DISCOUNT)
    expect(s.marginDollars).toBeCloseTo(674.5 - 155)
    expect(s.collectedUnitPrice).toBeCloseTo(6.745)
    expect(s.unitPrice).toBeCloseTo(13.49)
  })

  it("never prints an uncosted item at $0, 0% or 100%", () => {
    const m = items.get(MYSTERY)!
    expect(m.costed).toBeNull()
    expect(m.plateCost).toBeNull()
    expect(m.foodCostPct).toBeNull()
    expect(m.marginPct).toBeNull()
    expect(m.marginDollars).toBeNull()
    expect(m.unmapped).toBe(true)
  })

  it("keeps packaging out of the items and reports its cost once", () => {
    expect([...items.keys()].some((n) => n.startsWith("Packaging"))).toBe(false)
    expect(packagingCost).toBe(30)
  })

  it("blends the menu over costed items, Packaging out, after discounts", () => {
    const m = menuMargin(items.values())
    expect(m.items).toBe(2)
    expect(m.cost).toBe(230)
    expect(m.collected).toBeCloseTo(924.5)
    expect(m.marginPct).toBeCloseTo(FIXTURE_MENU_MARGIN)
    expect(m.foodCostPct).toBeCloseTo(100 - FIXTURE_MENU_MARGIN)
    expect(menuMargin([]).marginPct).toBeNull()
  })

  it("prices a recipe on collected revenue over units — weighted, not a mean of line prices", () => {
    // One recipe, two POS names: 10 in-store at $5 and 1 on an app at $20.
    // AVG(price) over those lines is $12.50; what a plate actually brought in
    // is $70 / 11 = $6.36.
    const { items: two } = foldItemEconomics(
      [
        cogsRow({ itemName: "Double Slider", recipeId: "r_d", qtySold: 10, salesRevenue: 50, lineCost: 15 }),
        cogsRow({ itemName: "Signature Double", recipeId: "r_d", qtySold: 1, salesRevenue: 20, lineCost: 1.5 }),
      ],
      new Map(),
    )
    const r = rollUpByRecipe(two.values()).get("r_d")!
    expect(r.units).toBe(11)
    expect(r.collectedUnitPrice).toBeCloseTo(70 / 11)
    expect(r.plateCost).toBeCloseTo(16.5 / 11)
    expect(r.foodCostPct).toBeCloseTo((16.5 / 70) * 100)
    expect(r.itemNames.sort()).toEqual(["Double Slider", "Signature Double"])
  })

  it("plates a part-costed item over its costed units only", () => {
    const { items: part } = foldItemEconomics(
      [
        cogsRow({ itemName: "Burger", qtySold: 10, salesRevenue: 100, lineCost: 40 }),
        cogsRow({ itemName: "Burger", status: "UNMAPPED", recipeId: null, qtySold: 10, salesRevenue: 100 }),
      ],
      new Map(),
    )
    const b = part.get("Burger")!
    expect(b.units).toBe(20)
    expect(b.plateCost).toBe(4)
    expect(b.foodCostPct).toBe(40)
  })
})

/* ── Every screen, one fixture ────────────────────────────────────────── */

const RANGE = { start: new Date(2026, 9, 1), end: new Date(2026, 9, 2) }
const TODAY = new Date(2026, 9, 3)
const STORE = {
  id: "s1",
  name: "Hollywood",
  accountId: "acct-A",
  isActive: true,
  lifecycleStage: "open",
  uberCommissionRate: 0.21,
  doordashCommissionRate: 0.25,
}

const POS = [
  { itemName: SLIDER, category: "Sliders", qty: 100, sales: 1349 },
  { itemName: FRIES, category: "Sides", qty: 50, sales: 250 },
  { itemName: MYSTERY, category: "", qty: 10, sales: 100 },
]

const RECIPES = [
  { id: "r_slider", itemName: SLIDER, category: "Sliders" },
  { id: "r_fries", itemName: FRIES, category: "Sides" },
].map((r) => ({
  ...r,
  isSellable: true,
  isConfirmed: true,
  foodCostOverride: null,
  yieldUnit: null,
  servingSize: 1,
  notes: null,
  ingredients: [{ canonicalIngredientId: "ci_beef", componentRecipeId: null }],
  _count: { ingredients: 1 },
}))

/** The walk at TODAY's prices — deliberately not what COGS booked ($1.55). */
const WALK = new Map(
  RECIPES.map((r) => [
    r.id,
    {
      recipeId: r.id,
      itemName: r.itemName,
      totalCost: 1,
      batchCost: 1,
      computedCost: 1,
      partial: false,
      emptyWalk: false,
      hasLines: true,
      overrideApplied: false,
      lines: [],
    },
  ]),
)

const marginText = (foodCost: number) => pct(100 - foodCost, { scaled: true })

beforeEach(() => {
  vi.clearAllMocks()
  asMock(prisma.store.findMany).mockResolvedValue([STORE])
  asMock(prisma.dailyCogsItem.groupBy).mockImplementation(cogsGroupBy(BOGO_ROWS))
  asMock(prisma.dailyCogsItem.findMany).mockImplementation(cogsFindMany(BOGO_ROWS))
  asMock(prisma.dailyCogsItem.aggregate).mockImplementation(cogsAggregate(BOGO_ROWS))
  asMock(prisma.otterMenuItem.findMany).mockImplementation(async (args: { where: { isModifier?: boolean } }) =>
    args.where.isModifier
      ? []
      : POS.map((p) => ({
          itemName: p.itemName,
          category: p.category,
          date: new Date(Date.UTC(2026, 9, 1)),
          fpQuantitySold: p.qty,
          tpQuantitySold: 0,
          fpTotalSales: p.sales,
          tpTotalSales: 0,
        })),
  )
  asMock(prisma.otterItemMapping.findMany).mockResolvedValue([
    { otterItemName: SLIDER, recipeId: "r_slider", storeId: "s1" },
    { otterItemName: FRIES, recipeId: "r_fries", storeId: "s1" },
  ])
  asMock(prisma.otterItemMapping.findFirst).mockResolvedValue({ recipeId: "r_slider" })
  asMock(prisma.otterSubItemMapping.findMany).mockResolvedValue([])
  asMock(prisma.otterOrder.count).mockResolvedValue(0)
  asMock(prisma.recipe.findMany).mockResolvedValue(RECIPES)
  asMock(prisma.recipe.findFirst).mockImplementation(async (args: { where: { id: string } }) =>
    RECIPES.find((r) => r.id === args.where.id) ?? null,
  )
  asMock(prisma.recipe.count).mockResolvedValue(0)
  asMock(prisma.canonicalIngredient.findMany).mockResolvedValue([])
  asMock(prisma.menuItemElasticity.findMany).mockResolvedValue([])
  asMock(prisma.$queryRaw).mockResolvedValue([])
  asMock(getItemDiscounts).mockImplementation(async () => bogoDiscounts())
  asMock(batchRecipeCosts).mockResolvedValue(WALK)
  asMock(batchForChat).mockResolvedValue(WALK)
  asMock(computeRecipeCost).mockResolvedValue(WALK.get("r_slider"))
})

const input = { range: RANGE, storeId: null, accountId: "acct-A" }
const ctx: ChatToolContext = {
  ownerId: "u1",
  accountId: "acct-A",
  prisma: prisma as unknown as ChatToolContext["prisma"],
}
const chatRange = { from: "2026-10-01", to: "2026-10-02" }

describe("a BOGO item reads the same food cost on every screen", () => {
  it("Catalog: margin after discounts, and a Paid price on the same basis", async () => {
    const list = await getMenuCatalogSectionPromises(input).list
    if (!hasData(list)) throw new Error("list")
    const row = list.data.rows.find((r) => r.item === SLIDER)!
    expect(row.margin).toBe(`${marginText(SLIDER_FOOD_COST)} · deal`)
    expect(row.plateCost).toBe("$1.55")
    // Paid − Plate cost is the margin's own dollars: $6.75 − $1.55 over $6.75.
    expect(row.price).toBe("$6.75 of $13.49")
    expect(list.data.rows.find((r) => r.item === MYSTERY)!.margin).toBe("—")
    expect(list.data.rows.find((r) => r.item === MYSTERY)!.plateCost).toBe("—")
  })

  it("Menu item page", async () => {
    const head = await getMenuItemSectionPromises({ ...input, slug: "signature-slider" }).headline
    if (!hasData(head)) throw new Error("headline")
    expect(head.data.cells.find((c) => c.label === "Counter margin")!.value).toBe(
      marginText(SLIDER_FOOD_COST),
    )
    expect(head.data.cells.find((c) => c.label === "Plate cost")!.value).toBe("$1.55")
  })

  it("Menu items", async () => {
    const d = await loadMenuItems({ ...input, now: TODAY })
    const slider = d.items.find((i) => i.id === "r_slider")!
    expect((slider.foodCostPct as number) * 100).toBeCloseTo(SLIDER_FOOD_COST)
    expect(slider.avgPrice).toBe("$6.75")
    expect(slider.plateCost).toBe("$1.55")
    expect(slider.keep).toBe("$5.20")
    expect(d.counts.cost / d.counts.revenue).toBeCloseTo((100 - FIXTURE_MENU_MARGIN) / 100)
  })

  it("Product mix", async () => {
    const table = await getProductMixSectionPromises(input).table
    if (!hasData(table)) throw new Error("table")
    const row = table.data.rows.find((r) => r.key === SLIDER)!
    expect(row.cells.margin).toBe(marginText(SLIDER_FOOD_COST))
    // Share of UNITS still counts the uncosted item; it just has no margin.
    expect(table.data.rows.find((r) => r.key === MYSTERY)!.cells.margin).toBe("—")
  })

  it("Recipes list: weighted collected price and margin on the booked plate", async () => {
    const cat = await getRecipesSectionPromises({ ...input, today: TODAY }).catalogue
    if (!hasData(cat)) throw new Error("catalogue")
    const row = cat.data.rows.find((r) => r.key === "r_slider")!
    expect(row.cells.margin).toBe(marginText(SLIDER_FOOD_COST))
    expect(row.cells.price).toBe("$6.75")
    // The booked plate, not the $1.00 walk at today's prices.
    expect(row.cells.cost).toBe("$1.55")
  })

  it("Recipe page", async () => {
    const head = await getRecipeSectionPromises({ ...input, recipeId: "r_slider", today: TODAY }).head
    if (!hasData(head)) throw new Error("head")
    expect(head.data.cells.find((c) => c.label === "Margin")!.value).toBe(marginText(SLIDER_FOOD_COST))
    expect(head.data.cells.find((c) => c.label === "Sells at")!.value).toBe("$6.75")
  })

  it("Menu engineering quadrants", async () => {
    const me = await getMenuEngineering({ lookbackDays: 1, asOf: new Date("2026-10-02T00:00:00Z"), minSoldQty: 0 })
    if (!me || !me.ok) throw new Error("menu engineering")
    const slider = me.data.rows.find((r) => r.itemName === SLIDER)!
    expect(100 - (slider.marginPct as number)).toBeCloseTo(SLIDER_FOOD_COST)
    expect(me.data.rows.map((r) => r.itemName)).not.toContain(MYSTERY)
  })

  it("COGS: the hurting-food-cost ranking sees the BOGO's real food cost", async () => {
    const { items } = await loadCogs({ ...input, sales: 2000 })
    const slider = items.find((i) => i.itemName === SLIDER)!
    expect(slider.foodPct).toBeCloseTo(SLIDER_FOOD_COST)
    expect(slider.revenue).toBeCloseTo(674.5)
    expect(items.find((i) => i.itemName === MYSTERY)!.foodPct).toBeNull()
  })

  it("Chat: getCogsByItem, getMenuMargin and rankRecipes", async () => {
    const byItem = await getCogsByItem.execute({ dateRange: chatRange, topN: 10 }, ctx)
    expect(100 - (byItem.find((r) => r.menuItem === SLIDER)!.marginPct as number)).toBeCloseTo(SLIDER_FOOD_COST)
    expect(byItem.map((r) => r.menuItem)).not.toContain(MYSTERY)

    const margin = await getMenuMargin.execute({ recipeId: "r_slider", dateRange: chatRange }, ctx)
    expect(100 - (margin.marginPct as number)).toBeCloseTo(SLIDER_FOOD_COST)
    expect(margin.avgSellingPrice).toBeCloseTo(6.745)
    expect(margin.recipeCost).toBeCloseTo(1.55)

    const ranked = await rankRecipes.execute(
      { by: "margin", direction: "desc", limit: 10, dateRange: chatRange },
      ctx,
    )
    const r = ranked.find((x) => x.recipeId === "r_slider")!
    expect(100 - (r.marginPct as number)).toBeCloseTo(SLIDER_FOOD_COST)
    expect(r.avgSellingPrice).toBeCloseTo(6.745)
  })
})

describe("the three Blended margin cells are one number", () => {
  it("Menu hub, Product mix and Menu profit print the same figure", async () => {
    const hub = await getMenuHubSectionPromises(input, "Oct 1 – Oct 2").headline
    const mix = await getProductMixSectionPromises(input).headline
    const profit = await getMenuProfitSectionPromises(input).headline
    if (!hasData(hub) || !hasData(mix) || !hasData(profit)) throw new Error("headline")
    const cell = (cells: { label: string; value: string }[]) =>
      cells.find((c) => c.label === "Blended margin")!.value
    const expected = pct(FIXTURE_MENU_MARGIN, { scaled: true })
    expect(cell(hub.data.cells)).toBe(expected)
    expect(cell(mix.data.cells)).toBe(expected)
    expect(cell(profit.data.cells)).toBe(expected)
  })
})

/* ── Review fixes: recipe slices, per-store deals, the $0 rule, scoping ── */

describe("a POS name booked against two recipes credits each with its own rows", () => {
  // Hollywood maps "Slider" to r_a; Glendale maps the same name to r_b.
  const SPLIT = [
    cogsRow({ storeId: "s1", itemName: "Slider", recipeId: "r_a", qtySold: 10, salesRevenue: 100, lineCost: 30 }),
    cogsRow({ storeId: "s2", itemName: "Slider", recipeId: "r_b", qtySold: 5, salesRevenue: 50, lineCost: 25 }),
  ]

  it("rolls up per (item, recipe) slice, not to the item's top recipe", () => {
    const { items } = foldItemEconomics(SPLIT, new Map())
    const byRecipe = rollUpByRecipe(items.values())
    expect(byRecipe.get("r_a")).toMatchObject({ units: 10, plateCost: 3 })
    expect(byRecipe.get("r_b")).toMatchObject({ units: 5, plateCost: 5 })
    expect(byRecipe.get("r_b")!.foodCostPct).toBeCloseTo(50)
  })

  it("Menu items shows each recipe's own sold, plate and keep", async () => {
    asMock(prisma.store.findMany).mockResolvedValue([STORE, { ...STORE, id: "s2", name: "Glendale" }])
    asMock(prisma.dailyCogsItem.groupBy).mockImplementation(cogsGroupBy(SPLIT))
    asMock(prisma.dailyCogsItem.findMany).mockImplementation(cogsFindMany(SPLIT))
    asMock(prisma.recipe.findMany).mockResolvedValue(
      ["r_a", "r_b"].map((id) => ({ ...RECIPES[0], id, itemName: `Recipe ${id}` })),
    )
    asMock(getItemDiscounts).mockResolvedValue(new Map())
    const d = await loadMenuItems({ ...input, now: TODAY })
    const a = d.items.find((i) => i.id === "r_a")!
    const b = d.items.find((i) => i.id === "r_b")!
    expect([a.sold, a.plateCost, a.keep]).toEqual([10, "$3.00", "$7.00"])
    expect([b.sold, b.plateCost, b.keep]).toEqual([5, "$5.00", "$5.00"])
  })
})

describe("a deal is the store's that ran it", () => {
  it("never discounts a store's costed sales by another store's deal", () => {
    const rows = [
      cogsRow({ storeId: "s1", itemName: "Slider", qtySold: 10, salesRevenue: 100, lineCost: 30 }),
      cogsRow({ storeId: "s2", itemName: "Slider", recipeId: null, status: "UNMAPPED", qtySold: 10, salesRevenue: 100 }),
    ]
    const deal = new Map([
      [
        "Slider",
        {
          gross: 200,
          discount: 50,
          byPlatform: new Map(),
          // The BOGO ran at s2 only, where nothing costed the item.
          byStore: new Map([
            ["s1", { gross: 100, discount: 0 }],
            ["s2", { gross: 100, discount: 50 }],
          ]),
        },
      ],
    ])
    const s = foldItemEconomics(rows, deal).items.get("Slider")!
    expect(s.costed!.collected).toBe(100)
    expect(s.foodCostPct).toBeCloseTo(30)
    // The item still reports what it collected overall.
    expect(s.collected).toBe(150)
    expect(s.discountShare).toBeCloseTo(0.25)
  })
})

describe("menuMargin uses the per-item rule", () => {
  it("leaves out a COSTED item whose booked cost is $0, as its own cell does", () => {
    const { items } = foldItemEconomics(
      [
        cogsRow({ itemName: "Burger", qtySold: 10, salesRevenue: 100, lineCost: 40 }),
        cogsRow({ itemName: "Water", qtySold: 10, salesRevenue: 100, lineCost: 0 }),
      ],
      new Map(),
    )
    expect(items.get("Water")!.marginPct).toBeNull()
    const m = menuMargin(items.values())
    expect(m.items).toBe(1)
    expect(m.marginPct).toBeCloseTo(60)
  })
})

describe("the three Blended margin cells agree for any selection", () => {
  it("an inactive store reads empty on the hub, mix and profit alike", async () => {
    asMock(prisma.store.findMany).mockResolvedValue([{ ...STORE, isActive: false }])
    const scoped = { ...input, storeId: "s1" }
    const hub = await getMenuHubSectionPromises(scoped, "Oct 1 – Oct 2").headline
    const mix = await getProductMixSectionPromises(scoped).headline
    const profit = await getMenuProfitSectionPromises(scoped).headline
    expect([hasData(hub), hasData(mix), hasData(profit)]).toEqual([false, false, false])
  })

  it("Product mix's bridge ends on the Blended margin cell, zero-unit costed items included", async () => {
    const rows = [
      ...BOGO_ROWS,
      // Booked cost and collected revenue with no units — a correction row.
      cogsRow({ itemName: "Adjustment", qtySold: 0, salesRevenue: 10, lineCost: 4 }),
    ]
    asMock(prisma.dailyCogsItem.groupBy).mockImplementation(cogsGroupBy(rows))
    const s = getProductMixSectionPromises(input)
    const [head, bridge] = await Promise.all([s.headline, s.bridge])
    if (!hasData(head) || !hasData(bridge)) throw new Error("mix")
    const cell = head.data.cells.find((c) => c.label === "Blended margin")!.value
    const expected = pct(100 - ((230 + 4) / (924.5 + 10)) * 100, { scaled: true })
    expect(cell).toBe(expected)
    expect(bridge.data.rows.find((r) => r.key === "now")!.value).toBe(expected)
  })
})
