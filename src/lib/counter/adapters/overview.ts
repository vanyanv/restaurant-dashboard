import { getStores } from "@/app/actions/store/crud-actions"
import { getCogsKpis, getCogsStoreOverview } from "@/lib/cogs"
import { getInvoiceSummary } from "@/app/actions/invoice-actions"
import type { InvoiceKpis } from "@/types/invoice"
import type { LifecycleStage } from "@/generated/prisma/enums"
import { partitionByLifecycle } from "@/lib/store-lifecycle"
import { toQueryBounds, type DateRange } from "@/lib/counter/date-range"
import { classify } from "@/lib/counter/adapters/types"
import {
  empty, failed, loading, notComputed, ready, stale, type SectionData,
} from "@/lib/counter/section-data"
import type { SwitchableStore } from "@/components/counter"

/**
 * Overview's data, classified.
 *
 * This is the ONLY new server code the Overview page needs — `npm run tokens`
 * fails a page that imports an action or Prisma directly, so every figure on
 * the page has to arrive through here already resolved into a `SectionData`,
 * shaped exactly the way the page's client island renders it. No mapping from
 * a library's own return type happens outside this file — `.status`
 * inspection is banned everywhere else, so the map from `RawLedgerRow` (what
 * `@/lib/cogs` returns) to `LedgerRow` (what the Table renders) has to live
 * beside the classification, not in the page.
 *
 * Two entry points: `getOverviewStores` loads the account's stores for the
 * `StoreSwitcher` (not itself a `SectionData` — a page always needs SOME
 * store list to render the control, so it fails closed to `[]` the same way
 * `getStores` already does rather than becoming a sixth "control failed to
 * load" state). `getOverviewSections` loads the page's actual sections,
 * concurrently, so a slow COGS rollup does not hold up invoices.
 */

export interface OverviewSectionsInput {
  range: DateRange
  /** null = every store on the account. */
  storeId: string | null
  /**
   * `getCogsStoreOverview` needs an account, not a store, for the all-stores
   * view — and the adapter cannot fetch its own session. Fetching one here
   * would import `@/lib/auth`, which imports `@/lib/prisma`, which throws at
   * MODULE LOAD without `DATABASE_URL` — that turns "one section is slow"
   * into "the whole page's module fails to import", for every caller,
   * tests included. The page already has this from its own session lookup,
   * the same way `src/app/dashboard/cogs/page.tsx` does.
   */
  accountId: string
  /**
   * The page's own `getOverviewStores()` result, reused (not re-fetched) only
   * to resolve the SELECTED store's display name for the single-store ledger
   * row — `getCogsKpis` (the single-store query) returns no name of its own.
   * Omit it and that row's `store` field falls back to the store id.
   */
  stores?: SwitchableStore[]
}

/** One row of the per-store ledger, as the Table renders it. */
export interface LedgerRow {
  storeId: string
  store: string
  net: number
  cogsPct: number | null
  deltaVsTargetPp: number | null
}

export interface OverviewSections {
  /**
   * Note 30: net sales says whether the day happened. Derived from the SAME
   * query as `ledger` (see `deriveSales`) — not a second fetch.
   */
  sales: SectionData<{ netSales: number }>
  /**
   * Note 30's second number — sales per labour hour, which says whether the
   * day was worth having. `getSplhSeries` cannot be scoped to Counter's
   * selected date range at all: its real signature takes no range or store
   * (`getSplhSeries(granularity)`), deriving its own trailing 14-day/12-week
   * window internally (see task-1-2-report.md). Showing that number beside a
   * range-scoped net sales figure would answer a DIFFERENT QUESTION under
   * the same label — exactly note 60's defect class (prime cost read 56.2%
   * on one page and 57.9% on another for the same range) and note 39's ("a
   * total is the sum of the series drawn beside it"). Unconditionally owed
   * until `getSplhSeries` grows a range parameter — not shown with a caption
   * explaining it means something else.
   */
  splh: SectionData<null>
  ledger: SectionData<LedgerRow[]>
  invoices: SectionData<{ spend: number; count: number; needsReview: number }>
  needsYou: SectionData<null>
  modelCall: SectionData<null>
}

const STAGE_FOR: Record<LifecycleStage, SwitchableStore["stage"]> = {
  pre_open: "pre_open",
  warming_up: "warming_up",
  ready: "trading",
}

/** The account's stores, for the `StoreSwitcher`. Fails closed to `[]`, same as `getStores` itself. */
export async function getOverviewStores(): Promise<SwitchableStore[]> {
  const stores = await getStores()
  return stores.map((s) => ({ id: s.id, name: s.name, stage: STAGE_FOR[s.lifecycleStage] }))
}

/** One COGS row, whether it came from the whole-account rollup or was synthesised for a single selected store. */
interface RawLedgerRow {
  storeId: string
  storeName: string | null
  cogsPct: number
  revenueDollars: number
  targetCogsPct: number | null
  deltaVsTargetPp: number | null
  lifecycleStage: LifecycleStage | null
}

