/**
 * Diagnostic: dump the raw rows Otter returns for Hollywood on one day.
 *
 * Purpose: we see no css-pos + CARD rows in OtterDailySummary, and css-pos +
 * CASH rows have fpGrossSales=null. Before patching anything we need to see
 * what Otter actually returns — is the row missing entirely, or present with
 * null amounts, or is the revenue tagged under a different platform value?
 *
 * Usage:
 *   npx tsx scripts/inspect-hollywood-otter-day.ts                  # yesterday
 *   npx tsx scripts/inspect-hollywood-otter-day.ts --date=2025-05-02
 *   npx tsx scripts/inspect-hollywood-otter-day.ts --store=Hollywood --date=2025-05-02
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

function parseArgs(): { dateArg: string | null; storeFilter: string } {
  let dateArg: string | null = null
  let storeFilter = "Hollywood"
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--date=")) dateArg = a.slice("--date=".length)
    else if (a.startsWith("--store=")) storeFilter = a.slice("--store=".length)
  }
  return { dateArg, storeFilter }
}

function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

async function main() {
  const { dateArg, storeFilter } = parseArgs()

  const target = dateArg ? new Date(`${dateArg}T12:00:00`) : new Date(Date.now() - 86400_000)
  target.setHours(0, 0, 0, 0)

  const { prisma } = await import("../src/lib/prisma")
  const { queryMetrics, buildDailySyncBody } = await import("../src/lib/otter")

  try {
    const otterStores = await prisma.otterStore.findMany({
      where: { store: { name: { contains: storeFilter, mode: "insensitive" } } },
      include: { store: { select: { id: true, name: true } } },
    })
    if (otterStores.length === 0) {
      console.error(`No OtterStore rows match store name contains=${storeFilter}`)
      process.exit(1)
    }
    const uuids = otterStores.map((s) => s.otterStoreId)
    console.log(`Store(s): ${otterStores.map((s) => `${s.store.name} (${s.otterStoreId})`).join(", ")}`)
    console.log(`Date:     ${ymd(target)}`)
    console.log()

    const body = buildDailySyncBody(uuids, target, target)
    const rows = await queryMetrics(body)

    console.log(`Otter returned ${rows.length} rows.`)
    console.log()

    rows.sort((a, b) => {
      const pa = String(a["pos_summary_ofo"] ?? "")
      const pb = String(b["pos_summary_ofo"] ?? "")
      if (pa !== pb) return pa.localeCompare(pb)
      return String(a["multi_value_pos_payment_method"] ?? "").localeCompare(
        String(b["multi_value_pos_payment_method"] ?? "")
      )
    })

    const money = (v: unknown) => {
      if (v == null) return "   null   "
      const n = typeof v === "number" ? v : Number(v)
      if (Number.isNaN(n)) return String(v).padStart(10)
      return n.toFixed(2).padStart(10)
    }
    const intOrNull = (v: unknown) => (v == null ? "null" : String(v))

    console.log(
      "platform".padEnd(12) +
        "pay".padEnd(6) +
        "fpGross".padStart(11) +
        "fpNet".padStart(11) +
        "fpDisc".padStart(11) +
        "fpTax".padStart(11) +
        "tpGross".padStart(11) +
        "tpNet".padStart(11) +
        "tpDisc".padStart(11) +
        "paidIn".padStart(11) +
        "paidOut".padStart(11) +
        "orders".padStart(8)
    )
    console.log("-".repeat(130))

    for (const r of rows) {
      const platform = String(r["pos_summary_ofo"] ?? "")
      const pay = String(r["multi_value_pos_payment_method"] ?? "")
      console.log(
        platform.padEnd(12) +
          pay.padEnd(6) +
          money(r["fp_sales_financials_gross_sales"]).padStart(11) +
          money(r["fp_sales_financials_net_sales"]).padStart(11) +
          money(r["fp_sales_financials_discounts"]).padStart(11) +
          money(r["fp_sales_financials_tax_collected"]).padStart(11) +
          money(r["third_party_gross_sales"]).padStart(11) +
          money(r["third_party_net_sales"]).padStart(11) +
          money(r["third_party_discounts"]).padStart(11) +
          money(r["enriched_till_report_paid_in"]).padStart(11) +
          money(r["enriched_till_report_paid_out"]).padStart(11) +
          intOrNull(r["order_count"]).padStart(8)
      )
    }

    console.log()
    console.log("Distinct platforms seen:    " + [...new Set(rows.map((r) => String(r["pos_summary_ofo"] ?? "(null)")))].sort().join(", "))
    console.log("Distinct payment methods:   " + [...new Set(rows.map((r) => String(r["multi_value_pos_payment_method"] ?? "(null)")))].sort().join(", "))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
