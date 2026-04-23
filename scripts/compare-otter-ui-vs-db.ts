/**
 * Sanity check: query Otter with the SAME shape the Otter UI uses (groupBy
 * payment_method + pos_summary_ofo, no date), then compare to our DB's summed
 * values for the same date range. If the merge fix is complete, these should
 * agree to the penny for every channel.
 *
 * Usage:
 *   npx tsx scripts/compare-otter-ui-vs-db.ts --start=2025-04-28 --end=2025-05-04
 *   npx tsx scripts/compare-otter-ui-vs-db.ts --start=2025-04-28 --end=2025-05-04 --store=Hollywood
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

function arg(name: string, fallback: string | null = null): string | null {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`))
  return found ? found.slice(`--${name}=`.length) : fallback
}

async function main() {
  const startStr = arg("start")
  const endStr = arg("end")
  const storeFilter = arg("store")
  if (!startStr || !endStr) { console.error("need --start and --end"); process.exit(1) }

  const { prisma } = await import("../src/lib/prisma")
  const { queryMetrics } = await import("../src/lib/otter")

  try {
    const otterStores = await prisma.otterStore.findMany({
      where: {
        store: {
          isActive: true,
          ...(storeFilter ? { name: { contains: storeFilter, mode: "insensitive" } } : {}),
        },
      },
      include: { store: { select: { id: true, name: true } } },
    })
    const storeIds = [...new Set(otterStores.map((s) => s.storeId))]
    const uuids = otterStores.map((s) => s.otterStoreId)
    console.log(`Scope: ${otterStores.map((s) => s.store.name).join(", ")}`)
    console.log(`Range: ${startStr} .. ${endStr}\n`)

    // UI-shape query: no date groupBy, all financial columns + till
    const columns = [
      "fp_sales_financials_gross_sales", "fp_sales_financials_net_sales",
      "fp_sales_financials_discounts", "fp_sales_financials_fees",
      "fp_sales_financials_tax_collected", "fp_sales_financials_service_charges",
      "fp_sales_financials_tips", "fp_sales_financials_loyalty",
      "third_party_gross_sales", "third_party_net_sales",
      "third_party_discounts", "third_party_fees",
      "third_party_tax_collected", "third_party_service_charges",
      "third_party_refunds_adjustments", "third_party_tip_for_restaurant",
      "third_party_loyalty_discount",
      "enriched_till_report_paid_in", "enriched_till_report_paid_out",
      "enriched_till_report_drawer_reconciliation",
      "order_count",
    ]

    const body = {
      columns: columns.map((k) => ({ type: "metric", key: k })),
      groupBy: [
        { key: "multi_value_pos_payment_method" },
        { key: "pos_summary_ofo" },
      ],
      sortBy: [{ type: "metric", key: "fp_sales_financials_gross_sales", sortOrder: "DESC" }],
      filterSet: [
        { filterType: "dateRangeFilter", minDate: `${startStr}T00:00:00.000Z`, maxDate: `${endStr}T23:59:59.999Z` },
      ],
      scopeSet: [{ key: "store", values: uuids }],
      includeMetricsFilters: true,
      localTime: true,
      includeTotalRowCount: false,
      limit: 1500,
      includeRawQueries: false,
    }

    const otterRows = await queryMetrics(body)
    console.log(`Otter returned ${otterRows.length} rows.\n`)

    // Build DB-side aggregate
    // Dates in OtterDailySummary are stored at UTC midnight; use explicit UTC bounds.
    const dbRows = await prisma.otterDailySummary.findMany({
      where: {
        storeId: { in: storeIds },
        date: { gte: new Date(`${startStr}T00:00:00.000Z`), lte: new Date(`${endStr}T00:00:00.000Z`) },
      },
    })

    type Key = string
    const keyFor = (platform: string, pay: string) => `${platform}|${pay}`

    const dbAgg = new Map<Key, Record<string, number>>()
    for (const r of dbRows) {
      const k = keyFor(r.platform, r.paymentMethod)
      const bucket = dbAgg.get(k) ?? {}
      const add = (name: string, v: number | null | undefined) => { bucket[name] = (bucket[name] ?? 0) + (v ?? 0) }
      add("fp_gross", r.fpGrossSales); add("fp_net", r.fpNetSales); add("fp_disc", r.fpDiscounts); add("fp_fees", r.fpFees); add("fp_tax", r.fpTaxCollected); add("fp_srv", r.fpServiceCharges); add("fp_tips", r.fpTips); add("fp_loy", r.fpLoyalty)
      add("tp_gross", r.tpGrossSales); add("tp_net", r.tpNetSales); add("tp_disc", r.tpDiscounts); add("tp_fees", r.tpFees); add("tp_tax", r.tpTaxCollected); add("tp_srv", r.tpServiceCharges); add("tp_refund", r.tpRefundsAdjustments); add("tp_tip", r.tpTipForRestaurant); add("tp_loy", r.tpLoyaltyDiscount)
      add("till_in", r.tillPaidIn); add("till_out", r.tillPaidOut)
      add("orders", (r.fpOrderCount ?? 0) + (r.tpOrderCount ?? 0))
      dbAgg.set(k, bucket)
    }

    const otterAgg = new Map<Key, Record<string, number>>()
    for (const r of otterRows) {
      const platform = String(r["pos_summary_ofo"] ?? "(null)")
      const pay = String(r["multi_value_pos_payment_method"] ?? "N/A")
      otterAgg.set(keyFor(platform, pay), {
        fp_gross: Number(r["fp_sales_financials_gross_sales"] ?? 0),
        fp_net: Number(r["fp_sales_financials_net_sales"] ?? 0),
        fp_disc: Number(r["fp_sales_financials_discounts"] ?? 0),
        fp_fees: Number(r["fp_sales_financials_fees"] ?? 0),
        fp_tax: Number(r["fp_sales_financials_tax_collected"] ?? 0),
        fp_srv: Number(r["fp_sales_financials_service_charges"] ?? 0),
        fp_tips: Number(r["fp_sales_financials_tips"] ?? 0),
        fp_loy: Number(r["fp_sales_financials_loyalty"] ?? 0),
        tp_gross: Number(r["third_party_gross_sales"] ?? 0),
        tp_net: Number(r["third_party_net_sales"] ?? 0),
        tp_disc: Number(r["third_party_discounts"] ?? 0),
        tp_fees: Number(r["third_party_fees"] ?? 0),
        tp_tax: Number(r["third_party_tax_collected"] ?? 0),
        tp_srv: Number(r["third_party_service_charges"] ?? 0),
        tp_refund: Number(r["third_party_refunds_adjustments"] ?? 0),
        tp_tip: Number(r["third_party_tip_for_restaurant"] ?? 0),
        tp_loy: Number(r["third_party_loyalty_discount"] ?? 0),
        till_in: Number(r["enriched_till_report_paid_in"] ?? 0),
        till_out: Number(r["enriched_till_report_paid_out"] ?? 0),
        orders: Number(r["order_count"] ?? 0),
      })
    }

    const keys = [...new Set([...otterAgg.keys(), ...dbAgg.keys()])].sort()
    const money = (n: number) => n.toFixed(2).padStart(11)
    const fields = ["fp_gross", "fp_net", "fp_disc", "fp_fees", "fp_tax", "tp_gross", "tp_net", "tp_disc", "tp_fees", "tp_tax", "orders"]

    console.log("channel           field         otter         db       Δ")
    console.log("-".repeat(74))
    for (const k of keys) {
      const o = otterAgg.get(k) ?? {}
      const d = dbAgg.get(k) ?? {}
      for (const f of fields) {
        const ov = Number(o[f] ?? 0)
        const dv = Number(d[f] ?? 0)
        const delta = dv - ov
        if (ov === 0 && dv === 0) continue
        const flag = Math.abs(delta) > 0.05 ? "  *" : ""
        console.log(`${k.padEnd(18)}${f.padEnd(12)}${money(ov)}${money(dv)}${money(delta)}${flag}`)
      }
      console.log()
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
