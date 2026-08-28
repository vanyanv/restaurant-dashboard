import { prisma } from "@/lib/prisma"
import { count, pct } from "@/lib/counter/format"
import { toQueryBounds, type DateRange } from "@/lib/counter/date-range"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
import { empty, mapReady, ready, type SectionData } from "@/lib/counter/section-data"
import type { DonutSlice, FigureProps, QueueItem } from "@/components/counter"

/**
 * The Menu hub — `P.menuhub` (`docs/counter/counter-prototype.html:7274`).
 *
 * The smallest page in the rebuild: what the menu IS, and the three places you
 * work on it. Four figures, three links and a ring.
 *
 * ## Every cell is answerable, which is unusual here
 *
 * Labor lost two prototype cells and COGS lost two, because both asked for
 * things this schema does not publish. This page asks about the menu's own
 * shape — how many items, how many carry a recipe, how many modifiers are
 * still unmapped — and the answer to all of it is in the tables. Measured
 * 2026-08-28: 61 items across 8 categories, 78.1% blended margin, 7 unmapped
 * items, 15 uncosted modifiers of 54.
 *
 * ## THE MARGIN IS ON MENU REVENUE, AND IT WILL NOT MATCH COGS
 *
 * `blendedMargin` is `DailyCogsItem.lineCost` over
 * `DailyCogsItem.salesRevenue` — the menu's OWN revenue, item by item. The
 * COGS page divides the same cost by the statement's Total Sales and gets a
 * food cost of 28.4%, implying a 71.6% margin. **78.1% against 71.6%: seven
 * and a half points apart, and both correct.**
 *
 * They answer different questions. A menu page asks what an item is worth when
 * it sells — that is its own revenue. A cost page asks what the food line took
 * out of the business — that is Total Sales, because Total Sales is what the
 * P&L divides by. Ruling C-R1 forbids the menu basis ON THE COGS PAGE and says
 * nothing about this one.
 *
 * The strip cell therefore says "of menu revenue" in its own delta, and the
 * section note says the rest, exactly as the COGS items table already says
 * "these rows do not sum to the figure above, and are not meant to". A reader
 * who spots the gap must find the reason on the page, not in a commit.
 *
 * ## "The menu" is what the POS sold, not a catalogue
 *
 * Every count here is over the range's `OtterMenuItem` rows. An item nobody
 * ordered is not on this menu however long it has sat in a catalogue, and an
 * item sold once is. That is the only definition this schema can defend, and
 * it is the one the ring, the item count and both mapping gaps all use.
 */

/** One slice of the category ring, plus the count behind it. */
export interface MenuCategory {
  category: string
  items: number
}

export interface MenuHubHeadline {
  /** Four cells: Items · Blended margin · Unmapped · Uncosted modifiers. */
  cells: FigureProps[]
  /** Two: Blended margin · Unmapped. */
  phoneCells: FigureProps[]
  /** "61 items · 7 unmapped" — the phone's `.msub`. */
  sub: string
}

export interface MenuWorkSection {
  items: QueueItem[]
  /** The phone's `.mlist`, three rows of [title, body, ""]. */
  phoneRows: Array<{ key: string; cells: [string, string, string]; href: string }>
}

export interface MenuCategoriesSection {
  slices: DonutSlice[]
  /** The item count, drawn in the hole — the prototype's `'84'`. */
  center: string
  meta: string
  note: string
}

export interface MenuHubSections {
  headline: SectionData<MenuHubHeadline>
  work: SectionData<MenuWorkSection>
  categories: SectionData<MenuCategoriesSection>
}

export interface MenuHubInput {
  range: DateRange
  storeId: string | null
  accountId: string
}

/**
 * The ring's colours, in the order `channels.ts` fixes its own bands: a
 * category keeps its colour as the mix moves, so a reader is not re-learning
 * the legend every week. `--line-strong` is last and deliberately neutral —
 * it is what a long tail gets, not a judgement about it.
 */
const SLICE_COLOURS = [
  "var(--mx-1)",
  "var(--mx-2)",
  "var(--mx-3)",
  "var(--mx-4)",
  "var(--ink-3)",
  "var(--line-strong)",
] as const

