import type { Period } from "@/lib/pnl"

/**
 * What the marketplaces kept — the pure half of the ONE commission function.
 *
 * `./commission.ts` runs the query; this file owns every rule, and has no
 * Prisma in it so that `src/lib/pnl.ts` (pure, imported by tests that never
 * mock a database) can use the same arithmetic.
 *
 * ## The rule, for one order
 *
 * 1. Cancelled orders (`orderStatus = 'OFO_STATUS_CANCELED'`) are not counted.
 * 2. An order Otter sent WITH a fee (`commission <> 0`) costs that fee —
 *    `feeAmount`, the positive amount, see `order-signs.ts`.
 * 3. An order sent WITHOUT one is estimated at the STORE's own rate for its
 *    platform and fulfilment mode × `max(0, subtotal + discount)`. The rates
 *    are owner-edited settings on the store file, charged on the price AFTER
 *    discounts — which is the basis every recorded DoorDash fee reconciles to
 *    (`order-signs.ts`'s worked row). Grubhub's observed fee is 25% of the
 *    full subtotal, its discounts looking platform-funded; it is still
 *    charged after discount here, the same as the others, so a heavily
 *    discounted Grubhub order is estimated a little low rather than a rule
 *    being invented for one platform from one month of data.
 * 4. A platform with no rate on file (ChowNow, Caviar, a store that cleared a
 *    rate) is UNKNOWN, never 0. Its orders are counted under `unknownOrders`
 *    so every surface can say the total is short.
 *
 * Why not Otter's per-day `tpFees`, or a flat rate on gross: on 2026-10-28
 * only 50–75% of marketplace orders carried a recorded fee, and the P&L's old
 * flat 21%/25% of PRE-discount gross overstated commission by about $9k a
 * month at Hollywood. Recorded where we have it, the store's own rate where we
 * do not, is the reading that is right on both halves.
 */

export type FulfillmentKind = "delivery" | "pickup"

/**
 * The in-house platforms — no marketplace, no commission. The same set as
 * `HOUSE_PLATFORMS` in `channel-mix.ts` (a test holds them equal); spelled
 * here because `channel-mix.ts` imports this module and the reverse import
 * would be a cycle.
 */
export const COMMISSION_FREE_PLATFORMS: readonly string[] = ["css-pos", "bnm-web"]

/** The commission lines the P&L prints. Everything that is not one of the three is `other`. */
export type CommissionLine = "ubereats" | "doordash" | "grubhub" | "other"

export const COMMISSION_LINES: readonly CommissionLine[] = [
  "ubereats",
  "doordash",
  "grubhub",
  "other",
]

export function commissionLineFor(platform: string): CommissionLine {
  if (platform === "ubereats" || platform === "doordash" || platform === "grubhub") return platform
  return "other"
}

/** `OtterOrder.fulfillmentMode` → the two kinds a rate is set for. Null and unknown modes are delivery. */
export function fulfillmentKind(mode: string | null | undefined): FulfillmentKind {
  return mode === "FULFILLMENT_MODE_PICKUP" ? "pickup" : "delivery"
}

/** The store's rate columns. Delivery rates are required columns; the rest may be null. */
export interface StoreCommissionRates {
  id?: string
  uberCommissionRate: number | null
  doordashCommissionRate: number | null
  uberPickupCommissionRate?: number | null
  doordashPickupCommissionRate?: number | null
  grubhubCommissionRate?: number | null
}

/**
 * The store's rate for one platform and mode, or `null` where none is set.
 * `null` is "not known" and must never be read as free.
 */
export function storeRateFor(
  store: StoreCommissionRates | null | undefined,
  platform: string,
  mode: FulfillmentKind,
): number | null {
  if (!store) return null
  const v = (() => {
    switch (platform) {
      case "ubereats":
        return mode === "pickup" ? store.uberPickupCommissionRate : store.uberCommissionRate
      case "doordash":
        return mode === "pickup" ? store.doordashPickupCommissionRate : store.doordashCommissionRate
      case "grubhub":
        return store.grubhubCommissionRate
      default:
        return null
    }
  })()
  return v == null || !Number.isFinite(v) ? null : v
}

/** One row of the grouped OtterOrder read. Cancelled orders are already excluded. */
export interface OrderFeeGroup {
  storeId: string
  /**
   * `YYYY-MM-DD` of `referenceTimeLocal` (LA wall-clock). Matches
   * `OtterDailySummary.date` — checked against production 2026-10-28.
   */
  day: string
  platform: string
  mode: FulfillmentKind
  /** True when every order in the group carries a recorded fee. */
  recorded: boolean
  orders: number
  /** Σ positive recorded fee. 0 on an unrecorded group. */
  fee: number
  /** Σ `max(0, subtotal + discount)`. */
  ticket: number
}

