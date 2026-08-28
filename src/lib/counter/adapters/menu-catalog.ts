import { prisma } from "@/lib/prisma"
import { count, money, pct } from "@/lib/counter/format"
import { toQueryBounds, type DateRange } from "@/lib/counter/date-range"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
import { mapReady, type SectionData } from "@/lib/counter/section-data"
import type { DonutSlice, FigureProps, MListRow, QueueItem } from "@/components/counter"

/**
 * The menu catalog — `P.catalog` (`docs/counter/counter-prototype.html:6059`).
 *
 * "The POS menu as it sells, and whether each item has a recipe behind it."
 * Every column and every figure the prototype asks for is answerable here.
 * Three of them answer differently enough to change what the page says — all
 * three measured in `docs/counter/measurements/2026-08-28-catalog.md`.
 *
 * ## 1. The unmapped items are POS junk, so "Map them" has almost nothing to do
 *
 * The prototype's headline gap is six unmapped items "blocking COGS on
 * $1,240". Here it is seven items and **sixty-two dollars**, and six of the
 * seven sold ONCE each for about three dollars: `loadfries 24`, `load 602`,
 * `Open item #1`, `add patty to fries` — open-item rows and typos, not menu
 * items. The seventh is a forty-eight-dollar baseball cap, which is
 * merchandise and has no recipe by nature.
 *
 * ## 2. The real gap is modifiers, and revenue hides it completely
 *
 * Fifteen of fifty-four modifiers are unmapped, carrying $213. That reads as
 * smaller still until you count servings rather than dollars: **Add Pickles
 * sold 2,250 times, Add Sauce 919, Add Raw Onions 215, Add Grilled Onions
 * 190 — every one of them at $0.** Over 3,700 servings of food left the
 * kitchen with no cost against them, and because a free modifier earns
 * nothing it never appears in anything ranked by revenue. The queue reports
 * that, in servings.
 *
 * ## 3. THE CATEGORY RING IS DRAWN, AND THE PAGE SAYS WHY NOT TO TRUST IT
 *
 * Measured, `On The Side` is **41.5% of revenue** — and it holds `Signature
 * Double Patty & Cheese Slider`, the biggest seller on the menu, along with
 * `Triple Patty Slider` and `Chris N Eddy's Slider`. `NFL Promo` is ONE item
 * holding a fifth of all revenue. `Loaded Fries` is filed under two
 * categories at once and eleven items are filed under none.
 *
 * Read as drawn, the ring says two fifths of this restaurant's sales are side
 * dishes. They are not — the POS categories do not describe the food.
 *
 * The ring stays anyway, and the section's note names the misfiling. Dropping
 * it would HIDE the problem; drawing it with the note turns a misleading
 * picture into the page's most useful finding, which is that the menu's own
 * filing cannot be reported on until someone fixes it. A reader must be able
 * to find the reason on the page rather than in a commit — the same rule the
 * COGS items table and the Menu hub's margin already follow.
 *
 * ## 4. The AI-proposal card has no counterpart
 *
 * `RecipeMappingProposal` holds 7 rejected and 3 accepted and **nothing
 * pending**, so the prototype's "Five AI mapping proposals are waiting" has
 * nothing behind it. The queue's second slot carries the unmapped ITEMS
 * instead — small, but real, and it is what the page is about.
 */

export interface CatalogRow {
  key: string
  item: string
  category: string
  /** Revenue over quantity — what a unit actually sold for, not a list price. */
  price: string
  sold: string
  soldQty: number
  mapped: boolean
  isModifier: boolean
  /** `—` when nothing costed it. */
  plateCost: string
  margin: string
  href: string
}

export interface CatalogList {
  rows: CatalogRow[]
  /** Every row, including modifiers — the toggles filter this client-side. */
  totalItems: number
  totalModifiers: number
  unmappedItems: number
  unmappedModifiers: number
  phoneUnmapped: MListRow[]
  phoneTop: MListRow[]
}

export interface CatalogHeadline {
  cells: FigureProps[]
  phoneCells: FigureProps[]
}

export interface CatalogGaps {
  items: QueueItem[]
  phoneRows: MListRow[]
  meta: string
}

export interface CatalogCategories {
  slices: DonutSlice[]
  centre: string
  meta: string
  /** The misfiling, named. Never optional — it is why the ring is readable. */
  note: string
}

export interface MenuCatalogSections {
  headline: SectionData<CatalogHeadline>
  list: SectionData<CatalogList>
  gaps: SectionData<CatalogGaps>
  categories: SectionData<CatalogCategories>
}

