import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { count, money, pct } from "@/lib/counter/format"
import { toQueryBounds, type DateRange } from "@/lib/counter/date-range"
import { classify, guardSection, type StreamedSections } from "@/lib/counter/adapters/types"
import { photoFrame, type PhotoFrame } from "@/lib/counter/menu-photos"
import type { SectionData } from "@/lib/counter/section-data"

/**
 * Menu items — one row per dish the owner sells, with its photo, what it
 * costs to plate and what it sold, plus the short list of dishes whose cost
 * the dashboard cannot vouch for yet.
 *
 * ## A dish is a RECIPE, not a POS name
 *
 * The POS sells the Double Slider under three names ("Double Slider" in the
 * store, "Chris N Eddy's Slider" and the Signature name on the delivery apps)
 * and the Catalog tab lists each one. This page is the owner's menu, so it
 * groups by the recipe those names map to and shows the name count.
 *
 * ## Every figure is READ from `DailyCogsItem`, never recomputed
 *
 * Plate cost, sales and food cost are the sums the COGS materializer already
 * booked for the range, so this page and the COGS page cannot disagree about
 * a dish. Margin is on the item's own booked revenue, the same basis
 * `menu-hub.ts` documents; a delivery deal that halves what was collected is
 * that table's to express, not this page's to re-derive.
 *
 * ## What lands in "Needs you"
 *
 * Only things that make a booked cost wrong or unknown, biggest first:
 * - a POS item that sold with no recipe (UNMAPPED rows), or a recipe with
 *   nothing in it and no typed-in cost (MISSING_COST);
 * - an ingredient in a selling dish whose newest invoice price is older than
 *   {@link STALE_DAYS} days, so every plate still uses that old price;
 * - a dish with days where one line had no price (`partialCost`);
 * - a dish costed from a typed-in `foodCostOverride` instead of its lines.
 *
 * Tenancy: stores come from `getScopedStores(accountId)`, recipes and
 * invoices are filtered on `accountId`, and the raw query joins `"Invoice"`
 * on it.
 */

export const STALE_DAYS = 90

/** POS "open item" keys are a cashier typing a price, not a dish. */
const OPEN_ITEM = /^open item\b/i

/** Recipe categories that are not dishes on the menu. */
const NOT_A_DISH = new Set(["modifier", "packaging"])

export type ItemGlyph = "ok" | "open" | "miss" | "up"

export interface MenuItemRow {
  id: string
  name: string
  category: string
  href: string
  photo: PhotoFrame | null
  glyph: ItemGlyph
  /** Why the glyph is not ✓, for its tooltip. */
  why: string
  posNames: number
  sold: number
  soldLabel: string
  avgPrice: string
  plateCost: string
  foodCostPct: number | null
  foodCost: string
  keep: string
}

export interface NeedRow {
  key: string
  glyph: "miss" | "open"
  title: string
  sub: string
  what: string
  amount: string
  act: { label: string; href: string }
  photo: PhotoFrame | null
  /** Sort weight: dollars of sales the problem sits under. */
  weight: number
}

export interface MenuItemsData {
  counts: {
    dishes: number
    /** Dishes that sold in the range: the denominator of `fullyCosted`. */
    sellingDishes: number
    fullyCosted: number
    notCosted: number
    notCostedSold: number
    staleIngredients: number
    staleExample: string | null
    cost: number
    revenue: number
  }
  needs: NeedRow[]
  items: MenuItemRow[]
  categories: string[]
}

export interface MenuItemsSections {
  items: SectionData<MenuItemsData>
}

export interface MenuItemsInput {
  range: DateRange
  storeId: string | null
  accountId: string
  /** Fixed in tests; defaults to now. */
  now?: Date
}

interface Agg {
  sold: number
  revenue: number
  cost: number
  partialDays: number
  override: boolean
  missing: boolean
}

const DAY = 86_400_000