async function loadLedgerRaw(
  bounds: { startDate: Date; endDate: Date },
  storeId: string | null,
  accountId: string,
  stores: SwitchableStore[] | undefined,
): Promise<RawLedgerRow[]> {
  if (storeId) {
    const kpis = await getCogsKpis(storeId, bounds.startDate, bounds.endDate)
    return [
      {
        storeId,
        storeName: stores?.find((s) => s.id === storeId)?.name ?? null,
        cogsPct: kpis.cogsPct,
        revenueDollars: kpis.revenueDollars,
        targetCogsPct: kpis.targetCogsPct,
        deltaVsTargetPp: kpis.deltaVsTargetPp,
        lifecycleStage: null,
      },
    ]
  }

  const rows = await getCogsStoreOverview(accountId, bounds.startDate, bounds.endDate)
  return rows.map((r) => ({
    storeId: r.storeId,
    storeName: r.storeName,
    cogsPct: r.cogsPct,
    revenueDollars: r.revenueDollars,
    targetCogsPct: r.targetCogsPct,
    deltaVsTargetPp: r.deltaVsTargetPp,
    lifecycleStage: r.lifecycleStage,
  }))
}

/**
 * The all-stores ledger is "empty" only when every store on the account is
 * still pre-open (isOperational, via partitionByLifecycle) — a trading store
 * with genuinely zero COGS activity this period still gets a row. The
 * single-store case has no lifecycle data to reason about, so it falls back
 * to a plain row count (known gap: a pre-open store selected individually
 * reads as "nothing matched" rather than "not trading yet").
 */
function ledgerIsEmpty(rows: RawLedgerRow[], storeId: string | null): boolean {
  if (storeId) return rows.length === 0
  const withStage = rows.filter(
    (r): r is RawLedgerRow & { lifecycleStage: LifecycleStage } => r.lifecycleStage !== null,
  )
  return withStage.length > 0 && partitionByLifecycle(withStage).operational.length === 0
}

/** `getInvoiceSummary` takes calendar-date strings, not `Date` objects. */
function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function sumNetSales(rows: RawLedgerRow[]): number {
  return rows.reduce((total, r) => total + r.revenueDollars, 0)
}

function toLedgerRow(r: RawLedgerRow): LedgerRow {
  return {
    storeId: r.storeId,
    store: r.storeName ?? r.storeId,
    net: r.revenueDollars,
    cogsPct: r.cogsPct,
    deltaVsTargetPp: r.deltaVsTargetPp,
  }
}

/**
 * Re-classifies an already-classified `SectionData` through `f`, keeping
 * every non-data status (failed/empty/not_computed/loading) exactly as it
 * was. This is how `sales` and `ledger` both derive from ONE ledger query —
 * `f` only ever runs on a value that already loaded.
 */
function mapReady<T, U>(sd: SectionData<T>, f: (value: T) => U): SectionData<U> {
  switch (sd.status) {
    case "ready":
      return ready(f(sd.data))
    case "stale":
      return stale(f(sd.data), sd.lastGoodAt)
    case "failed":
      return failed(sd.error, sd.retryAction)
    case "empty":
      return empty(sd.reason)
    case "not_computed":
      return notComputed(sd.owed)
    case "loading":
      return loading()
  }
}

export async function getOverviewSections(
  input: OverviewSectionsInput,
): Promise<OverviewSections> {
  const { range, storeId, accountId, stores } = input
  const bounds = toQueryBounds(range)

  const [ledgerRaw, invoicesRaw, needsYou, modelCall] = await Promise.all([
    classify(() => loadLedgerRaw(bounds, storeId, accountId, stores), {
      retryAction: "retryLedger",
      isEmpty: (rows) => ledgerIsEmpty(rows, storeId),
      emptyReason: "pre_open",
    }),

    classify<InvoiceKpis>(
      () =>
        getInvoiceSummary({
          storeId: storeId ?? undefined,
          startDate: isoDate(bounds.startDate),
          endDate: isoDate(bounds.endDate),
        }),
      {
        retryAction: "retryInvoices",
        isEmpty: (k) => k.invoiceCount === 0,
      },
    ),

    // No server code computes these yet — owed work, not a fake number.
    classify<null>(() => Promise.resolve(null), {
      retryAction: "retryNeedsYou",
      owed: "alerts and decisions queue",
    }),
    classify<null>(() => Promise.resolve(null), {
      retryAction: "retryModelCall",
      owed: "the model's call for this day",
    }),
  ])

  // Owed short-circuits before any loader runs — see classify. No query.
  const splh = await classify<null>(() => Promise.resolve(null), {
    retryAction: "retrySplh",
    owed: "sales per labour hour scoped to the selected range",
  })

  return {
    sales: mapReady(ledgerRaw, (rows) => ({ netSales: sumNetSales(rows) })),
    splh,
    ledger: mapReady(ledgerRaw, (rows) => rows.map(toLedgerRow)),
    invoices: mapReady(invoicesRaw, (k) => ({
      spend: k.totalSpend,
      count: k.invoiceCount,
      needsReview: k.pendingReviewCount,
    })),
    needsYou,
    modelCall,
  }
}
