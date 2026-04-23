/**
 * Ad-hoc probe of the till-report columns. User pointed out that Otter's own
 * UI uses `enriched_till_report_drawer_reconciliation` to surface the Cash
 * channel view — which we're NOT persisting today. This script fires the same
 * query shape against a recent day for all stores so we can see what comes back.
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
  const dateStr = arg("date") ?? new Date(Date.now() - 86400_000).toISOString().slice(0, 10)
  const storeFilter = arg("store")

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
      include: { store: { select: { name: true } } },
    })
    const uuids = otterStores.map((s) => s.otterStoreId)
    console.log(`Stores (${uuids.length}): ${[...new Set(otterStores.map((s) => s.store.name))].join(", ")}`)
    console.log(`Date: ${dateStr}`)
    console.log()

    // Mirror the shape the user shared:
    //   columns: till_drawer_reconciliation + till_paid_in/out
    //   groupBy: multi_value_pos_payment_method, pos_summary_ofo
    //   sortBy: till_paid_in DESC
    const body = {
      columns: [
        { type: "metric", key: "enriched_till_report_drawer_reconciliation" },
        { type: "metric", key: "enriched_till_report_paid_in" },
        { type: "metric", key: "enriched_till_report_paid_out" },
        // keep fp_gross alongside so we can see if this query also returns sales
        { type: "metric", key: "fp_sales_financials_gross_sales" },
        { type: "metric", key: "fp_sales_financials_net_sales" },
        { type: "metric", key: "fp_sales_financials_tax_collected" },
        { type: "metric", key: "order_count" },
      ],
      groupBy: [
        { key: "multi_value_pos_payment_method" },
        { key: "pos_summary_ofo" },
      ],
      sortBy: [{ type: "metric", key: "enriched_till_report_paid_in", sortOrder: "DESC" }],
      filterSet: [
        {
          filterType: "dateRangeFilter",
          minDate: `${dateStr}T00:00:00.000Z`,
          maxDate: `${dateStr}T23:59:59.999Z`,
        },
      ],
      scopeSet: [{ key: "store", values: uuids }],
      includeMetricsFilters: true,
      localTime: true,
      includeTotalRowCount: false,
      limit: 1500,
      includeRawQueries: false,
    }

    const rows = await queryMetrics(body)
    console.log(`Returned ${rows.length} rows.\n`)

    const money = (v: unknown) => {
      if (v == null) return "    null"
      const n = typeof v === "number" ? v : Number(v)
      return Number.isNaN(n) ? String(v).padStart(10) : n.toFixed(2).padStart(10)
    }

    console.log(
      ["platform".padStart(12), "pay".padStart(8), "drawer_recon", "paid_in", "paid_out", "fp_gross", "fp_net", "fp_tax", "orders"]
        .map((h) => h.padStart(12))
        .join(" ")
    )
    console.log("-".repeat(120))
    for (const r of rows) {
      console.log(
        [
          String(r["pos_summary_ofo"] ?? "(null)").padStart(12),
          String(r["multi_value_pos_payment_method"] ?? "(null)").padStart(8),
          money(r["enriched_till_report_drawer_reconciliation"]),
          money(r["enriched_till_report_paid_in"]),
          money(r["enriched_till_report_paid_out"]),
          money(r["fp_sales_financials_gross_sales"]),
          money(r["fp_sales_financials_net_sales"]),
          money(r["fp_sales_financials_tax_collected"]),
          String(r["order_count"] ?? "").padStart(12),
        ].join(" ")
      )
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
