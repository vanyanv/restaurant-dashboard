// Pulls a 2-day rolling window of customer_orders from Otter, buckets to
// (storeId, date, hour), and reconciles OtterHourlySummary for every
// (storeId, date) in the window in one transaction: new or changed buckets are
// upserted, buckets that disappeared are deleted, unchanged buckets are not
// written at all — idempotent + self-healing for late arrivals, refunds, and
// Otter retroactive edits, without rewriting the whole window every hour.
//
// Called from both the API route (manual / Vercel cron) and the GH Actions
// script. Keep all sync logic here; route + script are thin wrappers.

import { prisma } from "@/lib/prisma"
import { Prisma } from "@/generated/prisma/client"
import { planChangedUpserts, type ChangedUpsertSpec } from "@/lib/upsert-changed"
import { queryMetrics, buildCustomerOrdersBody } from "@/lib/otter"
import { todayInLA, startOfDayLA, endOfDayLA } from "@/lib/dashboard-utils"
import { laDateMinusDays } from "@/lib/hourly-orders"
import { recentSuccessSkip, withJobRun, type RecentSuccessSkip } from "@/lib/monitoring/job-run"
import { computeOrderNetSales } from "@/lib/hourly-sync-helpers"
import { shouldSyncStore } from "@/lib/store-lifecycle"

export interface HourlySyncResult {
  storesProcessed: number
  rowsFetched: number
  /** Buckets in the window after the sync (new, changed or unchanged). */
  bucketsWritten: number
  /** Buckets actually inserted, updated or deleted. 0 = the window was already current. */
  bucketsChanged: number
  datesCovered: string[]
  error?: string
}

