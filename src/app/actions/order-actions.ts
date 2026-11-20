// Server-only, not a server action: nothing in the browser calls these, so
// they are plain functions and cannot be invoked from outside the server.
// Browser saves go through `src/lib/counter/actions/`.
import "server-only"
import { getSession } from "@/lib/auth-scope"
import { unstable_cache } from "next/cache"
import { prisma } from "@/lib/prisma"
import { getAccountStoreRows } from "@/lib/account-stores"
import { Prisma } from "@/generated/prisma/client"
import { persistOrderItems } from "@/lib/otter-orders-sync"
import { HOUSE_PLATFORMS } from "@/lib/counter/channel-mix"
import {
  fulfillmentKind,
  totalCommission,
  type OrderFeeGroup,
  type StoreCommissionRates,
} from "@/lib/counter/commission-core"

/** Distinct platforms across an account's orders, cached for an hour.
 * The previous shape was a `distinct: ["platform"]` findMany inside every
 * getOrdersList call — at 41k+ rows that was a full-table scan on every
 * filter change. Tag is invalidated on order ingest (revalidateTag in the
 * sync routes once we wire that up); until then the TTL falls back. */
const getPlatformsForAccount = unstable_cache(
  async (accountId: string): Promise<string[]> => {
    // The one store query a request makes — `@/lib/account-stores`.
    const stores = await getAccountStoreRows(accountId)
    const storeIds = stores.map((s) => s.id)
    if (storeIds.length === 0) return []

    const rows = await prisma.otterOrder.findMany({
      where: { storeId: { in: storeIds } },
      distinct: ["platform"],
      select: { platform: true },
      orderBy: { platform: "asc" },
    })
    return rows.map((r) => r.platform)
  },
  ["order-platforms-by-account"],
  { revalidate: 3600, tags: ["order-platforms"] }
)

export type OrderListFilters = {
  storeId?: string | null
  platform?: string | null
  /**
   * Raw Otter platform slugs; an order matching ANY of them is returned.
   * Supersedes `platform`, which stays for callers that pass a single slug.
   *
   * A channel is not a platform: `css-pos` and `bnm-web` are both the `house`
   * channel, so "In-house" cannot be expressed with one slug at all.
   *
   * An EMPTY array means no platform filter — every channel. A reader who has
   * deselected every toggle (or pressed Clear) is asking to see everything,
   * and `{ in: [] }` would answer that with zero rows.
   */
  platforms?: string[] | null
  startDate?: string | null
  endDate?: string | null
  search?: string | null
  detailsOnly?: boolean
  limit?: number
  cursor?: string | null
  /**
   * Fetch only `totalCount` and `totals.netSales`, in ONE aggregate.
   *
   * For a caller that compares two ranges and shows the second one's headline
   * figures only — the Orders strip's "vs prior period". Every other field
   * comes back at its zero value, so this is not a cheaper way to ask the same
   * question: it is a different, smaller question. See `getOrdersList`.
   */
  summaryOnly?: boolean
}

export type OrderListRow = {
  id: string
  otterOrderId: string
  externalDisplayId: string | null
  storeId: string
  storeName: string
  platform: string
  referenceTimeLocal: Date
  fulfillmentMode: string | null
  orderStatus: string | null
  customerName: string | null
  itemCount: number
  subtotal: number
  tax: number
  tip: number
  discount: number
  total: number
  detailsFetched: boolean
  /** What the marketplace took on this order. 0 for in-house. */
  commission: number
}

