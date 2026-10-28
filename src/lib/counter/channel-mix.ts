import { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import { CHANNELS, type ChannelId } from "@/lib/counter/channels"
import { toQueryBounds, type DateRange } from "@/lib/counter/date-range"
import { otterRangeTags, rangeTtl } from "@/lib/cache/range"
import { cached, stableKey } from "@/lib/cache/cached"
import { getScopedStores } from "@/lib/account-stores"
import { rowSales } from "@/lib/pnl"
import {
  loadOrderFeeGroups,
  storeRateFor,
  totalCommission,
  type CommissionTotals,
  type OrderFeeGroup,
  type StoreCommissionRates,
} from "@/lib/counter/commission"

/**
 * Per-channel net, orders, commission and average ticket for a range.
 *
 * Nothing else in the codebase answers this. `getAllStoresPnL` returns
 * `channelMix: Array<{ channel, amount }>` — net per GL sales line and
 * nothing more, no orders and no per-channel commission — and
 * `getChannelMix` (F24, the mix optimiser) is a fixed trailing-90-day
 * window keyed on the raw platform slug. Counter needs the four channel ids
 * in `channels.ts`, scoped to the range the reader picked.
 *
 * ONE query answers it, because `OtterDailySummary` already carries net,
 * gross and order count at (store, date, platform, paymentMethod) grain.
 * Deriving orders from a second source would let the two disagree — the
 * ticket in this table has to be the net in this table over the orders in
 * this table, or the row is three numbers that were never true together.
 */

export interface ChannelReading {
  channel: ChannelId
  /**
   * Net sales on this channel over the range — the statement's figure:
   * gross + service charges + discounts + refunds, via `rowSales` in
   * `@/lib/pnl`. Summed over the four channels it is the P&L's Net Sales less
   * any slug with no Counter channel. NOT Otter's `fpNetSales`/`tpNetSales`.
   */
  net: number
  orders: number
  /**
   * What the marketplace kept, from `@/lib/counter/commission` — the same
   * function the P&L's commission lines come from: recorded fees, plus the
   * store's rate for the platform and mode × the after-discount ticket on
   * orders that came without one.
   *
   * `0` for in-house — there is no marketplace. `null` when not one order on
   * the channel could be priced (no recorded fee and no rate on file); never
   * a quiet $0, which would claim the marketplace works for free.
   */
  commission: number | null
  /** How `commission` was arrived at. Absent for in-house. */
  commissionBasis?: CommissionTotals
  /**
   * `net / orders`, and `null` when there were no orders.
   *
   * NEVER `0`. A channel with no orders has no average ticket; zero is the
   * claim that every order on it was free.
   */
  ticket: number | null
}

export interface ChannelMixInput {
  range: DateRange
  /** null = every active store on the account. */
  storeId: string | null
  /**
   * The account the reader belongs to. Not optional and not derivable here:
   * without it, `storeId: null` would mean "every store in the database".
   *
   * This module deliberately does not fetch its own session — importing
   * `@/lib/auth` pulls in `@/lib/prisma` at MODULE LOAD, which throws without
   * `DATABASE_URL` and takes every importer down with it, tests included.
   * The page already has an accountId from its own session lookup, and
   * `src/lib/counter/adapters/overview.ts` takes it the same way and for the
   * same reason.
   */
  accountId: string
}

/**
 * Which Counter channel a raw Otter platform slug belongs to.
 *
 * `css-pos` (the in-store POS) and `bnm-web` (the restaurant's own web
 * ordering) are both the house channel: the money arrives without a
 * marketplace in between, which is the distinction the channel column is
 * actually about. `src/lib/pnl.ts` groups them the same way (`FP_PLATFORMS`).
 *
 * Anything not listed — `chownow`, `caviar`, and whatever Otter adds next —
 * has no Counter channel and no CVD-safe band assigned to it, so it is left
 * out rather than folded into one of the four. Inventing a fifth id here
 * would put an unassigned colour on a stacked chart; folding it into `house`
 * would report marketplace volume as commission-free.
 */
export const CHANNEL_FOR_PLATFORM: Record<string, ChannelId> = {
  "css-pos": "house",
  "bnm-web": "house",
  doordash: "doordash",
  ubereats: "ubereats",
  grubhub: "grubhub",
}

/**
 * Raw Otter platform slugs whose channel is `house` — i.e. the money arrived
 * without a marketplace in between. Derived from `CHANNEL_FOR_PLATFORM` so
 * that inside the Counter layer there is one place that decides "in-house",
 * not a second `"css-pos"` string literal wherever something needs to exclude
 * the house channel (e.g. a third-party-only aggregate).
 *
 * ## IT IS NOT THE ONLY PLACE IN THE REPOSITORY, and this used to say it was
 *
 * The same set is defined independently, as its own literal, in four more:
 *
 *   src/lib/pnl.ts                              FP_PLATFORMS
 *   src/lib/dashboard/channel-fold.ts           FP_PLATFORMS
 *   src/lib/otter-analytics-aggregation.ts      FP_PLATFORMS
 *   src/lib/otter-metrics-sync.ts               inline `=== "css-pos" || …`
 *
 * plus three inline copies inside
 * `src/app/actions/store/dashboard-analytics-actions.ts`. Those belong to the
 * sync layer and the pre-Counter editorial stack rather than to this one, so
 * they are not wrong to exist yet — but a claim that this is THE one place
 * would send the next person who adds a first-party slug home after changing
 * one of five. Say where to look instead.
 */
export const HOUSE_PLATFORMS: readonly string[] = Object.entries(
  CHANNEL_FOR_PLATFORM
)
  .filter(([, channel]) => channel === "house")
  .map(([platform]) => platform)

/** The house channel's platforms are first-party: their figures are the `fp*` columns. */
const FIRST_PARTY: ReadonlySet<ChannelId> = new Set<ChannelId>(["house"])

interface SummaryRow {
  storeId: string
  platform: string
  fpGrossSales: number | null
  fpOrderCount: number | null
  tpGrossSales: number | null
  tpOrderCount: number | null
  fpDiscounts: number | null
  tpDiscounts: number | null
  fpServiceCharges: number | null
  tpServiceCharges: number | null
  fpTaxCollected: number | null
  tpTaxCollected: number | null
  tpRefundsAdjustments: number | null
}

export type StoreRates = StoreCommissionRates & { id: string }

/**
 * The DELIVERY commission rate this store has set for a channel, or `null`
 * where it has none — the menu-item page's "what does a marketplace take of
 * this item" uses it. Delegates to `storeRateFor` in `commission-core.ts`, the
 * one rule for rates; `0` for in-house, `null` for a missing store.
 */
export function commissionRateFor(
  channel: ChannelId,
  store: StoreRates | null,
): number | null {
  if (channel === "house") return 0
  return storeRateFor(store, channel, "delivery")
}

export async function loadChannelMix(
  input: ChannelMixInput,
): Promise<ChannelReading[]> {
  const { range, storeId, accountId } = input
  const { startDate, endDate } = toQueryBounds(range)

  // One `cache()`d store read per request, shared with every other loader on
  // the page, instead of this function's own query — which the Overview's
  // per-store fan-out used to repeat once per store. `getScopedStores` keeps
  // the contract below exactly: a storeId that is not on this account
  // resolves to no stores, not to the whole account.
  const stores = await getScopedStores(accountId, storeId ?? null)
  if (stores.length === 0) return []

  const ratesByStore = new Map<string, StoreRates>(stores.map((s) => [s.id, s]))
  const storeIds = stores.map((s) => s.id)

  const [rows, groups] = await Promise.all([
    queryChannelRows(storeIds, startDate, endDate),
    loadOrderFeeGroups({ accountId, storeIds, startDate, endDate }),
  ])

  return foldToChannels(rows, groups, ratesByStore)
}

/**
 * The same reading, PER STORE, from ONE query.
 *
 * `getOverviewSectionPromises` used to build this by calling
 * `loadChannelMix` once per operational store — 2 queries each, none of them
 * cached — which is 2N where 1 will do. The reason given in that adapter was
 * that "loadChannelMix aggregates rather than grouping", and that was half
 * true: the SQL has always ended `GROUP BY "storeId", "platform"` and
 * returned per-store rows. Only the JS fold threw the store away.
 *
 * So this shares the query and partitions the rows it already has. A store
 * with no rows in the range gets an empty array rather than being absent, so
 * a caller can tell "traded nothing" from "not on this account" — the latter
 * never reaches here, because `getScopedStores` filtered it out first.
 */
export async function loadChannelMixByStore(
  input: ChannelMixInput,
): Promise<Map<string, ChannelReading[]>> {
  const { range, storeId, accountId } = input
  const { startDate, endDate } = toQueryBounds(range)

  const stores = await getScopedStores(accountId, storeId ?? null)
  if (stores.length === 0) return new Map()

  const ratesByStore = new Map<string, StoreRates>(stores.map((s) => [s.id, s]))
  const storeIds = stores.map((s) => s.id)
  const [rows, groups] = await Promise.all([
    queryChannelRows(storeIds, startDate, endDate),
    loadOrderFeeGroups({ accountId, storeIds, startDate, endDate }),
  ])

  const byStore = new Map<string, SummaryRow[]>()
  for (const r of rows) {
    const list = byStore.get(r.storeId) ?? []
    list.push(r)
    byStore.set(r.storeId, list)
  }
  const groupsByStore = new Map<string, OrderFeeGroup[]>()
  for (const g of groups) {
    const list = groupsByStore.get(g.storeId) ?? []
    list.push(g)
    groupsByStore.set(g.storeId, list)
  }

  return new Map(
    stores.map((s) => [
      s.id,
      foldToChannels(byStore.get(s.id) ?? [], groupsByStore.get(s.id) ?? [], ratesByStore),
    ]),
  )
}

/**
 * The one summary read both loaders share.
 *
 * ## Why the cache sits HERE and not on either loader
 *
 * `loadChannelMix` returns an array and `loadChannelMixByStore` returns a
 * `Map`, and a `Map` does not survive the Redis JSON round-trip — it comes back
 * as `{}`, which folds to a channel strip of zeroes rather than an error. This
 * function is the shared Prisma call underneath both, and `SummaryRow` is
 * entirely strings and numbers, so it round-trips exactly. Caching the shared
 * read also means the two loaders cannot disagree about a range: they now fold
 * the same rows.
 *
 * The fold itself stays uncached. It is pure arithmetic over rows already in
 * memory, and `foldToChannels` is deliberately the single implementation of
 * that arithmetic — caching its output per shape would reintroduce the second
 * copy the docblock below exists to prevent.
 */
function queryChannelRows(
  storeIds: string[],
  startDate: Date,
  endDate: Date,
): Promise<SummaryRow[]> {
  return cached(
    // Store ids rather than the account: `getScopedStores` has already resolved
    // the account and the store filter into this exact list, so two readers with
    // different scopes cannot collide on one key.
    `counter:chanrows2:${stableKey({
      ids: [...storeIds].sort(),
      from: startDate,
      to: endDate,
    })}`,
    rangeTtl(endDate),
    otterRangeTags(startDate, endDate),
    () => queryChannelRowsUncached(storeIds, startDate, endDate),
  )
}

function queryChannelRowsUncached(
  storeIds: string[],
  startDate: Date,
  endDate: Date,
): Promise<SummaryRow[]> {
  return prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
    SELECT
      "storeId",
      "platform",
      SUM(COALESCE("fpGrossSales", 0))::double precision         AS "fpGrossSales",
      SUM(COALESCE("fpOrderCount", 0))::integer                  AS "fpOrderCount",
      SUM(COALESCE("tpGrossSales", 0))::double precision         AS "tpGrossSales",
      SUM(COALESCE("tpOrderCount", 0))::integer                  AS "tpOrderCount",
      SUM(COALESCE("fpDiscounts", 0))::double precision          AS "fpDiscounts",
      SUM(COALESCE("tpDiscounts", 0))::double precision          AS "tpDiscounts",
      SUM(COALESCE("fpServiceCharges", 0))::double precision     AS "fpServiceCharges",
      SUM(COALESCE("tpServiceCharges", 0))::double precision     AS "tpServiceCharges",
      SUM(COALESCE("fpTaxCollected", 0))::double precision       AS "fpTaxCollected",
      SUM(COALESCE("tpTaxCollected", 0))::double precision       AS "tpTaxCollected",
      SUM(COALESCE("tpRefundsAdjustments", 0))::double precision AS "tpRefundsAdjustments"
    FROM "OtterDailySummary"
    WHERE "storeId" IN (${Prisma.join(storeIds)})
      AND "date" >= ${startDate}
      AND "date" <= ${endDate}
    GROUP BY "storeId", "platform"
  `)
}

/**
 * Summary rows folded into one reading per channel, in CHANNELS order.
 *
 * Extracted from `loadChannelMix` so the per-store variant above produces
 * byte-identical readings rather than a second implementation of the same
 * arithmetic — two folds is how two surfaces come to print two different
 * commissions for one range.
 */
function foldToChannels(
  rows: SummaryRow[],
  groups: OrderFeeGroup[],
  ratesByStore: Map<string, StoreRates>,
): ChannelReading[] {
  const acc = new Map<
    ChannelId,
    { net: number; orders: number; commission: number | null; basis?: CommissionTotals }
  >()

  for (const r of rows) {
    const channel = CHANNEL_FOR_PLATFORM[r.platform]
    if (!channel) continue

    const firstParty = FIRST_PARTY.has(channel)
    const net = rowSales(r).net
    const orders = (firstParty ? r.fpOrderCount : r.tpOrderCount) ?? 0
    // A platform that traded nothing in the range is not a row. Otter keeps
    // emitting zeroed rows for channels a store once used.
    if (net === 0 && orders === 0) continue

    const bucket = acc.get(channel) ?? { net: 0, orders: 0, commission: firstParty ? 0 : null }
    bucket.net += net
    bucket.orders += orders
    acc.set(channel, bucket)
  }

  // Commission per marketplace channel, off the order rows, by the one rule.
  for (const [channel, bucket] of acc) {
    if (FIRST_PARTY.has(channel)) continue
    const basis = totalCommission(
      groups,
      ratesByStore,
      (g) => CHANNEL_FOR_PLATFORM[g.platform] === channel,
    )
    bucket.basis = basis
    // Sales on file and not one order to price them from is a sync gap, not
    // a free marketplace — the P&L flags the same case on its line.
    bucket.commission = basis.orders === 0 && bucket.net > 0 ? null : basis.amount
  }

  // CHANNELS order, not size order. The band is fixed to the channel (notes
  // 36/41), so a range where DoorDash outsells in-house must not reorder or
  // repaint anything.
  return CHANNELS.flatMap((c) => {
    const bucket = acc.get(c.id)
    if (!bucket) return []
    return [
      {
        channel: c.id,
        net: bucket.net,
        orders: bucket.orders,
        commission: bucket.commission,
        ...(bucket.basis ? { commissionBasis: bucket.basis } : {}),
        ticket: bucket.orders > 0 ? bucket.net / bucket.orders : null,
      },
    ]
  })
}
