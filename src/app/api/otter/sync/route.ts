import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import {
  queryMetrics,
  buildDailySyncBody,
  buildMenuCategorySyncBody,
  buildMenuItemSyncBody,
  buildModifierSyncBody,
  getDateRange,
} from "@/lib/otter"
import type { SyncProgressEvent } from "@/types/sync"

export const maxDuration = 120

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OtterRow = Record<string, any>

type ProgressEmitter = (event: SyncProgressEvent) => void

const PHASE_WEIGHTS = { daily: 0.25, categories: 0.15, items: 0.35, modifiers: 0.25 } as const

function computeTotalProgress(dailyPct: number, categoryPct: number, itemPct: number, modifierPct: number = 0): number {
  return Math.round(
    dailyPct * PHASE_WEIGHTS.daily +
    categoryPct * PHASE_WEIGHTS.categories +
    itemPct * PHASE_WEIGHTS.items +
    modifierPct * PHASE_WEIGHTS.modifiers
  )
}

/** Run async tasks with a concurrency limit (worker-pool pattern). */
async function withConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
  onProgress?: (completed: number, total: number) => void
): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let nextIndex = 0
  let completed = 0

  async function worker() {
    while (nextIndex < tasks.length) {
      const index = nextIndex++
      results[index] = await tasks[index]()
      completed++
      onProgress?.(completed, tasks.length)
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    () => worker()
  )
  await Promise.all(workers)
  return results
}

function isCronRequest(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return false
  return authHeader === `Bearer ${cronSecret}`
}

interface SyncResult {
  message: string
  synced: number
  failed: number
  categorySynced: number
  categoryFailed: number
  itemSynced: number
  itemFailed: number
  modifierSynced: number
  modifierFailed: number
  storesProcessed: number
}

