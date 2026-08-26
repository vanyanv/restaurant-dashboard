import { getAllStoresPnL } from "@/app/actions/store/pnl-actions"
import type { AllStoresPnLResult } from "@/app/actions/store/pnl-types"
import type { Period, PnLRow } from "@/lib/pnl"
import { primeCost, type PrimeCost } from "@/lib/counter/prime-cost"
import { bucketFor, dayCount, toQueryBounds, type Bucket, type DateRange } from "@/lib/counter/date-range"

/**
 * The statement, once.
 *
 * Every Counter surface that prints a dollar of sales prints it from here.
 * The Overview's headline, its bars, its store cards and the denominator of
 * every percent beside them already came from ONE `getAllStoresPnL` call —
 * that rule was written in `adapters/overview.ts`'s module comment and held
 * only for as long as the Overview was the only page. The P&L prints the same
 * dollars. A page that loaded them itself would bring note 60 back, and not as
 * a formula difference this time — `prime-cost.ts` closed that door — but as a
 * BOUNDS or a ROLLUP difference upstream of any formula: a second query with
 * its own end-of-day, or an answer covering a different set of stores.
 *
 * So the rule is now structural: this module makes the call, and the pages
 * consume what it returns.
 *
 * ## Three things this owes its callers, each learned the hard way
 *
 * - **A single store is READ OUT of the all-stores call.** `getStorePnL`
 *   publishes no labour TOTAL — labour is one `PnLRow` among twenty — while
 *   `getAllStoresPnL` publishes `cogsValue` and `laborValue` per store AND
 *   combined, from one already-cached query. One call shape is the only way a
 *   group total and a single-store figure cannot end up over different
 *   denominators.
 * - **`marginPct` is `null` with no sales, never `0`.** Zero reads as
 *   break-even; a pre-open store spending on fit-out would print a perfect
 *   score rather than an absent one. `format.ts` prints null as an em-dash.
 *   `<= 0` rather than `=== 0`, for the same reason `primeCost` uses it: a
 *   range of pure refunds divides by a negative and reads as a triumph.
 * - **`otherOperating` is clamped at zero.** It is a REMAINDER
 *   (`fixedCosts − labour − rent`), and when a store carries no towels,
 *   cleaning or custom lines the two sides are equal in theory and ~1e-12
 *   apart in practice. A cascade of positive subtractions renders that as
 *   `-$0.00`.
 *
 * ## What this module does NOT decide
 *
 * Whether a figure is fit to PRINT. `laborValue` of zero over a range with
 * sales is a store whose labour is neither posted nor configured, and the
 * Overview withholds its labour and prime cells on exactly that test — but
 * that is a decision about a cell, not about the statement, and it stays at
 * the surface that renders the cell. This module reports what the rollup says.
 */

/** `getAllStoresPnL`'s own vocabulary for how the range is bucketed. */
export type Granularity = "daily" | "weekly" | "monthly"

const GRANULARITY_FOR: Record<Bucket, Granularity> = {
  day: "daily",
  week: "weekly",
  month: "monthly",
}

/**
 * The buckets a range implies — `bucketFor`'s answer, in the rollup's words.
 *
 * Exported because a COMPARISON window must be loaded at the SELECTED range's
 * granularity, not at its own. `comparisonRange(r, "weekday")` returns a
 * window containing four occurrences, which derives "weekly" from itself; a
 * weekly series drawn as the dashed reference under daily bars is a chart
 * comparing two different things. So the caller works the granularity out once
 * and passes it to both loads.
 */
export function granularityFor(range: DateRange): Granularity {
  return GRANULARITY_FOR[bucketFor(range)]
}

/**
 * The cascade an owner reads, top to bottom.
 *
 * The five costs and the sixth line agree by construction:
 * `gross − commissions − cogs − labour − occupancy − otherOperating` IS
 * `bottomLine`, because `computeStorePnL` subtracts exactly those and
 * `otherOperating` is what is left of `fixedCosts` once labour and rent are
 * taken out of it. Do not re-derive `bottomLine` here from the parts — the
 * rollup states it, and a second derivation is a second number.
 */
export interface StatementLines {
  grossSales: number
  /** Gross less net-after-commissions, as a POSITIVE cost. */
  commissions: number
  cogsValue: number
  /** The whole blended wage bill — see `prime-cost.ts`'s "WHICH LABOUR". */
  laborValue: number
  /** Rent. Named for the line an owner reads, not for the column it comes from. */
  occupancy: number
  /** Towels, cleaning and any custom fixed expense: the remainder, clamped. */
  otherOperating: number
  bottomLine: number
  /** `null` with no sales — never `0`. See the module note. */
  marginPct: number | null
  /**
   * A FRACTION, not a percent — `getAllStoresPnL` divides and does not scale.
   *
   * These are the rollup's own ratios, carried through rather than recomputed.
   * For the ROUNDED percentages a page prints beside the prime-cost ceiling,
   * read `prime` — one figure, one owner, at whatever precision is wanted.
   */
  cogsPct: number
  laborPct: number
}

export interface StoreStatement extends StatementLines {
  storeId: string
  storeName: string
  /** Whether this store's file carries both a labour budget and a rent. */
  fixedCostsConfigured: boolean
  /** On this store's own denominator. */
  prime: PrimeCost
  /** This store's P&L, bucket by bucket. */
  rows: PnLRow[]
}

