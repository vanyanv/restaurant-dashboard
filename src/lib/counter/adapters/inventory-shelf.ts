import { cache } from "react"
import { prisma } from "@/lib/prisma"
import { UNCONVERTED_UNIT } from "@/lib/inventory/anchor-line"
import {
  COUNT_AREAS,
  areaLabel,
  describeShelf,
  layersFor,
  shelfTotal,
  showQty,
  unconverted,
  valuesFit,
} from "@/lib/counter/count-layers"
import { countedAgo } from "@/lib/counter/counted-ago"
import { DEFAULT_COVER_DAYS } from "@/lib/counter/draft-orders"
import { plainName } from "@/lib/counter/plain-names"
import {
  ALL_STORES,
  SHELF_STATE_LABEL,
  orderSoonTitle,
  shelfCoverage,
  shelfState,
  stateCounts,
  toOrderNow,
  type ShelfCoverage,
  type ShelfState,
} from "@/lib/counter/shelf-state"
import {
  countItems,
  dayLabel,
  loadLatestGap,
  loadWeekWaste,
  type ItemRow,
  type LatestGap,
} from "./count"
import { STALE_COUNT_DAYS, loadStoreDraft, type StoreDraft } from "./draft-orders"
import { classify, guardSection, type StreamedSections } from "./types"
import type { SectionData } from "@/lib/counter/section-data"

/**
 * Inventory — the Overview, the Shelf tab and the store switcher.
 *
 * One read per store and request (`loadStoreLines`, cached) builds the shelf:
 * a state for each line of the count list. The "N to order now" on the
 * switcher, on the Overview headline and on the store cards is `toOrderNow`
 * over those lines; the blocks of the shelf map and the rows of the Shelf tab
 * are the same lines; "X of Y lines valued" is `shelfCoverage` over them.
 * Nothing is worked out twice. The state rules are `shelfState` in
 * `shelf-state.ts`.
 *
 * WHICH COUNT. Each item is read from its LATEST finished count line, not
 * from the store's last count alone. Finishing a count with a few lines is
 * allowed ("anything you skipped keeps its older number"), and the draft
 * order rolls each item forward from its own latest line; the shelf does the
 * same, so a three-line recount does not turn the other lines into "Not
 * counted" and the Overview keeps agreeing with the Order tab. A line carried
 * from an older count says which. With "Skip this week's count" on, both read
 * only the counts the draft read (`StoreDraft.countsBefore`).
 *
 * It gathers and never invents. The draft amount, vendor, run-out day and
 * "order by" day are the Order tab's own (`loadStoreDraft`); "thrown out" is
 * the Waste tab's (`loadWeekWaste`); "went missing" is the Report tab's
 * (`loadLatestGap`). A line the app cannot value has `dollars: null` and says
 * why — it is never added in as $0.
 *
 * Tenancy: stores and count items are read by `accountId`; every store-owned
 * row (counts, lines, waste) goes through `store: { accountId }`. The page
 * passes `accountId` in from the session.
 */

const DAY_MS = 86_400_000
/** An open count older than this is not resumed (the same cutoff the walk uses). */
const OPEN_COUNT_DAYS = 7
/** The days-left bar's full span. */
const BAR_DAYS = 7

