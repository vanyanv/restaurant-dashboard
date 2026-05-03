import { prisma } from "@/lib/prisma"
import {
  queryMetrics,
  buildCustomerOrdersBody,
  fetchOrderDetails,
  withConcurrency,
} from "@/lib/otter"
import { withJobRun } from "@/lib/monitoring/job-run"

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

export type DetailsDrainResult = {
  storeId: string
  pendingBefore: number
  detailsFetched: number
  detailsFailed: number
  pendingAfter: number
  olderThanDays: number
  limit: number
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

/**
 * Fetch GraphQL order details for one OtterOrder and atomically replace its
 * line items + sub-items. Sets detailsFetchedAt on success. Returns true if
 * the row was enriched, false if the API returned no payload.
 *
 * Used by both Phase 2 of runOrdersSync (windowed) and runDetailsDrain
 * (historical backlog). The transaction is idempotent: deleteMany +
 * createMany inside a single $transaction means a concurrent caller hitting
 * the same orderId would just rewrite the same rows.
 */
async function fetchAndPersistDetails(
  internalId: string,
  otterOrderId: string,
): Promise<boolean> {
  const details = await fetchOrderDetails(otterOrderId)
  if (!details) return false

  await prisma.$transaction(async (tx) => {
    await tx.otterOrderItem.deleteMany({ where: { orderId: internalId } })
    for (const item of details.items) {
      const created = await tx.otterOrderItem.create({
        data: {
          orderId: internalId,
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
      where: { id: internalId },
      data: {
        detailsFetchedAt: new Date(),
        customerName: details.details.customerName,
        fulfillmentMode: details.details.fulfillmentMode ?? undefined,
      },
    })
  })

  return true
}

export async function runOrdersSync(
  days: number,
  endDateOverride?: Date,
  opts?: { triggeredBy?: "cron" | "manual"; metadata?: Record<string, unknown> }
): Promise<OrdersSyncResult> {
  const triggeredBy = opts?.triggeredBy ?? "manual"
  return withJobRun(
    "otter.orders.sync",
    { triggeredBy, metadata: { windowDays: days, ...(opts?.metadata ?? {}) } },
    async ({ addRows }) => {
      const result = await runOrdersSyncInner(days, endDateOverride)
      addRows(result.ordersCreated + result.ordersUpdated)
      return result
    }
  )
}

async function runOrdersSyncInner(
  days: number,
  endDateOverride?: Date
): Promise<OrdersSyncResult> {
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

  // Use UTC day boundaries: the downstream API expects UTC ISO bounds, and
  // OtterOrder rows store dates at UTC midnight. Local-TZ setHours would shift
  // the window by 7+ hours on a non-UTC server (e.g. PDT dev) and skip
  // boundary days.
  const endDate = endDateOverride ? new Date(endDateOverride) : new Date()
  if (!endDateOverride) endDate.setUTCHours(23, 59, 59, 999)
  const startDate = new Date(endDate)
  startDate.setUTCDate(startDate.getUTCDate() - (days - 1))
  startDate.setUTCHours(0, 0, 0, 0)

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
      const ok = await fetchAndPersistDetails(o.id, o.otterOrderId)
      if (ok) detailsFetched++
      else detailsFailed++
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

/**
 * Drain historical OtterOrder rows whose `detailsFetchedAt` is null and that
 * fall OUTSIDE the windowed Phase-2 sync's lookback (default >3 days old).
 * Targets the long tail of orders that were headered but never enriched —
 * mostly Jan/Apr 2026 in the current dataset.
 *
 * Scoped to one store so matrix workflows can drain stores in parallel.
 * The "older than 3 days" cutoff avoids fighting the windowed Phase 2 over
 * the same row.
 */
export async function runDetailsDrain(
  storeId: string,
  opts?: {
    limit?: number
    olderThanDays?: number
    concurrency?: number
    triggeredBy?: "cron" | "manual" | "github-actions" | "internal"
    metadata?: Record<string, unknown>
  },
): Promise<DetailsDrainResult> {
  const limit = opts?.limit ?? 1500
  const olderThanDays = opts?.olderThanDays ?? 3
  const concurrency = opts?.concurrency ?? 5
  const triggeredBy = opts?.triggeredBy ?? "manual"

  return withJobRun(
    "otter.orders.drain",
    {
      storeId,
      triggeredBy,
      metadata: {
        limit,
        olderThanDays,
        concurrency,
        ...(opts?.metadata ?? {}),
      },
    },
    async ({ addRows }) => {
      const cutoff = new Date()
      cutoff.setUTCHours(0, 0, 0, 0)
      cutoff.setUTCDate(cutoff.getUTCDate() - olderThanDays)

      const pendingBefore = await prisma.otterOrder.count({
        where: { storeId, detailsFetchedAt: null, referenceTimeLocal: { lt: cutoff } },
      })

      // Process oldest first so the long tail of Jan/Apr orders gets drained
      // before more recent ones that the windowed sync will pick up anyway.
      const pending = await prisma.otterOrder.findMany({
        where: {
          storeId,
          detailsFetchedAt: null,
          referenceTimeLocal: { lt: cutoff },
        },
        select: { id: true, otterOrderId: true },
        orderBy: { referenceTimeLocal: "asc" },
        take: limit,
      })

      let detailsFetched = 0
      let detailsFailed = 0

      const tasks = pending.map((o) => async () => {
        try {
          const ok = await fetchAndPersistDetails(o.id, o.otterOrderId)
          if (ok) detailsFetched++
          else detailsFailed++
        } catch (err) {
          console.error(
            `[orders.drain ${storeId}] OrderDetails failed for ${o.otterOrderId}:`,
            err,
          )
          detailsFailed++
        }
      })

      await withConcurrency(tasks, concurrency)
      addRows(detailsFetched)

      const pendingAfter = await prisma.otterOrder.count({
        where: { storeId, detailsFetchedAt: null, referenceTimeLocal: { lt: cutoff } },
      })

      return {
        storeId,
        pendingBefore,
        detailsFetched,
        detailsFailed,
        pendingAfter,
        olderThanDays,
        limit,
      }
    },
  )
}
