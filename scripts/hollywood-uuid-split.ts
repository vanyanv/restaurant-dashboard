/**
 * Check whether Hollywood's two Otter UUIDs are distinct facilities or
 * duplicate/overlapping. Queries each UUID separately, then both together,
 * and compares.
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
  const startStr = "2025-04-28"
  const endStr = "2025-05-04"
  const { prisma } = await import("../src/lib/prisma")
  const { queryMetrics } = await import("../src/lib/otter")

  try {
    const otterStores = await prisma.otterStore.findMany({
      where: { store: { name: { contains: "Hollywood", mode: "insensitive" }, isActive: true } },
    })

    const buildBody = (uuids: string[]) => ({
      columns: [
        { type: "metric", key: "third_party_gross_sales" },
        { type: "metric", key: "fp_sales_financials_gross_sales" },
        { type: "metric", key: "order_count" },
      ],
      groupBy: [{ key: "pos_summary_ofo" }],
      sortBy: [{ type: "metric", key: "third_party_gross_sales", sortOrder: "DESC" }],
      filterSet: [{ filterType: "dateRangeFilter", minDate: `${startStr}T00:00:00.000Z`, maxDate: `${endStr}T23:59:59.999Z` }],
      scopeSet: [{ key: "store", values: uuids }],
      includeMetricsFilters: true,
      localTime: true,
      includeTotalRowCount: false,
      limit: 500,
      includeRawQueries: false,
    })

    const probe = async (label: string, uuids: string[]) => {
      const rows = await queryMetrics(buildBody(uuids))
      console.log(`\n${label} (${uuids.length} UUID(s)):`)
      for (const r of rows) {
        const p = String(r["pos_summary_ofo"] ?? "")
        const fpG = Number(r["fp_sales_financials_gross_sales"] ?? 0)
        const tpG = Number(r["third_party_gross_sales"] ?? 0)
        const ord = Number(r["order_count"] ?? 0)
        console.log(`  ${p.padEnd(12)} fp=${fpG.toFixed(2).padStart(10)}  tp=${tpG.toFixed(2).padStart(10)}  orders=${ord}`)
      }
    }

    for (const os of otterStores) {
      await probe(`UUID ${os.otterStoreId}`, [os.otterStoreId])
    }
    await probe(`BOTH UUIDs combined`, otterStores.map((s) => s.otterStoreId))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
