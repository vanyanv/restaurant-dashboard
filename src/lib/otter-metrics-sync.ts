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
import { isFirstPartyPlatform } from "@/lib/first-party-platforms"
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
import { Prisma } from "@/generated/prisma/client"
import {
  buildDeleteMissingSql,
  dedupeByKey,
  planChangedUpserts,
  sumByKey,
  type ChangedUpsertSpec,
  type ColumnSpec,
  type UpsertRow,
} from "@/lib/upsert-changed"

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

function computeTotalProgress(
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
function mergeDailyRecords(records: DailyRecord[]): DailyRecord[] {
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

/**
 * `synced` = rows sent to the database (new, changed or unchanged), as before.
 * `changed` = rows actually inserted or updated; an unchanged row is no longer
 * rewritten, so its `syncedAt` stays put. Callers gate cache busts on it
 * (with `removed`, through `totalChangedRows`).
 * `failed` = rows whose write failed.
 * `removed` = rows deleted because Otter no longer returns them for a date
 * whose fetch fully succeeded (a voided item, a payment method reclassified).
 * `fetchFailed` = requests (a day, or the whole window for daily/ratings)
 * that failed or came back truncated at their row cap. Their dates are
 * neither reconciled nor counted as synced, and the run is recorded PARTIAL.
 */
export type PhaseCounts = {
  synced: number
  failed: number
  changed: number
  removed: number
  fetchFailed: number
}

export interface MetricsSyncResult {
  storeId: string
  daily: PhaseCounts
  categories: PhaseCounts
  items: PhaseCounts
  modifiers: PhaseCounts
  ratings: PhaseCounts
  windowStart: Date
  windowEnd: Date
  /**
   * Why this run is incomplete (failed or truncated fetches, failed writes).
   * Empty on a complete run. Non-empty marks the JobRun PARTIAL and leaves
   * `OtterStore.lastSyncAt` where it was.
   */
  problems: string[]
}

/** Rows inserted, updated or removed across every phase of one store's sync. */
export function totalChangedRows(result: MetricsSyncResult): number {
  const phases = [result.daily, result.categories, result.items, result.modifiers, result.ratings]
  return phases.reduce((sum, p) => sum + p.changed + p.removed, 0)
}

const float = (name: string): ColumnSpec => ({ name, type: "float" })

const MENU_VALUE_COLUMNS: ColumnSpec[] = [
  float("fpQuantitySold"),
  float("fpTotalInclModifiers"),
  float("fpTotalSales"),
  float("tpQuantitySold"),
  float("tpTotalInclModifiers"),
  float("tpTotalSales"),
]

/** @@unique([storeId, date, platform, paymentMethod]) */
export const DAILY_SUMMARY_UPSERT: ChangedUpsertSpec = {
  table: "OtterDailySummary",
  conflict: [
    { name: "storeId", type: "text" },
    { name: "date", type: "date" },
    { name: "platform", type: "text" },
    { name: "paymentMethod", type: "text" },
  ],
  values: [
    ...[
      "fpGrossSales", "fpNetSales", "fpDiscounts", "fpFees", "fpLostRevenue",
      "fpTaxCollected", "fpTaxRemitted", "fpTips", "fpServiceCharges", "fpLoyalty",
      "tpGrossSales", "tpNetSales", "tpFees", "tpTaxCollected", "tpTaxRemitted",
      "tpDiscounts", "tpRefundsAdjustments", "tpServiceCharges", "tpTipForRestaurant",
      "tpLoyaltyDiscount", "tillPaidIn", "tillPaidOut",
    ].map(float),
    { name: "fpOrderCount", type: "int" },
    { name: "tpOrderCount", type: "int" },
  ],
  touch: "syncedAt",
}

/** @@unique([storeId, date, category]) */
export const MENU_CATEGORY_UPSERT: ChangedUpsertSpec = {
  table: "OtterMenuCategory",
  conflict: [
    { name: "storeId", type: "text" },
    { name: "date", type: "date" },
    { name: "category", type: "text" },
  ],
  values: MENU_VALUE_COLUMNS,
  touch: "syncedAt",
}

/** @@unique([storeId, date, category, itemName, isModifier]) */
export const MENU_ITEM_UPSERT: ChangedUpsertSpec = {
  table: "OtterMenuItem",
  conflict: [
    { name: "storeId", type: "text" },
    { name: "date", type: "date" },
    { name: "category", type: "text" },
    { name: "itemName", type: "text" },
    { name: "isModifier", type: "boolean" },
  ],
  values: MENU_VALUE_COLUMNS,
  touch: "syncedAt",
}

/** @@unique([storeId, externalReviewId]) */
export const RATING_UPSERT: ChangedUpsertSpec = {
  table: "OtterRating",
  conflict: [
    { name: "storeId", type: "text" },
    { name: "externalReviewId", type: "text" },
  ],
  values: [
    { name: "brandName", type: "text" },
    { name: "facilityName", type: "text" },
    { name: "storeName", type: "text" },
    { name: "reviewedAt", type: "timestamp" },
    { name: "platform", type: "text" },
    { name: "reviewText", type: "text" },
    { name: "rating", type: "int" },
    { name: "externalOrderId", type: "text" },
    { name: "orderItemNames", type: "text" },
  ],
  touch: "syncedAt",
}

const emptyCounts = (): PhaseCounts => ({
  synced: 0,
  failed: 0,
  changed: 0,
  removed: 0,
  fetchFailed: 0,
})

/**
 * Write one phase's rows, only touching new or changed ones.
 *
 * Without `reconcile`, each statement (one chunk of up to 1000 rows) is its
 * own write: a failing chunk is logged and counted as failed, and the phase
 * carries on. With `reconcile` (the DELETE of rows Otter stopped returning
 * for the dates that fetched cleanly), the upserts and that delete run in one
 * transaction, like `hourly-sync.ts`: either the dates are fully replaced or
 * nothing moves, and a failure counts every row as failed.
 */
async function writeChangedPhase(
  label: string,
  spec: ChangedUpsertSpec,
  rows: UpsertRow[],
  onChunk: (processed: number, counts: PhaseCounts) => void,
  reconcile: Prisma.Sql | null = null,
): Promise<PhaseCounts> {
  const counts = emptyCounts()
  const plan = planChangedUpserts(spec, rows)

  if (reconcile) {
    try {
      const results = await prisma.$transaction([
        ...plan.map(({ sql }) => prisma.$executeRaw(sql)),
        prisma.$executeRaw(reconcile),
      ])
      counts.removed = results[results.length - 1]
      counts.changed = results.slice(0, -1).reduce((sum, n) => sum + n, 0)
      counts.synced = rows.length
    } catch (err) {
      console.error(`[metrics-sync] Failed ${label} write of ${rows.length} rows:`, err)
      counts.failed = rows.length
    }
    onChunk(rows.length, counts)
    return counts
  }

  let processed = 0
  for (const { sql, rowCount } of plan) {
    try {
      counts.changed += await prisma.$executeRaw(sql)
      counts.synced += rowCount
    } catch (err) {
      console.error(`[metrics-sync] Failed ${label} upsert of ${rowCount} rows:`, err)
      counts.failed += rowCount
    }
    processed += rowCount
    onChunk(processed, counts)
  }
  return counts
}

/**
 * True when a response holds as many rows as the request's `limit`.
 * `queryOtterEndpoint` reads one response page, so `limit` is a hard cap:
 * landing on it means Otter had more and the rest were dropped.
 */
function hitRowCap(rows: readonly unknown[], body: object): boolean {
  const limit = (body as { limit?: unknown }).limit
  return typeof limit === "number" && rows.length >= limit
}

const ymd = (d: Date) => d.toISOString().slice(0, 10)

/**
 * The dates a phase may reconcile: fetched cleanly AND came back with at least
 * one row for this store. A clean fetch that returns nothing for a day is not
 * trusted to mean "that day had no sales": one empty answer from Otter would
 * otherwise wipe the day off the P&L until the next run. The cost is that a
 * day whose every row was voided keeps its old rows; that is rare, and the
 * next non-empty answer for the day reconciles it.
 */
function datesWithRows(candidates: readonly string[], keep: readonly { date: Date }[]): string[] {
  const seen = new Set(keep.map((r) => ymd(r.date)))
  return candidates.filter((d) => seen.has(d))
}

type DayFetch = { day: Date; rows: OtterRow[]; ok: boolean }

/**
 * One request per day, five at a time. A day whose request throws or comes
 * back at its row cap is `ok: false`: its rows (if any) are not written and
 * its date is not reconciled.
 */
async function fetchPerDay(
  storeId: string,
  label: string,
  days: Date[],
  buildBody: (day: Date) => object,
  onProgress: (completed: number, total: number) => void,
): Promise<DayFetch[]> {
  const tasks = days.map((day) => async (): Promise<DayFetch> => {
    const body = buildBody(day)
    try {
      const rows: OtterRow[] = await queryMetrics(body)
      if (hitRowCap(rows, body)) {
        console.error(
          `[metrics-sync ${storeId}] ${label} for ${ymd(day)} returned ${rows.length} rows, ` +
            `its row cap: truncated, not written`,
        )
        return { day, rows: [], ok: false }
      }
      return { day, rows, ok: true }
    } catch (err) {
      console.error(`[metrics-sync ${storeId}] ${label} sync error for ${ymd(day)}:`, err)
      return { day, rows: [], ok: false }
    }
  })
  return withConcurrency(tasks, 5, onProgress)
}

function failedDaysProblem(label: string, results: DayFetch[]): string | null {
  const failed = results.filter((r) => !r.ok).map((r) => ymd(r.day))
  if (failed.length === 0) return null
  return `${label}: fetch failed for ${failed.length}/${results.length} days (${failed.slice(0, 10).join(", ")})`
}

function menuFields(row: OtterRow): Record<string, number> {
  return {
    fpQuantitySold: (row["fp_order_items_quantity_sold"] as number) ?? 0,
    fpTotalInclModifiers: (row["fp_order_items_total_include_modifiers"] as number) ?? 0,
    fpTotalSales: (row["fp_order_items_total_sales"] as number) ?? 0,
    tpQuantitySold: (row["third_party_item_quantity_sold"] as number) ?? 0,
    tpTotalInclModifiers: (row["third_party_item_total_include_modifiers"] as number) ?? 0,
    tpTotalSales: (row["third_party_item_total_sales"] as number) ?? 0,
  }
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
 * A run with failed or truncated fetches (or failed writes) completes but is
 * recorded PARTIAL, with the reasons in `metadata.problems`, so it never
 * stands in for the scheduled sync (`coversScheduledWindow`).
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
    async ({ jobRunId, addRows, markPartial }) => {
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
      if (result.problems.length > 0) markPartial(result.problems.join("; "))
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
            problems: result.problems,
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
  const problems: string[] = []
  const storeScope = [{ column: { name: "storeId", type: "text" as const }, value: storeId }]

  // ─── Phase 1: Daily summaries ───
  emit({
    phase: "daily",
    status: "fetching",
    totalProgress: 0,
    detail: `Store ${storeId}: fetching daily summaries…`,
    counts,
  })

  // One request for the whole window. A throw here fails the run (FAILURE),
  // as before; a truncated response writes what came back but reconciles
  // nothing and marks the run PARTIAL.
  const dailyBody = buildDailySyncBody(otterStoreIds, windowStart, windowEnd)
  const dailyRows = await queryMetrics(dailyBody)
  const dailyTruncated = hitRowCap(dailyRows, dailyBody)
  if (dailyTruncated) {
    problems.push(`daily: response hit its row cap (${dailyRows.length} rows), not reconciled`)
  }

  const rawDaily = dailyRows
    .filter((row: OtterRow) => {
      const otterStoreId = row["store"] as string | null
      return otterStoreId && otterUuidSet.has(otterStoreId) && row["eod_date_with_timezone"]
    })
    .map((row: OtterRow): DailyRecord => {
      const date = new Date(row["eod_date_with_timezone"] as string)
      const platform = (row["pos_summary_ofo"] as string | null) ?? "unknown"
      const paymentMethod = (row["multi_value_pos_payment_method"] as string | null) ?? "N/A"
      const isFP = isFirstPartyPlatform(platform)
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
  const dailyUpserts = dailyRecords.map(({ date, platform, paymentMethod, fields }) => ({
    storeId,
    date,
    platform,
    paymentMethod,
    ...fields,
  }))

  emit({
    phase: "daily",
    status: "writing",
    totalProgress: computeTotalProgress(10, 0, 0),
    detail: `Store ${storeId}: writing ${dailyRecords.length} daily records…`,
    counts,
  })

  const daily = await writeChangedPhase(
    `${storeId} daily`,
    DAILY_SUMMARY_UPSERT,
    dailyUpserts,
    (processed, phase) => {
      counts.daily = phase.synced
      emit({
        phase: "daily",
        status: "writing",
        totalProgress: computeTotalProgress(10 + (processed / dailyRecords.length) * 90, 0, 0),
        detail: `Store ${storeId}: writing daily (${processed}/${dailyRecords.length})…`,
        counts,
      })
    },
    dailyTruncated
      ? null
      : buildDeleteMissingSql({
          table: DAILY_SUMMARY_UPSERT.table,
          where: storeScope,
          dates: { column: "date", values: datesWithRows(days.map(ymd), dailyUpserts) },
          key: DAILY_SUMMARY_UPSERT.conflict.filter((c) => c.name !== "storeId"),
          keep: dailyUpserts,
        }),
  )
  if (dailyTruncated) daily.fetchFailed = 1

  emit({
    phase: "daily",
    status: "done",
    totalProgress: computeTotalProgress(100, 0, 0),
    detail: `Store ${storeId}: ${daily.synced} daily records synced (${daily.changed} changed)`,
    counts,
  })

  let categories = emptyCounts()
  let items = emptyCounts()
  let modifiers = emptyCounts()

  if (!dailyOnly) {
    // ─── Phase 2: Menu categories ───
    emit({
      phase: "categories",
      status: "fetching",
      totalProgress: computeTotalProgress(100, 0, 0),
      detail: `Store ${storeId}: fetching categories…`,
      counts,
    })

    const categoryResults = await fetchPerDay(
      storeId,
      "Category",
      days,
      (day) => buildMenuCategoryBatchBody(otterStoreIds, day),
      (completed, total) => {
        const fetchPct = (completed / total) * 40
        emit({
          phase: "categories",
          status: "fetching",
          totalProgress: computeTotalProgress(100, fetchPct, 0),
          detail: `Store ${storeId}: categories (${completed}/${total} days)…`,
          counts,
        })
      },
    )

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
          return { date, category, data: menuFields(row) }
        })
    })

    // The category request groups by `store`, so a store with two Otter
    // UUIDs gets one row per UUID for the same category. Add them: keeping
    // the last one (as `dedupeByKey` did) dropped one UUID's sales.
    const categoryRows = sumByKey(
      categoryRecords,
      (r) => `${r.date.toISOString()}|${r.category}`,
    )
    const categoryUpserts = categoryRows.map(({ date, category, data }) => ({
      storeId,
      date,
      category,
      ...data,
    }))
    categories = await writeChangedPhase(
      `${storeId} category`,
      MENU_CATEGORY_UPSERT,
      categoryUpserts,
      (processed, phase) => {
        counts.categories = phase.synced
        emit({
          phase: "categories",
          status: "writing",
          totalProgress: computeTotalProgress(100, 40 + (processed / categoryRows.length) * 60, 0),
          detail: `Store ${storeId}: writing categories (${processed}/${categoryRows.length})…`,
          counts,
        })
      },
      buildDeleteMissingSql({
        table: MENU_CATEGORY_UPSERT.table,
        where: storeScope,
        dates: {
          column: "date",
          values: datesWithRows(categoryResults.filter((r) => r.ok).map((r) => ymd(r.day)), categoryUpserts),
        },
        key: MENU_CATEGORY_UPSERT.conflict.filter((c) => c.name !== "storeId"),
        keep: categoryUpserts,
      }),
    )
    categories.fetchFailed = categoryResults.filter((r) => !r.ok).length
    const categoryProblem = failedDaysProblem("categories", categoryResults)
    if (categoryProblem) problems.push(categoryProblem)

    emit({
      phase: "categories",
      status: "done",
      totalProgress: computeTotalProgress(100, 100, 0),
      detail: `Store ${storeId}: ${categories.synced} categories synced (${categories.changed} changed)`,
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

    const itemResults = await fetchPerDay(
      storeId,
      "Item",
      days,
      (day) => buildMenuItemSyncBody(otterStoreIds, day),
      (completed, total) => {
        const fetchPct = (completed / total) * 40
        emit({
          phase: "items",
          status: "fetching",
          totalProgress: computeTotalProgress(100, 100, fetchPct),
          detail: `Store ${storeId}: items (${completed}/${total} days)…`,
          counts,
        })
      },
    )

    items = await writeMenuItemPhase(storeId, false, itemResults, (processed, total, phase) => {
      counts.items = phase.synced
      emit({
        phase: "items",
        status: "writing",
        totalProgress: computeTotalProgress(100, 100, 40 + (processed / total) * 60),
        detail: `Store ${storeId}: writing items (${processed}/${total})…`,
        counts,
      })
    })
    const itemProblem = failedDaysProblem("items", itemResults)
    if (itemProblem) problems.push(itemProblem)

    // ─── Phase 4: Modifiers ───
    emit({
      phase: "modifiers",
      status: "fetching",
      totalProgress: computeTotalProgress(100, 100, 100, 0),
      detail: `Store ${storeId}: fetching modifiers…`,
      counts,
    })

    const modifierResults = await fetchPerDay(
      storeId,
      "Modifier",
      days,
      (day) => buildModifierSyncBody(otterStoreIds, day),
      (completed, total) => {
        const fetchPct = (completed / total) * 40
        emit({
          phase: "modifiers",
          status: "fetching",
          totalProgress: computeTotalProgress(100, 100, 100, fetchPct),
          detail: `Store ${storeId}: modifiers (${completed}/${total} days)…`,
          counts,
        })
      },
    )

    modifiers = await writeMenuItemPhase(storeId, true, modifierResults, (processed, total, phase) => {
      counts.modifiers = phase.synced
      emit({
        phase: "modifiers",
        status: "writing",
        totalProgress: computeTotalProgress(100, 100, 100, 40 + (processed / total) * 60),
        detail: `Store ${storeId}: writing modifiers (${processed}/${total})…`,
        counts,
      })
    })
    const modifierProblem = failedDaysProblem("modifiers", modifierResults)
    if (modifierProblem) problems.push(modifierProblem)
  }

  // ─── Phase 5: Ratings (21-day lookback, route opts in) ───
  let ratings = emptyCounts()

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

    // Ratings are individual reviews: nothing is reconciled, so a truncated
    // response still writes what came back. A failed or truncated fetch
    // marks the run PARTIAL.
    let ratingRows: OtterRow[] = []
    let ratingsFetchFailed = false
    const ratingsBody = buildRatingsBody(otterStoreIds, ratingsStart, ratingsEnd)
    try {
      ratingRows = await queryRatings(ratingsBody)
      if (hitRowCap(ratingRows, ratingsBody)) {
        ratingsFetchFailed = true
        problems.push(`ratings: response hit its row cap (${ratingRows.length} rows)`)
      }
    } catch (err) {
      console.error(`[metrics-sync ${storeId}] Ratings sync error:`, err)
      ratingsFetchFailed = true
      problems.push(
        `ratings: fetch failed (${err instanceof Error ? err.message.slice(0, 200) : String(err)})`,
      )
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

    const ratingUpserts = dedupeByKey(ratingRecords, (r) => r.externalReviewId)
    ratings = await writeChangedPhase(
      `${storeId} rating`,
      RATING_UPSERT,
      ratingUpserts.map(({ externalReviewId, data }) => ({ storeId, externalReviewId, ...data })),
      (processed, phase) => {
        counts.ratings = phase.synced
        emit({
          phase: "ratings",
          status: "writing",
          totalProgress: computeTotalProgress(
            100,
            100,
            100,
            100,
            40 + (processed / ratingUpserts.length) * 60,
          ),
          detail: `Store ${storeId}: writing ratings (${processed}/${ratingUpserts.length})…`,
          counts,
        })
      },
    )
    if (ratingsFetchFailed) ratings.fetchFailed = 1

    emit({
      phase: "ratings",
      status: "done",
      totalProgress: computeTotalProgress(100, 100, 100, 100, 100),
      detail: `Store ${storeId}: ${ratings.synced} ratings synced (${ratings.changed} changed)`,
      counts,
    })
  }

  const phases = { daily, categories, items, modifiers, ratings }
  for (const [name, phase] of Object.entries(phases)) {
    if (phase.failed > 0) problems.push(`${name}: ${phase.failed} rows failed to write`)
  }

  // Update lastSyncAt for THIS store's Otter UUIDs only — never touch other
  // stores. The previous global updateMany would lie about other stores'
  // freshness when running per-store. An incomplete run leaves it alone: a
  // store whose menu fetch failed has not been freshly synced.
  if (problems.length === 0) {
    await prisma.otterStore.updateMany({
      where: { storeId, otterStoreId: { in: otterStoreIds } },
      data: { lastSyncAt: new Date() },
    })
  }

  return {
    storeId,
    ...phases,
    windowStart,
    windowEnd,
    problems,
  }
}

/**
 * Items (isModifier=false) or modifiers (isModifier=true) for one store:
 * rows from the days that fetched cleanly, summed on (date, category,
 * itemName), written with the stale rows of those days removed in the same
 * transaction. The item requests carry all of a store's Otter UUIDs and do
 * not group by store, so Otter already adds the UUIDs together; the sum only
 * matters when a null item or category name folds into "Unknown" /
 * "Uncategorized" beside a real row of that name, which last-wins dropped.
 */
async function writeMenuItemPhase(
  storeId: string,
  isModifier: boolean,
  results: DayFetch[],
  onWrite: (processed: number, total: number, counts: PhaseCounts) => void,
): Promise<PhaseCounts> {
  const records = results.flatMap(({ day, rows }) => {
    const date = new Date(day)
    date.setUTCHours(0, 0, 0, 0)
    return rows.map((row: OtterRow) => {
      const category = (row["menu_parent_entity_name"] as string | null) ?? "Uncategorized"
      const itemName = (row["item"] as string | null) ?? "Unknown"
      return { date, category, itemName, data: menuFields(row) }
    })
  })
  const merged = sumByKey(records, (r) => `${r.date.toISOString()}|${r.category}|${r.itemName}`)
  const upserts = merged.map(({ date, category, itemName, data }) => ({
    storeId,
    date,
    category,
    itemName,
    isModifier,
    ...data,
  }))
  const counts = await writeChangedPhase(
    `${storeId} ${isModifier ? "modifier" : "item"}`,
    MENU_ITEM_UPSERT,
    upserts,
    (processed, phase) => onWrite(processed, merged.length, phase),
    buildDeleteMissingSql({
      table: MENU_ITEM_UPSERT.table,
      where: [
        { column: { name: "storeId", type: "text" }, value: storeId },
        { column: { name: "isModifier", type: "boolean" }, value: isModifier },
      ],
      dates: { column: "date", values: datesWithRows(results.filter((r) => r.ok).map((r) => ymd(r.day)), upserts) },
      key: MENU_ITEM_UPSERT.conflict.filter((c) => c.name !== "storeId" && c.name !== "isModifier"),
      keep: upserts,
    }),
  )
  counts.fetchFailed = results.filter((r) => !r.ok).length
  return counts
}
