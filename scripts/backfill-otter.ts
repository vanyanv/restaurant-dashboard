// scripts/backfill-otter.ts
// One-time backfill of historical Otter data into the database.
// Run with: npx tsx scripts/backfill-otter.ts [days]
//   npx tsx scripts/backfill-otter.ts          # 365 days (default)
//   npx tsx scripts/backfill-otter.ts 180      # 180 days
//   npx tsx scripts/backfill-otter.ts 90       # 90 days

import fs from "fs"
import path from "path"

// --- Load .env.local BEFORE dynamic imports that read process.env ---
function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return
  const content = fs.readFileSync(envPath, "utf-8")
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "")
    if (!process.env[key]) {
      process.env[key] = val
    }
  }
}

loadEnvLocal()

const CHUNK_DAYS = 30
const INTER_CHUNK_DELAY_MS = 2000
const MAX_RETRIES = 3
const BATCH_SIZE = 25
const CONCURRENCY = 5

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const startTime = Date.now()
function elapsed(): string {
  const s = Math.floor((Date.now() - startTime) / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}m${String(sec).padStart(2, "0")}s`
}

async function main() {
  // Dynamic imports so process.env is populated first
  const { prisma } = await import("../src/lib/prisma")
  const {
    queryMetrics,
    buildDailySyncBody,
    buildMenuCategoryBatchBody,
    buildMenuItemSyncBody,
    buildModifierSyncBody,
    getDateRange,
    withConcurrency,
  } = await import("../src/lib/otter")
  type OtterRow = import("../src/lib/otter").OtterRow

  // Retry wrapper for rate-limited (403) responses
  async function queryWithRetry(body: object, label: string): Promise<OtterRow[]> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await queryMetrics(body)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes("403") && attempt < MAX_RETRIES) {
          const backoff = INTER_CHUNK_DELAY_MS * attempt
          console.log(`  ${label}: 403 — retrying in ${backoff / 1000}s (attempt ${attempt}/${MAX_RETRIES})`)
          await sleep(backoff)
        } else {
          throw err
        }
      }
    }
    return [] // unreachable
  }

  // Batch upsert helper — executes PrismaPromises in batches via $transaction
  async function batchUpsert(
    operations: Array<() => any>,
    _label: string
  ): Promise<{ synced: number; failed: number }> {
    let synced = 0
    let failed = 0

    for (let i = 0; i < operations.length; i += BATCH_SIZE) {
      const batch = operations.slice(i, i + BATCH_SIZE)
      try {
        await prisma.$transaction(batch.map((op) => op()))
        synced += batch.length
      } catch {
        // Fallback: run individually
        for (const op of batch) {
          try {
            await op()
            synced++
          } catch {
            failed++
          }
        }
      }
    }

    return { synced, failed }
  }

  const days = parseInt(process.argv[2] || "365", 10)
  if (isNaN(days) || days < 1) {
    console.error("Usage: npx tsx scripts/backfill-otter.ts [days] [--daily-only]")
    process.exit(1)
  }

  const dailyOnly = process.argv.includes("--daily-only")

  console.log(`\nOtter Historical Backfill — ${days} days\n`)

  // Fetch all active Otter stores
  const otterStores = await prisma.otterStore.findMany({
    include: { store: { select: { id: true, name: true, isActive: true } } },
  })

  const activeStores = otterStores.filter((os) => os.store.isActive)
  if (activeStores.length === 0) {
    console.log("No active Otter stores found. Exiting.")
    await prisma.$disconnect()
    return
  }

  const otterStoreIds = activeStores.map((os) => os.otterStoreId)
  const otterToInternal = new Map<string, string>(
    activeStores.map((os) => [os.otterStoreId, os.storeId])
  )

  // Group Otter UUIDs by internal storeId (multiple UUIDs may map to one store)
  const storeGroups = new Map<string, string[]>()
  for (const os of activeStores) {
    const uuids = storeGroups.get(os.storeId) ?? []
    uuids.push(os.otterStoreId)
    storeGroups.set(os.storeId, uuids)
  }

  console.log(
    `Stores: ${activeStores.map((s) => s.store.name).join(", ")} (${activeStores.length} active, ${storeGroups.size} internal)\n`
  )

  // --- Upsert helpers ---

  function makeDailyUpsert(row: OtterRow) {
    const otterStoreId = row["store"] as string | null
    if (!otterStoreId) return null
    const storeId = otterToInternal.get(otterStoreId)
    if (!storeId) return null
    const dateStr = row["eod_date_with_timezone"] as string | null
    if (!dateStr) return null

    const date = new Date(dateStr)
    const platform = (row["pos_summary_ofo"] as string | null) ?? "unknown"
    const paymentMethod = (row["multi_value_pos_payment_method"] as string | null) ?? "N/A"
    const isFP = platform === "css-pos" || platform === "bnm-web"
    const orderCount = (row["order_count"] as number | null) ?? null

    const data = {
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

    return () =>
      prisma.otterDailySummary.upsert({
        where: {
          storeId_date_platform_paymentMethod: { storeId, date, platform, paymentMethod },
        },
        create: { storeId, date, platform, paymentMethod, ...data },
        update: data,
      })
  }

  function makeCategoryUpsert(row: OtterRow, storeId: string, date: Date) {
    const category = (row["menu_parent_entity_name"] as string | null) ?? "Uncategorized"

    const data = {
      fpQuantitySold: (row["fp_order_items_quantity_sold"] as number) ?? 0,
      fpTotalInclModifiers: (row["fp_order_items_total_include_modifiers"] as number) ?? 0,
      fpTotalSales: (row["fp_order_items_total_sales"] as number) ?? 0,
      tpQuantitySold: (row["third_party_item_quantity_sold"] as number) ?? 0,
      tpTotalInclModifiers: (row["third_party_item_total_include_modifiers"] as number) ?? 0,
      tpTotalSales: (row["third_party_item_total_sales"] as number) ?? 0,
    }

    return () =>
      prisma.otterMenuCategory.upsert({
        where: { storeId_date_category: { storeId, date, category } },
        create: { storeId, date, category, ...data },
        update: data,
      })
  }

  function makeItemUpsert(row: OtterRow, storeId: string, date: Date, isModifier: boolean) {
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

    return () =>
      prisma.otterMenuItem.upsert({
        where: { storeId_date_category_itemName_isModifier: { storeId, date, category, itemName, isModifier } },
        create: { storeId, date, category, itemName, isModifier, ...data },
        update: data,
      })
  }

  // --- Process chunks ---
  const totalChunks = Math.ceil(days / CHUNK_DAYS)
  let totalDaily = 0
  let totalDailyFailed = 0
  let totalCategories = 0
  let totalCategoriesFailed = 0
  let totalItems = 0
  let totalItemsFailed = 0
  let totalModifiers = 0
  let totalModifiersFailed = 0

  for (let chunk = 0; chunk < totalChunks; chunk++) {
    const daysBack = days - chunk * CHUNK_DAYS
    const daysBackEnd = Math.max(daysBack - CHUNK_DAYS, 0)

    const endDate = new Date()
    endDate.setDate(endDate.getDate() - daysBackEnd)
    endDate.setHours(23, 59, 59, 999)

    const startDate = new Date()
    startDate.setDate(startDate.getDate() - daysBack)
    startDate.setHours(0, 0, 0, 0)

    const label = `[${elapsed()}] Chunk ${chunk + 1}/${totalChunks}: days ${daysBack}-${daysBackEnd}`
    console.log(`\n${label}`)

    // --- Daily Summaries (1 API call per chunk, all stores) ---
    try {
      const body = buildDailySyncBody(otterStoreIds, startDate, endDate)
      const rows = await queryWithRetry(body, "Daily")
      console.log(`  [Daily] Fetched ${rows.length} rows, upserting...`)

      const ops = rows.map((row) => makeDailyUpsert(row)).filter(Boolean) as Array<() => any>
      const { synced, failed } = await batchUpsert(ops, "Daily")
      totalDaily += synced
      totalDailyFailed += failed
      console.log(`  [Daily] Done: ${synced} synced${failed > 0 ? `, ${failed} failed` : ""}`)
    } catch (err) {
      console.error(`  [Daily] Sync error:`, err instanceof Error ? err.message : err)
    }

    if (!dailyOnly) {
      const chunkDays = getDateRange(startDate, endDate)

      // --- Menu Categories (1 API call per day, all stores via store groupBy) ---
      const categoryTasks = chunkDays.map((day) => () =>
        queryWithRetry(buildMenuCategoryBatchBody(otterStoreIds, day), `Categories ${day.toISOString().slice(0, 10)}`)
          .then((rows) => ({ day, rows }))
      )

      console.log(`  [Categories] Fetching ${categoryTasks.length} days with concurrency ${CONCURRENCY}...`)
      const categoryResults = await withConcurrency(categoryTasks, CONCURRENCY)

      for (const { day, rows } of categoryResults) {
        const date = new Date(day)
        date.setHours(0, 0, 0, 0)

        const ops = rows
          .filter((row) => {
            const otterStoreId = row["store"] as string | null
            return otterStoreId && otterToInternal.has(otterStoreId)
          })
          .map((row) => {
            const storeId = otterToInternal.get(row["store"] as string)!
            return makeCategoryUpsert(row, storeId, date)
          })

        const { synced, failed } = await batchUpsert(ops, `Categories ${day.toISOString().slice(0, 10)}`)
        totalCategories += synced
        totalCategoriesFailed += failed
      }
      console.log(`  [Categories] Done: ${totalCategories} synced total`)

      // --- Menu Items (per-store per-day, store groupBy not supported) ---
      const storeEntries = [...storeGroups.entries()]
      const itemTasks = chunkDays.flatMap((day) =>
        storeEntries.map(([sid, uuids]) => () =>
          queryWithRetry(buildMenuItemSyncBody(uuids, day), `Items ${day.toISOString().slice(0, 10)}`)
            .then((rows) => ({ day, sid, rows }))
        )
      )

      console.log(`  [Items] Fetching ${itemTasks.length} store-days with concurrency ${CONCURRENCY}...`)
      const itemResults = await withConcurrency(itemTasks, CONCURRENCY)

      for (const { day, sid, rows } of itemResults) {
        const date = new Date(day)
        date.setHours(0, 0, 0, 0)
        const ops = rows.map((row) => makeItemUpsert(row, sid, date, false)).filter(Boolean) as Array<() => any>
        const { synced, failed } = await batchUpsert(ops, `Items`)
        totalItems += synced
        totalItemsFailed += failed
      }
      console.log(`  [Items] Done: ${totalItems} synced total`)

      // --- Modifiers (per-store per-day) ---
      const modTasks = chunkDays.flatMap((day) =>
        storeEntries.map(([sid, uuids]) => () =>
          queryWithRetry(buildModifierSyncBody(uuids, day), `Modifiers ${day.toISOString().slice(0, 10)}`)
            .then((rows) => ({ day, sid, rows }))
        )
      )

      console.log(`  [Modifiers] Fetching ${modTasks.length} store-days with concurrency ${CONCURRENCY}...`)
      const modResults = await withConcurrency(modTasks, CONCURRENCY)

      for (const { day, sid, rows } of modResults) {
        const date = new Date(day)
        date.setHours(0, 0, 0, 0)
        const ops = rows.map((row) => makeItemUpsert(row, sid, date, true)).filter(Boolean) as Array<() => any>
        const { synced, failed } = await batchUpsert(ops, `Modifiers`)
        totalModifiers += synced
        totalModifiersFailed += failed
      }
      console.log(`  [Modifiers] Done: ${totalModifiers} synced total`)
    }

    // Pause between chunks to avoid rate limiting
    if (chunk < totalChunks - 1) {
      console.log(`  [${elapsed()}] Chunk complete. Pausing ${INTER_CHUNK_DELAY_MS / 1000}s...`)
      await sleep(INTER_CHUNK_DELAY_MS)
    }
  }

  // Update lastSyncAt for all processed stores
  await prisma.otterStore.updateMany({
    where: { otterStoreId: { in: otterStoreIds } },
    data: { lastSyncAt: new Date() },
  })

  // Summary
  console.log(`\n--- Backfill Complete [${elapsed()}] ---`)
  console.log(`Daily summaries: ${totalDaily} synced, ${totalDailyFailed} failed`)
  console.log(`Menu categories: ${totalCategories} synced, ${totalCategoriesFailed} failed`)
  console.log(`Menu items:      ${totalItems} synced, ${totalItemsFailed} failed`)
  console.log(`Modifiers:       ${totalModifiers} synced, ${totalModifiersFailed} failed`)
  const totalSynced = totalDaily + totalCategories + totalItems + totalModifiers
  const totalFailed = totalDailyFailed + totalCategoriesFailed + totalItemsFailed + totalModifiersFailed
  console.log(`Total:           ${totalSynced} synced, ${totalFailed} failed\n`)

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error("Backfill failed:", err)
  process.exit(1)
})
