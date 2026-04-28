// Pulls a 2-day rolling window of customer_orders from Otter, buckets to
// (storeId, date, hour), and writes OtterHourlySummary via transactional
// delete+insert per (storeId, date) — idempotent + self-healing for late
// arrivals, refunds, and Otter retroactive edits.
//
// Called from both the API route (manual / Vercel cron) and the GH Actions
// script. Keep all sync logic here; route + script are thin wrappers.

import { prisma } from "@/lib/prisma"
import { queryMetrics, buildCustomerOrdersBody } from "@/lib/otter"
import { todayInLA, startOfDayLA, endOfDayLA } from "@/lib/dashboard-utils"
import { laDateMinusDays } from "@/lib/hourly-orders"

export interface HourlySyncResult {
  storesProcessed: number
  rowsFetched: number
  bucketsWritten: number
  datesCovered: string[]
  error?: string
}

interface BucketKey {
  storeId: string
  date: string
  hour: number
}

interface BucketValue {
  orderCount: number
  netSales: number
}

/**
 * Sync the rolling window of hourly aggregates for all configured Otter stores.
 * Default window: today + yesterday in LA. Idempotent.
 */
export async function runHourlySync(opts?: {
  windowDays?: number  // default 2 (today + yesterday)
  rowLimit?: number    // default 10000
}): Promise<HourlySyncResult> {
  const windowDays = opts?.windowDays ?? 2
  const rowLimit = opts?.rowLimit ?? 10000

  const otterStores = await prisma.otterStore.findMany({
    select: {
      otterStoreId: true,
      storeId: true,
      store: { select: { isActive: true } },
    },
  })
  const active = otterStores.filter((os) => os.store.isActive)
  if (active.length === 0) {
    return { storesProcessed: 0, rowsFetched: 0, bucketsWritten: 0, datesCovered: [] }
  }

  // Map otterStoreId → internal storeId, for row bucketing.
  const otterToStore = new Map<string, string>()
  for (const os of active) otterToStore.set(os.otterStoreId, os.storeId)
  const otterIds = active.map((os) => os.otterStoreId)

  // Build the window: from start-of-day (today - (windowDays-1)) to end-of-day today.
  const today = todayInLA()
  const earliest = laDateMinusDays(today, windowDays - 1)
  const rangeStart = startOfDayLA(earliest)
  const rangeEnd = endOfDayLA(today)

  // Build the date list for the window so we know which (storeId, date) pairs
  // to clear even if no rows came back for them.
  const datesCovered: string[] = []
  for (let i = 0; i < windowDays; i++) {
    datesCovered.push(laDateMinusDays(today, windowDays - 1 - i))
  }

  const body = buildCustomerOrdersBody(otterIds, rangeStart, rangeEnd) as Record<
    string,
    unknown
  >
  body.limit = rowLimit

  const rows = await queryMetrics(body)

  // Bucket by (storeId, date, hour).
  const buckets = new Map<string, BucketValue>()  // key: `${storeId}|${date}|${hour}`
  let droppedNoStore = 0

  for (const row of rows) {
    const epochMs = row.reference_time_local_without_tz as number | null
    if (epochMs == null) continue
    const otterStoreId = row.store_id as string | null | undefined
    if (!otterStoreId) {
      droppedNoStore++
      continue
    }
    const storeId = otterToStore.get(otterStoreId)
    if (!storeId) {
      droppedNoStore++
      continue
    }

    // reference_time_local_without_tz is local-encoded epoch — getUTC* yields LA wall-clock.
    const d = new Date(epochMs)
    const hour = d.getUTCHours()
    if (hour < 0 || hour >= 24) continue
    const yyyy = d.getUTCFullYear()
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0")
    const dd = String(d.getUTCDate()).padStart(2, "0")
    const date = `${yyyy}-${mm}-${dd}`

    // Skip rows whose LA date falls outside our window — Otter may return
    // boundary rows. We only commit dates we're going to delete first.
    if (!datesCovered.includes(date)) continue

    const key = `${storeId}|${date}|${hour}`
    const existing = buckets.get(key)
    if (existing) {
      existing.orderCount += 1
      existing.netSales += (row.net_sales as number) ?? 0
    } else {
      buckets.set(key, {
        orderCount: 1,
        netSales: (row.net_sales as number) ?? 0,
      })
    }
  }

  // Group bucketed values by (storeId, date) for transactional delete+insert.
  type DateKey = string  // `${storeId}|${date}`
  const byPair = new Map<DateKey, Array<BucketKey & BucketValue>>()
  for (const [key, val] of buckets) {
    const [storeId, date, hourStr] = key.split("|")
    const hour = parseInt(hourStr, 10)
    const pairKey = `${storeId}|${date}`
    const arr = byPair.get(pairKey) ?? []
    arr.push({ storeId, date, hour, ...val })
    byPair.set(pairKey, arr)
  }

  // For every (storeId, date) in the window — even if no rows — run delete to
  // clear stale data. Only insert when we have buckets.
  let bucketsWritten = 0
  for (const storeId of new Set(active.map((s) => s.storeId))) {
    for (const date of datesCovered) {
      const pairKey = `${storeId}|${date}`
      const inserts = byPair.get(pairKey) ?? []
      const dateObj = new Date(date + "T00:00:00.000Z")

      await prisma.$transaction([
        prisma.otterHourlySummary.deleteMany({
          where: { storeId, date: dateObj },
        }),
        ...(inserts.length > 0
          ? [
              prisma.otterHourlySummary.createMany({
                data: inserts.map((b) => ({
                  storeId: b.storeId,
                  date: dateObj,
                  hour: b.hour,
                  orderCount: b.orderCount,
                  netSales: Math.round(b.netSales * 100) / 100,
                })),
                skipDuplicates: true,
              }),
            ]
          : []),
      ])

      bucketsWritten += inserts.length
    }
  }

  if (droppedNoStore > 0) {
    console.warn(
      `[hourly-sync] dropped ${droppedNoStore} rows with no store mapping`
    )
  }

  return {
    storesProcessed: active.length,
    rowsFetched: rows.length,
    bucketsWritten,
    datesCovered,
  }
}
