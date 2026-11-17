import { UNCONVERTED_UNIT } from "@/lib/inventory/anchor-line"
import { COUNT_AREAS, areaLabel, layersFor, showQty } from "@/lib/counter/count-layers"
import { DEFAULT_COVER_DAYS } from "@/lib/counter/draft-orders"
import { gapVerdict, type GapVerdict } from "@/lib/counter/gap-picture"
import { plainName } from "@/lib/counter/plain-names"
import { ALL_STORES, type ShelfState } from "@/lib/counter/shelf-state"
import { countItems, dayLabel, loadLatestPair, orderFrequency, type GapRow, type OrderRow } from "./count"
import { loadStoreDraft } from "./draft-orders"
import {
  loadStoreLines,
  loadStores,
  pickShelfView,
  switcherOf,
  type ShelfLine,
  type StoreLines,
  type SwitcherData,
} from "./inventory-shelf"
import { classify, guardSection, type StreamedSections } from "./types"
import type { SectionData } from "@/lib/counter/section-data"

/**
 * Inventory — one item. Everything the other tabs say about a single line of
 * the count list, in one place: its state and what was typed (the Shelf
 * tab's own line), how long it lasts (the draft order's reading), what went
 * missing since the last count (the Report's own row), the same item at every
 * store, and how it is ordered.
 *
 * It works nothing out. The line is `loadStoreLines`, the gap row is
 * `loadLatestPair`, the ordering facts are `orderFrequency` and the draft is
 * `loadStoreDraft`: the page cannot disagree with the tab it was opened from.
 *
 * Tenancy: the item is looked up on the account's own count list, stores are
 * read by `accountId`, and every loader borrowed here filters by it.
 */

const BAR_DAYS = 7

export type ItemStoreBar = {
  id: string
  name: string
  /** The saved count in the item's unit. Null when not counted here, or a box has no size. */
  qty: number | null
  /** "414 lb". Null with `qty`. */
  amount: string | null
  /** The boxes as typed, every stop joined. */
  typed: string | null
  /** The day of the count the number is from. */
  day: string | null
  state: ShelfState
  stateText: string
  /** Why there is no amount: never counted here, or a box with no size. */
  why: "not_counted" | "no_size" | null
  /**
   * "Skip this week's count" is on at this store: counts from the last 7 days
   * are left out, so "not counted" means "on no count the page reads", not never.
   */
  skip: boolean
}

export type ItemOne = {
  store: { id: string; name: string }
  /** The item's lines at this store, one per stop: the Shelf tab's own. */
  lines: ShelfLine[]
  /** The day of the count shown. Null when never counted here. */
  counted: string | null
  /** "Skip this week's count" is on here: the page reads only counts from before the last 7 days. */
  skip: boolean
  /** The saved count in one unit: "414 lb". Null when not counted or a box has no size. */
  amount: string | null
  /** Σ of the lines' dollars. Null when any of them has no value. */
  worth: number | null
  /** "80 lb": expected use a day, from what sold. Null when nothing on the menu uses it. */
  perDay: string | null
  /** What each box holds: "Cases: 27 lb each". */
  sizes: string[]
  /** The Report's row for this item between the store's two latest counts. */
  gap: { from: string; to: string; row: GapRow; verdict: GapVerdict } | null
  /** Why there is no gap: the store has one count, or this item was not on both. */
  gapWhy: "one_count" | "not_compared" | null
  /** How it is ordered here, from 8 weeks of invoices. Null with no invoice. */
  ordering: OrderRow | null
}

export type ItemView = SwitcherData & {
  /** "all", or the id of the store shown. */
  view: string
  /** Null when the id is not an item on this account's count list. */
  item: { id: string; name: string; fullName: string; unit: string; areas: string } | null
  one: ItemOne | null
  /** The same item at every store, in one unit. */
  byStore: ItemStoreBar[]
  /** Every store with a whole count added up. Null when none has one. */
  across: { amount: string; stores: number } | null
  barDays: number
}

export type ItemSections = { item: SectionData<ItemView | null> }

