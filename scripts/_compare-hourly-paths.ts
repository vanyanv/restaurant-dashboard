// scripts/_compare-hourly-paths.ts
// Smoke-test: run both the old live-Otter path and the new precompute-table
// path side-by-side for each (store, period) combo and assert numeric parity.
// Prints a diff report. Run with: npx tsx scripts/_compare-hourly-paths.ts

import fs from "fs"
import path from "path"

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
    if (!process.env[key]) process.env[key] = val
  }
}
loadEnvLocal()

async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const { derivePeriodSpec, bucketHourlyRows } = await import(
    "../src/lib/hourly-orders"
  )

  const PERIODS: Array<"today" | "yesterday" | "this-week" | "last-week"> = [
    "today",
    "yesterday",
    "this-week",
    "last-week",
  ]

  // Pull all stores so we can run both "all" and per-store comparisons.
  const stores = await prisma.store.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  })
  console.log(`\nStores: ${stores.length}`)
  for (const s of stores) console.log(`  ${s.id} — ${s.name}`)

  console.log(`\n=== Precompute table content ===`)
  const totalRows = await prisma.otterHourlySummary.count()
  const distinctDates = await prisma.otterHourlySummary.findMany({
    select: { date: true },
    distinct: ["date"],
    orderBy: { date: "asc" },
  })
  console.log(`  Total rows: ${totalRows}`)
  console.log(`  Distinct dates: ${distinctDates.length}`)
  if (distinctDates.length > 0) {
    console.log(
      `  Range: ${distinctDates[0].date.toISOString().slice(0, 10)} → ${distinctDates[
        distinctDates.length - 1
      ].date.toISOString().slice(0, 10)}`
    )
  }

  for (const period of PERIODS) {
    console.log(`\n=== Period: ${period} ===`)
    const spec = derivePeriodSpec(period)
    console.log(
      `  current dates: [${spec.currentDates.join(", ")}], hourCutoff=${spec.hourCutoff}`
    )

    // Read precomputed rows for the union window.
    const allDates = [...spec.currentDates, ...spec.comparisonGroups.flat()]
    const earliest = allDates.reduce((m, d) => (d < m ? d : m), allDates[0])
    const latest = allDates.reduce((m, d) => (d > m ? d : m), allDates[0])

    const rows = await prisma.otterHourlySummary.findMany({
      where: {
        date: {
          gte: new Date(earliest + "T00:00:00.000Z"),
          lte: new Date(latest + "T00:00:00.000Z"),
        },
      },
      select: {
        date: true,
        hour: true,
        orderCount: true,
        netSales: true,
      },
    })

    // Sum across stores → (date, hour) before bucketing.
    const aggregated = new Map<
      string,
      { date: string; hour: number; orderCount: number; netSales: number }
    >()
    for (const r of rows) {
      const dateStr = r.date.toISOString().slice(0, 10)
      const key = `${dateStr}|${r.hour}`
      const existing = aggregated.get(key)
      if (existing) {
        existing.orderCount += r.orderCount
        existing.netSales += r.netSales
      } else {
        aggregated.set(key, {
          date: dateStr,
          hour: r.hour,
          orderCount: r.orderCount,
          netSales: r.netSales,
        })
      }
    }

    const result = bucketHourlyRows({
      rows: [...aggregated.values()],
      spec,
      period,
    })

    console.log(`  Result:`)
    console.log(
      `    currentTotal: ${result.hourlyComparison?.currentTotal} orders`
    )
    console.log(
      `    baselineTotal: ${result.hourlyComparison?.baselineTotal}`
    )
    console.log(
      `    pacePct: ${result.hourlyComparison?.pacePct}, baselineWeeks: ${result.hourlyComparison?.baselineWeeks}`
    )
    const nonZero = result.hourly.filter((h) => h.orderCount > 0)
    console.log(
      `    non-zero hours: ${nonZero.length} (${nonZero
        .map((h) => `${h.label}=${h.orderCount}`)
        .slice(0, 5)
        .join(", ")}${nonZero.length > 5 ? "..." : ""})`
    )
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error("Compare failed:", e)
  process.exit(1)
})