export interface MenuCatalogInput {
  range: DateRange
  storeId: string | null
  accountId: string
}

/** Rows shown on the phone's two lists. */
const PHONE_ROWS = 4
/** Slices before the ring stops naming them; the rest fold into one. */
const MAX_SLICES = 7

interface Agg {
  categories: Set<string>
  qty: number
  revenue: number
}

interface CatalogData {
  items: Map<string, Agg>
  modifiers: Map<string, Agg>
  mappedItems: Set<string>
  mappedModifiers: Set<string>
  costs: Map<string, { cost: number; revenue: number; qty: number }>
  categoryRevenue: Map<string, number>
  categoryItems: Map<string, Set<string>>
}

/**
 * A blank category is `Uncategorized` and is counted as its own, never folded
 * away — the Menu hub's rule, for the Menu hub's reason: eleven items here
 * have no category and a report that hides its own biggest filing gap is
 * decoration.
 */
const categoryOf = (raw: string | null) => (raw?.trim() ? raw.trim() : "Uncategorized")

async function loadCatalog(input: MenuCatalogInput): Promise<CatalogData> {
  const { range, storeId, accountId } = input
  const { startDate, endDate } = toQueryBounds(range)

  // Scoped through the account first: without it a null `storeId` would mean
  // every store in the database.
  const stores = await prisma.store.findMany({
    where: { accountId, isActive: true, ...(storeId ? { id: storeId } : {}) },
    select: { id: true },
  })
  const storeIds = stores.map((s) => s.id)
  const empty: CatalogData = {
    items: new Map(),
    modifiers: new Map(),
    mappedItems: new Set(),
    mappedModifiers: new Set(),
    costs: new Map(),
    categoryRevenue: new Map(),
    categoryItems: new Map(),
  }
  if (storeIds.length === 0) return empty

  const where = { storeId: { in: storeIds }, date: { gte: startDate, lte: endDate } }
  const sales = {
    fpQuantitySold: true,
    tpQuantitySold: true,
    fpTotalSales: true,
    tpTotalSales: true,
  } as const

  const [rawItems, rawMods, itemMaps, modMaps, cogs] = await Promise.all([
    prisma.otterMenuItem.findMany({
      where: { ...where, isModifier: false },
      select: { itemName: true, category: true, ...sales },
    }),
    prisma.otterMenuItem.findMany({
      where: { ...where, isModifier: true },
      select: { itemName: true, ...sales },
    }),
    prisma.otterItemMapping.findMany({
      where: { storeId: { in: storeIds } },
      select: { otterItemName: true },
    }),
    prisma.otterSubItemMapping.findMany({
      where: { storeId: { in: storeIds } },
      select: { otterSubItemName: true },
    }),
    prisma.dailyCogsItem.groupBy({
      by: ["itemName"],
      where,
      _sum: { lineCost: true, salesRevenue: true, qtySold: true },
    }),
  ])

  const items = new Map<string, Agg>()
  const categoryRevenue = new Map<string, number>()
  const categoryItems = new Map<string, Set<string>>()
  for (const r of rawItems) {
    // Both channels, added. An item sold in-house and on a marketplace is one
    // item at one price, not two rows — `fp` and `tp` are the two halves of
    // the same sale everywhere else in this codebase.
    const qty = Number(r.fpQuantitySold ?? 0) + Number(r.tpQuantitySold ?? 0)
    const revenue = Number(r.fpTotalSales ?? 0) + Number(r.tpTotalSales ?? 0)
    const category = categoryOf(r.category)

    const agg = items.get(r.itemName) ?? { categories: new Set<string>(), qty: 0, revenue: 0 }
    agg.categories.add(category)
    agg.qty += qty
    agg.revenue += revenue
    items.set(r.itemName, agg)

    categoryRevenue.set(category, (categoryRevenue.get(category) ?? 0) + revenue)
    const named = categoryItems.get(category) ?? new Set<string>()
    named.add(r.itemName)
    categoryItems.set(category, named)
  }

  const modifiers = new Map<string, Agg>()
  for (const r of rawMods) {
    const agg = modifiers.get(r.itemName) ?? { categories: new Set<string>(), qty: 0, revenue: 0 }
    agg.qty += Number(r.fpQuantitySold ?? 0) + Number(r.tpQuantitySold ?? 0)
    agg.revenue += Number(r.fpTotalSales ?? 0) + Number(r.tpTotalSales ?? 0)
    modifiers.set(r.itemName, agg)
  }

  return {
    items,
    modifiers,
    mappedItems: new Set(itemMaps.map((m) => m.otterItemName)),
    mappedModifiers: new Set(modMaps.map((m) => m.otterSubItemName)),
    costs: new Map(
      cogs.map((c) => [
        c.itemName,
        {
          cost: Number(c._sum.lineCost ?? 0),
          revenue: Number(c._sum.salesRevenue ?? 0),
          qty: Number(c._sum.qtySold ?? 0),
        },
      ]),
    ),
    categoryRevenue,
    categoryItems,
  }
}

