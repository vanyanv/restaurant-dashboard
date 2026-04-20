import { prisma } from "@/lib/prisma"
import {
  queryMetrics,
  buildCustomerOrdersBody,
  fetchOrderDetails,
  withConcurrency,
} from "@/lib/otter"

export type OrdersSyncResult = {
  storesProcessed: number
  ordersFetched: number
  ordersCreated: number
  ordersUpdated: number
  detailsFetched: number
  detailsFailed: number
  pendingDetails: number
  windowDays: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asString(v: any): string | null {
  if (v == null) return null
  return String(v)
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asNumber(v: any): number {
  if (v == null) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export async function runOrdersSync(days: number): Promise<OrdersSyncResult> {
  const otterStores = await prisma.otterStore.findMany({
    include: { store: { select: { id: true, isActive: true } } },
  })
  const activeOtterStores = otterStores.filter((os) => os.store.isActive)

  if (activeOtterStores.length === 0) {
    return {
      storesProcessed: 0,
      ordersFetched: 0,
      ordersCreated: 0,
      ordersUpdated: 0,
      detailsFetched: 0,
      detailsFailed: 0,
      pendingDetails: 0,
      windowDays: days,
    }
  }

  const otterStoreIds = activeOtterStores.map((os) => os.otterStoreId)
  const otterToInternal = new Map(
    activeOtterStores.map((os) => [os.otterStoreId, os.storeId])
  )

  const endDate = new Date()
  endDate.setHours(23, 59, 59, 999)
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - (days - 1))
  startDate.setHours(0, 0, 0, 0)

  // ─── Phase 1: Fetch customer_orders headers ───
  const body = buildCustomerOrdersBody(otterStoreIds, startDate, endDate)
  const rows = await queryMetrics(body)

  let ordersCreated = 0
  let ordersUpdated = 0

  for (const row of rows) {
    const otterStoreId = asString(row["store_id"])
    const orderId = asString(row["order_id"])
    if (!otterStoreId || !orderId) continue
    const internalStoreId = otterToInternal.get(otterStoreId)
    if (!internalStoreId) continue

    const refTimeStr = asString(row["reference_time_local_without_tz"])
    if (!refTimeStr) continue

    // refTimeStr is either an ISO string or an epoch ms number; handle both.
    const refTime =
      typeof row["reference_time_local_without_tz"] === "number"
        ? new Date(row["reference_time_local_without_tz"])
        : new Date(refTimeStr)
    if (isNaN(refTime.getTime())) continue

    const restaurantDiscount = asNumber(row["restaurant_funded_discount"])
    const ofoDiscount = asNumber(row["ofo_funded_discount"])

    const data = {
      otterOrderId: orderId,
      externalDisplayId: asString(row["external_order_display_id"]),
      storeId: internalStoreId,
      otterStoreId,
      platform: asString(row["ofo_slug"]) ?? "unknown",
      referenceTimeLocal: refTime,
      fulfillmentMode: asString(row["fulfillment_mode"]),
      orderStatus: asString(row["order_status"]),
      acceptanceStatus: asString(row["acceptance_status"]),
      subtotal: asNumber(row["subtotal"]),
      tax: asNumber(row["tax"]),
      tip: asNumber(row["tip"]),
      commission: asNumber(row["adjusted_commission"]),
      discount: restaurantDiscount + ofoDiscount,
      total: asNumber(row["total_with_tip"]),
    }

    const existing = await prisma.otterOrder.findUnique({
      where: { otterOrderId: orderId },
      select: { id: true },
    })

    if (existing) {
      await prisma.otterOrder.update({
        where: { otterOrderId: orderId },
        data,
      })
      ordersUpdated++
    } else {
      await prisma.otterOrder.create({ data })
      ordersCreated++
    }
  }

  // ─── Phase 2: Fetch OrderDetails for any unfetched orders in this window ───
  const pending = await prisma.otterOrder.findMany({
    where: {
      detailsFetchedAt: null,
      referenceTimeLocal: { gte: startDate, lte: endDate },
    },
    select: { id: true, otterOrderId: true },
    take: 2000,
  })

  let detailsFetched = 0
  let detailsFailed = 0

  const tasks = pending.map((o) => async () => {
    try {
      const details = await fetchOrderDetails(o.otterOrderId)
      if (!details) {
        detailsFailed++
        return
      }
      await prisma.$transaction(async (tx) => {
        await tx.otterOrderItem.deleteMany({ where: { orderId: o.id } })
        for (const item of details.items) {
          const created = await tx.otterOrderItem.create({
            data: {
              orderId: o.id,
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
          where: { id: o.id },
          data: {
            detailsFetchedAt: new Date(),
            customerName: details.details.customerName,
            fulfillmentMode:
              details.details.fulfillmentMode ?? undefined,
          },
        })
      })
      detailsFetched++
    } catch (err) {
      console.error(`OrderDetails failed for ${o.otterOrderId}:`, err)
      detailsFailed++
    }
  })

  await withConcurrency(tasks, 5)

  const stillPending = await prisma.otterOrder.count({
    where: { detailsFetchedAt: null },
  })

  return {
    storesProcessed: activeOtterStores.length,
    ordersFetched: rows.length,
    ordersCreated,
    ordersUpdated,
    detailsFetched,
    detailsFailed,
    pendingDetails: stillPending,
    windowDays: days,
  }
}