/** Commission over some set of orders. All money positive. */
export interface CommissionTotals {
  /**
   * Recorded + estimated, or `null` when there were orders and NOT ONE of
   * them could be priced. A partly-known total is a number with
   * `unknownOrders > 0` beside it.
   */
  amount: number | null
  recorded: number
  estimated: number
  orders: number
  /** Orders whose fee came from Otter. */
  ordersRecorded: number
  /** Orders priced at the store's rate. */
  ordersEstimated: number
  /** Orders with neither — no recorded fee and no rate on file. */
  unknownOrders: number
  /**
   * Of `ordersEstimated`, the orders priced from the DAILY SUMMARY because
   * their order rows were missing or partial (see `reconcileWithSales`).
   * Their fee is the delivery rate × the channel's net sales that day.
   */
  ordersFromSales: number
  /** After-discount ticket on the marketplace orders counted. */
  ticket: number
}

export const NO_COMMISSION: CommissionTotals = {
  amount: 0,
  recorded: 0,
  estimated: 0,
  orders: 0,
  ordersRecorded: 0,
  ordersEstimated: 0,
  unknownOrders: 0,
  ordersFromSales: 0,
  ticket: 0,
}

function finish(t: Omit<CommissionTotals, "amount">): CommissionTotals {
  const known = t.ordersRecorded + t.ordersEstimated
  return {
    ...t,
    amount: t.orders > 0 && known === 0 ? null : t.recorded + t.estimated,
  }
}

/** Add one group's orders into a running total. */
function addGroup(
  acc: Omit<CommissionTotals, "amount">,
  g: OrderFeeGroup,
  rates: Map<string, StoreCommissionRates>,
): void {
  acc.orders += g.orders
  acc.ticket += g.ticket
  if (g.recorded) {
    acc.recorded += g.fee
    acc.ordersRecorded += g.orders
    return
  }
  const rate = storeRateFor(rates.get(g.storeId), g.platform, g.mode)
  if (rate === null) {
    acc.unknownOrders += g.orders
    return
  }
  acc.estimated += rate * g.ticket
  acc.ordersEstimated += g.orders
}

const empty = (): Omit<CommissionTotals, "amount"> => ({
  recorded: 0,
  estimated: 0,
  orders: 0,
  ordersRecorded: 0,
  ordersEstimated: 0,
  unknownOrders: 0,
  ordersFromSales: 0,
  ticket: 0,
})

function addTotals(acc: Omit<CommissionTotals, "amount">, p: Omit<CommissionTotals, "amount">): void {
  acc.recorded += p.recorded
  acc.estimated += p.estimated
  acc.orders += p.orders
  acc.ordersRecorded += p.ordersRecorded
  acc.ordersEstimated += p.ordersEstimated
  acc.unknownOrders += p.unknownOrders
  acc.ordersFromSales += p.ordersFromSales
  acc.ticket += p.ticket
}

/**
 * One store's marketplace trade on one day on one platform, off
 * `OtterDailySummary` — the check on whether the order rows are complete.
 */
export interface SalesSlice {
  storeId: string
  /** `YYYY-MM-DD`, the summary's `date`. */
  day: string
  platform: string
  /** `tpOrderCount`. */
  orders: number
  /** The statement's net for the slice: gross + discounts + refunds (`rowSales`). */
  net: number
}

/** Day key of an `OtterDailySummary.date` (a `@db.Date`, read back as UTC midnight). */
export function summaryDay(date: Date | string): string {
  return typeof date === "string" ? date.slice(0, 10) : date.toISOString().slice(0, 10)
}

/**
 * Fold summary rows (one per platform × payment method) into one slice per
 * store/day/platform. `net` is the caller's `rowSales(r).net`.
 */
export function salesSlices(
  rows: Array<{ storeId: string; date: Date | string; platform: string; orders: number | null; net: number }>,
): SalesSlice[] {
  const out = new Map<string, SalesSlice>()
  for (const r of rows) {
    if (COMMISSION_FREE_PLATFORMS.includes(r.platform)) continue
    const day = summaryDay(r.date)
    const k = `${r.storeId}|${day}|${r.platform}`
    const sl = out.get(k) ?? { storeId: r.storeId, day, platform: r.platform, orders: 0, net: 0 }
    sl.orders += r.orders ?? 0
    sl.net += r.net
    out.set(k, sl)
  }
  return [...out.values()]
}