/** `/dashboard/menu/catalog/<slug>` — the prototype's own `catalogitem` link. */
const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

function rowsOf(data: CatalogData): CatalogRow[] {
  const build = (name: string, agg: Agg, isModifier: boolean): CatalogRow => {
    const cost = data.costs.get(name)
    const mapped = isModifier ? data.mappedModifiers.has(name) : data.mappedItems.has(name)
    const plate = cost && cost.qty > 0 ? cost.cost / cost.qty : null
    const margin = cost && cost.revenue > 0 ? 100 - (cost.cost / cost.revenue) * 100 : null
    return {
      key: `${isModifier ? "mod" : "item"}::${name}`,
      item: name,
      category: isModifier ? "Modifier" : [...agg.categories].sort().join(" · "),
      // Revenue over quantity, NOT a list price — this schema has no list
      // price, and what an item actually sold for is the more useful figure
      // anyway: it carries the discounts.
      price: agg.qty > 0 ? money(agg.revenue / agg.qty, { cents: true }) : "—",
      sold: count(agg.qty),
      soldQty: agg.qty,
      mapped,
      isModifier,
      plateCost: plate === null ? "—" : money(plate, { cents: true }),
      margin: margin === null ? "—" : pct(margin, { scaled: true }),
      href: `/dashboard/menu/catalog/${slugOf(name)}`,
    }
  }

  return [
    ...[...data.items.entries()].map(([n, a]) => build(n, a, false)),
    ...[...data.modifiers.entries()].map(([n, a]) => build(n, a, true)),
  ].sort((a, b) => b.soldQty - a.soldQty)
}

function headlineOf(data: CatalogData): CatalogHeadline {
  const items = data.items.size
  const categories = data.categoryItems.size
  const unmapped = [...data.items.keys()].filter((n) => !data.mappedItems.has(n))
  const unmappedRevenue = unmapped.reduce((t, n) => t + (data.items.get(n)?.revenue ?? 0), 0)
  const mapped = items - unmapped.length
  const mods = data.modifiers.size
  const costedMods = [...data.modifiers.keys()].filter((n) =>
    data.mappedModifiers.has(n),
  ).length

  const mappedCell: FigureProps = {
    label: "Mapped to a recipe",
    value: count(mapped),
    delta: items > 0 ? pct((mapped / items) * 100, { scaled: true }) : "no items sold",
    deltaTone: "is-flat",
  }
  const unmappedCell: FigureProps = {
    label: "Unmapped",
    value: count(unmapped.length),
    // The prototype's cell says "blocking COGS on $1,240". Ours says the
    // measured figure, which is sixty-two dollars — writing the prototype's
    // sentence over this number would make a rounding error sound like a
    // crisis.
    delta: `${money(unmappedRevenue)} of sales`,
    deltaTone: "is-down",
  }

  return {
    cells: [
      {
        label: "Items",
        value: count(items),
        delta: `${count(categories)} categories`,
        deltaTone: "is-flat",
      },
      mappedCell,
      unmappedCell,
      {
        label: "Modifiers",
        value: count(mods),
        delta: `${count(costedMods)} costed`,
        deltaTone: "is-flat",
      },
    ],
    phoneCells: [mappedCell, unmappedCell],
  }
}

