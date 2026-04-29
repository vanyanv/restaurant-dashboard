"use server"

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"

export type OrderListFilters = {
  storeId?: string | null
  platform?: string | null
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
}

export type OrderListResponse = {
  rows: OrderListRow[]
  nextCursor: string | null
  platforms: string[]
  totalCount: number
}

export async function getOrdersList(
  filters: OrderListFilters = {}
): Promise<OrderListResponse> {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return { rows: [], nextCursor: null, platforms: [], totalCount: 0 }
  }

  const stores = await prisma.store.findMany({
    where: { accountId: session.user.accountId },
    select: { id: true, name: true },
  })
  const storeIds = stores.map((s) => s.id)
  if (storeIds.length === 0) {
    return { rows: [], nextCursor: null, platforms: [], totalCount: 0 }
  }
  const nameById = new Map(stores.map((s) => [s.id, s.name]))

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200)

  const where: Prisma.OtterOrderWhereInput = {
    storeId: { in: storeIds },
  }

  if (filters.storeId) {
    if (!storeIds.includes(filters.storeId)) {
      return { rows: [], nextCursor: null, platforms: [], totalCount: 0 }
    }
    where.storeId = filters.storeId
  }
  if (filters.platform) where.platform = filters.platform
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

  const [rows, totalCount, platforms] = await Promise.all([
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
        detailsFetchedAt: true,
        _count: { select: { items: true } },
      },
    }),
    prisma.otterOrder.count({ where }),
    prisma.otterOrder.findMany({
      where: { storeId: { in: storeIds } },
      distinct: ["platform"],
      select: { platform: true },
      orderBy: { platform: "asc" },
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
    })),
    nextCursor: hasMore ? trimmed[trimmed.length - 1].id : null,
    platforms: platforms.map((p) => p.platform),
    totalCount,
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
      await tx.otterOrderItem.deleteMany({ where: { orderId: order.id } })
      for (const item of details.items) {
        const created = await tx.otterOrderItem.create({
          data: {
            orderId: order.id,
            skuId: item.skuId,
            name: item.name,
            quantity: item.quantity,
            price: item.price,
          },
        })
        if (item.subItems.length > 0) {
          await tx.otterOrderSubItem.createMany({
            data: item.subItems.map((si) => ({
              orderItemId: created.id,
              skuId: si.skuId,
              name: si.name,
              quantity: si.quantity,
              price: si.price,
              subHeader: si.subHeader,
            })),
          })
        }
      }
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