export type OrderListTotals = {
  /** Σ subtotal + Σ discount — the column is stored NEGATIVE. See `order-signs.ts`. */
  netSales: number
  /**
   * What the marketplaces took, by the one commission rule
   * (`@/lib/counter/commission-core`): recorded fees, plus the store's rate
   * for platform and mode × the after-discount ticket on orders that came
   * without one. Cancelled orders excluded. `null` when not one marketplace
   * order could be priced.
   */
  commission: number | null
  /** The recorded half of `commission`. */
  commissionRecorded: number
  /** The estimated half, and how many orders it covers. */
  commissionEstimated: number
  thirdPartyEstimatedCount: number
  /** Marketplace orders with no recorded fee and no rate on file. */
  thirdPartyUnknownCount: number
  /** Σ subtotal + Σ discount, over matched orders whose platform is not in-house. */
  thirdPartyNetSales: number
  /**
   * How many matched orders are on a marketplace at all, and how many of those
   * carry a commission figure.
   *
   * `commission` alone cannot say whether it is the whole bill or a fraction of
   * it, and `adjusted_commission`'s coverage is not a constant: counted on
   * 2026-08-26 it ran 5,908 of 6,094 marketplace orders in January, 2,548 of
   * 5,835 in April, 0 of 6,145 in May and 4,393 of 7,559 in July. A range on
   * the wrong side of one of those cliffs states a total that is roughly half
   * the truth, so the strip needs the ratio, not just the sum.
   */
  thirdPartyCount: number
  thirdPartyWithFees: number
}

const ZERO_TOTALS: OrderListTotals = {
  netSales: 0,
  commission: 0,
  commissionRecorded: 0,
  commissionEstimated: 0,
  thirdPartyEstimatedCount: 0,
  thirdPartyUnknownCount: 0,
  thirdPartyNetSales: 0,
  thirdPartyCount: 0,
  thirdPartyWithFees: 0,
}

export type OrderListResponse = {
  rows: OrderListRow[]
  nextCursor: string | null
  platforms: string[]
  totalCount: number
  /** Orders in the same scope still waiting on OrderDetails (detailsFetchedAt: null). */
  undrainedCount: number
  /** The whole matched range, not just the returned page — see OrderListTotals. */
  totals: OrderListTotals
}

/** One row of the range-figures read: a group, or the whole range (`total_row` 1). */
type RangeFigureRow = {
  total_row: number
  storeId: string | null
  platform: string | null
  fulfillmentMode: string | null
  live: boolean | null
  recorded: boolean | null
  tp: boolean | null
  n: number
  subtotal: number | null
  discount: number | null
  commission: number | null
  tp_n: number
  tp_subtotal: number | null
  tp_discount: number | null
  tp_fee_n: number
}

/**
 * `contains` + `mode: "insensitive"` as Prisma sends it: `ILIKE '%term%'` with
 * the term NOT escaped, so a `%` or `_` typed into the search box is a LIKE
 * wildcard, exactly as it is on the list query. Escaping them here would make
 * the totals describe different orders than the rows beside them.
 */
const containsPattern = (term: string): string => `%${term}%`

/**
 * The filters `getOrdersList` hands Prisma as `where`, as a SQL fragment over
 * `"OtterOrder" o` — the same predicate, restated for the grouped read.
 * `storeIds` is the account's own store list: a requested `storeId` outside
 * it has already returned empty by the time this runs.
 */
function matchedWhere(filters: OrderListFilters, storeIds: string[]): Prisma.Sql {
  const parts: Prisma.Sql[] = [
    filters.storeId
      ? Prisma.sql`o."storeId" = ${filters.storeId}`
      : Prisma.sql`o."storeId" IN (${Prisma.join(storeIds)})`,
  ]
  if (filters.platforms && filters.platforms.length > 0) {
    parts.push(Prisma.sql`o."platform" IN (${Prisma.join(filters.platforms)})`)
  } else if (filters.platform) {
    parts.push(Prisma.sql`o."platform" = ${filters.platform}`)
  }
  if (filters.detailsOnly) parts.push(Prisma.sql`o."detailsFetchedAt" IS NOT NULL`)
  if (filters.startDate) parts.push(Prisma.sql`o."referenceTimeLocal" >= ${new Date(filters.startDate + "T00:00:00")}`)
  if (filters.endDate) parts.push(Prisma.sql`o."referenceTimeLocal" <= ${new Date(filters.endDate + "T23:59:59")}`)
  if (filters.search && filters.search.trim()) {
    const pattern = containsPattern(filters.search.trim())
    parts.push(
      Prisma.sql`(o."externalDisplayId" ILIKE ${pattern} OR o."customerName" ILIKE ${pattern} OR o."otterOrderId" ILIKE ${pattern})`,
    )
  }
  return Prisma.join(parts, " AND ")
}