export type ShelfLine = {
  /** The count item (one stop of the walk). */
  id: string
  ingredientId: string
  name: string
  area: string
  state: ShelfState
  /** "Out", "Order today", "Order by Thu, Nov 12", "Fine"… */
  stateText: string
  /** The boxes as typed: "2 Cases + 3 Bags". Null when there are none to show. */
  typed: string | null
  /** The same shelf in one unit: "70 lb". Null when not counted. */
  amount: string | null
  /** Null when the line has no value yet. Never $0 for an unknown. */
  dollars: number | null
  /** Why a counted line has no value: "3 Trays: no size set yet", "No price on file yet". */
  notValued: string | null
  /** The same reason as a kind, for grouping: a box with no size, no price on file, or a size or box changed since the count. */
  notValuedWhy: "size" | "price" | "boxes" | null
  /** On hand rolled forward from the count reads below zero. */
  belowZero: boolean
  /** The day of the count these numbers are from, when it is older than the store's last one: "Tue, Nov 3". */
  from: string | null
  /** Days until it runs out, for the bar. Null when nothing uses it or it can't be read. */
  daysLeft: number | null
  /** Where on the bar an order has to be placed to arrive in time. */
  orderAt: number | null
  /** "Runs out Fri, Nov 14" / "Lasts 60+ days". */
  runsOut: string | null
  /** The draft order's amount: "3 cases". Null when there is no draft line. */
  order: string | null
  /** The draft's "Order today" / "Order by Thu, Nov 12". */
  when: string | null
  vendor: string | null
  /** Plain sentences on why the row reads the way it does, joined with ". ". */
  note: string | null
  /**
   * The count before the one this line shows: its day and what was typed for
   * this stop then ("4 Cases + 2 Chubs"). Null when the item has no earlier
   * finished count, or nothing of it can be shown for this stop.
   */
  last: { day: string; typed: string } | null
}

export type LastCount = {
  day: string
  ago: string
  stale: boolean
  /** Lines whose numbers are carried from a count before this one. */
  older: number
}

export type StoreShelf = {
  id: string
  name: string
  /** The newest finished count the shelf reads. Null: none. */
  lastCount: LastCount | null
  /**
   * "Skip this week's count" is on: the shelf, like the draft order, is read
   * from the counts taken before the last 7 days.
   */
  skip: boolean
  /** Lines saved on a count that is still open, or null when none is. */
  openCount: number | null
  lines: ShelfLine[]
  /** Null when the store has no finished count: "not counted", never 0. */
  toOrder: number | null
  counts: Record<ShelfState, number>
  coverage: ShelfCoverage
  /** "Order by Thu, Nov 12" when every order-soon line shares the day, else "Order soon". */
  soonTitle: string
  /** Vendors on the draft order, as the Order tab groups them. */
  draftVendors: number
  missing: LatestGap | null
  /** Thrown out, last 7 days. `dollars` is null when no entry has a price: an unknown, never $0. */
  waste: { dollars: number | null; entries: number; unpriced: number }
}

export type SwitchStore = { id: string; name: string; toOrder: number | null }

export type SwitcherData = {
  stores: SwitchStore[]
  /** Σ of the counted stores' `toOrder`. Null when no store is counted. */
  total: number | null
}

export type ShelfData = SwitcherData & {
  /** "all", or the id of the store shown. */
  view: string
  /** Every store on "all", otherwise the one shown. */
  shelves: StoreShelf[]
  areas: Array<{ id: string; label: string }>
  barDays: number
}

export type ShelfSections = { shelf: SectionData<ShelfData | null> }
export type SwitcherSections = { switcher: SectionData<SwitcherData | null> }

export type CountLine = {
  canonicalIngredientId: string
  qtyInRecipeUnit: number
  nativeUnit: string | null
  breakdown: unknown
  /** When the count this line is on was taken. */
  countedAt: Date
}

function stopValues(line: CountLine, itemId: string): number[] | null {
  const b = line.breakdown
  if (!b || typeof b !== "object" || Array.isArray(b)) return null
  const vals = (b as Record<string, unknown>)[itemId]
  return Array.isArray(vals) ? vals.map((n) => (typeof n === "number" ? n : 0)) : null
}

/** The boxes of one stop in words. An empty shelf reads as its boxes at zero ("0 Cases + 0 Trays"), the way the sheet has it. */
function typedOf(layers: ReturnType<typeof layersFor>, vals: number[]): string {
  return shelfTotal(layers, vals) > 0 || unconverted(layers, vals) ? describeShelf(layers, vals) : layers.map((l) => `0 ${l.label}`).join(" + ")
}

