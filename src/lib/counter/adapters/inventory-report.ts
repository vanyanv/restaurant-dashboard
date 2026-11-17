import { ALL_STORES } from "@/lib/counter/shelf-state"
import { loadLatestGap, loadReport, type LatestGap, type ReportData } from "./count"
import { loadStores, pickShelfView } from "./inventory-shelf"
import { classify, guardSection, type StreamedSections } from "./types"
import type { SectionData } from "@/lib/counter/section-data"

/**
 * Inventory — Report. The picture first: what went missing between two
 * counts, how much of the list that covers, and each item as two bars (should
 * have, counted). The working is folded under it.
 *
 * The rows, the totals and the headline are `loadReport` and `loadLatestGap`
 * in `count.ts`: the Inventory overview's "Went missing" tile is the same
 * `loadLatestGap`, so a store reads one figure on both. With every store
 * picked the page is that figure per store, side by side.
 *
 * Tenancy: stores are read by `accountId`; counts, lines and adjustments go
 * through `store: { accountId }`. The page passes `accountId` in.
 */

export type ReportStoreBar = {
  id: string
  name: string
  /** Null until the store has two finished counts. */
  gap: LatestGap | null
}

export type ReportView = {
  /** "all", or the id of the store shown. */
  view: string
  /** The store shown. Null on "all". */
  one: ReportData | null
  /** On "all": each store's two most recent counts. Empty for one store. */
  byStore: ReportStoreBar[]
  /** On "all": Σ of the stores that have a figure, and how many that is. */
  total: { dollars: number | null; stores: number }
}

export type ReportPictureSections = { report: SectionData<ReportView | null> }

export function getInventoryReportSectionPromises(opts: {
  accountId: string
  storeId?: string
  countId?: string
}): StreamedSections<ReportPictureSections> {
  return {
    report: guardSection(
      classify(async (): Promise<ReportView | null> => {
        const stores = await loadStores(opts.accountId)
        const view = pickShelfView(stores, opts.storeId)
        if (view === null) return null
        if (view !== ALL_STORES) {
          const store = stores.find((s) => s.id === view)!
          return {
            view,
            one: await loadReport({ accountId: opts.accountId, stores, store, countId: opts.countId, picture: true }),
            byStore: [],
            total: { dollars: null, stores: 0 },
          }
        }
        const gaps = await Promise.all(stores.map((s) => loadLatestGap(opts.accountId, s.id)))
        const withFigure = gaps.filter((g): g is LatestGap & { missingDollars: number } => g !== null && g.missingDollars !== null)
        return {
          view,
          one: null,
          byStore: stores.map((s, i) => ({ id: s.id, name: s.name, gap: gaps[i] })),
          total: {
            dollars: withFigure.length ? withFigure.reduce((t, g) => t + g.missingDollars, 0) : null,
            stores: withFigure.length,
          },
        }
      }, { retryAction: "count.report", isEmpty: (d) => d === null, emptyReason: "no_stores" }),
      "count.report",
    ),
  }
}