/** Slices drawn by name; the rest folded into one neutral wedge. */
const NAMED_SLICES = 5

interface MenuCounts {
  items: number
  categories: MenuCategory[]
  /** Items the POS emitted under more than one category in the window. */
  multiCategory: number
  /** Items that are ONLY ever uncategorized — the real gap, not the duplicates. */
  onlyUncategorized: number
  unmappedItems: number
  modifiers: number
  unmappedModifiers: number
  cost: number
  revenue: number
}

async function loadMenuCounts(input: MenuHubInput): Promise<MenuCounts> {
  const { range, storeId, accountId } = input
  const { startDate, endDate } = toQueryBounds(range)

  // Scoped through the account first, the same rule `channel-mix.ts` states at
  // length: without it a null `storeId` would mean every store in the database.
  const stores = await prisma.store.findMany({
    where: { accountId, isActive: true, ...(storeId ? { id: storeId } : {}) },
    select: { id: true },
  })
  if (stores.length === 0) {
    return {
      items: 0,
      categories: [],
      multiCategory: 0,
      onlyUncategorized: 0,
      unmappedItems: 0,
      modifiers: 0,
      unmappedModifiers: 0,
      cost: 0,
      revenue: 0,
    }
  }
  const storeIds = stores.map((s) => s.id)
  const where = { storeId: { in: storeIds }, date: { gte: startDate, lte: endDate } }

  const [sold, mods, mappedItems, mappedMods, cogs] = await Promise.all([
    prisma.otterMenuItem.findMany({
      where: { ...where, isModifier: false },
      select: { itemName: true, category: true },
      distinct: ["itemName", "category"],
    }),
    prisma.otterMenuItem.findMany({
      where: { ...where, isModifier: true },
      select: { itemName: true },
      distinct: ["itemName"],
    }),
    prisma.otterItemMapping.findMany({
      where: { storeId: { in: storeIds } },
      select: { otterItemName: true },
    }),
    prisma.otterSubItemMapping.findMany({
      where: { storeId: { in: storeIds } },
      select: { otterSubItemName: true },
    }),
    prisma.dailyCogsItem.aggregate({
      where,
      _sum: { lineCost: true, salesRevenue: true },
    }),
  ])

  const mappedItemNames = new Set(mappedItems.map((m) => m.otterItemName))
  const mappedModNames = new Set(mappedMods.map((m) => m.otterSubItemName))

  // One row per (itemName, category), so an item sold under two categories is
  // one item and two category rows. The item COUNT dedupes by name; the ring
  // counts what each category carries.
  const names = new Set(sold.map((s) => s.itemName))
  const byCategory = new Map<string, Set<string>>()
  for (const s of sold) {
    // A blank category is "Uncategorized" and is drawn as its own slice, never
    // folded away — measured, it is the SECOND largest category on this menu
    // at 11 of 61 items, and a ring that hides its own biggest data gap is
    // decoration rather than a reading.
    const key = s.category?.trim() ? s.category : "Uncategorized"
    const set = byCategory.get(key) ?? new Set<string>()
    set.add(s.itemName)
    byCategory.set(key, set)
  }

  // 7 items in the measured window carry two categories, and FIVE of those
  // pair a real category with "Uncategorized" — the POS emits the same item
  // sometimes with a category and sometimes without. So the Uncategorized
  // slice is not 11 uncategorised items; it is 11 rows, six of which are the
  // only home their item has. Both numbers go in the note, because "11 items
  // have no category" would overstate the gap by nearly half.
  const catsPerItem = new Map<string, Set<string>>()
  for (const s of sold) {
    const key = s.category?.trim() ? s.category : "Uncategorized"
    const set = catsPerItem.get(s.itemName) ?? new Set<string>()
    set.add(key)
    catsPerItem.set(s.itemName, set)
  }
  const multiCategory = [...catsPerItem.values()].filter((v) => v.size > 1).length
  const onlyUncategorized = [...catsPerItem.values()].filter(
    (v) => v.size === 1 && v.has("Uncategorized"),
  ).length

  return {
    items: names.size,
    multiCategory,
    onlyUncategorized,
    categories: [...byCategory.entries()]
      .map(([category, set]) => ({ category, items: set.size }))
      .sort((a, b) => b.items - a.items || a.category.localeCompare(b.category)),
    unmappedItems: [...names].filter((n) => !mappedItemNames.has(n)).length,
    modifiers: mods.length,
    unmappedModifiers: mods.filter((m) => !mappedModNames.has(m.itemName)).length,
    cost: cogs._sum.lineCost ?? 0,
    revenue: cogs._sum.salesRevenue ?? 0,
  }
}

