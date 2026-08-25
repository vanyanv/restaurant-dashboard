import { getSplhSeries, type SplhSeries } from "@/app/actions/splh-actions"
import { getCogsKpis, getCogsStoreOverview } from "@/lib/cogs"
import { getInvoiceSummary } from "@/app/actions/invoice-actions"
import type { InvoiceKpis } from "@/types/invoice"
import type { LifecycleStage } from "@/generated/prisma/enums"
import { partitionByLifecycle, LIFECYCLE_LABEL } from "@/lib/store-lifecycle"
import { toQueryBounds, type DateRange } from "@/lib/counter/date-range"
import { classify } from "@/lib/counter/adapters/types"
import type { SectionData } from "@/lib/counter/section-data"

/**
 * Overview's data, classified.
 *
 * This is the ONLY new server code the Overview page needs — `npm run tokens`
 * fails a page that imports an action or Prisma directly, so every figure on
 * the page has to arrive through here already resolved into a `SectionData`.
 *
 * `lead` and `ledger` both normalise to an ARRAY OF ROWS even when a single
 * store is selected (a one-row array), matching note 22's "states belong in
 * the builders" — a page that always receives a list never special-cases the
 * single-store view.
 *
 * Every real section (`lead`, `ledger`, `invoices`) is loaded concurrently
 * with `Promise.all`. A slow COGS rollup must not hold up SPLH or invoices —
 * they don't share a query.
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
}

/**
 * One COGS row, whether it came from the whole-account rollup or was
 * synthesised for a single selected store. `lifecycleStage` is only ever
 * known in the all-stores case — `getCogsKpis` (single store) does not
 * return it, so a pre-open store filtered down to one selection currently
 * reads as a plain zero rather than "pre-open" (flagged in the task report;
 * not fixable without a second query this task doesn't call for).
 */
export interface LedgerRow {
  storeId: string
  storeName: string | null
  cogsPct: number
  cogsDollars: number
  foodCogsDollars: number
  packagingCogsDollars: number
  revenueDollars: number
  costedRevenueDollars: number
  targetCogsPct: number | null
  deltaVsTargetPp: number | null
  warningCount: number | null
  lifecycleStage: LifecycleStage | null
  lifecycleLabel: string | null
}

export interface OverviewSections {
  lead: SectionData<SplhSeries[]>
  ledger: SectionData<LedgerRow[]>
  invoices: SectionData<InvoiceKpis>
  needsYou: SectionData<null>
  modelCall: SectionData<null>
}

async function loadLead(storeId: string | null): Promise<SplhSeries[]> {
  // getSplhSeries computes its own trailing window (14 days / 12 weeks) and
  // takes no date-range or store parameter — it cannot be scoped to
  // Counter's selected range at all. See task report: a real mismatch with
  // what the brief assumed. Filtering the result to the selected store is
  // the only scoping available to this adapter.
  const all = await getSplhSeries("day")
  return storeId ? all.filter((s) => s.storeId === storeId) : all
}

async function loadLedger(
  bounds: { startDate: Date; endDate: Date },
  storeId: string | null,
  accountId: string,
): Promise<LedgerRow[]> {
  if (storeId) {
    const kpis = await getCogsKpis(storeId, bounds.startDate, bounds.endDate)
    return [
      {
        storeId,
        storeName: null,
        cogsPct: kpis.cogsPct,
        cogsDollars: kpis.cogsDollars,
        foodCogsDollars: kpis.foodCogsDollars,
        packagingCogsDollars: kpis.packagingCogsDollars,
        revenueDollars: kpis.revenueDollars,
        costedRevenueDollars: kpis.costedRevenueDollars,
        targetCogsPct: kpis.targetCogsPct,
        deltaVsTargetPp: kpis.deltaVsTargetPp,
        warningCount: null,
        lifecycleStage: null,
        lifecycleLabel: null,
      },
    ]
  }

  const rows = await getCogsStoreOverview(accountId, bounds.startDate, bounds.endDate)
  return rows.map((r) => ({
    storeId: r.storeId,
    storeName: r.storeName,
    cogsPct: r.cogsPct,
    cogsDollars: r.cogsDollars,
    foodCogsDollars: r.foodCogsDollars,
    packagingCogsDollars: r.packagingCogsDollars,
    revenueDollars: r.revenueDollars,
    costedRevenueDollars: r.costedRevenueDollars,
    targetCogsPct: r.targetCogsPct,
    deltaVsTargetPp: r.deltaVsTargetPp,
    warningCount: r.warningCount,
    lifecycleStage: r.lifecycleStage,
    lifecycleLabel: LIFECYCLE_LABEL[r.lifecycleStage],
  }))
}

/**
 * The all-stores ledger is "empty" only when every store on the account is
 * still pre-open (isOperational, via partitionByLifecycle) — a trading store
 * with genuinely zero COGS activity this period still gets a row. The
 * single-store case has no lifecycle data to reason about (see LedgerRow's
 * doc comment) so it falls back to a plain row count.
 */
function ledgerIsEmpty(rows: LedgerRow[], storeId: string | null): boolean {
  if (storeId) return rows.length === 0
  const withStage = rows.filter(
    (r): r is LedgerRow & { lifecycleStage: LifecycleStage } => r.lifecycleStage !== null,
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

export async function getOverviewSections(
  input: OverviewSectionsInput,
): Promise<OverviewSections> {
  const { range, storeId, accountId } = input
  const bounds = toQueryBounds(range)

  const [lead, ledger, invoices, needsYou, modelCall] = await Promise.all([
    classify(() => loadLead(storeId), {
      retryAction: "retryLead",
      isEmpty: (rows) => rows.length === 0,
      // Absence from getSplhSeries means no labor hours at all — for a
      // single selected store that is exactly what a construction-stage
      // store looks like per that function's own doc comment (omitted, not
      // zeroed).
      emptyReason: storeId ? "pre_open" : "no_match",
    }),

    classify(() => loadLedger(bounds, storeId, accountId), {
      retryAction: "retryLedger",
      isEmpty: (rows) => ledgerIsEmpty(rows, storeId),
      emptyReason: "pre_open",
    }),

    classify(
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

  return { lead, ledger, invoices, needsYou, modelCall }
}