export async function getOrdersList(
  filters: OrderListFilters = {}
): Promise<OrderListResponse> {
  const session = await getSession()
  if (!session?.user) {
    return {
      rows: [],
      nextCursor: null,
      platforms: [],
      totalCount: 0,
      undrainedCount: 0,
      totals: ZERO_TOTALS,
    }
  }

  // The one store query a request makes — see `@/lib/account-stores`. Whole
  // rows and no `isActive` filter, which is what this call already asked for.
  const stores = await getAccountStoreRows(session.user.accountId)
  const storeIds = stores.map((s) => s.id)
  if (storeIds.length === 0) {
    return {
      rows: [],
      nextCursor: null,
      platforms: [],
      totalCount: 0,
      undrainedCount: 0,
      totals: ZERO_TOTALS,
    }
  }
  const nameById = new Map(stores.map((s) => [s.id, s.name]))

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200)

  const where: Prisma.OtterOrderWhereInput = {
    storeId: { in: storeIds },
  }

  if (filters.storeId) {
    if (!storeIds.includes(filters.storeId)) {
      return {
        rows: [],
        nextCursor: null,
        platforms: [],
        totalCount: 0,
        undrainedCount: 0,
        totals: ZERO_TOTALS,
      }
    }
    where.storeId = filters.storeId
  }
  // Order matters: a non-empty set supersedes the single slug, and an empty
  // set leaves `where.platform` unset rather than narrowing to nothing.
  if (filters.platforms && filters.platforms.length > 0) {
    where.platform = { in: filters.platforms }
  } else if (filters.platform) {
    where.platform = filters.platform
  }
  if (filters.detailsOnly) where.detailsFetchedAt = { not: null }
  if (filters.startDate || filters.endDate) {
    const range: { gte?: Date; lte?: Date } = {}
    if (filters.startDate) range.gte = new Date(filters.startDate + "T00:00:00")
    if (filters.endDate) range.lte = new Date(filters.endDate + "T23:59:59")
    where.referenceTimeLocal = range
  }
  if (filters.search && filters.search.trim()) {
    const s = filters.search.trim()
    where.OR = [
      { externalDisplayId: { contains: s, mode: "insensitive" } },
      { customerName: { contains: s, mode: "insensitive" } },
      { otterOrderId: { contains: s, mode: "insensitive" } },
    ]
  }

  /** The same filters as `where`, as SQL — see `rangeFigures`. */
  const matchedWhereSql = matchedWhere(filters, storeIds)

  /*
   * WHAT THE CALLER ACTUALLY READS.
   *
   * `summaryOnly` is the comparison range's load — the Orders strip prints
   * "vs the prior period" from exactly two numbers off it, `totalCount` and
   * `totals.netSales` (see `buildOrdersStrip`), and read the other six
   * queries' answers nowhere. It was still paying for all eight: a page of
   * rows it discards, the pending-details count, the account's platform list
   * and three marketplace aggregates. One aggregate answers what it asks.
   *
   * The fields a summary load does not fetch come back at their zero value,
   * which is why this is an opt-in flag on a private-ish action and not the
   * default: a caller that reads `rows` or `undrainedCount` from a summary
   * response would be reading an absence as an answer.
   */
  const summaryOnly = filters.summaryOnly === true

  const listRows = () =>
    prisma.otterOrder.findMany({
        where,
        orderBy: { referenceTimeLocal: "desc" },
        take: limit + 1,
        ...(filters.cursor
          ? { skip: 1, cursor: { id: filters.cursor } }
          : {}),
        select: {
          id: true,
          otterOrderId: true,
          externalDisplayId: true,
          storeId: true,
          platform: true,
          referenceTimeLocal: true,
          fulfillmentMode: true,
          orderStatus: true,
          customerName: true,
          subtotal: true,
          tax: true,
          tip: true,
          discount: true,
          total: true,
          commission: true,
          detailsFetchedAt: true,
          _count: { select: { items: true } },
        },
      })


  /*
   * ONE grouped read for every range figure that is not a row.
   *
   * This was six queries over the same `where`: the whole-range aggregate, the
   * marketplace aggregate, the count of marketplace orders carrying a fee, and
   * the commission groups twice (fee recorded, fee not recorded). They differ
   * only in which orders they keep, so one `GROUP BY` over
   * (store, platform, mode, not-cancelled, fee-recorded) answers all of them,
   * and the whole-range totals come off a `GROUPING SETS ()` row computed
   * straight over the matched rows — not by re-adding the group sums, which
   * would change the last bits of a float total.
   *
   * It is raw SQL because Prisma cannot group on an expression. The `WHERE` is
   * `matchedWhereSql`, the same filters `where` above states, written once more
   * in SQL; `tests/app/actions/order-actions.test.ts` pins the pair together.
   * Tenancy is the store list: every id in it came from the session's account.
   *
   * The undrained count stays its own query on purpose: `detailsFetchedAt` is
   * not in the covering index (`OtterOrder_store_time_fees_idx`) that keeps
   * every column read here index-only, and folding it in would send the whole
   * grouped read to the table.
   */
  const rangeFigures = () => {
    // `Prisma.join([])` throws; with no house platforms every order is third-party.
    const thirdParty =
      HOUSE_PLATFORMS.length > 0
        ? Prisma.sql`(o."platform" NOT IN (${Prisma.join([...HOUSE_PLATFORMS])}))`
        : Prisma.sql`TRUE`
    return prisma.$queryRaw<RangeFigureRow[]>`
      WITH t AS (
        SELECT o."storeId", o."platform", o."fulfillmentMode", o."subtotal", o."discount", o."commission",
               (o."orderStatus" IS NULL OR o."orderStatus" <> 'OFO_STATUS_CANCELED') AS live,
               (o."commission" <> 0) AS recorded,
               ${thirdParty} AS tp
        FROM "OtterOrder" o
        WHERE ${matchedWhereSql}
      )
      SELECT GROUPING("storeId")::int AS total_row,
             "storeId", "platform", "fulfillmentMode", live, recorded, tp,
             COUNT(*)::int AS n,
             SUM("subtotal")::float8 AS subtotal,
             SUM("discount")::float8 AS discount,
             SUM("commission")::float8 AS commission,
             COUNT(*) FILTER (WHERE tp)::int AS tp_n,
             SUM("subtotal") FILTER (WHERE tp)::float8 AS tp_subtotal,
             SUM("discount") FILTER (WHERE tp)::float8 AS tp_discount,
             COUNT(*) FILTER (WHERE tp AND live AND recorded)::int AS tp_fee_n
      FROM t
      GROUP BY GROUPING SETS ((), ("storeId", "platform", "fulfillmentMode", live, recorded, tp))`
  }

  const [rows, undrainedCount, platforms, figureRows, summarySums] =
    await Promise.all([
      summaryOnly
        ? Promise.resolve([] as Awaited<ReturnType<typeof listRows>>)
        : listRows(),
      // Served by the partial index OtterOrder_pending_details_idx — see
      // prisma/manual-migrations/2026-05-03_otter_pending_details_index.sql.
      summaryOnly
        ? Promise.resolve(0)
        : prisma.otterOrder.count({ where: { ...where, detailsFetchedAt: null } }),
      summaryOnly
        ? Promise.resolve([] as string[])
        : getPlatformsForAccount(session.user.accountId),
      summaryOnly ? Promise.resolve([] as RangeFigureRow[]) : rangeFigures(),
      // The comparison range's load: `totalCount` and the net-sales sums, from
      // one aggregate and nothing else.
      summaryOnly
        ? prisma.otterOrder.aggregate({
            where,
            _count: true,
            _sum: { subtotal: true, discount: true, commission: true },
          })
        : Promise.resolve(null),
    ])

  const totalRow = figureRows.find((r) => r.total_row === 1)
  const overallSums = summarySums ?? {
    _count: totalRow?.n ?? 0,
    _sum: {
      subtotal: totalRow?.subtotal ?? null,
      discount: totalRow?.discount ?? null,
      commission: totalRow?.commission ?? null,
    },
  }
  const thirdPartySums = summaryOnly
    ? null
    : {
        _count: totalRow?.tp_n ?? 0,
        _sum: { subtotal: totalRow?.tp_subtotal ?? null, discount: totalRow?.tp_discount ?? null },
      }
  const thirdPartyWithFees = totalRow?.tp_fee_n ?? 0
  // Marketplace orders under the reader's filter, cancelled ones out, as the
  // pair of group lists `totalCommission` folds: fee recorded, then not.
  const feeGroupRows = figureRows.filter((r) => r.total_row === 0 && r.tp && r.live)
  const recordedGroups = feeGroupRows.filter((r) => r.recorded)
  const unrecordedGroups = feeGroupRows.filter((r) => !r.recorded)

  const groups: OrderFeeGroup[] = [
    ...recordedGroups.map((g) => ({ g, recorded: true })),
    ...unrecordedGroups.map((g) => ({ g, recorded: false })),
  ].map(({ g, recorded }) => ({
    storeId: g.storeId as string,
    day: "",
    platform: g.platform as string,
    mode: fulfillmentKind(g.fulfillmentMode),
    recorded,
    orders: g.n,
    fee: Math.max(0, -(g.commission ?? 0)),
    ticket: Math.max(0, (g.subtotal ?? 0) + (g.discount ?? 0)),
  }))
  const fees = totalCommission(
    groups,
    new Map<string, StoreCommissionRates>(stores.map((s) => [s.id, s])),
  )

  const totalCount = overallSums._count
  const thirdPartyCount = thirdPartySums?._count ?? 0

  const hasMore = rows.length > limit
  const trimmed = hasMore ? rows.slice(0, limit) : rows

  return {
    rows: trimmed.map((r) => ({
      id: r.id,
      otterOrderId: r.otterOrderId,
      externalDisplayId: r.externalDisplayId,
      storeId: r.storeId,
      storeName: nameById.get(r.storeId) ?? r.storeId,
      platform: r.platform,
      referenceTimeLocal: r.referenceTimeLocal,
      fulfillmentMode: r.fulfillmentMode,
      orderStatus: r.orderStatus,
      customerName: r.customerName,
      itemCount: r._count.items,
      subtotal: r.subtotal,
      tax: r.tax,
      tip: r.tip,
      discount: r.discount,
      total: r.total,
      detailsFetched: r.detailsFetchedAt != null,
      commission: r.commission,
    })),
    nextCursor: hasMore ? trimmed[trimmed.length - 1].id : null,
    platforms,
    totalCount,
    undrainedCount,
    totals: {
      // `+ discount`, not `−`: the column is stored NEGATIVE (0 positive rows
      // of 40,055 on 2026-08-26). Subtracting it inflated every range's net
      // sales by twice the discounts given. See `src/lib/counter/order-signs.ts`.
      netSales: (overallSums._sum.subtotal ?? 0) + (overallSums._sum.discount ?? 0),
      // Reported as the POSITIVE amount the marketplaces took, so the strip's
      // "Marketplace fees" is a fee and not a negative number. A summary load
      // fetched no groups and keeps the recorded sum alone.
      commission: summaryOnly ? Math.max(0, -(overallSums._sum.commission ?? 0)) : fees.amount,
      commissionRecorded: summaryOnly ? Math.max(0, -(overallSums._sum.commission ?? 0)) : fees.recorded,
      commissionEstimated: fees.estimated,
      thirdPartyEstimatedCount: fees.ordersEstimated,
      thirdPartyUnknownCount: fees.unknownOrders,
      thirdPartyNetSales:
        (thirdPartySums?._sum.subtotal ?? 0) + (thirdPartySums?._sum.discount ?? 0),
      thirdPartyCount,
      thirdPartyWithFees,
    },
  }
}

