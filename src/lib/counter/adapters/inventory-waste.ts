import { ALL_STORES } from "@/lib/counter/shelf-state"
import { mergeWaste, moneyChange, type MoneyChange, type WasteSummary } from "@/lib/counter/waste-picture"
import { loadStoreWaste, loadWasteData, type ApartFigure, type StoreWaste, type WasteData } from "./count"
import { loadStores, pickShelfView } from "./inventory-shelf"
import { classify, guardSection, type StreamedSections } from "./types"
import type { SectionData } from "@/lib/counter/section-data"

/**
 * Inventory — Waste. The picture first: what was thrown out in the last 7
 * days, against the 7 days before, by reason and by store, then the log.
 *
 * Every figure is `loadStoreWaste` (in `count.ts`), the same read the
 * Inventory overview's "Thrown out" tile prints; this file only arranges it
 * for one store or for all of them. An entry on an item with no price is
 * listed and counted as an entry, never added in as $0.
 *
 * Tenancy: stores are read by `accountId`, and the adjustment log through
 * `store: { accountId }`. The page passes `accountId` in from the session.
 */

export type WasteStoreBar = {
  id: string
  name: string
  entries: number
  unpriced: number
  /** Null when nothing was logged, or nothing logged has a price. */
  dollars: number | null
}

export type WasteOne = WasteData & {
  before: StoreWaste["before"]
  /** This week against the week before. Null when neither has an entry. */
  change: MoneyChange | null
  /** Theft and sent back: shown apart, never in the total. */
  apart: ApartFigure[]
  /** Everything logged in the last 7 days, theft and sent back included. See `StoreWaste.logged`. */
  logged: StoreWaste["logged"]
}

export type WasteView = {
  /** "all", or the id of the store shown. */
  view: string
  /** The store shown: the picture and the form's data. Null on "all". */
  one: WasteOne | null
  /** Every store's last 7 days, for the comparison. */
  byStore: WasteStoreBar[]
  /** Every store together. */
  all: WasteSummary & {
    /** Stores with at least one entry: what the total covers. */
    storesLogged: number
  }
}

export type WastePictureSections = { waste: SectionData<WasteView | null> }

export function getInventoryWasteSectionPromises(opts: { accountId: string; storeId?: string }): StreamedSections<WastePictureSections> {
  return {
    waste: guardSection(
      classify(async (): Promise<WasteView | null> => {
        const stores = await loadStores(opts.accountId)
        const view = pickShelfView(stores, opts.storeId)
        if (view === null) return null
        const waste = await Promise.all(stores.map((s) => loadStoreWaste(opts.accountId, s.id)))
        const shown = view === ALL_STORES ? null : stores.find((s) => s.id === view) ?? null
        let one: WasteOne | null = null
        if (shown) {
          const w = waste[stores.indexOf(shown)]
          one = {
            ...(await loadWasteData(opts.accountId, stores, shown)),
            before: w.before,
            change: moneyChange(w.week, w.before),
            apart: w.apart,
            logged: w.logged,
          }
        }
        return {
          view,
          one,
          byStore: stores.map((s, i) => ({
            id: s.id,
            name: s.name,
            entries: waste[i].week.entries,
            unpriced: waste[i].week.unpriced,
            dollars: waste[i].week.dollars,
          })),
          all: {
            ...mergeWaste(waste.map((w) => w.week)),
            storesLogged: waste.filter((w) => w.week.entries > 0).length,
          },
        }
      }, { retryAction: "count.waste", isEmpty: (d) => d === null, emptyReason: "no_stores" }),
      "count.waste",
    ),
  }
}
