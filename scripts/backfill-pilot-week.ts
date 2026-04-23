/**
 * One-shot: re-sync OtterDailySummary for a specific date range using the
 * merge-duplicates logic. Built for rescuing historical weeks after the
 * collision fix — safer than running the full 365-day backfill.
 *
 * Usage:
 *   npx tsx scripts/backfill-pilot-week.ts --start=2025-04-28 --end=2025-05-04
 */
import fs from "node:fs"
import path from "node:path"

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const i = t.indexOf("=")
    if (i === -1) continue
    const k = t.slice(0, i).trim()
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "")
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnvLocal()

async function main() {
  const args = process.argv.slice(2)
  const get = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(`--${k}=`.length) ?? null
  const startStr = get("start")
  const endStr = get("end")
  if (!startStr || !endStr) {
    console.error("Usage: --start=YYYY-MM-DD --end=YYYY-MM-DD")
    process.exit(1)
  }
  const startDate = new Date(`${startStr}T00:00:00`)
  const endDate = new Date(`${endStr}T23:59:59`)

  const { prisma } = await import("../src/lib/prisma")
  const { queryMetrics, buildDailySyncBody } = await import("../src/lib/otter")

  try {
    const otterStores = await prisma.otterStore.findMany({
      where: { store: { isActive: true } },
    })
    const otterToInternal = new Map(otterStores.map((s) => [s.otterStoreId, s.storeId]))
    const uuids = otterStores.map((s) => s.otterStoreId)
    console.log(`Querying Otter for ${uuids.length} store UUIDs, ${startStr}..${endStr}`)

    const body = buildDailySyncBody(uuids, startDate, endDate)
    const rows = await queryMetrics(body)
    console.log(`Fetched ${rows.length} raw rows`)

    type Extract = {
      storeId: string; date: Date; platform: string; paymentMethod: string
      data: Record<string, number | null>
    }
    const merged = new Map<string, Extract>()
    let skipped = 0
    for (const row of rows) {
      const otterStoreId = row["store"] as string | null
      if (!otterStoreId) { skipped++; continue }
      const storeId = otterToInternal.get(otterStoreId)
      if (!storeId) { skipped++; continue }
      const dateStr = row["eod_date_with_timezone"] as string | null
      if (!dateStr) { skipped++; continue }
      const date = new Date(dateStr)
      const platform = (row["pos_summary_ofo"] as string | null) ?? "unknown"
      const paymentMethod = (row["multi_value_pos_payment_method"] as string | null) ?? "N/A"
      const isFP = platform === "css-pos" || platform === "bnm-web"
      const orderCount = (row["order_count"] as number | null) ?? null
      const data: Record<string, number | null> = {
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

      const key = `${storeId}|${date.toISOString()}|${platform}|${paymentMethod}`
      const existing = merged.get(key)
      if (!existing) {
        merged.set(key, { storeId, date, platform, paymentMethod, data })
      } else {
        for (const [k, v] of Object.entries(data)) {
          const cur = existing.data[k]
          if (v == null) continue
          existing.data[k] = cur == null ? v : cur + v
        }
      }
    }
    console.log(`Merged to ${merged.size} unique rows (skipped ${skipped})`)

    let synced = 0
    for (const rec of merged.values()) {
      await prisma.otterDailySummary.upsert({
        where: {
          storeId_date_platform_paymentMethod: {
            storeId: rec.storeId, date: rec.date, platform: rec.platform, paymentMethod: rec.paymentMethod,
          },
        },
        create: { storeId: rec.storeId, date: rec.date, platform: rec.platform, paymentMethod: rec.paymentMethod, ...rec.data },
        update: rec.data,
      })
      synced++
    }
    console.log(`Upserted ${synced} rows`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