/** Below this share of the summary's order count, the order rows are not trusted for the slice. */
export const ORDER_ROW_COVERAGE_FLOOR = 0.9

/** A store/day/platform slice and the commission it carries, after reconciliation. */
interface Cell {
  storeId: string
  day: string
  platform: string
  totals: Omit<CommissionTotals, "amount">
}

/**
 * Order rows, checked against the daily summary, slice by slice.
 *
 * `OtterOrder` history only starts 2026-01-02 while `OtterDailySummary` runs
 * back to 2025-02-21, and the order sync can lag the summary. So for every
 * (store, day, platform): when the non-cancelled order rows cover at least
 * 90% of the summary's `tpOrderCount`, the rows are priced by the per-order
 * rule; when they cover less (including none), the whole slice is priced
 * instead at the store's DELIVERY rate × the channel's net sales that day,
 * and counted as estimated (`ordersFromSales`). A slice with no rate is
 * unknown. A channel that sold is never $0.
 *
 * Without `slices` (the orders page, which lists the rows it has) this is
 * the per-order rule alone.
 */
function cellsOf(
  groups: OrderFeeGroup[],
  rates: Map<string, StoreCommissionRates>,
  slices?: SalesSlice[],
): Cell[] {
  const key = (storeId: string, day: string, platform: string) => `${storeId}|${day}|${platform}`
  const cells = new Map<string, Cell>()
  for (const g of groups) {
    const k = key(g.storeId, g.day, g.platform)
    const c = cells.get(k) ?? { storeId: g.storeId, day: g.day, platform: g.platform, totals: empty() }
    addGroup(c.totals, g, rates)
    cells.set(k, c)
  }
  if (!slices) return [...cells.values()]

  for (const sl of slices) {
    if (COMMISSION_FREE_PLATFORMS.includes(sl.platform)) continue
    if (sl.orders <= 0) continue
    const k = key(sl.storeId, sl.day, sl.platform)
    const rows = cells.get(k)?.totals.orders ?? 0
    if (rows >= ORDER_ROW_COVERAGE_FLOOR * sl.orders) continue
    const totals = empty()
    const ticket = Math.max(0, sl.net)
    totals.orders = sl.orders
    totals.ticket = ticket
    const rate = storeRateFor(rates.get(sl.storeId), sl.platform, "delivery")
    if (rate === null) {
      totals.unknownOrders = sl.orders
    } else {
      totals.estimated = rate * ticket
      totals.ordersEstimated = sl.orders
      totals.ordersFromSales = sl.orders
    }
    cells.set(k, { storeId: sl.storeId, day: sl.day, platform: sl.platform, totals })
  }
  return [...cells.values()]
}

/**
 * Commission over a set of groups, optionally filtered by store, day and
 * platform. Pass `slices` to check the rows against the daily summary first
 * (see `cellsOf`).
 */
export function totalCommission(
  groups: OrderFeeGroup[],
  rates: Map<string, StoreCommissionRates>,
  where: (g: { storeId: string; day: string; platform: string }) => boolean = () => true,
  slices?: SalesSlice[],
): CommissionTotals {
  const acc = empty()
  for (const c of cellsOf(groups, rates, slices)) if (where(c)) addTotals(acc, c.totals)
  return finish(acc)
}

/** Sum totals that were each computed by `totalCommission`. Null stays null only if every part is. */
export function addCommission(parts: CommissionTotals[]): CommissionTotals {
  const acc = empty()
  for (const p of parts) addTotals(acc, { ...p, ordersFromSales: p.ordersFromSales ?? 0 })
  return finish(acc)
}

/** Share of the counted orders whose fee came from Otter, 0..1, or null with no orders. */
export function recordedShare(t: CommissionTotals): number | null {
  return t.orders > 0 ? t.ordersRecorded / t.orders : null
}

/** True when any part of the figure is not a recorded fee: estimated at a rate, off daily sales, or unpriced. */
export function commissionIsEstimated(t: CommissionTotals): boolean {
  return t.ordersEstimated > 0 || t.unknownOrders > 0 || (t.ordersFromSales ?? 0) > 0
}

/**
 * The words that qualify a commission figure: "recorded", "estimated for 38%
 * of orders", plus what could not be priced. One phrasing for every page.
 */