function listOf(data: CatalogData): CatalogList {
  const rows = rowsOf(data)
  const unmappedItems = rows.filter((r) => !r.isModifier && !r.mapped)
  const unmappedModifiers = rows.filter((r) => r.isModifier && !r.mapped)

  return {
    rows,
    totalItems: data.items.size,
    totalModifiers: data.modifiers.size,
    unmappedItems: unmappedItems.length,
    unmappedModifiers: unmappedModifiers.length,
    // The phone leads with the unmapped MODIFIERS, not the unmapped items,
    // because that is where the gap is — and it ranks them by servings, since
    // every one that matters earns nothing.
    // SERVINGS in the value slot, not price. The prototype puts the price
    // there and its unmapped items have prices; every unmapped modifier that
    // matters here is FREE, so a price column reads `$0.00` four times over
    // and buries the only figure on the row that carries the problem.
    phoneUnmapped: unmappedModifiers.slice(0, PHONE_ROWS).map((r) => ({
      key: r.key,
      title: r.item,
      detail: r.price === "$0.00" ? "Modifier · free" : `Modifier · ${r.price}`,
      value: r.sold,
      note: "servings, no recipe",
      noteTone: "down",
      href: r.href,
    })),
    phoneTop: rows
      .filter((r) => !r.isModifier)
      .slice(0, PHONE_ROWS)
      .map((r) => ({
        key: r.key,
        title: r.item,
        detail: `${r.category} · ${r.sold} sold`,
        value: r.price,
        note: r.margin === "—" ? "not costed" : `${r.margin} margin`,
        noteTone: r.margin === "—" ? "down" : "up",
        href: r.href,
      })),
  }
}

function gapsOf(data: CatalogData): CatalogGaps {
  const rows = rowsOf(data)
  const unmappedMods = rows.filter((r) => r.isModifier && !r.mapped)
  const unmappedItems = rows.filter((r) => !r.isModifier && !r.mapped)
  // Case- and whitespace-insensitive, because that is exactly the collision
  // being detected.
  const trimmedMapped = new Set([...data.mappedModifiers].map((n) => n.trim().toLowerCase()))
  const servings = unmappedMods.reduce((t, r) => t + r.soldQty, 0)
  const free = unmappedMods.filter((r) => r.price === "—" || r.price === "$0.00")
  const itemRevenue = unmappedItems.reduce(
    (t, r) => t + (data.items.get(r.item)?.revenue ?? 0),
    0,
  )

  const items: QueueItem[] = []

  if (unmappedMods.length > 0) {
    // Three of the fifteen unmapped modifiers on this menu are the SAME name
    // as a mapped one with a leading or trailing space — " Add Sauce",
    // " Remove Cheese", "Make it a Triple ". Counting them as mapping work
    // overstates it by a fifth and points the owner at recipes when the fix is
    // a trim in the sync. They are separated here rather than silently folded
    // in, because both facts are actionable and they are actionable by
    // different people.
    const variants = unmappedMods.filter((r) => trimmedMapped.has(r.item.trim().toLowerCase()))
    const real = unmappedMods.filter((r) => !trimmedMapped.has(r.item.trim().toLowerCase()))
    items.push({
      key: "modifiers",
      tone: "bad",
      lead: count(servings),
      title: `${count(servings)} modifier servings left the kitchen with no cost`,
      body:
        `${count(real.length)} of ${count(data.modifiers.size)} modifiers carry no recipe. ` +
        `${count(free.length)} of them are FREE, so they earn nothing and never appear in ` +
        `anything ranked by revenue — but the food still went out. ` +
        `${real
          .slice(0, 3)
          .map((r) => `${r.item} ${r.sold}`)
          .join(", ")}.` +
        (variants.length > 0
          ? ` A further ${count(variants.length)} are the same name as a mapped modifier with ` +
            `a stray space, which is a trim in the sync rather than a recipe.`
          : ""),
      act: "Map the modifiers",
      href: "/dashboard/recipes",
    })
  }

  if (unmappedItems.length > 0) {
    items.push({
      key: "items",
      tone: "warn",
      lead: count(unmappedItems.length),
      title: `${count(unmappedItems.length)} items sell with no recipe behind them`,
      body:
        `${money(itemRevenue)} of sales, which is the whole of this gap. Most of these are ` +
        `single open-item rows the POS emitted once — a mapping loop will not help them, and ` +
        `merchandise has no recipe by nature.`,
      act: "See which items",
      href: "/dashboard/menu/catalog?filter=unmapped",
    })
  }

  return {
    items,
    phoneRows: items.map((q) => ({
      key: q.key,
      title: q.title,
      value: q.lead,
      note: q.key === "modifiers" ? "servings" : "items",
      noteTone: "down",
    })),
    meta:
      unmappedMods.length > 0
        ? `${count(servings)} servings · ${money(itemRevenue)} of sales`
        : "nothing unmapped",
  }
}

/**
 * The ring, and the sentence that makes it readable.
 *
 * Slices are REVENUE share — the prototype's own subject. The note is what
 * stops it lying: the largest category holds the flagship burger, and the
 * second largest is a single promotional item.
 */
