import type { PrismaClient } from "@/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import { blendedMargin } from "@/lib/counter/blended-margin"
import {
  discountShare,
  getItemDiscounts,
  isDealRunning,
  type ItemDiscountEntry,
} from "@/lib/counter/item-discounts"

/**
 * THE ONE FUNCTION THAT OWNS PER-ITEM PRICE, DISCOUNT, PLATE COST AND MARGIN.
 *
 * Every menu screen and every chat tool that prints what an item sold for,
 * what it cost to plate, its food cost or its margin reads it from here. Before
 * this module those figures were computed six different ways: three pages took
 * the deals off and five did not, two costed a plate at today's account-wide
 * price while the rest read what COGS booked, and "Blended margin" was printed
 * on three pages with three different numbers.
 *
 * ## The rules, in one place
 *
 * - **Units and revenue** are `DailyCogsItem.qtySold` / `salesRevenue` — the
 *   POS rollup (`OtterMenuItem`, both channels) exactly as the COGS
 *   materializer copied it, one row per store, day, item and category.
 *   `revenue` is BEFORE discounts: that is what the POS rings up.
 * - **Discounts** come from `item-discounts.ts` (`getItemDiscounts`), applied
 *   as the item's SHARE of what it rang up on the order feed. `collected` is
 *   `revenue × (1 − share)` — what the restaurant was actually paid. A BOGO
 *   rings up 2 × $13.49 and collects $13.49; its food cost is over the $13.49.
 * - **Plate cost** is engine A: `DailyCogsItem.lineCost / qtySold` over
 *   COSTED rows only — the store-and-day invoice prices plus modifiers, i.e.
 *   exactly what COGS booked. UNMAPPED and MISSING_COST rows carry real
 *   revenue at no (or a modifier-only) cost and are left out of every cost
 *   figure; an item with no COSTED row has `costed: null`, and its plate cost,
 *   food cost and margin are `null` — never `$0.00`, `0%` or `100%`.
 * - **Food cost %** is `cost / collected` over the costed rows, 0..100.
 *   **Margin %** is `100 − food cost %`; **margin $** is `collected − cost`.
 * - **Packaging** (`category: "Packaging"`, the `Packaging - *` rows that hold
 *   cost against $0 of revenue) is not a menu item. It is kept out of `items`
 *   and reported once, as `packagingCost`, for a caller that needs it.
 * - **Deal running** is `item-discounts.ts`'s `isDealRunning`: more than 10%
 *   of what it rang up came back off.
 *
 * What is NOT here: the marketplace's commission (`pnl.ts`, `channel-mix.ts`,
 * the menu item page's "Kept"). Margin here is before that cut, and the pages
 * that print it say so.
 *
 * ## Tenancy
 *
 * `accountId` is the boundary. `DailyCogsItem` is store-owned, so the query
 * filters `store: { accountId }` as well as the caller's store ids, and
 * `getItemDiscounts` re-checks the stores against the account the same way. A
 * store id that is not this account's contributes nothing.
 */

/** One grouped `DailyCogsItem` slice — or one raw row, with `rows` 1. */
export interface CogsSlice {
  itemName: string
  category: string
  recipeId: string | null
  status: string
  partialCost: boolean
  costSource: string | null
  qtySold: number
  salesRevenue: number
  lineCost: number
  /** How many store-day rows this slice folds. Defaults to 1. */
  rows?: number
}

export interface CostedEconomics {
  /** Units on COSTED rows. */
  units: number
  /** COSTED rows' revenue, before discounts. */
  revenue: number
  /** COSTED rows' revenue after the item's discount share. */
  collected: number
  /** `DailyCogsItem.lineCost` on COSTED rows — what COGS booked. */
  cost: number
}