async function runSync(emit: ProgressEmitter): Promise<SyncResult> {
  // Fetch all configured Otter stores
  const otterStores = await prisma.otterStore.findMany({
    include: { store: { select: { id: true, name: true, isActive: true } } },
  })

  if (otterStores.length === 0) {
    return {
      message: "No Otter stores configured",
      synced: 0, failed: 0,
      categorySynced: 0, categoryFailed: 0,
      itemSynced: 0, itemFailed: 0,
      modifierSynced: 0, modifierFailed: 0,
      storesProcessed: 0,
    }
  }

  const activeOtterStores = otterStores.filter((os) => os.store.isActive)
  const otterStoreIds = activeOtterStores.map((os) => os.otterStoreId)

  // 3-day lookback to catch late-arriving platform adjustments
  const endDate = new Date()
  endDate.setHours(23, 59, 59, 999)
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 3)
  startDate.setHours(0, 0, 0, 0)

  const otterToInternal = new Map<string, string>(
    activeOtterStores.map((os) => [os.otterStoreId, os.storeId])
  )

  // Group Otter UUIDs by internal storeId (multiple UUIDs may map to one store)
  const storeGroups = new Map<string, string[]>()
  for (const os of activeOtterStores) {
    const uuids = storeGroups.get(os.storeId) ?? []
    uuids.push(os.otterStoreId)
    storeGroups.set(os.storeId, uuids)
  }

  const days = getDateRange(startDate, endDate)
  const counts = { daily: 0, categories: 0, items: 0, modifiers: 0 }

  // ─── Phase 1: Daily summary sync (1 API call) ───
  emit({
    phase: "daily", status: "fetching", totalProgress: 0,
    detail: "Fetching daily summaries...", counts,
  })

  const body = buildDailySyncBody(otterStoreIds, startDate, endDate)
  const rows = await queryMetrics(body)

  let synced = 0
  let failed = 0

  const dailyRecords = rows
    .filter((row: OtterRow) => {
      const otterStoreId = row["store"] as string | null
      return otterStoreId && otterToInternal.has(otterStoreId) && row["eod_date_with_timezone"]
    })
    .map((row: OtterRow) => {
      const storeId = otterToInternal.get(row["store"] as string)!
      const date = new Date(row["eod_date_with_timezone"] as string)
      const platform = (row["pos_summary_ofo"] as string | null) ?? "unknown"
      const paymentMethod = (row["multi_value_pos_payment_method"] as string | null) ?? "N/A"
      const isFP = platform === "css-pos" || platform === "bnm-web"
      const orderCount = (row["order_count"] as number | null) ?? null

      const fields = {
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

  emit({
    phase: "daily", status: "writing", totalProgress: computeTotalProgress(10, 0, 0),
    detail: `Writing ${dailyRecords.length} daily records...`, counts,
  })

  for (let i = 0; i < dailyRecords.length; i += 50) {
    const batch = dailyRecords.slice(i, i + 50)
    try {
      await prisma.$transaction(
        batch.map(({ storeId, date, platform, paymentMethod, fields }) =>
          prisma.otterDailySummary.upsert({
            where: {
              storeId_date_platform_paymentMethod: { storeId, date, platform, paymentMethod },
            },
            create: { storeId, date, platform, paymentMethod, ...fields },
            update: fields,
          })
        )
      )
      synced += batch.length
      counts.daily = synced
    } catch (err) {
      console.error(`Failed batch of ${batch.length} daily upserts at offset ${i}:`, err)
      failed += batch.length
    }
    const phasePct = dailyRecords.length > 0
      ? 10 + ((i + batch.length) / dailyRecords.length) * 90
      : 100
    emit({
      phase: "daily", status: "writing",
      totalProgress: computeTotalProgress(phasePct, 0, 0),
      detail: `Writing daily records (${Math.min(i + 50, dailyRecords.length)}/${dailyRecords.length})...`,
      counts,
    })
  }

  emit({
    phase: "daily", status: "done", totalProgress: computeTotalProgress(100, 0, 0),
    detail: `${synced} daily records synced`, counts,
  })

  // ─── Phase 2: Menu categories ───
  emit({
    phase: "categories", status: "fetching",
    totalProgress: computeTotalProgress(100, 0, 0),
    detail: "Fetching menu categories...", counts,
  })

  // One API call per internal store per day (Otter deduplicates across UUIDs)
  const categoryTasks = days.flatMap((day) =>
    [...storeGroups.entries()].map(([storeId, uuids]) => () =>
      queryMetrics(buildMenuCategorySyncBody(uuids, day))
        .then((categoryRows: OtterRow[]) => ({ day, storeId, rows: categoryRows }))
        .catch((err: unknown) => {
          console.error(`Menu category sync error for ${day.toISOString().slice(0, 10)}:`, err)
          return { day, storeId, rows: [] as OtterRow[] }
        })
    )
  )

  const categoryResults = await withConcurrency(categoryTasks, 5, (completed, total) => {
    const fetchPct = (completed / total) * 40
    emit({
      phase: "categories", status: "fetching",
      totalProgress: computeTotalProgress(100, fetchPct, 0),
      detail: `Fetching categories (${completed}/${total} store-days)...`, counts,
    })
  })

  let categorySynced = 0
  let categoryFailed = 0

  const categoryRecords = categoryResults.flatMap(({ day, storeId, rows: categoryRows }) => {
    const date = new Date(day)
    date.setHours(0, 0, 0, 0)

    return categoryRows.map((row: OtterRow) => {
      const category = (row["menu_parent_entity_name"] as string | null) ?? "Uncategorized"
      const data = {
        fpQuantitySold: (row["fp_order_items_quantity_sold"] as number) ?? 0,
        fpTotalInclModifiers: (row["fp_order_items_total_include_modifiers"] as number) ?? 0,
        fpTotalSales: (row["fp_order_items_total_sales"] as number) ?? 0,
        tpQuantitySold: (row["third_party_item_quantity_sold"] as number) ?? 0,
        tpTotalInclModifiers: (row["third_party_item_total_include_modifiers"] as number) ?? 0,
        tpTotalSales: (row["third_party_item_total_sales"] as number) ?? 0,
      }
      return { storeId, date, category, data }
    })
  })

  for (let i = 0; i < categoryRecords.length; i += 50) {
    const batch = categoryRecords.slice(i, i + 50)
    try {
      await prisma.$transaction(
        batch.map(({ storeId, date, category, data }) =>
          prisma.otterMenuCategory.upsert({
            where: { storeId_date_category: { storeId, date, category } },
            create: { storeId, date, category, ...data },
            update: data,
          })
        )
      )
      categorySynced += batch.length
      counts.categories = categorySynced
    } catch (err) {
      console.error(`Failed batch of ${batch.length} category upserts:`, err)
      categoryFailed += batch.length
    }
    const phasePct = categoryRecords.length > 0
      ? 40 + ((i + batch.length) / categoryRecords.length) * 60
      : 100
    emit({
      phase: "categories", status: "writing",
      totalProgress: computeTotalProgress(100, phasePct, 0),
      detail: `Writing categories (${Math.min(i + 50, categoryRecords.length)}/${categoryRecords.length})...`,
      counts,
    })
  }

  emit({
    phase: "categories", status: "done",
    totalProgress: computeTotalProgress(100, 100, 0),
    detail: `${categorySynced} categories synced`, counts,
  })

  // ─── Phase 3: Menu items ───
  emit({
    phase: "items", status: "fetching",
    totalProgress: computeTotalProgress(100, 100, 0),
    detail: "Fetching menu items...", counts,
  })

  // One API call per internal store per day (Otter deduplicates across UUIDs)
  const itemTasks = days.flatMap((day) =>
    [...storeGroups.entries()].map(([storeId, uuids]) => () =>
      queryMetrics(buildMenuItemSyncBody(uuids, day))
        .then((itemRows: OtterRow[]) => ({ day, storeId, rows: itemRows }))
        .catch((err: unknown) => {
          console.error(`Menu item sync error for ${day.toISOString().slice(0, 10)} store ${storeId}:`, err)
          return { day, storeId, rows: [] as OtterRow[] }
        })
    )
  )

  const itemResults = await withConcurrency(itemTasks, 5, (completed, total) => {
    const fetchPct = (completed / total) * 40
    emit({
      phase: "items", status: "fetching",
      totalProgress: computeTotalProgress(100, 100, fetchPct),
      detail: `Fetching items (${completed}/${total} store-days)...`, counts,
    })
  })

  let itemSynced = 0
  let itemFailed = 0

  const itemRecords = itemResults.flatMap(({ day, storeId, rows: itemRows }) => {
    const date = new Date(day)
    date.setHours(0, 0, 0, 0)

    return itemRows.map((row: OtterRow) => {
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
      return { storeId, date, category, itemName, data }
    })
  })

  for (let i = 0; i < itemRecords.length; i += 50) {
    const batch = itemRecords.slice(i, i + 50)
    try {
      await prisma.$transaction(
        batch.map(({ storeId, date, category, itemName, data }) =>
          prisma.otterMenuItem.upsert({
            where: { storeId_date_category_itemName_isModifier: { storeId, date, category, itemName, isModifier: false } },
            create: { storeId, date, category, itemName, isModifier: false, ...data },
            update: data,
          })
        )
      )
      itemSynced += batch.length
      counts.items = itemSynced
    } catch (err) {
      console.error(`Failed batch of ${batch.length} item upserts:`, err)
      itemFailed += batch.length
    }
    const phasePct = itemRecords.length > 0
      ? 40 + ((i + batch.length) / itemRecords.length) * 60
      : 100
    emit({
      phase: "items", status: "writing",
      totalProgress: computeTotalProgress(100, 100, phasePct),
      detail: `Writing items (${Math.min(i + 50, itemRecords.length)}/${itemRecords.length})...`,
      counts,
    })
  }

  // ─── Phase 4: Modifiers (is_parent: false) ───
  emit({
    phase: "modifiers", status: "fetching",
    totalProgress: computeTotalProgress(100, 100, 100, 0),
    detail: "Fetching modifiers...", counts,
  })

  const modifierTasks = days.flatMap((day) =>
    [...storeGroups.entries()].map(([storeId, uuids]) => () =>
      queryMetrics(buildModifierSyncBody(uuids, day))
        .then((modRows: OtterRow[]) => ({ day, storeId, rows: modRows }))
        .catch((err: unknown) => {
          console.error(`Modifier sync error for ${day.toISOString().slice(0, 10)} store ${storeId}:`, err)
          return { day, storeId, rows: [] as OtterRow[] }
        })
    )
  )

  const modifierResults = await withConcurrency(modifierTasks, 5, (completed, total) => {
    const fetchPct = (completed / total) * 40
    emit({
      phase: "modifiers", status: "fetching",
      totalProgress: computeTotalProgress(100, 100, 100, fetchPct),
      detail: `Fetching modifiers (${completed}/${total} store-days)...`, counts,
    })
  })

  let modifierSynced = 0
  let modifierFailed = 0

  const modifierRecords = modifierResults.flatMap(({ day, storeId, rows: modRows }) => {
    const date = new Date(day)
    date.setHours(0, 0, 0, 0)

    return modRows.map((row: OtterRow) => {
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
      return { storeId, date, category, itemName, data }
    })
  })

  for (let i = 0; i < modifierRecords.length; i += 50) {
    const batch = modifierRecords.slice(i, i + 50)
    try {
      await prisma.$transaction(
        batch.map(({ storeId, date, category, itemName, data }) =>
          prisma.otterMenuItem.upsert({
            where: { storeId_date_category_itemName_isModifier: { storeId, date, category, itemName, isModifier: true } },
            create: { storeId, date, category, itemName, isModifier: true, ...data },
            update: data,
          })
        )
      )
      modifierSynced += batch.length
      counts.modifiers = modifierSynced
    } catch (err) {
      console.error(`Failed batch of ${batch.length} modifier upserts:`, err)
      modifierFailed += batch.length
    }
    const phasePct = modifierRecords.length > 0
      ? 40 + ((i + batch.length) / modifierRecords.length) * 60
      : 100
    emit({
      phase: "modifiers", status: "writing",
      totalProgress: computeTotalProgress(100, 100, 100, phasePct),
      detail: `Writing modifiers (${Math.min(i + 50, modifierRecords.length)}/${modifierRecords.length})...`,
      counts,
    })
  }

  // Update lastSyncAt for all processed stores
  await prisma.otterStore.updateMany({
    where: { otterStoreId: { in: otterStoreIds } },
    data: { lastSyncAt: new Date() },
  })

  const message = `Otter sync completed: ${synced} daily rows, ${categorySynced} categories, ${itemSynced} items, ${modifierSynced} modifiers`
  counts.daily = synced
  counts.categories = categorySynced
  counts.items = itemSynced
  counts.modifiers = modifierSynced

  emit({
    phase: "complete", status: "done", totalProgress: 100,
    detail: message, counts,
  })

  return {
    message,
    synced, failed,
    categorySynced, categoryFailed,
    itemSynced, itemFailed,
    modifierSynced, modifierFailed,
    storesProcessed: activeOtterStores.length,
  }
}

export async function POST(request: NextRequest) {
  // Allow Vercel Cron or authenticated owner
  const fromCron = isCronRequest(request)
  if (!fromCron) {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (session.user.role !== "OWNER") {
      return NextResponse.json({ error: "Only owners can sync Otter data" }, { status: 403 })
    }
  }

  const wantsSSE = request.headers.get("accept")?.includes("text/event-stream")

  if (wantsSSE) {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const emit: ProgressEmitter = (event) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          } catch {
            // Client disconnected, ignore
          }
        }
        try {
          await runSync(emit)
        } catch (error) {
          console.error("Otter sync error:", error)
          emit({
            phase: "error", status: "error", totalProgress: 0,
            detail: error instanceof Error ? error.message : "Internal server error",
            counts: { daily: 0, categories: 0, items: 0, modifiers: 0 },
            error: error instanceof Error ? error.message : "Internal server error",
          })
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    })
  }

  // JSON path (cron or non-SSE clients)
  try {
    const result = await runSync(() => {})
    return NextResponse.json(result)
  } catch (error) {
    console.error("Otter sync error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    )
  }
}