export interface Statement extends StatementLines {
  /** Calendar days in the range asked for. */
  days: number
  prime: PrimeCost
  /**
   * The stores behind the lines above, and only those: filtered to the
   * selection, so a single-store statement holds exactly one entry whose lines
   * ARE the lines above it. Every figure here sums to its headline (note 39).
   */
  perStore: StoreStatement[]
  /**
   * EVERY store the rollup answered for, whatever the selection — the same
   * call's whole answer, not a second query.
   *
   * `perStore` is the right list for a section that must sum to the headline
   * above it, and the wrong one for a section that is ABOUT the stores: the
   * P&L's "By store" table lists all three stores while the rest of the page
   * is scoped to one, because the reader's question there is which stores are
   * in the statement and which are not. Deriving that from a second
   * `getAllStoresPnL` call with `storeId: null` would be a second set of
   * bounds and a second rollup for one page — exactly the shape note 60 came
   * back through — so it is taken off the call already made.
   *
   * Identical to `perStore` when nothing is selected. Populated even when the
   * selected store is not on the account (`storeNotFound`), because "which
   * stores does this account have" is still an answer, and it is the one that
   * tells the reader what they can look at instead.
   */
  allStores: StoreStatement[]
  /**
   * A `storeId` the rollup has no row for. The lines are zeroed and `perStore`
   * is empty — never a silent fall back to the whole account, which is a page
   * that answers a question nobody asked.
   */
  storeNotFound: boolean
  /** The selection's P&L, bucket by bucket: one store's rows, or the consolidated ones. */
  rows: PnLRow[]
  periods: Period[]
}

type RollupOk = Extract<AllStoresPnLResult, { combined: unknown }>
type RollupLines = RollupOk["combined"]

function linesFrom(k: RollupLines): StatementLines {
  const occupancy = k.rentValue
  return {
    grossSales: k.grossSales,
    commissions: k.grossSales - k.netAfterCommissions,
    cogsValue: k.cogsValue,
    laborValue: k.laborValue,
    occupancy,
    // `Math.max(0, …)` and not `Math.abs` — a genuinely negative remainder
    // would be a fixed-cost row that does not belong under fixed costs, and
    // hiding its sign would hide that. Zero is the honest floor.
    otherOperating: Math.max(0, k.fixedCosts - k.laborValue - occupancy),
    bottomLine: k.bottomLine,
    marginPct: k.grossSales <= 0 ? null : k.marginPct,
    cogsPct: k.cogsPct,
    laborPct: k.laborPct,
  }
}

function primeFor(lines: StatementLines): PrimeCost {
  return primeCost({
    grossSales: lines.grossSales,
    cogsValue: lines.cogsValue,
    laborValue: lines.laborValue,
  })
}

function storeStatement(s: RollupOk["perStore"][number]): StoreStatement {
  const lines = linesFrom(s)
  return {
    ...lines,
    storeId: s.storeId,
    storeName: s.storeName,
    fixedCostsConfigured: s.fixedCostsConfigured,
    prime: primeFor(lines),
    rows: s.rows,
  }
}

const NO_LINES: StatementLines = {
  grossSales: 0,
  commissions: 0,
  cogsValue: 0,
  laborValue: 0,
  occupancy: 0,
  otherOperating: 0,
  bottomLine: 0,
  marginPct: null,
  cogsPct: 0,
  laborPct: 0,
}

/**
 * NOTE ON THE ACCOUNT, because its absence here is deliberate and every other
 * Counter loader takes one. `getAllStoresPnL` reads the account off the
 * SESSION and caches under it, so an `accountId` passed here was forwarded
 * nowhere and judged nothing — two callers could hand it two different
 * accounts and get the same answer. Task 1 kept it for symmetry with
 * `loadChannelMix` and `loadStripTargets`, which genuinely scope their own
 * queries by it; Task 3 found no use for it and removed it, because a
 * parameter that looks load-bearing and is not is worse than none. The
 * adapters still take an account — they need it for the loaders that DO use
 * it — they simply stop passing it here.
 */
export interface StatementInput {
  range: DateRange
  /** `null` = every store on the account. */
  storeId: string | null
  /** Overrides the granularity the range implies. See `granularityFor`. */
  granularity?: Granularity
}

/**
 * ONE `getAllStoresPnL` call, reduced to the statement.
 *
 * Throws on the rollup's `{ error }` rather than returning an empty statement:
 * "P&L is restricted to owners" is a refusal the reader must SEE, and a
 * zeroed cascade would print it as a restaurant that took no money.
 */
export async function loadStatement(input: StatementInput): Promise<Statement> {
  const { range, storeId } = input
  const granularity = input.granularity ?? granularityFor(range)

  const result = await getAllStoresPnL({ ...toQueryBounds(range), granularity })
  if ("error" in result) throw new Error(result.error)

  const days = dayCount(range)
  const selected = result.perStore.filter((s) => storeId === null || s.storeId === storeId)

  const allStores = result.perStore.map(storeStatement)

  if (storeId !== null && selected.length === 0) {
    return {
      ...NO_LINES,
      days,
      prime: primeFor(NO_LINES),
      perStore: [],
      allStores,
      storeNotFound: true,
      rows: [],
      periods: result.periods,
    }
  }

  const lines = storeId === null ? linesFrom(result.combined) : linesFrom(selected[0])

  return {
    ...lines,
    days,
    prime: primeFor(lines),
    // Filtered out of the list already built, rather than mapped a second
    // time: one `StoreStatement` per store, so a figure read off `perStore`
    // and the same figure read off `allStores` are the same object.
    perStore:
      storeId === null ? allStores : allStores.filter((p) => p.storeId === storeId),
    allStores,
    storeNotFound: false,
    rows: storeId === null ? result.consolidatedRows : selected[0].rows,
    periods: result.periods,
  }
}