/** One store's lines, in the sheet's order. Pure: everything it reads is passed in. */
export function buildShelfLines(input: {
  items: ItemRow[]
  /** Each item's latest finished count line, among the counts the draft read. */
  latest: Map<string, CountLine>
  /** Each item's finished count line before that one, for "last count". */
  previous?: Map<string, CountLine>
  /** When the newest of those counts was taken. Null when there is none. */
  lastCountAt: Date | null
  /** "Skip this week's count" is on: says why a line counted only this week reads not counted. */
  skip?: boolean
  draft: Pick<StoreDraft, "stock" | "vendors" | "reads">
}): ShelfLine[] {
  const { latest, lastCountAt, draft } = input
  // No recipe unit: it cannot be counted at all, and the walk leaves it out too.
  const items = input.items.filter((it) => it.canonicalIngredient.recipeUnit)
  const stockBy = new Map(draft.stock.map((r) => [r.id, r]))
  const draftBy = new Map(draft.vendors.flatMap((v) => v.rows.map((r) => [r.id, { row: r, vendor: v.vendor }] as const)))
  const layersOf = (it: ItemRow) => layersFor(it.layers, it.canonicalIngredient.recipeUnit ?? "")

  const firstStop = new Map<string, ItemRow>()
  // Per counted item: the stops whose saved boxes still fit the boxes they
  // have today, what those boxes add up to at TODAY's sizes, and whether any
  // of them holds a box that has no size today.
  const reading = new Map<string, { fits: Set<string>; sum: number; unsizedNow: boolean }>()
  for (const it of items) {
    const id = it.canonicalIngredientId
    if (!firstStop.has(id)) firstStop.set(id, it)
    const line = latest.get(id)
    if (!line) continue
    const r = reading.get(id) ?? { fits: new Set<string>(), sum: 0, unsizedNow: false }
    reading.set(id, r)
    const layers = layersOf(it)
    const vals = stopValues(line, it.id)
    if (!valuesFit(layers, vals)) continue
    r.fits.add(it.id)
    r.sum += shelfTotal(layers, vals)
    if (unconverted(layers, vals)) r.unsizedNow = true
  }
  /**
   * The boxes, at today's sizes, still add up to the quantity the count saved.
   * They stop doing so when a size or a box is edited in Sizes & list after
   * the count (2 cases of 30 lb saved as 60; the case is now 60 lb), when a
   * stop is taken off the list, or when a box that had no size is given one.
   * The saved line is what the draft order rolls forward from, so the shelf
   * never shows an amount that disagrees with it.
   */
  const addsUp = (line: CountLine, r: { fits: Set<string>; sum: number }) =>
    r.fits.size > 0 && Math.abs(r.sum - line.qtyInRecipeUnit) <= Math.max(0.01, Math.abs(line.qtyInRecipeUnit) * 0.001)

  /**
   * The count before, read the same way: its boxes, at today's sizes, still
   * add up to the quantity that count saved. When a stop's boxes were swapped
   * since (3 Cases of 30 lb then, one "Bags" box of 5 lb now) the numbers
   * still fit the new boxes by position, and would read "3 Bags". They no
   * longer add up, so the saved total is shown instead, once.
   */
  const beforeAddsUp = new Map<string, boolean>()
  if (input.previous) {
    const sums = new Map<string, number>()
    for (const it of items) {
      const id = it.canonicalIngredientId
      const b = input.previous.get(id)
      if (!b) continue
      const vals = stopValues(b, it.id)
      const layers = layersOf(it)
      if (valuesFit(layers, vals)) sums.set(id, (sums.get(id) ?? 0) + shelfTotal(layers, vals))
    }
    for (const [id, sum] of sums) {
      const q = input.previous.get(id)!.qtyInRecipeUnit
      beforeAddsUp.set(id, Math.abs(sum - q) <= Math.max(0.01, Math.abs(q) * 0.001))
    }
  }

  return items.map((it): ShelfLine => {
    const ing = it.canonicalIngredient
    const ingId = it.canonicalIngredientId
    const unit = ing.recipeUnit ?? ""
    const layers = layersOf(it)
    const line = latest.get(ingId) ?? null
    const r = reading.get(ingId)
    const stock = stockBy.get(ingId) ?? null
    const drafted = draftBy.get(ingId) ?? null
    const read = draft.reads.get(ingId) ?? null
    const vendor = drafted?.vendor ?? read?.vendor ?? null
    // Saved with a box that had no size: the saved total is only a floor, and
    // the draft order starts from the count before this one.
    const partial = line?.nativeUnit === UNCONVERTED_UNIT

    // What this stop itself holds on that count.
    let stop: { qty: number; typed: string | null; unsized: string | null } | null = null
    // "first" / "other": the boxes no longer add up to the saved line (or it
    // was counted without boxes), so the saved total is shown once, on the
    // item's first stop.
    let carried: "first" | "other" | null = null
    // The saved line is a floor AND the boxes no longer add up to it: nothing whole to show.
    let recount = false
    // The item reads, but this stop has no numbers on that count.
    let absent = false
    if (line && r) {
      const vals = r.fits.has(it.id) ? stopValues(line, it.id) ?? [] : null
      const today = vals ? shelfTotal(layers, vals) : 0
      const unsized = vals ? unconverted(layers, vals) : null
      const typed = vals ? typedOf(layers, vals) : null
      if (addsUp(line, r)) {
        stop = { qty: today, typed, unsized }
        absent = !vals
      } else if (partial) {
        stop = { qty: 0, typed, unsized }
        recount = true
      } else {
        carried = firstStop.get(ingId)?.id === it.id ? "first" : "other"
        stop = { qty: carried === "first" ? line.qtyInRecipeUnit : 0, typed, unsized: null }
      }
    }
    const firstArea = areaLabel(firstStop.get(ingId)?.area ?? "")
    // Counted on the older count screens: one total and no boxes at all.
    const noBoxes = carried !== null && r?.fits.size === 0

    const state = shelfState({
      counted: line ? { qty: line.qtyInRecipeUnit, unsized: partial } : null,
      onHandNow: read?.onHand ?? null,
      flow: stock?.status ?? null,
    })
    // The draft read it from the count before the one with the unsized box.
    const fromOlder = partial && (state === "order_now" || state === "order_soon" || state === "ok")
    // Less than nothing on hand: an empty shelf with sales since, a count that
    // was short, or more logged off than was there.
    const belowZero = (state === "out" || (state === "cant_tell" && !partial)) && read?.onHand != null && read.onHand < 0

    const cost = ing.costPerRecipeUnit
    let dollars: number | null = null
    let notValuedWhy: ShelfLine["notValuedWhy"] = null
    let notValued: string | null = null
    if (stop?.unsized) {
      notValuedWhy = "size"
      notValued = `${stop.unsized}: no size set yet`
    } else if (recount) {
      notValuedWhy = "boxes"
      notValued = "A size or a box was changed after this count"
    } else if (stop && cost == null) {
      notValuedWhy = "price"
      notValued = "No price on file yet"
    } else if (stop) {
      // A stop whose amount is carried on another line is $0 of a known total, not an unknown.
      dollars = stop.qty * cost!
    }

    const order = drafted ? drafted.row.order : null
    const from = vendor ? ` from ${vendor}` : ""
    const notes: string[] = []
    if (!line) {
      notes.push(input.skip ? "Not on a count from before the last 7 days" : lastCountAt ? "Never on a finished count" : "No finished count yet")
    } else {
      if (carried === "other") notes.push(noBoxes ? `Counted with ${firstArea}` : `A size or a box was changed after this count: its amount is with ${firstArea}`)
      else if (carried === "first" && !noBoxes) notes.push("A size or a box was changed after this count, so this is the total saved then")
      else if (absent) notes.push("Not on this count: added or changed since")
      if (state === "out") {
        if (belowZero) notes.push("On hand reads below zero since the count. A delivery may not be invoiced yet. Count it again")
        else if (order) notes.push(`Draft order: ${order}${from}`)
        else if (stock) notes.push("No draft yet")
        else {
          const why = `nothing on the menu uses it, so the app can't size an order${vendor ? `. Last${from}` : ""}`
          notes.push(line.qtyInRecipeUnit > 0 ? `Everything counted has been logged off since. No draft: ${why}` : `No draft yet: ${why}`)
        }
      } else if ((state === "order_now" || state === "order_soon") && order) {
        notes.push(`Draft order: ${order}${from}`)
      }
      if (partial) {
        // A box with no size on this very stop is already said by `notValued`.
        if (stop?.unsized) {
          if (fromOlder) notes.push("The latest count has a box with no size yet")
        } else if (r?.unsizedNow) notes.push("Another shelf of this item has a box with no size yet")
        // Every box of the item has a size today, so the count can be redone whole.
        else notes.push(recount ? "Sized after this count. Count it again" : "This count had a box with no size. Count it again")
        if (fromOlder) notes.push(read?.countedAt ? `Read from the ${dayLabel(read.countedAt)} count` : "Read from the count before")
      } else if (state === "cant_tell") {
        notes.push(belowZero ? "On hand reads below zero. Count it again" : "No count the draft order can start from")
      }
    }

    // The count before: what was typed for this stop, as typed. Only the
    // boxes are shown, never an amount worked out from today's sizes. A count
    // saved as one total (no boxes) shows that total, once, on the first stop.
    const before = line ? input.previous?.get(ingId) ?? null : null
    let last: ShelfLine["last"] = null
    if (before) {
      const vals = stopValues(before, it.id)
      const day = dayLabel(before.countedAt)
      const whole = before.nativeUnit !== UNCONVERTED_UNIT
      // Today's box names are put on the saved numbers only while they are
      // still the boxes that count was typed in (see `beforeAddsUp`).
      if (valuesFit(layers, vals) && (!whole || beforeAddsUp.get(ingId))) last = { day, typed: typedOf(layers, vals) }
      else if (whole && (before.breakdown == null || beforeAddsUp.get(ingId) === false) && firstStop.get(ingId)?.id === it.id) {
        last = { day, typed: showQty(before.qtyInRecipeUnit, unit).trim() }
      }
    }

    const readable = state === "order_now" || state === "order_soon" || state === "ok"
    return {
      id: it.id,
      ingredientId: ingId,
      name: plainName(ing.name),
      area: it.area,
      state,
      stateText:
        state === "order_soon" && drafted ? drafted.row.when
        : state === "cant_tell" && stop?.unsized ? "Not valued yet"
        : state === "in_stock" ? "In stock"
        : SHELF_STATE_LABEL[state],
      typed: stop?.typed ?? null,
      // Only where it says more than the boxes do: not for an empty shelf, nor
      // for one box that is already the unit ("3 Rolls" is 3 roll).
      // The saved total where that is what the line shows.
      amount: stop && stop.qty > 0 && (carried === "first" || !(layers.length === 1 && layers[0].per === 1)) ? showQty(stop.qty, unit).trim() : null,
      dollars,
      notValued,
      notValuedWhy,
      belowZero,
      from: line && lastCountAt && line.countedAt.getTime() < lastCountAt.getTime() ? dayLabel(line.countedAt) : null,
      daysLeft: readable ? (stock?.daysLeft ?? null) : null,
      orderAt: readable ? (stock?.orderAt ?? null) : null,
      runsOut: readable ? (stock?.runsOut ?? null) : null,
      order,
      when: drafted?.row.when ?? null,
      vendor,
      note: notes.length ? notes.join(". ") : null,
      last,
    }
  })
}