export function commissionBasis(t: CommissionTotals): string {
  if (t.orders === 0) return "no marketplace orders"
  const parts: string[] = []
  const estShare = t.ordersEstimated / t.orders
  if (t.ordersEstimated === 0) parts.push("as recorded by the marketplaces")
  else parts.push(`estimated for ${Math.round(estShare * 100)}% of orders`)
  if ((t.ordersFromSales ?? 0) > 0) {
    parts.push(`${t.ordersFromSales} from daily sales, order detail missing`)
  }
  if (t.unknownOrders > 0) {
    parts.push(`${t.unknownOrders} order${t.unknownOrders === 1 ? "" : "s"} with no rate on file`)
  }
  return parts.join(" · ")
}

/** Period commission, one figure per P&L line. */
export type PeriodCommission = Record<CommissionLine, CommissionTotals>

/** Parse a `YYYY-MM-DD` day key to the UTC-midnight instant `OtterDailySummary.date` uses. */
export function dayInstant(day: string): number {
  return Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)))
}

/**
 * One store's groups bucketed onto the statement's periods, per P&L line.
 *
 * The day key is the calendar date of `referenceTimeLocal` (LA wall-clock
 * time), which is how `OtterDailySummary.date` is keyed, so an order lands in
 * the same period its sales do. Checked against production on 2026-10-28:
 * order rows bucketed this way matched the summary's daily `tpOrderCount`
 * exactly at Hollywood and Van Nuys for 10/13–10/19.
 *
 * Pass `slices` (the same stores' summary rows) so a day whose order rows are
 * missing or partial is priced from its sales instead — see `cellsOf`.
 */
export function bucketCommission(
  groups: OrderFeeGroup[],
  periods: Period[],
  rates: Map<string, StoreCommissionRates>,
  slices?: SalesSlice[],
): PeriodCommission[] {
  const accs = periods.map(() => ({
    ubereats: empty(),
    doordash: empty(),
    grubhub: empty(),
    other: empty(),
  }))
  for (const c of cellsOf(groups, rates, slices)) {
    const t = dayInstant(c.day)
    const idx = periods.findIndex(
      (p) => t >= p.startDate.getTime() && t <= p.endDate.getTime(),
    )
    if (idx === -1) continue
    addTotals(accs[idx][commissionLineFor(c.platform)], c.totals)
  }
  return accs.map((a) => ({
    ubereats: finish(a.ubereats),
    doordash: finish(a.doordash),
    grubhub: finish(a.grubhub),
    other: finish(a.other),
  }))
}

/**
 * The fallback when no order rows were supplied (a pure caller, a test): the
 * same rule with nothing recorded — the store's DELIVERY rate on the
 * after-discount sales of each platform. Only `computeStorePnL` uses it.
 */
export function estimateFromSales(
  salesAfterDiscount: Record<CommissionLine, number>,
  store: StoreCommissionRates,
): PeriodCommission {
  const one = (line: CommissionLine, platform: string): CommissionTotals => {
    const ticket = Math.max(0, salesAfterDiscount[line])
    if (ticket === 0) return NO_COMMISSION
    const rate = line === "other" ? null : storeRateFor(store, platform, "delivery")
    if (rate === null) {
      return { ...NO_COMMISSION, amount: null, ticket }
    }
    return { ...NO_COMMISSION, amount: rate * ticket, estimated: rate * ticket, ticket }
  }
  return {
    ubereats: one("ubereats", "ubereats"),
    doordash: one("doordash", "doordash"),
    grubhub: one("grubhub", "grubhub"),
    other: one("other", "other"),
  }
}

/** One observed rate for the store file: Σ recorded fee / Σ ticket on recorded orders. */
export interface ObservedRate {
  platform: string
  mode: FulfillmentKind
  /** Fraction, or `null` with no recorded orders to read it from. */
  rate: number | null
  orders: number
  /** Σ recorded fee and Σ after-discount ticket behind `rate`, so rates can be pooled exactly. */
  fee: number
  ticket: number
}

export function observedRates(groups: OrderFeeGroup[]): ObservedRate[] {
  const acc = new Map<string, { platform: string; mode: FulfillmentKind; fee: number; ticket: number; orders: number }>()
  for (const g of groups) {
    if (!g.recorded) continue
    const key = `${g.platform}:${g.mode}`
    const a = acc.get(key) ?? { platform: g.platform, mode: g.mode, fee: 0, ticket: 0, orders: 0 }
    a.fee += g.fee
    a.ticket += g.ticket
    a.orders += g.orders
    acc.set(key, a)
  }
  return [...acc.values()].map((a) => ({
    platform: a.platform,
    mode: a.mode,
    rate: a.ticket > 0 ? a.fee / a.ticket : null,
    orders: a.orders,
    fee: a.fee,
    ticket: a.ticket,
  }))
}
