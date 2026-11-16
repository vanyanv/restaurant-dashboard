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
 * One read per request (`loadShelves`, cached) builds every store's shelf: a
 * state for each line of the count list. The "N to order now" on the switcher,
 * on the Overview headline and on the store cards is `toOrderNow` over those
 * lines; the blocks of the shelf map and the rows of the Shelf tab are the same
 * lines; "X of Y lines valued" is `shelfCoverage` over them. Nothing is worked
 * out twice. The state rules are `shelfState` in `shelf-state.ts`.
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
  /** The same reason as a kind, for grouping: a box with no size, or no price on file. */
  notValuedWhy: "size" | "price" | null
  /** On hand rolled forward from the count reads below zero. */
  belowZero: boolean
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
  /** One plain line on why the row reads the way it does. */
  note: string | null
}

export type StoreShelf = {
  id: string
  name: string
  /** The store's last finished count. Null: never counted. */
  lastCount: { day: string; ago: string; stale: boolean } | null
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
  waste: { dollars: number; entries: number; unpriced: number }
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

/** Calendar days between two moments on the stores' own (LA) clock: 11pm to 1am is "yesterday". */
function laDay(d: Date): number {
  return Date.parse(`${d.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })}T00:00:00Z`)
}

function agoLabel(at: Date, now: Date): string {
  const days = Math.round((laDay(now) - laDay(at)) / DAY_MS)
  if (days <= 0) return "today"
  if (days === 1) return "yesterday"
  return `${days} days ago`
}

type CountLine = { canonicalIngredientId: string; qtyInRecipeUnit: number; nativeUnit: string | null; breakdown: unknown }

function stopValues(line: CountLine, itemId: string): number[] | null {
  const b = line.breakdown
  if (!b || typeof b !== "object" || Array.isArray(b)) return null
  const vals = (b as Record<string, unknown>)[itemId]
  return Array.isArray(vals) ? vals.map((n) => (typeof n === "number" ? n : 0)) : null
}

/** One store's lines, in the sheet's order. Pure: everything it reads is passed in. */
export function buildShelfLines(input: {
  items: ItemRow[]
  /** The last finished count's lines by ingredient, or null when there is no finished count. */
  lastLines: Map<string, CountLine> | null
  lastDay: string | null
  draft: Pick<StoreDraft, "stock" | "vendors" | "reads">
}): ShelfLine[] {
  const { items, lastLines, lastDay, draft } = input
  const stockBy = new Map(draft.stock.map((r) => [r.id, r]))
  const draftBy = new Map(draft.vendors.flatMap((v) => v.rows.map((r) => [r.id, { row: r, vendor: v.vendor }] as const)))
  // An item counted without boxes (the older count screens) has one total and
  // no stop to hang it on: its first stop on the list carries it.
  const firstStop = new Map<string, string>()
  for (const it of items) if (!firstStop.has(it.canonicalIngredientId)) firstStop.set(it.canonicalIngredientId, it.id)
  const firstArea = new Map(items.map((it) => [it.id, it.area]))

  return items.flatMap((it): ShelfLine[] => {
    const ing = it.canonicalIngredient
    const unit = ing.recipeUnit
    // No recipe unit: it cannot be counted at all, and the walk leaves it out too.
    if (!unit) return []
    const layers = layersFor(it.layers, unit)
    const line = lastLines?.get(it.canonicalIngredientId) ?? null
    const stock = stockBy.get(it.canonicalIngredientId) ?? null
    const drafted = draftBy.get(it.canonicalIngredientId) ?? null
    const read = draft.reads.get(it.canonicalIngredientId) ?? null
    const vendor = drafted?.vendor ?? read?.vendor ?? null

    // What this stop itself holds on the last count.
    let stop: { qty: number; typed: string | null; unsized: string | null } | null = null
    let sharedWith: string | null = null
    if (line) {
      const vals = stopValues(line, it.id)
      if (valuesFit(layers, vals)) {
        const qty = shelfTotal(layers, vals)
        const unsized = unconverted(layers, vals)
        // An empty shelf reads as its boxes at zero ("0 Cases + 0 Trays"), the way the sheet has it.
        const typed = qty > 0 || unsized ? describeShelf(layers, vals) : layers.map((l) => `0 ${l.label}`).join(" + ")
        stop = { qty, typed, unsized }
      } else if (line.breakdown == null) {
        const first = firstStop.get(it.canonicalIngredientId)
        if (first === it.id) stop = { qty: line.qtyInRecipeUnit, typed: null, unsized: null }
        else {
          stop = { qty: 0, typed: null, unsized: null }
          sharedWith = areaLabel(firstArea.get(first ?? "") ?? "")
        }
      }
    }

    const state = shelfState({
      counted: line && stop ? { qty: line.qtyInRecipeUnit, unsized: line.nativeUnit === UNCONVERTED_UNIT } : null,
      onHandNow: read?.onHand ?? null,
      flow: stock?.status ?? null,
    })

    const cost = ing.costPerRecipeUnit
    const dollars = stop && !stop.unsized && !sharedWith && cost != null ? stop.qty * cost : sharedWith ? 0 : null
    const notValuedWhy = !stop || dollars !== null ? null : stop.unsized ? ("size" as const) : ("price" as const)
    const notValued = notValuedWhy === "size" ? `${stop?.unsized}: no size set yet` : notValuedWhy === "price" ? "No price on file yet" : null
    // The draft's own "reads below zero": a use rate, a count to start from, and less than nothing left.
    const belowZero = state === "cant_tell" && stock?.status === "unknown" && read?.onHand != null && read.onHand < 0

    const order = drafted ? drafted.row.order : null
    const from = vendor ? ` from ${vendor}` : ""
    let note: string | null = null
    if (state === "not_counted") note = lastDay ? `Not on the ${lastDay} count` : "No finished count yet"
    else if (sharedWith) note = `Counted with ${sharedWith}`
    else if (state === "out") {
      note = order
        ? `Draft order: ${order}${from}`
        : stock
          ? "No draft yet"
          : `No draft yet: nothing on the menu uses it, so the app can't size an order${vendor ? `. Last${from}` : ""}`
    } else if (state === "order_now" || state === "order_soon") note = order ? `Draft order: ${order}${from}` : null
    else if (state === "cant_tell" && !stop?.unsized) {
      // A box with no size on this very stop is already said by `notValued`.
      note = line?.nativeUnit === UNCONVERTED_UNIT
          ? "Another shelf of this item has a box with no size yet"
          : belowZero
            ? "On hand reads below zero. Count it again"
            : "No count the draft order can start from"
    }

    const readable = state === "order_now" || state === "order_soon" || state === "ok"
    return [{
      id: it.id,
      ingredientId: it.canonicalIngredientId,
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
      amount: stop && !sharedWith && stop.qty > 0 && !(layers.length === 1 && layers[0].per === 1) ? showQty(stop.qty, unit).trim() : null,
      dollars: state === "not_counted" ? null : dollars,
      notValued: state === "not_counted" ? null : notValued,
      notValuedWhy: state === "not_counted" ? null : notValuedWhy,
      belowZero,
      daysLeft: readable ? (stock?.daysLeft ?? null) : null,
      orderAt: readable ? (stock?.orderAt ?? null) : null,
      runsOut: readable ? (stock?.runsOut ?? null) : null,
      order,
      when: drafted?.row.when ?? null,
      vendor,
      note,
    }]
  })
}

type StoreRow = { id: string; name: string; draftSkipCount: boolean }

async function loadStoreShelf(accountId: string, store: StoreRow, items: ItemRow[], now: Date): Promise<StoreShelf> {
  const [draft, last, open, waste, missing] = await Promise.all([
    // The Order tab's own draft at its default cover, so the two pages agree.
    loadStoreDraft(accountId, store.id, DEFAULT_COVER_DAYS, store.draftSkipCount),
    prisma.stockCount.findFirst({
      where: { storeId: store.id, store: { accountId }, status: "COMPLETED" },
      orderBy: { countedAt: "desc" },
      select: {
        countedAt: true,
        lines: { select: { canonicalIngredientId: true, qtyInRecipeUnit: true, nativeUnit: true, breakdown: true } },
      },
    }),
    prisma.stockCount.findFirst({
      where: {
        storeId: store.id,
        store: { accountId },
        status: "IN_PROGRESS",
        startedAt: { gte: new Date(now.getTime() - OPEN_COUNT_DAYS * DAY_MS) },
      },
      orderBy: { startedAt: "desc" },
      select: { _count: { select: { lines: true } } },
    }),
    loadWeekWaste(accountId, store.id),
    loadLatestGap(accountId, store.id),
  ])
  const lastDay = last ? dayLabel(last.countedAt) : null
  const lines = buildShelfLines({
    items,
    lastLines: last ? new Map(last.lines.map((l) => [l.canonicalIngredientId, l])) : null,
    lastDay,
    draft,
  })
  return {
    id: store.id,
    name: store.name,
    lastCount: last
      ? {
          day: lastDay!,
          ago: agoLabel(last.countedAt, now),
          stale: now.getTime() - last.countedAt.getTime() > STALE_COUNT_DAYS * DAY_MS,
        }
      : null,
    openCount: open ? open._count.lines : null,
    lines,
    toOrder: last ? toOrderNow(lines) : null,
    counts: stateCounts(lines),
    coverage: shelfCoverage(lines),
    soonTitle: orderSoonTitle(lines.filter((l) => l.state === "order_soon").map((l) => l.when)),
    draftVendors: draft.vendors.length,
    missing,
    waste: { dollars: waste.dollars, entries: waste.entries.length, unpriced: waste.unpriced },
  }
}

/** Every active store's shelf, once per request. */
const loadShelves = cache(async (accountId: string): Promise<StoreShelf[]> => {
  const [stores, items] = await Promise.all([
    prisma.store.findMany({
      where: { accountId, isActive: true },
      select: { id: true, name: true, draftSkipCount: true },
      orderBy: { name: "asc" },
    }),
    countItems(accountId),
  ])
  const now = new Date()
  return Promise.all(stores.map((s) => loadStoreShelf(accountId, s, items, now)))
})

function switcherOf(shelves: StoreShelf[]): SwitcherData {
  const counted = shelves.filter((s) => s.toOrder !== null)
  return {
    stores: shelves.map((s) => ({ id: s.id, name: s.name, toOrder: s.toOrder })),
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
          ...switcherOf(shelves),
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

/** The store switcher on the Order, Waste and Report tabs: each store's "N to order". */
export function getInventorySwitcherSectionPromises(opts: { accountId: string }): StreamedSections<SwitcherSections> {
  return {
    switcher: guardSection(
      classify(async (): Promise<SwitcherData | null> => {
        const shelves = await loadShelves(opts.accountId)
        return shelves.length ? switcherOf(shelves) : null
      }, { retryAction: "count.switcher", isEmpty: (d) => d === null, emptyReason: "no_stores" }),
      "count.switcher",
    ),
  }
}
