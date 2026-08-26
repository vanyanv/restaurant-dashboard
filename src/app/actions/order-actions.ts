"use server"

import { getServerSession } from "next-auth"
import { unstable_cache } from "next/cache"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { persistOrderItems } from "@/lib/otter-orders-sync"
import { HOUSE_PLATFORMS } from "@/lib/counter/channel-mix"

/** Distinct platforms across an account's orders, cached for an hour.
 * The previous shape was a `distinct: ["platform"]` findMany inside every
 * getOrdersList call — at 41k+ rows that was a full-table scan on every
 * filter change. Tag is invalidated on order ingest (revalidateTag in the
 * sync routes once we wire that up); until then the TTL falls back. */
const getPlatformsForAccount = unstable_cache(
  async (accountId: string): Promise<string[]> => {
    const stores = await prisma.store.findMany({
      where: { accountId },
      select: { id: true },
    })
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
  /** −Σ commission: the POSITIVE amount the marketplaces took. */
  commission: number
  /** Σ subtotal + Σ discount, over matched orders whose platform is not in-house. */
  thirdPartyNetSales: number
}

const ZERO_TOTALS: OrderListTotals = {
  netSales: 0,
  commission: 0,
  thirdPartyNetSales: 0,
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

export async function getOrdersList(
  filters: OrderListFilters = {}
): Promise<OrderListResponse> {
  const session = await getServerSession(authOptions)
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

  const stores = await prisma.store.findMany({
    where: { accountId: session.user.accountId },
    select: { id: true, name: true },
  })
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

  const [rows, totalCount, undrainedCount, platforms, overallSums, thirdPartySums] =
    await Promise.all([
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
      }),
      prisma.otterOrder.count({ where }),
      // Served by the partial index OtterOrder_pending_details_idx — see
      // prisma/manual-migrations/2026-05-03_otter_pending_details_index.sql.
      prisma.otterOrder.count({ where: { ...where, detailsFetchedAt: null } }),
      getPlatformsForAccount(session.user.accountId),
      // The Orders strip is about the whole matched range, not the single
      // page `rows` covers (findMany is capped at `limit`), so netSales and
      // commission need their own aggregate under the same `where`.
      prisma.otterOrder.aggregate({
        where,
        _sum: { subtotal: true, discount: true, commission: true },
      }),
      // thirdPartyNetSales is what "X% of 3P" is a percentage OF, so it can't
      // be derived from overallSums — it needs the in-house platforms
      // excluded in its own aggregate.
      //
      // ANDed rather than spread: `{ ...where, platform: … }` OVERWRITES the
      // reader's own platform filter, so filtering to DoorDash would divide
      // DoorDash fees by every marketplace's sales. Both conditions hold.
      prisma.otterOrder.aggregate({
        where: { AND: [where, { platform: { notIn: [...HOUSE_PLATFORMS] } }] },
        _sum: { subtotal: true, discount: true },
      }),
    ])

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
      // "Marketplace fees" is a fee and not a negative number.
      commission: Math.max(0, -(overallSums._sum.commission ?? 0)),
      thirdPartyNetSales:
        (thirdPartySums._sum.subtotal ?? 0) + (thirdPartySums._sum.discount ?? 0),
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
    skuId: string
    name: string
    quantity: number
    price: number
    subItems: Array<{
      id: string
      skuId: string
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
  const session = await getServerSession(authOptions)
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

  return {
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
}

/**
 * Force a re-fetch of OrderDetails from Otter GraphQL for a single order.
 * Useful on the detail page when details are missing or look stale.
 */
export async function refetchOrderDetail(
  orderId: string
): Promise<{ ok: boolean; message?: string }> {
  const session = await getServerSession(authOptions)
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