/** The account's active stores, once per request. */
export const loadStores = cache((accountId: string) =>
  prisma.store.findMany({
    where: { accountId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  }),
)

const loadItems = cache((accountId: string) => countItems(accountId))

export type StoreLines = Pick<StoreShelf, "lines" | "lastCount" | "skip" | "toOrder" | "draftVendors"> & {
  /**
   * Each item's latest finished count line, as saved. Server-side only (the
   * one-item page reads the saved quantity from it); it is not sent to a page.
   */
  latest: Map<string, CountLine>
}

/**
 * One store's lines and its "N to order now", once per request: all the store
 * switcher needs, and the part of the full shelf everything else hangs on.
 * Three reads: the draft order (the Order tab's own, for the same "how long
 * should it last"), a light pass over the store's finished count lines to
 * find each item's latest, and those lines themselves.
 *
 * `coverDays` is the Order tab's pick. Everywhere else it is the default; on
 * the Order tab the switcher is given the reader's own, so its "N to order"
 * is counted from the draft the page under it shows.
 */
export const loadStoreLines = cache(async (accountId: string, storeId: string, coverDays: number): Promise<StoreLines> => {
  const now = new Date()
  const finished = { storeId, store: { accountId }, status: "COMPLETED" as const }
  const [draft, items, scan] = await Promise.all([
    loadStoreDraft(accountId, storeId, coverDays),
    loadItems(accountId),
    prisma.stockCountLine.findMany({
      where: { stockCount: finished },
      orderBy: { stockCount: { countedAt: "desc" } },
      select: { id: true, canonicalIngredientId: true, stockCount: { select: { countedAt: true } } },
    }),
  ])
  // Newest first, so the first line per item wins: the draft's rule. With the
  // skip on, the counts the draft left out are left out here too.
  // The line after it per item is the count before: "last count" on a row.
  const latestId = new Map<string, string>()
  const previousId = new Map<string, string>()
  let lastCountAt: Date | null = null
  for (const l of scan) {
    const at = l.stockCount.countedAt
    if (draft.countsBefore && at.getTime() >= draft.countsBefore.getTime()) continue
    lastCountAt ??= at
    if (!latestId.has(l.canonicalIngredientId)) latestId.set(l.canonicalIngredientId, l.id)
    else if (!previousId.has(l.canonicalIngredientId)) previousId.set(l.canonicalIngredientId, l.id)
  }
  const rows = latestId.size
    ? await prisma.stockCountLine.findMany({
        where: { id: { in: [...latestId.values(), ...previousId.values()] }, stockCount: finished },
        select: {
          id: true, canonicalIngredientId: true, qtyInRecipeUnit: true, nativeUnit: true, breakdown: true,
          stockCount: { select: { countedAt: true } },
        },
      })
    : []
  const latest = new Map<string, CountLine>()
  const previous = new Map<string, CountLine>()
  for (const l of rows) {
    const line: CountLine = { canonicalIngredientId: l.canonicalIngredientId, qtyInRecipeUnit: l.qtyInRecipeUnit, nativeUnit: l.nativeUnit, breakdown: l.breakdown, countedAt: l.stockCount.countedAt }
    if (latestId.get(l.canonicalIngredientId) === l.id) latest.set(l.canonicalIngredientId, line)
    else if (previousId.get(l.canonicalIngredientId) === l.id) previous.set(l.canonicalIngredientId, line)
  }
  const lines = buildShelfLines({ items, latest, previous, lastCountAt, skip: draft.skip, draft })
  return {
    latest,
    lines,
    lastCount: lastCountAt
      ? {
          day: dayLabel(lastCountAt),
          ago: countedAgo(lastCountAt, now),
          stale: now.getTime() - lastCountAt.getTime() > STALE_COUNT_DAYS * DAY_MS,
          older: lines.filter((l) => l.from !== null).length,
        }
      : null,
    skip: draft.skip,
    toOrder: lastCountAt ? toOrderNow(lines) : null,
    draftVendors: draft.vendors.length,
  }
})

/** The full shelf of one store: its lines, plus the open count and the two money figures borrowed from Waste and Report. */
async function loadStoreShelf(accountId: string, store: { id: string; name: string }): Promise<StoreShelf> {
  const [base, open, waste, missing] = await Promise.all([
    loadStoreLines(accountId, store.id, DEFAULT_COVER_DAYS),
    prisma.stockCount.findFirst({
      where: {
        storeId: store.id,
        store: { accountId },
        status: "IN_PROGRESS",
        startedAt: { gte: new Date(Date.now() - OPEN_COUNT_DAYS * DAY_MS) },
      },
      orderBy: { startedAt: "desc" },
      select: { _count: { select: { lines: true } } },
    }),
    loadWeekWaste(accountId, store.id),
    loadLatestGap(accountId, store.id),
  ])
  return {
    id: store.id,
    name: store.name,
    lines: base.lines,
    lastCount: base.lastCount,
    skip: base.skip,
    toOrder: base.toOrder,
    draftVendors: base.draftVendors,
    openCount: open ? open._count.lines : null,
    counts: stateCounts(base.lines),
    coverage: shelfCoverage(base.lines),
    soonTitle: orderSoonTitle(base.lines.filter((l) => l.state === "order_soon").map((l) => l.when)),
    missing,
    waste: { dollars: waste.dollars, entries: waste.entries, unpriced: waste.unpriced },
  }
}

/** Every active store's full shelf, once per request. */
const loadShelves = cache(async (accountId: string): Promise<StoreShelf[]> => {
  const stores = await loadStores(accountId)
  return Promise.all(stores.map((s) => loadStoreShelf(accountId, s)))
})

export function switcherOf(stores: SwitchStore[]): SwitcherData {
  const counted = stores.filter((s) => s.toOrder !== null)
  return {
    stores,
    // Σ of the same per-store figure, so "All 3" is the three cells added up.
    total: counted.length ? counted.reduce((t, s) => t + (s.toOrder ?? 0), 0) : null,
  }
}

/** Which shelf a `?store=` asks for: one store, or all of them when there is more than one. */
export function pickShelfView(stores: Array<{ id: string }>, requested: string | undefined): string | null {
  if (stores.length === 0) return null
  if (stores.length === 1) return stores[0].id
  return stores.find((s) => s.id === requested)?.id ?? ALL_STORES
}

/** The Overview and the Shelf tab: both draw the same shelves. */
export function getInventoryShelfSectionPromises(opts: { accountId: string; storeId?: string }): StreamedSections<ShelfSections> {
  return {
    shelf: guardSection(
      classify(async (): Promise<ShelfData | null> => {
        const shelves = await loadShelves(opts.accountId)
        const view = pickShelfView(shelves, opts.storeId)
        if (view === null) return null
        return {
          ...switcherOf(shelves.map((s) => ({ id: s.id, name: s.name, toOrder: s.toOrder }))),
          view,
          shelves: view === ALL_STORES ? shelves : shelves.filter((s) => s.id === view),
          areas: COUNT_AREAS.map((a) => ({ id: a.id, label: a.label })),
          barDays: BAR_DAYS,
        }
      }, { retryAction: "count.shelf", isEmpty: (d) => d === null, emptyReason: "no_stores" }),
      "count.shelf",
    ),
  }
}

/**
 * The store switcher on the Order, Waste and Report tabs: each store's "N to
 * order". It reads the lines and nothing else: not the open count, the week's
 * waste or the two-count gap the Overview also shows. The Order tab passes
 * the cover it is showing, so the cell for a store and the draft under it are
 * one build of one draft.
 */
export function getInventorySwitcherSectionPromises(opts: { accountId: string; coverDays?: number }): StreamedSections<SwitcherSections> {
  return {
    switcher: guardSection(
      classify(async (): Promise<SwitcherData | null> => {
        const stores = await loadStores(opts.accountId)
        if (stores.length === 0) return null
        const lines = await Promise.all(stores.map((s) => loadStoreLines(opts.accountId, s.id, opts.coverDays ?? DEFAULT_COVER_DAYS)))
        return switcherOf(stores.map((s, i) => ({ id: s.id, name: s.name, toOrder: lines[i].toOrder })))
      }, { retryAction: "count.switcher", isEmpty: (d) => d === null, emptyReason: "no_stores" }),
      "count.switcher",
    ),
  }
}
