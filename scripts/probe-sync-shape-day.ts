/**
 * Fire the EXACT query shape the sync uses (buildDailySyncBody) for one day
 * and one store, and dump every row the API returns. Answers the question:
 * is Otter even returning CASH rows to our daily-sync query shape?
 *
 * Usage:
 *   npx tsx scripts/probe-sync-shape-day.ts --date=2026-04-22 --store=Hollywood
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
  const dateStr = arg("date")
  const storeFilter = arg("store", "Hollywood")!
  if (!dateStr) { console.error("--date=YYYY-MM-DD required"); process.exit(1) }
  const target = new Date(`${dateStr}T00:00:00`)
  target.setHours(0, 0, 0, 0)

  const { prisma } = await import("../src/lib/prisma")
  const { queryMetrics, buildDailySyncBody } = await import("../src/lib/otter")

  try {
    const otterStores = await prisma.otterStore.findMany({
      where: { store: { name: { contains: storeFilter, mode: "insensitive" }, isActive: true } },
      include: { store: { select: { id: true, name: true } } },
    })
    const uuids = otterStores.map((s) => s.otterStoreId)
    const internalStoreId = otterStores[0]?.storeId
    console.log(`Stores: ${[...new Set(otterStores.map((s) => s.store.name))].join(", ")}  (${uuids.length} UUID(s))`)
    console.log(`Date:   ${dateStr}`)
    console.log()

    // Fire the EXACT query the sync uses
    const body = buildDailySyncBody(uuids, target, target)
    const rows = await queryMetrics(body)

    console.log(`[API] Otter returned ${rows.length} rows with sync-shape query:`)
    console.log()

    const money = (v: unknown) => v == null ? "    null" : Number(v).toFixed(2).padStart(10)
    console.log(
      "store".padStart(12) + " " +
      "platform".padStart(11) + " " +
      "pay".padStart(8) + " " +
      "fpGross".padStart(11) + " " +
      "fpNet".padStart(11) + " " +
      "fpTax".padStart(9) + " " +
      "tpGross".padStart(11) + " " +
      "paidIn".padStart(9) + " " +
      "paidOut".padStart(9) + " " +
      "orders".padStart(8)
    )
    console.log("-".repeat(120))

    // Short-form the store UUID for display
    const shortUuid = (s: string | null) => s ? s.slice(0, 8) : "(null)"

    // Sort by store then platform+pay
    rows.sort((a, b) => {
      const sa = String(a["store"] ?? ""), sb = String(b["store"] ?? "")
      if (sa !== sb) return sa.localeCompare(sb)
      const pa = String(a["pos_summary_ofo"] ?? ""), pb = String(b["pos_summary_ofo"] ?? "")
      if (pa !== pb) return pa.localeCompare(pb)
      return String(a["multi_value_pos_payment_method"] ?? "").localeCompare(String(b["multi_value_pos_payment_method"] ?? ""))
    })

    for (const r of rows) {
      console.log(
        shortUuid(r["store"] as string | null).padStart(12) + " " +
        String(r["pos_summary_ofo"] ?? "").padStart(11) + " " +
        String(r["multi_value_pos_payment_method"] ?? "(null)").padStart(8) + " " +
        money(r["fp_sales_financials_gross_sales"]) + " " +
        money(r["fp_sales_financials_net_sales"]) + " " +
        money(r["fp_sales_financials_tax_collected"]).padStart(9) + " " +
        money(r["third_party_gross_sales"]) + " " +
        money(r["enriched_till_report_paid_in"]).padStart(9) + " " +
        money(r["enriched_till_report_paid_out"]).padStart(9) + " " +
        String(r["order_count"] ?? "null").padStart(8)
      )
    }

    // Highlight CASH rows specifically
    console.log()
    const cashRows = rows.filter((r) => r["multi_value_pos_payment_method"] === "CASH")
    console.log(`[API] CASH rows (multi_value_pos_payment_method="CASH"): ${cashRows.length}`)
    for (const r of cashRows) {
      console.log(
        `  store=${shortUuid(r["store"] as string | null)} platform=${r["pos_summary_ofo"]} fpGross=${r["fp_sales_financials_gross_sales"]} fpTax=${r["fp_sales_financials_tax_collected"]} orders=${r["order_count"]} paidIn=${r["enriched_till_report_paid_in"]} paidOut=${r["enriched_till_report_paid_out"]}`
      )
    }

    // Compare against DB
    if (internalStoreId) {
      console.log()
      console.log(`[DB] Rows currently in OtterDailySummary for ${dateStr}:`)
      const dbRows = await prisma.otterDailySummary.findMany({
        where: { storeId: internalStoreId, date: new Date(`${dateStr}T00:00:00.000Z`) },
        orderBy: [{ platform: "asc" }, { paymentMethod: "asc" }],
      })
      for (const r of dbRows) {
        console.log(
          `  ${r.platform.padEnd(12)} ${r.paymentMethod.padEnd(8)} fpGross=${String(r.fpGrossSales).padStart(10)} fpNet=${String(r.fpNetSales).padStart(10)} fpTax=${String(r.fpTaxCollected).padStart(8)} fpOrd=${String(r.fpOrderCount ?? "null").padStart(5)} tpGross=${String(r.tpGrossSales).padStart(10)} tpOrd=${String(r.tpOrderCount ?? "null").padStart(5)} updatedAt=${r.updatedAt.toISOString()}`
        )
      }
    }

    // Also show last sync timestamp
    const syncInfo = await prisma.otterStore.findMany({
      where: { storeId: internalStoreId! },
      select: { otterStoreId: true, lastSyncAt: true },
    })
    console.log()
    console.log(`[Sync] lastSyncAt per UUID:`)
    for (const s of syncInfo) console.log(`  ${s.otterStoreId}  ${s.lastSyncAt?.toISOString() ?? "(never)"}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
