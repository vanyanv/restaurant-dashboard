import { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import { CHANNELS, type ChannelId } from "@/lib/counter/channels"
import { toQueryBounds, type DateRange } from "@/lib/counter/date-range"
import { getScopedStores } from "@/lib/account-stores"

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
  /** Net sales on this channel over the range. */
  net: number
  orders: number
  /**
   * What the marketplace kept.
   *
   * `0` for in-house — there is no marketplace, so the answer is genuinely
   * zero. `null` for Grubhub, where the schema publishes NO rate: `Store` has
   * `uberCommissionRate` and `doordashCommissionRate` and nothing else, and a
   * commission column that quietly reads $0 for Grubhub is the claim that
   * Grubhub works for free. Same rule as `ticket` below.
   *
   * Uber and DoorDash are the store's configured rate applied to GROSS, which
   * is what the P&L's commission lines do (`computePnL`, and the schema's own
   * note on those columns: "Applied to tpGrossSales on the P&L"). One figure,
   * one derivation — a commission that disagreed with the P&L for the same
   * range would be note 60 all over again.
   */
  commission: number | null
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
 * there is one place that decides "in-house", not a second `"css-pos"`
 * string literal wherever something needs to exclude the house channel
 * (e.g. a third-party-only aggregate).
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
  fpNetSales: number | null
  fpGrossSales: number | null
  fpOrderCount: number | null
  tpNetSales: number | null
  tpGrossSales: number | null
  tpOrderCount: number | null
}

interface StoreRates {
  id: string
  uberCommissionRate: number
  doordashCommissionRate: number
}

/**
 * The commission rate this store has on this channel, or `null` where the
 * schema publishes none. Not a lookup into `channels.ts` — the `commission`
 * field there is the design system's identity constant from the prototype,
 * not this restaurant's contract.
 */
function rateFor(channel: ChannelId, store: StoreRates): number | null {
  if (channel === "house") return 0
  if (channel === "ubereats") return store.uberCommissionRate
  if (channel === "doordash") return store.doordashCommissionRate
  return null
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

  const rows = await prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
    SELECT
      "storeId",
      "platform",
      SUM(COALESCE("fpNetSales", 0))::double precision   AS "fpNetSales",
      SUM(COALESCE("fpGrossSales", 0))::double precision AS "fpGrossSales",
      SUM(COALESCE("fpOrderCount", 0))::integer          AS "fpOrderCount",
      SUM(COALESCE("tpNetSales", 0))::double precision   AS "tpNetSales",
      SUM(COALESCE("tpGrossSales", 0))::double precision AS "tpGrossSales",
      SUM(COALESCE("tpOrderCount", 0))::integer          AS "tpOrderCount"
    FROM "OtterDailySummary"
    WHERE "storeId" IN (${Prisma.join(storeIds)})
      AND "date" >= ${startDate}
      AND "date" <= ${endDate}
    GROUP BY "storeId", "platform"
  `)

  const acc = new Map<ChannelId, { net: number; orders: number; commission: number | null }>()

  for (const r of rows) {
    const channel = CHANNEL_FOR_PLATFORM[r.platform]
    if (!channel) continue

    const firstParty = FIRST_PARTY.has(channel)
    const net = (firstParty ? r.fpNetSales : r.tpNetSales) ?? 0
    const gross = (firstParty ? r.fpGrossSales : r.tpGrossSales) ?? 0
    const orders = (firstParty ? r.fpOrderCount : r.tpOrderCount) ?? 0
    // A platform that traded nothing in the range is not a row. Otter keeps
    // emitting zeroed rows for channels a store once used.
    if (net === 0 && orders === 0) continue

    const bucket = acc.get(channel) ?? { net: 0, orders: 0, commission: null }
    bucket.net += net
    bucket.orders += orders

    const rate = rateFor(channel, ratesByStore.get(r.storeId) ?? {
      id: r.storeId,
      uberCommissionRate: 0,
      doordashCommissionRate: 0,
    })
    // An unrateable channel stays null however many stores contribute to it:
    // a sum that treats "no published rate" as zero is a fabricated total.
    if (rate !== null) bucket.commission = (bucket.commission ?? 0) + rate * gross

    acc.set(channel, bucket)
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
        ticket: bucket.orders > 0 ? bucket.net / bucket.orders : null,
      },
    ]
  })
}