export type OrderDetail = {
  id: string
  otterOrderId: string
  externalDisplayId: string | null
  storeName: string
  platform: string
  referenceTimeLocal: Date
  fulfillmentMode: string | null
  orderStatus: string | null
  acceptanceStatus: string | null
  customerName: string | null
  subtotal: number
  tax: number
  tip: number
  commission: number
  discount: number
  total: number
  detailsFetchedAt: Date | null
  syncedAt: Date
  items: Array<{
    id: string
    skuId: string | null
    name: string
    quantity: number
    price: number
    subItems: Array<{
      id: string
      skuId: string | null
      name: string
      quantity: number
      price: number
      subHeader: string | null
    }>
  }>
}

export async function getOrderDetail(
  orderId: string
): Promise<OrderDetail | null> {
  return (await getOrderDetailWithStoreId(orderId))?.order ?? null
}

/**
 * `getOrderDetail`, and the id of the store the order belongs to, from the
 * one read. `OrderDetail` carries the store's NAME; a caller that needs the id
 * (the order page's recipe mappings are keyed on it) used to read the order a
 * second time to get it. The row is already account-scoped here.
 */
export async function getOrderDetailWithStoreId(
  orderId: string
): Promise<{ order: OrderDetail; storeId: string } | null> {
  const session = await getSession()
  if (!session?.user) return null

  const order = await prisma.otterOrder.findFirst({
    where: { id: orderId, store: { accountId: session.user.accountId } },
    include: {
      store: { select: { name: true } },
      items: {
        include: { subItems: true },
      },
    },
  })

  if (!order) return null

  const detail: OrderDetail = {
    id: order.id,
    otterOrderId: order.otterOrderId,
    externalDisplayId: order.externalDisplayId,
    storeName: order.store.name,
    platform: order.platform,
    referenceTimeLocal: order.referenceTimeLocal,
    fulfillmentMode: order.fulfillmentMode,
    orderStatus: order.orderStatus,
    acceptanceStatus: order.acceptanceStatus,
    customerName: order.customerName,
    subtotal: order.subtotal,
    tax: order.tax,
    tip: order.tip,
    commission: order.commission,
    discount: order.discount,
    total: order.total,
    detailsFetchedAt: order.detailsFetchedAt,
    syncedAt: order.syncedAt,
    items: order.items.map((it) => ({
      id: it.id,
      skuId: it.skuId,
      name: it.name,
      quantity: it.quantity,
      price: it.price,
      subItems: it.subItems.map((si) => ({
        id: si.id,
        skuId: si.skuId,
        name: si.name,
        quantity: si.quantity,
        price: si.price,
        subHeader: si.subHeader,
      })),
    })),
  }
  return { order: detail, storeId: order.storeId }
}

/**
 * Force a re-fetch of OrderDetails from Otter GraphQL for a single order.
 * Useful on the detail page when details are missing or look stale.
 */
export async function refetchOrderDetail(
  orderId: string
): Promise<{ ok: boolean; message?: string }> {
  const session = await getSession()
  if (!session?.user) return { ok: false, message: "Unauthorized" }

  const order = await prisma.otterOrder.findFirst({
    where: { id: orderId, store: { accountId: session.user.accountId } },
    select: { id: true, otterOrderId: true },
  })
  if (!order) return { ok: false, message: "Not found" }

  const { fetchOrderDetails } = await import("@/lib/otter")
  try {
    const details = await fetchOrderDetails(order.otterOrderId)
    if (!details) return { ok: false, message: "Otter returned no details" }

    await prisma.$transaction(async (tx) => {
      await persistOrderItems(tx, order.id, details.items)
      await tx.otterOrder.update({
        where: { id: order.id },
        data: {
          detailsFetchedAt: new Date(),
          customerName: details.details.customerName,
          fulfillmentMode: details.details.fulfillmentMode ?? undefined,
        },
      })
    })

    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Refetch failed",
    }
  }
}