export async function loadMenuItems(input: MenuItemsInput): Promise<MenuItemsData> {
  const { accountId } = input
  const now = input.now ?? new Date()
  const { startDate, endDate } = toQueryBounds(input.range)
  const stores = await getScopedStores(accountId, input.storeId)
  const storeIds = stores.map((s) => s.id)

  const [recipes, cogs, maps] = await Promise.all([
    prisma.recipe.findMany({
      where: { accountId },
      select: {
        id: true,
        itemName: true,
        category: true,
        isSellable: true,
        foodCostOverride: true,
        ingredients: { select: { canonicalIngredientId: true, componentRecipeId: true } },
      },
    }),
    storeIds.length
      ? prisma.dailyCogsItem.findMany({
          where: { storeId: { in: storeIds }, date: { gte: startDate, lte: endDate } },
          select: {
            recipeId: true,
            itemName: true,
            category: true,
            qtySold: true,
            salesRevenue: true,
            lineCost: true,
            status: true,
            partialCost: true,
            costSource: true,
          },
        })
      : Promise.resolve([]),
    storeIds.length
      ? prisma.otterItemMapping.findMany({
          where: { storeId: { in: storeIds }, recipe: { accountId } },
          select: { recipeId: true, otterItemName: true },
        })
      : Promise.resolve([]),
  ])

  const byId = new Map(recipes.map((r) => [r.id, r]))
  const dishes = recipes.filter((r) => r.isSellable && !NOT_A_DISH.has(r.category.trim().toLowerCase()))

  const posNames = new Map<string, Set<string>>()
  for (const m of maps) {
    const set = posNames.get(m.recipeId) ?? new Set<string>()
    set.add(m.otterItemName.trim())
    posNames.set(m.recipeId, set)
  }

  // A name mapped since the last COGS run is no longer waiting, even though
  // its rows in the range still say UNMAPPED until the next run.
  const mappedNames = new Set(maps.map((m) => m.otterItemName.trim().toLowerCase()))

  const agg = new Map<string, Agg>()
  const unmapped = new Map<string, { name: string; category: string; sold: number; revenue: number }>()
  let cost = 0
  let revenue = 0
  for (const c of cogs) {
    if (c.status === "UNMAPPED" || !c.recipeId) {
      if (OPEN_ITEM.test(c.itemName.trim()) || mappedNames.has(c.itemName.trim().toLowerCase())) continue
      const key = `${c.itemName.trim()}\u0000${c.category.trim()}`
      const u = unmapped.get(key) ?? { name: c.itemName.trim(), category: c.category.trim(), sold: 0, revenue: 0 }
      u.sold += c.qtySold
      u.revenue += c.salesRevenue
      unmapped.set(key, u)
      continue
    }
    const r = byId.get(c.recipeId)
    if (!r || NOT_A_DISH.has(r.category.trim().toLowerCase())) continue
    const a = agg.get(c.recipeId) ?? { sold: 0, revenue: 0, cost: 0, partialDays: 0, override: false, missing: false }
    a.sold += c.qtySold
    a.revenue += c.salesRevenue
    a.cost += c.lineCost
    if (c.partialCost) a.partialDays += 1
    if (c.costSource === "override") a.override = true
    if (c.status === "MISSING_COST") a.missing = true
    agg.set(c.recipeId, a)
    cost += c.lineCost
    revenue += c.salesRevenue
  }

  // Ingredients a selling dish uses, directly or through one component recipe.
  const selling = dishes.filter((d) => (agg.get(d.id)?.sold ?? 0) > 0)
  const usedBy = new Map<string, Set<string>>()
  const use = (ing: string | null, dishId: string) => {
    if (!ing) return
    const set = usedBy.get(ing) ?? new Set<string>()
    set.add(dishId)
    usedBy.set(ing, set)
  }
  for (const d of selling) {
    for (const line of d.ingredients) {
      use(line.canonicalIngredientId, d.id)
      const sub = line.componentRecipeId ? byId.get(line.componentRecipeId) : undefined
      // Modifiers are add-ons, not the dish; their ingredients are checked
      // where they are the dish.
      if (sub && !NOT_A_DISH.has(sub.category.trim().toLowerCase())) {
        for (const l2 of sub.ingredients) use(l2.canonicalIngredientId, d.id)
      }
    }
  }

  const ingIds = [...usedBy.keys()]
  const lastPriced = ingIds.length
    ? await prisma.$queryRaw<Array<{ id: string; name: string; vendor: string | null; last: Date | null }>>`
        SELECT ci.id, ci.name,
               (ARRAY_AGG(i."vendorName" ORDER BY i."invoiceDate" DESC NULLS LAST))[1] AS vendor,
               MAX(i."invoiceDate") AS last
        FROM "CanonicalIngredient" ci
        JOIN "InvoiceLineItem" li ON li."canonicalIngredientId" = ci.id AND li."unitPrice" > 0
        JOIN "Invoice" i ON i.id = li."invoiceId" AND i."accountId" = ${accountId}
        WHERE ci."accountId" = ${accountId} AND ci.id = ANY(${ingIds})
        GROUP BY ci.id, ci.name`
    : []
  const stale = lastPriced
    .filter((p) => p.last && now.getTime() - new Date(p.last).getTime() > STALE_DAYS * DAY)
    .map((p) => ({ ...p, dishes: usedBy.get(p.id) ?? new Set<string>() }))
  const staleDishes = new Set(stale.flatMap((s) => [...s.dishes]))

  const needs: NeedRow[] = []
  for (const u of unmapped.values()) {
    needs.push({
      key: `pos:${u.name}:${u.category}`,
      glyph: "miss",
      title: u.name,
      sub: `${u.category || "Uncategorized"} · on the POS, no recipe`,
      what: `Sold ${count(u.sold)} with nothing counted for food.`,
      amount: `${count(u.sold)} sold`,
      act: { label: "Set it up", href: `/dashboard/menu/items/new?pos=${encodeURIComponent(u.name)}` },
      photo: photoFrame(u.name),
      weight: u.revenue,
    })
  }

  let fullyCosted = 0
  const items: MenuItemRow[] = []
  for (const d of dishes) {
    const a = agg.get(d.id)
    const empty = d.ingredients.length === 0 && d.foodCostOverride == null
    const isStale = staleDishes.has(d.id)
    let glyph: ItemGlyph = "ok"
    let why = "Every line priced"
    if (!a || a.sold === 0) {
      glyph = "up"
      why = "Not sold in this range"
    } else if (a.missing || empty) {
      glyph = "miss"
      why = "Nothing in the recipe"
    } else if (a.partialDays > 0 || a.override || isStale) {
      glyph = "open"
      why = a.override
        ? "Cost is typed in, not from the recipe"
        : a.partialDays > 0
          ? "Some days had a line with no price"
          : "Uses an ingredient with an old price"
    }
    // Only a dish that sold can be vouched for: the stale-price check runs on
    // selling dishes, so an unsold one is not counted either way.
    if (glyph === "ok") fullyCosted += 1

    const sold = a?.sold ?? 0
    const avg = sold > 0 ? a!.revenue / sold : null
    const plate = sold > 0 ? a!.cost / sold : null
    const fc = a && a.revenue > 0 ? a.cost / a.revenue : null
    items.push({
      id: d.id,
      name: d.itemName,
      category: d.category.trim(),
      href: `/dashboard/recipes/${d.id}`,
      photo: photoFrame(d.itemName),
      glyph,
      why,
      posNames: posNames.get(d.id)?.size ?? 0,
      sold,
      soldLabel: count(sold),
      avgPrice: money(avg, { cents: true }),
      plateCost: money(plate, { cents: true }),
      foodCostPct: fc,
      foodCost: pct(fc),
      keep: avg != null && plate != null ? money(avg - plate, { cents: true }) : money(null),
    })

    if (!a || a.sold === 0) continue
    const sub = `${d.category.trim()} · ${count(a.sold)} sold`
    if (glyph === "miss") {
      needs.push({
        key: `empty:${d.id}`,
        glyph: "miss",
        title: d.itemName,
        sub,
        what:
          a.cost > 0
            ? `Has a name but nothing in it. Only ${money(a.cost)} of add-ons was counted.`
            : "Has a name but nothing in it, so nothing was counted for food.",
        amount: `${count(a.sold)} sold`,
        act: { label: "Set it up", href: `/dashboard/recipes/${d.id}` },
        photo: photoFrame(d.itemName),
        weight: a.revenue,
      })
    } else if (a.override) {
      needs.push({
        key: `override:${d.id}`,
        glyph: "open",
        title: d.itemName,
        sub,
        what: `Cost is a typed-in ${money(a.cost / a.sold, { cents: true })}, not built from what's in it.`,
        amount: `${count(a.sold)} sold`,
        act: { label: "Build the recipe", href: `/dashboard/recipes/${d.id}` },
        photo: photoFrame(d.itemName),
        weight: a.revenue * 0.25,
      })
    }
  }

  // Partial days: one row for every dish that shares the problem, not five.
  const partial = dishes.filter((d) => {
    const a = agg.get(d.id)
    return a && a.sold > 0 && a.partialDays > 0 && !a.missing && !a.override
  })
  if (partial.length > 0) {
    partial.sort((x, y) => (agg.get(y.id)!.revenue - agg.get(x.id)!.revenue))
    const top = partial[0]
    needs.push({
      key: "partial",
      glyph: "open",
      title: partial.length === 1 ? top.itemName : `${top.itemName} and ${partial.length - 1} more`,
      sub:
        partial.length === 1
          ? `${top.category.trim()} · ${count(agg.get(top.id)!.partialDays)} store-days short`
          : partial.map((d) => d.itemName).slice(0, 5).join(", "),
      what: "On some days one line had no price, so those days are counted a little low.",
      amount: `${partial.length} ${partial.length === 1 ? "dish" : "dishes"}`,
      act: { label: "See the recipe", href: `/dashboard/recipes/${top.id}` },
      photo: photoFrame(top.itemName),
      weight: partial.reduce((s, d) => s + agg.get(d.id)!.revenue, 0) * 0.5,
    })
  }

  for (const s of stale) {
    const names = [...s.dishes].map((id) => byId.get(id)?.itemName).filter(Boolean) as string[]
    const weight = [...s.dishes].reduce((sum, id) => sum + (agg.get(id)?.revenue ?? 0), 0)
    const when = new Date(s.last!).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    needs.push({
      key: `stale:${s.id}`,
      glyph: "open",
      title: s.name,
      sub: `Ingredient · in ${names.length === 1 ? names[0] : `${names.length} dishes`}`,
      what: `Newest price is from ${when}${s.vendor ? ` (${s.vendor})` : ""}. If you buy it somewhere else now, that invoice isn't linked to it.`,
      amount: `Since ${when}`,
      act: { label: "Open the ingredient", href: `/dashboard/ingredients/${s.id}` },
      photo: null,
      weight,
    })
  }

  needs.sort((x, y) => y.weight - x.weight || x.title.localeCompare(y.title))
  items.sort((x, y) => y.sold - x.sold || x.name.localeCompare(y.name))

  const notCostedRows = needs.filter((n) => n.glyph === "miss")
  const staleTop = [...stale].sort((x, y) => (y.dishes.size - x.dishes.size))[0]

  return {
    counts: {
      dishes: dishes.length,
      sellingDishes: selling.length,
      fullyCosted,
      notCosted: notCostedRows.length,
      notCostedSold:
        [...unmapped.values()].reduce((s, u) => s + u.sold, 0) +
        dishes.filter((d) => agg.get(d.id)?.missing || (d.ingredients.length === 0 && d.foodCostOverride == null))
          .reduce((s, d) => s + (agg.get(d.id)?.sold ?? 0), 0),
      staleIngredients: stale.length,
      staleExample: staleTop ? staleTop.name : null,
      cost,
      revenue,
    },
    needs,
    items,
    categories: [...new Set(items.map((i) => i.category))].sort((a, b) => a.localeCompare(b)),
  }
}

export function getMenuItemsSectionPromises(input: MenuItemsInput): StreamedSections<MenuItemsSections> {
  return {
    items: guardSection(
      classify(() => loadMenuItems(input), {
        retryAction: "retryMenuItems",
        isEmpty: (d) => d.items.length === 0 && d.needs.length === 0,
        emptyReason: "no_match",
      }),
      "retryMenuItems",
    ),
  }
}
