// Per-store metrics sync runner. Pulls daily summaries, menu categories,
// menu items, modifiers, and (optionally) ratings for ONE internal store
// from the Otter metrics API and upserts them into Postgres.
//
// Used by both the API route (POST /api/otter/sync) and scripts/backfill-otter.ts
// — keep all sync logic here so the two callers don't drift.
//
// The runner wraps in `withJobRun("otter.metrics.sync", { storeId, ... })`,
// so each call produces one JobRun row scoped to its store. The route still
// emits a single batch JobRun ("otter.metrics.sync.batch") around the loop
// so the existing single-row-per-tick monitoring shape is preserved until
// the per-store matrix workflow lands.
import { prisma } from "@/lib/prisma"
import {
  queryMetrics,
  queryRatings,
  buildDailySyncBody,
  buildMenuCategoryBatchBody,
  buildMenuItemSyncBody,
  buildModifierSyncBody,
  buildRatingsBody,
  getDateRange,
  withConcurrency,
} from "@/lib/otter"
import type { SyncProgressEvent } from "@/types/sync"
import { withJobRun } from "@/lib/monitoring/job-run"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OtterRow = Record<string, any>

export type ProgressEmitter = (event: SyncProgressEvent) => void

export const PHASE_WEIGHTS = {
  daily: 0.20,
  categories: 0.15,
  items: 0.28,
  modifiers: 0.18,
  ratings: 0.14,
  cogs: 0.05,
} as const

export function computeTotalProgress(
  dailyPct: number,
  categoryPct: number,
  itemPct: number,
  modifierPct: number = 0,
  ratingsPct: number = 0,
  cogsPct: number = 0,
): number {
  return Math.round(
    dailyPct * PHASE_WEIGHTS.daily +
      categoryPct * PHASE_WEIGHTS.categories +
      itemPct * PHASE_WEIGHTS.items +
      modifierPct * PHASE_WEIGHTS.modifiers +
      ratingsPct * PHASE_WEIGHTS.ratings +
      cogsPct * PHASE_WEIGHTS.cogs,
  )
}

type DailyFields = Record<string, number | null>
type DailyRecord = {
  storeId: string
  date: Date
  platform: string
  paymentMethod: string
  fields: DailyFields
}

/** Merge duplicate (storeId, date, platform, paymentMethod) records so collisions
 *  on the unique index don't lose fields. For each numeric field, sum non-null
 *  values across the group; keep null only when every duplicate is null. */