/** `cost / revenue` as a MARGIN percent, or `null` with no revenue — never `0`. */
export function blendedMargin(cost: number, revenue: number): number | null {
  if (!(revenue > 0)) return null
  return 100 - (cost / revenue) * 100
}

function headline(c: MenuCounts): MenuHubHeadline {
  const margin = blendedMargin(c.cost, c.revenue)
  const marginCell: FigureProps = {
    label: "Blended margin",
    value: margin === null ? "—" : pct(margin, { scaled: true }),
    // The denominator, in the cell itself. A margin whose base is not named is
    // the defect this project has now fixed on four pages.
    delta: "of menu revenue",
    deltaTone: "is-flat",
  }
  const unmapped: FigureProps = {
    label: "Unmapped",
    value: count(c.unmappedItems),
    delta: `of ${count(c.items)} sold · no recipe`,
    deltaTone: c.unmappedItems > 0 ? "is-down" : "is-flat",
  }

  return {
    cells: [
      {
        label: "Items",
        value: count(c.items),
        delta: `${count(c.categories.length)} categories`,
        deltaTone: "is-flat",
      },
      marginCell,
      unmapped,
      {
        label: "Uncosted modifiers",
        value: count(c.unmappedModifiers),
        delta: `of ${count(c.modifiers)} sold`,
        deltaTone: c.unmappedModifiers > 0 ? "is-down" : "is-flat",
      },
    ],
    // NOT a slice of `cells`: the phone's two are the two that need acting on,
    // and a page slicing by position gets the wrong pair the moment one cell is
    // withheld.
    phoneCells: [marginCell, unmapped],
    sub: `${count(c.items)} items · ${count(c.unmappedItems)} unmapped`,
  }
}

/**
 * The three places the menu is worked on. Derived from `nav.ts`'s own
 * destinations rather than hardcoded here, so a renamed route cannot leave
 * this page pointing at a page that moved.
 */
const WORK: ReadonlyArray<{ key: string; lead: string; title: string; body: string; act: string; href: string }> = [
  {
    key: "catalog",
    lead: "A",
    title: "Catalog",
    body: "Everything the POS sells, with the recipe behind each item and what it is worth.",
    act: "Open catalog",
    href: "/dashboard/menu/catalog",
  },
  {
    key: "recipes",
    lead: "B",
    title: "Recipes",
    body: "What each plate is made of, what it costs, and which are still unconfirmed.",
    act: "Open recipes",
    href: "/dashboard/recipes",
  },
  {
    key: "menu-profit",
    lead: "C",
    title: "Menu profit",
    body: "Volume against margin, and the groups worth acting on.",
    act: "Open menu profit",
    href: "/dashboard/menu-profit",
  },
]

function work(): MenuWorkSection {
  return {
    items: WORK.map((w) => ({
      key: w.key,
      // `good` on all three: these are destinations, not verdicts. The
      // prototype tones them the same way and for the same reason — a
      // navigation card coloured like a warning reads as a problem.
      tone: "good" as const,
      lead: w.lead,
      title: w.title,
      body: w.body,
      act: w.act,
      href: w.href,
    })),
    phoneRows: WORK.map((w) => ({
      key: w.key,
      cells: [w.title, w.body.split(",")[0], ""] as [string, string, string],
      href: w.href,
    })),
  }
}