function storeBar(store: { id: string; name: string }, read: StoreLines, ingredientId: string, unit: string): ItemStoreBar {
  const lines = read.lines.filter((l) => l.ingredientId === ingredientId)
  const saved = read.latest.get(ingredientId) ?? null
  const partial = saved?.nativeUnit === UNCONVERTED_UNIT
  const qty = saved && !partial ? saved.qtyInRecipeUnit : null
  const typed = lines.map((l) => l.typed).filter(Boolean).join("; ")
  return {
    id: store.id,
    name: store.name,
    qty,
    amount: qty !== null ? showQty(qty, unit).trim() : null,
    typed: typed || null,
    day: saved ? dayLabel(saved.countedAt) : null,
    state: lines[0]?.state ?? "not_counted",
    stateText: lines[0]?.stateText ?? "Not counted",
    why: !saved ? "not_counted" : partial ? "no_size" : null,
    skip: read.skip,
  }
}

export function getInventoryItemSectionPromises(opts: {
  accountId: string
  ingredientId: string
  storeId?: string
}): StreamedSections<ItemSections> {
  return {
    item: guardSection(
      classify(async (): Promise<ItemView | null> => {
        const { accountId, ingredientId } = opts
        const stores = await loadStores(accountId)
        const view = pickShelfView(stores, opts.storeId)
        if (view === null) return null
        const [items, reads] = await Promise.all([
          countItems(accountId),
          Promise.all(stores.map((s) => loadStoreLines(accountId, s.id, DEFAULT_COVER_DAYS))),
        ])
        const switcher = switcherOf(stores.map((s, i) => ({ id: s.id, name: s.name, toOrder: reads[i].toOrder })))
        const stops = items.filter((it) => it.canonicalIngredientId === ingredientId && it.canonicalIngredient.recipeUnit)
        if (stops.length === 0) {
          return { ...switcher, view, item: null, one: null, byStore: [], across: null, barDays: BAR_DAYS }
        }
        const ing = stops[0].canonicalIngredient
        const unit = ing.recipeUnit ?? ""
        const areas = COUNT_AREAS.map((a) => a.id).filter((a) => stops.some((s) => s.area === a)).map(areaLabel)
        const byStore = stores.map((s, i) => storeBar(s, reads[i], ingredientId, unit))
        const whole = byStore.filter((b) => b.qty !== null)

        let one: ItemOne | null = null
        if (view !== ALL_STORES) {
          const i = stores.findIndex((s) => s.id === view)
          const store = stores[i]
          const lines = reads[i].lines.filter((l) => l.ingredientId === ingredientId)
          const [draft, pair, ordering] = await Promise.all([
            loadStoreDraft(accountId, store.id, DEFAULT_COVER_DAYS),
            loadLatestPair(accountId, store.id),
            orderFrequency(accountId, store.id, [ingredientId]),
          ])
          const row = pair?.rows.find((r) => r.ingredientId === ingredientId) ?? null
          const stock = draft.stock.find((r) => r.id === ingredientId) ?? null
          // A stop's boxes, once each by name and size: "Cases: 27 lb each". Two
          // shelves can hold a box of the same name in two sizes; both are said.
          const sizes = new Map<string, string>()
          for (const s of stops) {
            for (const l of layersFor(s.layers, unit)) {
              if (l.per === 1) continue
              sizes.set(`${l.label}|${l.per}`, l.per > 0 ? `${l.label}: ${showQty(l.per, unit).trim()} each` : `${l.label}: no size yet`)
            }
          }
          one = {
            store,
            lines,
            counted: byStore[i].day,
            skip: reads[i].skip,
            amount: byStore[i].amount,
            worth: lines.length > 0 && lines.every((l) => l.dollars !== null) ? lines.reduce((t, l) => t + (l.dollars ?? 0), 0) : null,
            perDay: stock && lines.some((l) => l.daysLeft !== null) ? stock.perDay : null,
            sizes: [...sizes.values()],
            gap: pair && row ? { from: pair.from, to: pair.to, row, verdict: gapVerdict(row) } : null,
            gapWhy: !pair ? "one_count" : !row ? "not_compared" : null,
            ordering: ordering[0] ?? null,
          }
        }

        return {
          ...switcher,
          view,
          item: { id: ingredientId, name: plainName(ing.name), fullName: ing.name, unit, areas: areas.join(" · ") },
          one,
          byStore,
          across: whole.length
            ? { amount: showQty(whole.reduce((t, b) => t + (b.qty ?? 0), 0), unit).trim(), stores: whole.length }
            : null,
          barDays: BAR_DAYS,
        }
      }, { retryAction: "count.item", isEmpty: (d) => d === null, emptyReason: "no_stores" }),
      "count.item",
    ),
  }
}