export interface ItemEconomics {
  itemName: string
  /** The category it sold the most units under. */
  category: string
  /** Every category the POS filed it under in the window. */
  categories: string[]
  /** The recipe behind most of its costed units (else any it was mapped to). */
  recipeId: string | null
  /** Every unit sold, costed or not. */
  units: number
  /** Every dollar rung up, BEFORE discounts. */
  revenue: number
  /** Share of `revenue` the deals took back off, 0..1. */
  discountShare: number
  /** Dollars of discount attributed to it, positive. */
  discount: number
  /** `revenue − discount` — what was actually collected. */
  collected: number
  /** More than `DEAL_THRESHOLD` of what it rang up came back off. */
  dealRunning: boolean
  /** `revenue / units`, before discounts. Null with no units. */
  unitPrice: number | null
  /** `collected / units`. Null with no units. */
  collectedUnitPrice: number | null
  /** The costed slice, or `null` when nothing costed it in the window. */
  costed: CostedEconomics | null
  /** Booked cost per costed unit. Null when not costed. */
  plateCost: number | null
  /** `cost / collected` on the costed rows, 0..100. Null when not costed. */
  foodCostPct: number | null
  /** `100 − foodCostPct`. Null when not costed. */
  marginPct: number | null
  /** `collected − cost` on the costed rows. Null when not costed. */
  marginDollars: number | null
  /** Store-day rows the cost walk flagged as an understatement. */
  partialDays: number
  /** Some costed day used the recipe's typed-in `foodCostOverride`. */
  override: boolean
  /** Some row resolved a recipe that walks to nothing (MISSING_COST). */
  missingCost: boolean
  /** Some row had no recipe at all (UNMAPPED). */
  unmapped: boolean
}

/**
 * The menu-wide figure every "Blended margin" cell prints.
 *
 * THE RULE: over items that have COSTED rows, Packaging excluded (it is not an
 * item), on COLLECTED revenue (after discounts):
 *
 *     marginPct   = 100 − Σ costed cost / Σ costed collected × 100
 *     foodCostPct = Σ costed cost / Σ costed collected × 100
 *
 * Uncosted revenue is not in the denominator — counting it at $0 cost reads
 * every unmapped item as 100% margin and flatters the blend by exactly the gap
 * it hides. No minimum-units filter: a cut such as Menu profit's ≥5-units
 * classifier is a DISPLAY choice for a chart and does not move this figure.
 * This is menu revenue, not the statement's Total Sales; the COGS page divides
 * by Total Sales and gets a different, equally correct number.
 */
export interface MenuMargin {
  /** Σ booked cost on costed items. */
  cost: number
  /** Σ costed revenue before discounts. */
  revenue: number
  /** Σ costed revenue after discounts — the denominator. */
  collected: number
  /** `revenue − collected`. */
  discount: number
  /** Null with no costed revenue — never 0 or 100. */
  marginPct: number | null
  /** Null with no costed revenue. */
  foodCostPct: number | null
  /** Items that contributed. */
  items: number
}

export interface ItemEconomicsResult {
  /** Keyed by POS item name (`DailyCogsItem.itemName`). Packaging excluded. */
  items: Map<string, ItemEconomics>
  /** `menuMargin(items)`. */
  menu: MenuMargin
  /** Booked cost on `Packaging - *` rows, which no item carries. */
  packagingCost: number
  /** The raw `getItemDiscounts` map, for a caller that splits by platform. */
  discounts: Map<string, ItemDiscountEntry>
}

export const PACKAGING_CATEGORY = "Packaging"

const isPackaging = (s: Pick<CogsSlice, "category">) => s.category === PACKAGING_CATEGORY

/**
 * Fold `DailyCogsItem` slices and the discount map into per-item economics.
 * Pure — the loader below and `cogs.ts`'s own fold both call it, so a figure
 * read off either cannot disagree.
 */