function categories(c: MenuCounts, rangeLabel: string): MenuCategoriesSection {
  const named = c.categories.slice(0, NAMED_SLICES)
  const rest = c.categories.slice(NAMED_SLICES)
  const restItems = rest.reduce((t, r) => t + r.items, 0)

  /*
   * `DonutSlice.value` IS A PERCENTAGE, not the count behind it. The arc is
   * drawn against the sum of every slice, so a raw count draws the ring
   * correctly either way — but the legend prints `pct(value, { scaled: true })`
   * beside each name, and a raw count there renders "23.0%" for 23 items out
   * of 61. Caught on the first render: the legend read 23.0 / 11.0 / 10.0 /
   * 10.0 / 5.0 / 9.0, which is the count column with a percent sign on it and
   * sums to 68 rather than 100.
   *
   * The COGS ring got this right by accident — its values were already
   * percentages of cost. This one had to convert.
   */
  // Divided by the SUM OF THE SLICES, not by the item count. Seven items carry
  // two categories, so the counts total 68 against 61 items — dividing by 61
  // gave a legend summing to 111.5%, which is what the first render showed.
  // The arc is already drawn against the slice sum, so this is also the only
  // divisor that makes the legend agree with the ring beside it.
  const placements = c.categories.reduce((t, r) => t + r.items, 0) || 1
  const share = (n: number) => (n / placements) * 100

  const slices: DonutSlice[] = named.map((r, i) => ({
    name: r.category,
    value: share(r.items),
    color: SLICE_COLOURS[i],
  }))
  if (restItems > 0) {
    slices.push({
      name: `Other · ${count(rest.length)}`,
      value: share(restItems),
      color: SLICE_COLOURS[SLICE_COLOURS.length - 1],
    })
  }

  const uncategorized = c.categories.find((r) => r.category === "Uncategorized")
  const lead = c.categories[0]

  return {
    slices,
    // The prototype's centre is the item COUNT, not a dollar figure — this ring
    // counts items, and a ring by cost is a different picture entirely (Drinks
    // is 23 of 61 items here and 7.1% of cost on the COGS page).
    center: count(c.items),
    meta: `${count(c.categories.length)} categories · ${rangeLabel}`,
    note:
      `${lead ? `${lead.category} is the largest at ${count(lead.items)} of ${count(c.items)} items. ` : ""}` +
      (uncategorized
        ? `${count(uncategorized.items)} rows carry no category, but only ` +
          `${count(c.onlyUncategorized)} items are uncategorized everywhere — the POS emits ` +
          `some items with a category and sometimes without, so the rest appear twice. ` +
          `They are drawn as their own slice rather than folded into "Other": a ring that ` +
          `hides the menu's biggest data gap behind a neutral wedge is decoration. `
        : "") +
      `${count(c.multiCategory)} items carry more than one category, so the slices total ` +
      `${count(placements)} placements across ${count(c.items)} items and each share is of ` +
      `placements, not of items. This ring counts ITEMS, not money: a category with many ` +
      `cheap items is a wide slice here and a narrow one on the cost page.`,
  }
}

export function getMenuHubSectionPromises(
  input: MenuHubInput,
  rangeLabel: string,
): StreamedSections<MenuHubSections> {
  const countsP = classify(() => loadMenuCounts(input), {
    retryAction: "retryMenu",
    isEmpty: (c) => c.items === 0,
    // "No rows fall inside the current filters and date range. Widen either to
    // see figures." — which is the true cause of an empty menu window, and it
    // tells the reader what to do about it.
    emptyReason: "no_match",
  })

  return {
    headline: guardSection(
      countsP.then((sd) => mapReady(sd, headline)),
      "retryMenu",
    ),
    // The three destinations do not depend on the data and cannot fail with
    // it: a reader whose counts did not load can still open the catalog.
    work: Promise.resolve(ready(work())),
    categories: guardSection(
      countsP.then((sd) =>
        mapReady(sd, (c) =>
          c.categories.length === 0
            ? // Not a ring drawn over nothing (A-R12). The reason names the
              // WINDOW rather than the table, because an empty window is the
              // likely cause and it is the one a reader can act on.
              (empty("no_match") as never)
            : categories(c, rangeLabel),
        ),
      ),
      "retryMenu",
    ),
  }
}

export async function getMenuHubSections(
  input: MenuHubInput,
  rangeLabel: string,
): Promise<MenuHubSections> {
  return awaitSections(getMenuHubSectionPromises(input, rangeLabel))
}