/** @@unique([storeId, date, hour]) */
export const HOURLY_SUMMARY_UPSERT: ChangedUpsertSpec = {
  table: "OtterHourlySummary",
  conflict: [
    { name: "storeId", type: "text" },
    { name: "date", type: "date" },
    { name: "hour", type: "int" },
  ],
  values: [
    { name: "orderCount", type: "int" },
    { name: "netSales", type: "float" },
  ],
  touch: "updatedAt",
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

export type HourlySyncOpts = {
  windowDays?: number  // default 2 (today + yesterday)
  rowLimit?: number    // default 10000
  // Last LA date the window should cover ("YYYY-MM-DD"). Defaults to today in
  // LA. Only backfills pass this — it lets a caller walk history in chunks
  // small enough to stay under the row cap (see runHourlySyncInner).
  anchorDate?: string
  triggeredBy?: "cron" | "manual" | "github-actions"
  metadata?: Record<string, unknown>
}

/**
 * Sync the rolling window of hourly aggregates for all configured Otter stores.
 * Default window: today + yesterday in LA. Idempotent.
 *
 * With `skipIfRecentSuccess`, a run that finds a SUCCESS from the same kind of
 * caller in the last 20 minutes returns `{ skipped: "recent-success" }` and
 * writes nothing: the scheduled workflow's backup `schedule:` firing after the
 * sync ticker already dispatched the same hour. Only the scheduled script
 * passes it.
 */
export function runHourlySync(
  opts: HourlySyncOpts & { skipIfRecentSuccess: boolean },
): Promise<HourlySyncResult | RecentSuccessSkip>
export function runHourlySync(opts?: HourlySyncOpts): Promise<HourlySyncResult>
export async function runHourlySync(
  opts?: HourlySyncOpts & { skipIfRecentSuccess?: boolean },
): Promise<HourlySyncResult | RecentSuccessSkip> {
  const triggeredBy = opts?.triggeredBy ?? "manual"
  return withJobRun(
    "otter.hourly.sync",
    {
      triggeredBy,
      skipIf: opts?.skipIfRecentSuccess
        ? recentSuccessSkip("otter.hourly.sync", { triggeredBy })
        : async () => null,
      metadata: {
        windowDays: opts?.windowDays ?? 2,
        rowLimit: opts?.rowLimit ?? 10000,
        ...(opts?.anchorDate ? { anchorDate: opts.anchorDate } : {}),
        ...(opts?.metadata ?? {}),
      },
    },
    async ({ addRows }) => {
      const result = await runHourlySyncInner(opts)
      addRows(result.bucketsWritten)
      return result
    }
  )
}

async function runHourlySyncInner(opts?: HourlySyncOpts): Promise<HourlySyncResult> {
  const windowDays = opts?.windowDays ?? 2
  const rowLimit = opts?.rowLimit ?? 10000

  const otterStores = await prisma.otterStore.findMany({
    select: {
      otterStoreId: true,
      storeId: true,
      store: { select: { isActive: true, lifecycleStage: true } },
    },
  })
  const active = otterStores.filter((os) => shouldSyncStore(os.store))
  if (active.length === 0) {
    return {
      storesProcessed: 0,
      rowsFetched: 0,
      bucketsWritten: 0,
      bucketsChanged: 0,
      datesCovered: [],
    }
  }

  // Map otterStoreId → internal storeId, for row bucketing.
  const otterToStore = new Map<string, string>()
  for (const os of active) otterToStore.set(os.otterStoreId, os.storeId)
  const otterIds = active.map((os) => os.otterStoreId)

  // Build the window: from start-of-day (anchor - (windowDays-1)) to end-of-day anchor.
  const today = opts?.anchorDate ?? todayInLA()
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

  // queryOtterEndpoint reads a single response page — `limit` is a hard cap,
  // not a page size. Landing exactly on it means Otter had more rows and we
  // silently dropped them, which would write an under-counted day. Fail loudly
  // instead: the caller must shrink windowDays or raise rowLimit (Otter 413s
  // somewhere above 50k, so shrinking the window is usually the answer).
  if (rows.length >= rowLimit) {
    throw new Error(
      `[hourly-sync] row cap hit: Otter returned ${rows.length} rows for a ` +
        `${windowDays}-day window ending ${today}, which equals rowLimit=${rowLimit}. ` +
        `Results are truncated — re-run with a smaller windowDays.`
    )
  }

  // Bucket by (storeId, date, hour).
  const buckets = new Map<string, BucketValue>()  // key: `${storeId}|${date}|${hour}`
  let droppedNoStore = 0

  for (const row of rows) {
    const epochMs = row.reference_time_local_without_tz as number | null
    if (epochMs == null) continue
    // The daily rollup (order_count metric) excludes canceled orders; skip
    // them here too so completed days reconcile exactly between the two
    // tables instead of drifting by the day's cancellation count.
    const orderStatus = row.order_status as string | null | undefined
    if (
      orderStatus &&
      (orderStatus.includes("CANCELED") || orderStatus.includes("REJECTED"))
    ) {
      continue
    }
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
    const orderNet = computeOrderNetSales(row)
    const existing = buckets.get(key)
    if (existing) {
      existing.orderCount += 1
      existing.netSales += orderNet
    } else {
      buckets.set(key, {
        orderCount: 1,
        netSales: orderNet,
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

  // Reconcile every (storeId, date) in the window — even pairs with no rows —
  // in a single transaction: upsert the new buckets (only new or changed ones
  // are written), then delete the window's buckets that no longer exist.
  // This replaced a delete-everything + createMany that rewrote the whole
  // window every hour even when nothing had moved.
  const storeIds = [...new Set(active.map((s) => s.storeId))]

  let bucketsWritten = 0
  const allInserts: Array<{
    storeId: string
    date: Date
    hour: number
    orderCount: number
    netSales: number
  }> = []
  for (const storeId of storeIds) {
    for (const date of datesCovered) {
      const inserts = byPair.get(`${storeId}|${date}`) ?? []
      const dateObj = new Date(date + "T00:00:00.000Z")
      for (const b of inserts) {
        allInserts.push({
          storeId: b.storeId,
          date: dateObj,
          hour: b.hour,
          orderCount: b.orderCount,
          netSales: Math.round(b.netSales * 100) / 100,
        })
      }
      bucketsWritten += inserts.length
    }
  }

  const keepClause =
    allInserts.length === 0
      ? Prisma.empty
      : Prisma.sql`
          AND (h."storeId", h."date", h."hour") NOT IN (
            VALUES ${Prisma.join(
              allInserts.map(
                (b) => Prisma.sql`(${b.storeId}::text, ${b.date}::date, ${b.hour}::integer)`,
              ),
            )}
          )
        `
  const deleteStale = prisma.$executeRaw(Prisma.sql`
    DELETE FROM "OtterHourlySummary" h
    WHERE h."storeId" IN (${Prisma.join(storeIds.map((id) => Prisma.sql`${id}::text`))})
      AND h."date" IN (${Prisma.join(datesCovered.map((d) => Prisma.sql`${d}::date`))})
      ${keepClause}
  `)
  const upserts = planChangedUpserts(HOURLY_SUMMARY_UPSERT, allInserts).map(({ sql }) =>
    prisma.$executeRaw(sql),
  )
  const counts = await prisma.$transaction([...upserts, deleteStale])
  const bucketsChanged = counts.reduce((sum, n) => sum + n, 0)

  if (droppedNoStore > 0) {
    console.warn(
      `[hourly-sync] dropped ${droppedNoStore} rows with no store mapping`
    )
  }

  return {
    storesProcessed: active.length,
    rowsFetched: rows.length,
    bucketsWritten,
    bucketsChanged,
    datesCovered,
  }
}