export function foldItemEconomics(
  slices: Iterable<CogsSlice>,
  discounts: Map<string, ItemDiscountEntry>,
): { items: Map<string, ItemEconomics>; packagingCost: number } {
  interface Acc {
    units: number
    revenue: number
    catUnits: Map<string, number>
    recipeUnits: Map<string, number>
    anyRecipe: string | null
    costedUnits: number
    costedRevenue: number
    cost: number
    hasCosted: boolean
    partialDays: number
    override: boolean
    missingCost: boolean
    unmapped: boolean
  }
  const accs = new Map<string, Acc>()
  let packagingCost = 0

  for (const s of slices) {
    const qty = Number(s.qtySold) || 0
    const revenue = Number(s.salesRevenue) || 0
    const lineCost = Number(s.lineCost) || 0
    if (isPackaging(s)) {
      packagingCost += lineCost
      continue
    }
    const a: Acc = accs.get(s.itemName) ?? {
      units: 0,
      revenue: 0,
      catUnits: new Map(),
      recipeUnits: new Map(),
      anyRecipe: null,
      costedUnits: 0,
      costedRevenue: 0,
      cost: 0,
      hasCosted: false,
      partialDays: 0,
      override: false,
      missingCost: false,
      unmapped: false,
    }
    a.units += qty
    a.revenue += revenue
    const category = s.category?.trim() ? s.category.trim() : "Uncategorized"
    a.catUnits.set(category, (a.catUnits.get(category) ?? 0) + qty)
    if (s.recipeId) a.anyRecipe ??= s.recipeId
    if (s.partialCost) a.partialDays += s.rows ?? 1
    if (s.status === "COSTED") {
      a.hasCosted = true
      a.costedUnits += qty
      a.costedRevenue += revenue
      a.cost += lineCost
      if (s.recipeId) a.recipeUnits.set(s.recipeId, (a.recipeUnits.get(s.recipeId) ?? 0) + qty)
      if (s.costSource === "override") a.override = true
    } else if (s.status === "MISSING_COST") {
      a.missingCost = true
    } else if (s.status === "UNMAPPED") {
      a.unmapped = true
    }
    accs.set(s.itemName, a)
  }

  const top = (m: Map<string, number>) =>
    [...m.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0] ?? null

  const items = new Map<string, ItemEconomics>()
  for (const [itemName, a] of accs) {
    const deal = discounts.get(itemName)
    const share = discountShare(deal)
    const collected = a.revenue * (1 - share)
    const costed: CostedEconomics | null = a.hasCosted
      ? {
          units: a.costedUnits,
          revenue: a.costedRevenue,
          collected: a.costedRevenue * (1 - share),
          cost: a.cost,
        }
      : null
    // A cost of nothing, or nothing collected, yields no ratio — the same
    // "never 0, never 100" rule `cogs.ts`'s `itemFoodPct` states.
    const ratioOk = costed !== null && costed.cost > 0 && costed.collected > 0
    const foodCostPct = ratioOk ? (costed.cost / costed.collected) * 100 : null
    items.set(itemName, {
      itemName,
      category: top(a.catUnits) ?? "Uncategorized",
      categories: [...a.catUnits.keys()].sort(),
      recipeId: top(a.recipeUnits) ?? a.anyRecipe,
      units: a.units,
      revenue: a.revenue,
      discountShare: share,
      discount: a.revenue * share,
      collected,
      dealRunning: isDealRunning(deal),
      unitPrice: a.units > 0 ? a.revenue / a.units : null,
      collectedUnitPrice: a.units > 0 ? collected / a.units : null,
      costed,
      plateCost: costed && costed.units > 0 ? costed.cost / costed.units : null,
      foodCostPct,
      marginPct: foodCostPct === null ? null : 100 - foodCostPct,
      marginDollars: ratioOk ? costed.collected - costed.cost : null,
      partialDays: a.partialDays,
      override: a.override,
      missingCost: a.missingCost,
      unmapped: a.unmapped,
    })
  }
  return { items, packagingCost }
}

/** See `MenuMargin` for the rule. */
export function menuMargin(items: Iterable<ItemEconomics>): MenuMargin {
  let cost = 0
  let revenue = 0
  let collected = 0
  let n = 0
  for (const i of items) {
    if (!i.costed) continue
    cost += i.costed.cost
    revenue += i.costed.revenue
    collected += i.costed.collected
    n += 1
  }
  const marginPct = blendedMargin(cost, collected)
  return {
    cost,
    revenue,
    collected,
    discount: revenue - collected,
    marginPct,
    foodCostPct: marginPct === null ? null : 100 - marginPct,
    items: n,
  }
}

/** Per-recipe roll-up of the same figures, for the pages that list dishes. */
export interface RecipeEconomics {
  recipeId: string
  /** POS item names whose units count toward it. */
  itemNames: string[]
  units: number
  revenue: number
  collected: number
  discount: number
  /** Collected over units — WEIGHTED, never a mean of line prices. */
  collectedUnitPrice: number | null
  unitPrice: number | null
  costed: CostedEconomics | null
  plateCost: number | null
  foodCostPct: number | null
  marginPct: number | null
  marginDollars: number | null
  partialDays: number
  override: boolean
  missingCost: boolean
}