export function mergeDailyRecords(records: DailyRecord[]): DailyRecord[] {
  const byKey = new Map<string, DailyRecord>()
  for (const rec of records) {
    const key = `${rec.storeId}|${rec.date.toISOString()}|${rec.platform}|${rec.paymentMethod}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, { ...rec, fields: { ...rec.fields } })
      continue
    }
    for (const [k, v] of Object.entries(rec.fields)) {
      const cur = existing.fields[k]
      if (v == null) continue
      existing.fields[k] = cur == null ? v : cur + v
    }
  }
  return [...byKey.values()]
}

export interface MetricsSyncResult {
  storeId: string
  daily: { synced: number; failed: number }
  categories: { synced: number; failed: number }
  items: { synced: number; failed: number }
  modifiers: { synced: number; failed: number }
  ratings: { synced: number; failed: number }
  windowStart: Date
  windowEnd: Date
}

export interface MetricsSyncOpts {
  triggeredBy: "cron" | "manual" | "github-actions" | "internal" | "webhook"
  /** Skip categories, items, modifiers (used by chunked backfill). */
  dailyOnly?: boolean
  /** Run the ratings phase. Default false; route opts in. */
  includeRatings?: boolean
  /** Receive progress events scoped to this store (totalProgress 0-100). */
  onProgress?: ProgressEmitter
  /** Extra metadata to attach to the JobRun row. */
  metadata?: Record<string, unknown>
}

/**
 * Sync metrics for ONE internal store across the given window.
 * Wraps the work in withJobRun so each call produces a per-store JobRun row.
 */
export async function runMetricsSyncForStore(
  storeId: string,
  otterStoreIds: string[],
  windowStart: Date,
  windowEnd: Date,
  opts: MetricsSyncOpts,
): Promise<MetricsSyncResult> {
  const { triggeredBy } = opts
  const dailyOnly = opts.dailyOnly ?? false
  const includeRatings = opts.includeRatings ?? false

  return withJobRun(
    "otter.metrics.sync",
    {
      storeId,
      triggeredBy,
      metadata: {
        otterStoreIds,
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        dailyOnly,
        includeRatings,
        ...(opts.metadata ?? {}),
      },
    },
    async ({ jobRunId, addRows }) => {
      const result = await runMetricsSyncInner(
        storeId,
        otterStoreIds,
        windowStart,
        windowEnd,
        { dailyOnly, includeRatings, onProgress: opts.onProgress },
      )
      const totalRows =
        result.daily.synced +
        result.categories.synced +
        result.items.synced +
        result.modifiers.synced +
        result.ratings.synced
      addRows(totalRows)
      // Enrich the JobRun with per-phase counts so the monitoring grid can
      // surface durations + rows alongside phase-level breakdowns.
      await prisma.jobRun.update({
        where: { id: jobRunId },
        data: {
          metadata: {
            otterStoreIds,
            windowStart: windowStart.toISOString(),
            windowEnd: windowEnd.toISOString(),
            dailyOnly,
            includeRatings,
            ...(opts.metadata ?? {}),
            daily: result.daily,
            categories: result.categories,
            items: result.items,
            modifiers: result.modifiers,
            ratings: result.ratings,
          },
        },
      })
      return result
    },
  )
}

async function runMetricsSyncInner(
  storeId: string,
  otterStoreIds: string[],
  windowStart: Date,
  windowEnd: Date,
  opts: { dailyOnly: boolean; includeRatings: boolean; onProgress?: ProgressEmitter },
): Promise<MetricsSyncResult> {
  const { dailyOnly, includeRatings, onProgress } = opts
  const emit: ProgressEmitter = (event) => onProgress?.(event)

  const counts = { daily: 0, categories: 0, items: 0, modifiers: 0, ratings: 0, cogs: 0 }
  const otterUuidSet = new Set(otterStoreIds)
  const days = getDateRange(windowStart, windowEnd)

  // ─── Phase 1: Daily summaries ───
  emit({
    phase: "daily",
    status: "fetching",
    totalProgress: 0,
    detail: `Store ${storeId}: fetching daily summaries…`,
    counts,
  })

  const dailyBody = buildDailySyncBody(otterStoreIds, windowStart, windowEnd)
  const dailyRows = await queryMetrics(dailyBody)

  let dailySynced = 0
  let dailyFailed = 0

  const rawDaily = dailyRows
    .filter((row: OtterRow) => {
      const otterStoreId = row["store"] as string | null
      return otterStoreId && otterUuidSet.has(otterStoreId) && row["eod_date_with_timezone"]
    })
    .map((row: OtterRow): DailyRecord => {
      const date = new Date(row["eod_date_with_timezone"] as string)
      const platform = (row["pos_summary_ofo"] as string | null) ?? "unknown"
      const paymentMethod = (row["multi_value_pos_payment_method"] as string | null) ?? "N/A"
      const isFP = platform === "css-pos" || platform === "bnm-web"
      const orderCount = (row["order_count"] as number | null) ?? null

      const fields: DailyFields = {
        fpGrossSales: row["fp_sales_financials_gross_sales"] as number | null,
        fpNetSales: row["fp_sales_financials_net_sales"] as number | null,
        fpDiscounts: row["fp_sales_financials_discounts"] as number | null,
        fpFees: row["fp_sales_financials_fees"] as number | null,
        fpLostRevenue: row["fp_sales_financials_lost_revenue"] as number | null,
        fpTaxCollected: row["fp_sales_financials_tax_collected"] as number | null,
        fpTaxRemitted: row["fp_sales_financials_tax_remitted"] as number | null,
        fpTips: row["fp_sales_financials_tips"] as number | null,
        fpServiceCharges: row["fp_sales_financials_service_charges"] as number | null,
        fpLoyalty: row["fp_sales_financials_loyalty"] as number | null,
        tpGrossSales: row["third_party_gross_sales"] as number | null,
        tpNetSales: row["third_party_net_sales"] as number | null,
        tpFees: row["third_party_fees"] as number | null,
        tpTaxCollected: row["third_party_tax_collected"] as number | null,
        tpTaxRemitted: row["third_party_tax_remitted"] as number | null,
        tpDiscounts: row["third_party_discounts"] as number | null,
        tpRefundsAdjustments: row["third_party_refunds_adjustments"] as number | null,
        tpServiceCharges: row["third_party_service_charges"] as number | null,
        tpTipForRestaurant: row["third_party_tip_for_restaurant"] as number | null,
        tpLoyaltyDiscount: row["third_party_loyalty_discount"] as number | null,
        tillPaidIn: row["enriched_till_report_paid_in"] as number | null,
        tillPaidOut: row["enriched_till_report_paid_out"] as number | null,
        fpOrderCount: isFP ? orderCount : null,
        tpOrderCount: isFP ? null : orderCount,
      }

      return { storeId, date, platform, paymentMethod, fields }
    })

  // Otter sometimes returns multiple rows per (store, date, platform, paymentMethod)
  // — e.g. css-pos CASH has one "sales" row and one "till session" row sharing the
  // unique key. Sequential upserts lose data to last-write; merge first.
  const dailyRecords = mergeDailyRecords(rawDaily)

  emit({
    phase: "daily",
    status: "writing",
    totalProgress: computeTotalProgress(10, 0, 0),
    detail: `Store ${storeId}: writing ${dailyRecords.length} daily records…`,
    counts,
  })

  for (let i = 0; i < dailyRecords.length; i += 50) {
    const batch = dailyRecords.slice(i, i + 50)
    try {
      await prisma.$transaction(
        batch.map(({ date, platform, paymentMethod, fields }) =>
          prisma.otterDailySummary.upsert({
            where: {
              storeId_date_platform_paymentMethod: {
                storeId,
                date,
                platform,
                paymentMethod,
              },
            },
            create: { storeId, date, platform, paymentMethod, ...fields },
            update: fields,
          }),
        ),
      )
      dailySynced += batch.length
      counts.daily = dailySynced
    } catch (err) {
      console.error(
        `[metrics-sync ${storeId}] Failed batch of ${batch.length} daily upserts at offset ${i}:`,
        err,
      )
      dailyFailed += batch.length
    }
    const phasePct =
      dailyRecords.length > 0
        ? 10 + ((i + batch.length) / dailyRecords.length) * 90
        : 100
    emit({
      phase: "daily",
      status: "writing",
      totalProgress: computeTotalProgress(phasePct, 0, 0),
      detail: `Store ${storeId}: writing daily (${Math.min(i + 50, dailyRecords.length)}/${dailyRecords.length})…`,
      counts,
    })
  }

  emit({
    phase: "daily",
    status: "done",
    totalProgress: computeTotalProgress(100, 0, 0),
    detail: `Store ${storeId}: ${dailySynced} daily records synced`,
    counts,
  })

  let categorySynced = 0
  let categoryFailed = 0
  let itemSynced = 0
  let itemFailed = 0
  let modifierSynced = 0
  let modifierFailed = 0

  if (!dailyOnly) {
    // ─── Phase 2: Menu categories ───
    emit({
      phase: "categories",
      status: "fetching",
      totalProgress: computeTotalProgress(100, 0, 0),
      detail: `Store ${storeId}: fetching categories…`,
      counts,
    })

    const categoryTasks = days.map((day) => () =>
      queryMetrics(buildMenuCategoryBatchBody(otterStoreIds, day))
        .then((rows: OtterRow[]) => ({ day, rows }))
        .catch((err: unknown) => {
          console.error(
            `[metrics-sync ${storeId}] Category sync error for ${day.toISOString().slice(0, 10)}:`,
            err,
          )
          return { day, rows: [] as OtterRow[] }
        }),
    )

    const categoryResults = await withConcurrency(categoryTasks, 5, (completed, total) => {
      const fetchPct = (completed / total) * 40
      emit({
        phase: "categories",
        status: "fetching",
        totalProgress: computeTotalProgress(100, fetchPct, 0),
        detail: `Store ${storeId}: categories (${completed}/${total} days)…`,
        counts,
      })
    })

    const categoryRecords = categoryResults.flatMap(({ day, rows }) => {
      const date = new Date(day)
      date.setUTCHours(0, 0, 0, 0)

      return rows
        .filter((row: OtterRow) => {
          const otterStoreId = row["store"] as string | null
          return otterStoreId && otterUuidSet.has(otterStoreId)
        })
        .map((row: OtterRow) => {
          const category = (row["menu_parent_entity_name"] as string | null) ?? "Uncategorized"
          const data = {
            fpQuantitySold: (row["fp_order_items_quantity_sold"] as number) ?? 0,
            fpTotalInclModifiers: (row["fp_order_items_total_include_modifiers"] as number) ?? 0,
            fpTotalSales: (row["fp_order_items_total_sales"] as number) ?? 0,
            tpQuantitySold: (row["third_party_item_quantity_sold"] as number) ?? 0,
            tpTotalInclModifiers: (row["third_party_item_total_include_modifiers"] as number) ?? 0,
            tpTotalSales: (row["third_party_item_total_sales"] as number) ?? 0,
          }
          return { date, category, data }
        })
    })

    for (let i = 0; i < categoryRecords.length; i += 50) {
      const batch = categoryRecords.slice(i, i + 50)
      try {
        await prisma.$transaction(
          batch.map(({ date, category, data }) =>
            prisma.otterMenuCategory.upsert({
              where: { storeId_date_category: { storeId, date, category } },
              create: { storeId, date, category, ...data },
              update: data,
            }),
          ),
        )
        categorySynced += batch.length
        counts.categories = categorySynced
      } catch (err) {
        console.error(
          `[metrics-sync ${storeId}] Failed batch of ${batch.length} category upserts:`,
          err,
        )
        categoryFailed += batch.length
      }
      const phasePct =
        categoryRecords.length > 0
          ? 40 + ((i + batch.length) / categoryRecords.length) * 60
          : 100
      emit({
        phase: "categories",
        status: "writing",
        totalProgress: computeTotalProgress(100, phasePct, 0),
        detail: `Store ${storeId}: writing categories (${Math.min(i + 50, categoryRecords.length)}/${categoryRecords.length})…`,
        counts,
      })
    }

    emit({
      phase: "categories",
      status: "done",
      totalProgress: computeTotalProgress(100, 100, 0),
      detail: `Store ${storeId}: ${categorySynced} categories synced`,
      counts,
    })

    // ─── Phase 3: Menu items ───
    emit({
      phase: "items",
      status: "fetching",
      totalProgress: computeTotalProgress(100, 100, 0),
      detail: `Store ${storeId}: fetching items…`,
      counts,
    })

    const itemTasks = days.map((day) => () =>
      queryMetrics(buildMenuItemSyncBody(otterStoreIds, day))
        .then((rows: OtterRow[]) => ({ day, rows }))
        .catch((err: unknown) => {
          console.error(
            `[metrics-sync ${storeId}] Item sync error for ${day.toISOString().slice(0, 10)}:`,
            err,
          )
          return { day, rows: [] as OtterRow[] }
        }),
    )

    const itemResults = await withConcurrency(itemTasks, 5, (completed, total) => {
      const fetchPct = (completed / total) * 40
      emit({
        phase: "items",
        status: "fetching",
        totalProgress: computeTotalProgress(100, 100, fetchPct),
        detail: `Store ${storeId}: items (${completed}/${total} days)…`,
        counts,
      })
    })

    const itemRecords = itemResults.flatMap(({ day, rows }) => {
      const date = new Date(day)
      date.setUTCHours(0, 0, 0, 0)
      return rows.map((row: OtterRow) => {
        const category = (row["menu_parent_entity_name"] as string | null) ?? "Uncategorized"
        const itemName = (row["item"] as string | null) ?? "Unknown"
        const data = {
          fpQuantitySold: (row["fp_order_items_quantity_sold"] as number) ?? 0,
          fpTotalInclModifiers: (row["fp_order_items_total_include_modifiers"] as number) ?? 0,
          fpTotalSales: (row["fp_order_items_total_sales"] as number) ?? 0,
          tpQuantitySold: (row["third_party_item_quantity_sold"] as number) ?? 0,
          tpTotalInclModifiers: (row["third_party_item_total_include_modifiers"] as number) ?? 0,
          tpTotalSales: (row["third_party_item_total_sales"] as number) ?? 0,
        }
        return { date, category, itemName, data }
      })
    })

    for (let i = 0; i < itemRecords.length; i += 50) {
      const batch = itemRecords.slice(i, i + 50)
      try {
        await prisma.$transaction(
          batch.map(({ date, category, itemName, data }) =>
            prisma.otterMenuItem.upsert({
              where: {
                storeId_date_category_itemName_isModifier: {
                  storeId,
                  date,
                  category,
                  itemName,
                  isModifier: false,
                },
              },
              create: { storeId, date, category, itemName, isModifier: false, ...data },
              update: data,
            }),
          ),
        )
        itemSynced += batch.length
        counts.items = itemSynced
      } catch (err) {
        console.error(
          `[metrics-sync ${storeId}] Failed batch of ${batch.length} item upserts:`,
          err,
        )
        itemFailed += batch.length
      }
      const phasePct =
        itemRecords.length > 0
          ? 40 + ((i + batch.length) / itemRecords.length) * 60
          : 100
      emit({
        phase: "items",
        status: "writing",
        totalProgress: computeTotalProgress(100, 100, phasePct),
        detail: `Store ${storeId}: writing items (${Math.min(i + 50, itemRecords.length)}/${itemRecords.length})…`,
        counts,
      })
    }

    // ─── Phase 4: Modifiers ───
    emit({
      phase: "modifiers",
      status: "fetching",
      totalProgress: computeTotalProgress(100, 100, 100, 0),
      detail: `Store ${storeId}: fetching modifiers…`,
      counts,
    })

    const modifierTasks = days.map((day) => () =>
      queryMetrics(buildModifierSyncBody(otterStoreIds, day))
        .then((rows: OtterRow[]) => ({ day, rows }))
        .catch((err: unknown) => {
          console.error(
            `[metrics-sync ${storeId}] Modifier sync error for ${day.toISOString().slice(0, 10)}:`,
            err,
          )
          return { day, rows: [] as OtterRow[] }
        }),
    )

    const modifierResults = await withConcurrency(modifierTasks, 5, (completed, total) => {
      const fetchPct = (completed / total) * 40
      emit({
        phase: "modifiers",
        status: "fetching",
        totalProgress: computeTotalProgress(100, 100, 100, fetchPct),
        detail: `Store ${storeId}: modifiers (${completed}/${total} days)…`,
        counts,
      })
    })

    const modifierRecords = modifierResults.flatMap(({ day, rows }) => {
      const date = new Date(day)
      date.setUTCHours(0, 0, 0, 0)
      return rows.map((row: OtterRow) => {
        const category = (row["menu_parent_entity_name"] as string | null) ?? "Uncategorized"
        const itemName = (row["item"] as string | null) ?? "Unknown"
        const data = {
          fpQuantitySold: (row["fp_order_items_quantity_sold"] as number) ?? 0,
          fpTotalInclModifiers: (row["fp_order_items_total_include_modifiers"] as number) ?? 0,
          fpTotalSales: (row["fp_order_items_total_sales"] as number) ?? 0,
          tpQuantitySold: (row["third_party_item_quantity_sold"] as number) ?? 0,
          tpTotalInclModifiers: (row["third_party_item_total_include_modifiers"] as number) ?? 0,
          tpTotalSales: (row["third_party_item_total_sales"] as number) ?? 0,
        }
        return { date, category, itemName, data }
      })
    })

    for (let i = 0; i < modifierRecords.length; i += 50) {
      const batch = modifierRecords.slice(i, i + 50)
      try {
        await prisma.$transaction(
          batch.map(({ date, category, itemName, data }) =>
            prisma.otterMenuItem.upsert({
              where: {
                storeId_date_category_itemName_isModifier: {
                  storeId,
                  date,
                  category,
                  itemName,
                  isModifier: true,
                },
              },
              create: { storeId, date, category, itemName, isModifier: true, ...data },
              update: data,
            }),
          ),
        )
        modifierSynced += batch.length
        counts.modifiers = modifierSynced
      } catch (err) {
        console.error(
          `[metrics-sync ${storeId}] Failed batch of ${batch.length} modifier upserts:`,
          err,
        )
        modifierFailed += batch.length
      }
      const phasePct =
        modifierRecords.length > 0
          ? 40 + ((i + batch.length) / modifierRecords.length) * 60
          : 100
      emit({
        phase: "modifiers",
        status: "writing",
        totalProgress: computeTotalProgress(100, 100, 100, phasePct),
        detail: `Store ${storeId}: writing modifiers (${Math.min(i + 50, modifierRecords.length)}/${modifierRecords.length})…`,
        counts,
      })
    }
  }

  // ─── Phase 5: Ratings (21-day lookback, route opts in) ───
  let ratingsSynced = 0
  let ratingsFailed = 0

  if (includeRatings) {
    emit({
      phase: "ratings",
      status: "fetching",
      totalProgress: computeTotalProgress(100, 100, 100, 100, 0),
      detail: `Store ${storeId}: fetching ratings…`,
      counts,
    })

    const ratingsEnd = new Date()
    ratingsEnd.setUTCHours(23, 59, 59, 999)
    const ratingsStart = new Date()
    ratingsStart.setUTCDate(ratingsStart.getUTCDate() - 21)
    ratingsStart.setUTCHours(0, 0, 0, 0)

    let ratingRows: OtterRow[] = []
    try {
      ratingRows = await queryRatings(buildRatingsBody(otterStoreIds, ratingsStart, ratingsEnd))
    } catch (err) {
      console.error(`[metrics-sync ${storeId}] Ratings sync error:`, err)
    }

    const ratingRecords = ratingRows
      .filter((row: OtterRow) => row["external_review_id"] && row["order_rating"] != null)
      .map((row: OtterRow) => {
        const reviewedAtRaw = row["order_reviewed_at"]
        const reviewedAt =
          typeof reviewedAtRaw === "number"
            ? new Date(reviewedAtRaw)
            : new Date(String(reviewedAtRaw))

        return {
          externalReviewId: String(row["external_review_id"]),
          data: {
            brandName: (row["brand_name"] as string) ?? "",
            facilityName: (row["facility_name"] as string) ?? "",
            storeName: (row["store_name"] as string) ?? "",
            reviewedAt,
            platform: (row["ofo_slug"] as string) ?? "unknown",
            reviewText: (row["order_review_full_text"] as string) || null,
            rating: Number(row["order_rating"]),
            externalOrderId: row["external_order_id"]
              ? String(row["external_order_id"])
              : null,
            orderItemNames: (row["order_items_names"] as string) || null,
          },
        }
      })

    emit({
      phase: "ratings",
      status: "writing",
      totalProgress: computeTotalProgress(100, 100, 100, 100, 40),
      detail: `Store ${storeId}: writing ${ratingRecords.length} ratings…`,
      counts,
    })

    for (let i = 0; i < ratingRecords.length; i += 50) {
      const batch = ratingRecords.slice(i, i + 50)
      try {
        await prisma.$transaction(
          batch.map(({ externalReviewId, data }) =>
            prisma.otterRating.upsert({
              where: {
                storeId_externalReviewId: { storeId, externalReviewId },
              },
              create: { storeId, externalReviewId, ...data },
              update: data,
            }),
          ),
        )
        ratingsSynced += batch.length
        counts.ratings = ratingsSynced
      } catch (err) {
        console.error(
          `[metrics-sync ${storeId}] Failed batch of ${batch.length} rating upserts:`,
          err,
        )
        ratingsFailed += batch.length
      }
      const phasePct =
        ratingRecords.length > 0
          ? 40 + ((i + batch.length) / ratingRecords.length) * 60
          : 100
      emit({
        phase: "ratings",
        status: "writing",
        totalProgress: computeTotalProgress(100, 100, 100, 100, phasePct),
        detail: `Store ${storeId}: writing ratings (${Math.min(i + 50, ratingRecords.length)}/${ratingRecords.length})…`,
        counts,
      })
    }

    emit({
      phase: "ratings",
      status: "done",
      totalProgress: computeTotalProgress(100, 100, 100, 100, 100),
      detail: `Store ${storeId}: ${ratingsSynced} ratings synced`,
      counts,
    })
  }

  // Update lastSyncAt for THIS store's Otter UUIDs only — never touch other
  // stores. The previous global updateMany would lie about other stores'
  // freshness when running per-store.
  await prisma.otterStore.updateMany({
    where: { storeId, otterStoreId: { in: otterStoreIds } },
    data: { lastSyncAt: new Date() },
  })

  return {
    storeId,
    daily: { synced: dailySynced, failed: dailyFailed },
    categories: { synced: categorySynced, failed: categoryFailed },
    items: { synced: itemSynced, failed: itemFailed },
    modifiers: { synced: modifierSynced, failed: modifierFailed },
    ratings: { synced: ratingsSynced, failed: ratingsFailed },
    windowStart,
    windowEnd,
  }
}