function categoriesOf(data: CatalogData): CatalogCategories {
  const ranked = [...data.categoryRevenue.entries()].sort((a, b) => b[1] - a[1])
  const total = ranked.reduce((t, [, v]) => t + v, 0)
  // Fold only when folding SAVES something. Eight categories against a cap of
  // seven left exactly one in the tail, and "Other · 1" is strictly worse than
  // the category's own name — a fold that hides one row is a rename.
  const fold = ranked.length > MAX_SLICES + 1
  const head = fold ? ranked.slice(0, MAX_SLICES) : ranked
  const tail = fold ? ranked.slice(MAX_SLICES) : []
  const tailTotal = tail.reduce((t, [, v]) => t + v, 0)

  const share = (v: number) => (total > 0 ? (v / total) * 100 : 0)
  // `DonutSlice.value` IS A PERCENTAGE, the same trap the Menu hub's ring
  // documented: passing the raw revenue draws the right arcs and prints a
  // legend of dollars labelled as shares.
  const slices: DonutSlice[] = head.map(([name, v], i) => ({
    name,
    value: share(v),
    color: RING_TONES[i % RING_TONES.length],
  }))
  if (tail.length > 0) {
    slices.push({
      name: `Other · ${count(tail.length)}`,
      value: share(tailTotal),
      color: RING_TONES[RING_TONES.length - 1],
    })
  }

  const biggest = ranked[0]
  const biggestItems = biggest ? [...(data.categoryItems.get(biggest[0]) ?? [])] : []
  // The item that makes the point: the top seller inside the biggest category.
  const flagship = biggestItems
    .map((n) => ({ name: n, qty: data.items.get(n)?.qty ?? 0 }))
    .sort((a, b) => b.qty - a.qty)[0]
  const singletons = ranked
    .filter(([name]) => (data.categoryItems.get(name)?.size ?? 0) === 1)
    .map(([name]) => name)

  // Named, not counted. "1 of these categories holds a single item" makes the
  // reader go looking; naming NFL Promo — which is a fifth of all revenue —
  // is the finding itself.
  const singletonSentence =
    singletons.length === 0
      ? ""
      : singletons.length === 1
        ? `${singletons[0]} is a single item. `
        : `${singletons.slice(0, 2).join(" and ")} hold one item each. `

  const note =
    biggest && flagship
      ? `These are the POS's categories, and they do not describe the food. ` +
        `${biggest[0]} is ${pct(share(biggest[1]), { scaled: true })} of sales and holds ` +
        `${flagship.name} — ${count(flagship.qty)} sold, the biggest seller on this menu. ` +
        singletonSentence +
        `Read the ring as a picture of the filing, not of what the restaurant sells.`
      : "No categorised sales in this range."

  return {
    slices,
    centre: count(data.items.size),
    meta: "sales share · POS categories",
    note,
  }
}

/**
 * The ring's colours, in order of slice size — the Menu hub's own list, so the
 * two rings on this rail read as the same instrument. Every entry is a token
 * reference; nothing here is a colour literal.
 */
const RING_TONES = [
  "var(--mx-1)",
  "var(--mx-2)",
  "var(--mx-3)",
  "var(--mx-4)",
  "var(--ink-3)",
  "var(--line-strong)",
  "var(--gp-2)",
  "var(--gp-3)",
] as const

export function getMenuCatalogSectionPromises(
  input: MenuCatalogInput,
): StreamedSections<MenuCatalogSections> {
  const dataP = classify(() => loadCatalog(input), {
    retryAction: "retryMenuCatalog",
    isEmpty: (d) => d.items.size === 0 && d.modifiers.size === 0,
    emptyReason: "no_match",
  })

  return {
    headline: guardSection(
      dataP.then((sd) => mapReady(sd, headlineOf)),
      "retryMenuCatalog",
    ),
    list: guardSection(
      dataP.then((sd) => mapReady(sd, listOf)),
      "retryMenuCatalog",
    ),
    gaps: guardSection(
      dataP.then((sd) => mapReady(sd, gapsOf)),
      "retryMenuCatalog",
    ),
    categories: guardSection(
      dataP.then((sd) => mapReady(sd, categoriesOf)),
      "retryMenuCatalog",
    ),
  }
}

export async function getMenuCatalogSections(
  input: MenuCatalogInput,
): Promise<MenuCatalogSections> {
  return awaitSections(getMenuCatalogSectionPromises(input))
}