/**
 * Sum the items behind each recipe. An item counts toward the recipe that
 * carries most of its costed units — `ItemEconomics.recipeId` — which is the
 * recipe COGS actually booked it against, not whatever the mapping table says
 * today.
 */
export function rollUpByRecipe(items: Iterable<ItemEconomics>): Map<string, RecipeEconomics> {
  const out = new Map<string, RecipeEconomics>()
  for (const i of items) {
    if (!i.recipeId) continue
    const r: RecipeEconomics = out.get(i.recipeId) ?? {
      recipeId: i.recipeId,
      itemNames: [],
      units: 0,
      revenue: 0,
      collected: 0,
      discount: 0,
      collectedUnitPrice: null,
      unitPrice: null,
      costed: null,
      plateCost: null,
      foodCostPct: null,
      marginPct: null,
      marginDollars: null,
      partialDays: 0,
      override: false,
      missingCost: false,
    }
    r.itemNames.push(i.itemName)
    r.units += i.units
    r.revenue += i.revenue
    r.collected += i.collected
    r.discount += i.discount
    r.partialDays += i.partialDays
    r.override ||= i.override
    r.missingCost ||= i.missingCost
    if (i.costed) {
      const c = r.costed ?? { units: 0, revenue: 0, collected: 0, cost: 0 }
      c.units += i.costed.units
      c.revenue += i.costed.revenue
      c.collected += i.costed.collected
      c.cost += i.costed.cost
      r.costed = c
    }
    out.set(i.recipeId, r)
  }
  for (const r of out.values()) {
    r.unitPrice = r.units > 0 ? r.revenue / r.units : null
    r.collectedUnitPrice = r.units > 0 ? r.collected / r.units : null
    const c = r.costed
    const ratioOk = c !== null && c.cost > 0 && c.collected > 0
    r.plateCost = c && c.units > 0 ? c.cost / c.units : null
    r.foodCostPct = ratioOk ? (c.cost / c.collected) * 100 : null
    r.marginPct = r.foodCostPct === null ? null : 100 - r.foodCostPct
    r.marginDollars = ratioOk ? c.collected - c.cost : null
  }
  return out
}

export type ItemEconomicsDb = Pick<PrismaClient, "$queryRaw" | "dailyCogsItem">

/**
 * Load and fold. `startDate`/`endDate` bound both `DailyCogsItem.date` and the
 * order feed's `referenceTimeLocal`, so pass an `endDate` at the end of the
 * last day (`toQueryBounds` does). `db` defaults to the app client; the chat
 * tools pass their own context client.
 */
export async function getItemEconomics(input: {
  accountId: string
  storeIds: string[]
  startDate: Date
  endDate: Date
  /** Limit to one POS item name — the menu item page. */
  itemName?: string
  db?: ItemEconomicsDb
}): Promise<ItemEconomicsResult> {
  const { accountId, storeIds, startDate, endDate, itemName } = input
  const db = input.db ?? prisma
  if (storeIds.length === 0) {
    return { items: new Map(), menu: menuMargin([]), packagingCost: 0, discounts: new Map() }
  }

  const [grouped, discounts] = await Promise.all([
    db.dailyCogsItem.groupBy({
      by: ["itemName", "category", "recipeId", "status", "partialCost", "costSource"],
      where: {
        storeId: { in: storeIds },
        store: { accountId },
        date: { gte: startDate, lte: endDate },
        ...(itemName !== undefined ? { itemName } : {}),
      },
      _sum: { qtySold: true, salesRevenue: true, lineCost: true },
      _count: { _all: true },
    }),
    getItemDiscounts({ accountId, storeIds, startDate, endDate, itemName, db }),
  ])

  const slices: CogsSlice[] = grouped.map((g) => ({
    itemName: g.itemName,
    category: g.category,
    recipeId: g.recipeId ?? null,
    status: String(g.status),
    partialCost: Boolean(g.partialCost),
    costSource: g.costSource ?? null,
    qtySold: Number(g._sum?.qtySold ?? 0),
    salesRevenue: Number(g._sum?.salesRevenue ?? 0),
    lineCost: Number(g._sum?.lineCost ?? 0),
    rows: Number((g._count as { _all?: number } | undefined)?._all ?? 1),
  }))
  const { items, packagingCost } = foldItemEconomics(slices, discounts)
  return { items, menu: menuMargin(items.values()), packagingCost, discounts }
}
