import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { count, money } from "@/lib/counter/format"
import { classify, guardSection, type StreamedSections } from "@/lib/counter/adapters/types"
import { photoFrame, type PhotoFrame } from "@/lib/counter/menu-photos"
import type { SectionData } from "@/lib/counter/section-data"

/**
 * The three ways into a new menu item, each listed from the owner's data:
 *
 * - **Already selling** — POS names that sold in the last 30 days with no
 *   recipe (UNMAPPED `DailyCogsItem` rows), biggest seller first. Starting
 *   from one names the recipe after it and maps the name for every store, so
 *   the next COGS run costs it.
 * - **Waiting for lines** — recipes that exist but have nothing in them and
 *   no typed-in cost, so every sale of them counts $0 of food.
 * - **Copy a dish** — every dish with lines, with its photo, so a new slider
 *   starts from the Double Slider's patty, cheese and bun rather than empty.
 *
 * Menu items are the same at every store: recipes belong to the account and
 * the unmapped names are summed across all of the account's stores, never
 * one location's view.
 *
 * Tenancy: stores from `getScopedStores(accountId)`, recipes and mappings
 * filtered on `accountId`.
 */

export const START_WINDOW_DAYS = 30

/** POS "open item" keys are a cashier typing a price, not a dish. */
const OPEN_ITEM = /^open item\b/i

/** Recipe categories that are not dishes on the menu. */
const NOT_A_DISH = new Set(["modifier", "packaging"])

export interface SellingRow {
  name: string
  category: string
  sold: number
  soldLabel: string
  revenue: string
  photo: PhotoFrame | null
}

export interface RecipeChoice {
  id: string
  name: string
  category: string
  lines: number
  photo: PhotoFrame | null
  sold: number
}

export interface MenuItemStartData {
  selling: SellingRow[]
  empty: RecipeChoice[]
  copy: RecipeChoice[]
  categories: string[]
}

export interface MenuItemStartSections {
  start: SectionData<MenuItemStartData>
}

export interface MenuItemStartInput {
  accountId: string
  /** Fixed in tests; defaults to now. */
  now?: Date
}

const DAY = 86_400_000

export async function loadMenuItemStart(input: MenuItemStartInput): Promise<MenuItemStartData> {
  const { accountId } = input
  const now = input.now ?? new Date()
  const since = new Date(now.getTime() - START_WINDOW_DAYS * DAY)
  const stores = await getScopedStores(accountId, null)
  const storeIds = stores.map((s) => s.id)

  const [recipes, cogs, maps] = await Promise.all([
    prisma.recipe.findMany({
      where: { accountId, isSellable: true },
      select: {
        id: true,
        itemName: true,
        category: true,
        foodCostOverride: true,
        _count: { select: { ingredients: true } },
      },
    }),
    storeIds.length
      ? prisma.dailyCogsItem.findMany({
          where: { storeId: { in: storeIds }, date: { gte: since } },
          select: { recipeId: true, itemName: true, category: true, qtySold: true, salesRevenue: true, status: true },
        })
      : Promise.resolve([]),
    storeIds.length
      ? prisma.otterItemMapping.findMany({
          where: { storeId: { in: storeIds }, recipe: { accountId } },
          select: { otterItemName: true },
        })
      : Promise.resolve([]),
  ])

  // A name mapped since the last COGS run is no longer waiting, even though
  // its old rows still say UNMAPPED.
  const mapped = new Set(maps.map((m) => m.otterItemName.trim().toLowerCase()))
  const soldByRecipe = new Map<string, number>()
  const unmapped = new Map<string, { name: string; category: string; sold: number; revenue: number }>()
  for (const c of cogs) {
    if (c.recipeId && c.status !== "UNMAPPED") {
      soldByRecipe.set(c.recipeId, (soldByRecipe.get(c.recipeId) ?? 0) + c.qtySold)
      continue
    }
    const name = c.itemName.trim()
    if (!name || OPEN_ITEM.test(name) || mapped.has(name.toLowerCase())) continue
    const key = `${name}\u0000${c.category.trim()}`
    const u = unmapped.get(key) ?? { name, category: c.category.trim(), sold: 0, revenue: 0 }
    u.sold += c.qtySold
    u.revenue += c.salesRevenue
    unmapped.set(key, u)
  }

  const selling: SellingRow[] = [...unmapped.values()]
    .filter((u) => u.sold > 0)
    .sort((a, b) => b.revenue - a.revenue || b.sold - a.sold)
    .map((u) => ({
      name: u.name,
      category: u.category,
      sold: u.sold,
      soldLabel: `${count(u.sold)} sold`,
      revenue: money(u.revenue),
      photo: photoFrame(u.name),
    }))

  const dishes = recipes.filter((r) => !NOT_A_DISH.has(r.category.trim().toLowerCase()))
  const choice = (r: (typeof recipes)[number]): RecipeChoice => ({
    id: r.id,
    name: r.itemName,
    category: r.category,
    lines: r._count.ingredients,
    photo: photoFrame(r.itemName),
    sold: soldByRecipe.get(r.id) ?? 0,
  })

  const empty = dishes
    .filter((r) => r._count.ingredients === 0 && r.foodCostOverride == null)
    .map(choice)
    .sort((a, b) => b.sold - a.sold || a.name.localeCompare(b.name))

  // Best sellers first: the dish an owner copies is usually the one they sell most of.
  const copy = dishes
    .filter((r) => r._count.ingredients > 0)
    .map(choice)
    .sort((a, b) => b.sold - a.sold || a.name.localeCompare(b.name))

  return {
    selling,
    empty,
    copy,
    categories: [...new Set(dishes.map((r) => r.category.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
  }
}

export function getMenuItemStartSectionPromises(input: MenuItemStartInput): StreamedSections<MenuItemStartSections> {
  return {
    start: guardSection(
      classify(() => loadMenuItemStart(input), { retryAction: "retryMenuItemStart" }),
      "retryMenuItemStart",
    ),
  }
}
