/**
 * Smoke-test the cogs.ts aggregations against a real store.
 *
 * Usage:
 *   pnpm tsx scripts/check-cogs-aggregations.ts <storeName> [days=30]
 *
 * Prints the KPIs, the trend (compact), category breakdown, top 5 worst-margin
 * items, top 10 cost-driver ingredients, and data-quality counts. Useful both
 * as a development check and as a post-deploy sanity probe.
 */
import { prisma } from "@/lib/prisma"
import {
  getCogsKpis,
  getCogsTrend,
  getCostByCategory,
  getWorstMarginItems,
  getDataQualityCounts,
  getTopCostDriverIngredients,
} from "@/lib/cogs"

async function main() {
  const storeName = process.argv[2]
  const days = Number(process.argv[3] ?? 30)
  if (!storeName) {
    console.error("usage: pnpm tsx scripts/check-cogs-aggregations.ts <storeName> [days=30]")
    process.exit(1)
  }

  const store = await prisma.store.findFirst({
    where: { name: { contains: storeName, mode: "insensitive" } },
    select: { id: true, name: true, targetCogsPct: true },
  })
  if (!store) {
    console.error(`No store matching "${storeName}"`)
    process.exit(1)
  }

  const endDate = new Date()
  endDate.setHours(0, 0, 0, 0)
  endDate.setDate(endDate.getDate() + 1) // exclusive end
  const startDate = new Date(endDate)
  startDate.setDate(startDate.getDate() - days)

  console.log(`\n== ${store.name} · last ${days} days · target ${store.targetCogsPct ?? "(none)"} ==\n`)

  const kpis = await getCogsKpis(store.id, startDate, endDate)
  console.log("KPIs:", {
    cogsPct: kpis.cogsPct.toFixed(2),
    cogsDollars: kpis.cogsDollars.toFixed(2),
    revenueDollars: kpis.revenueDollars.toFixed(2),
    deltaVsPriorPp: kpis.deltaVsPriorPp?.toFixed(2) ?? "n/a",
    deltaVsTargetPp: kpis.deltaVsTargetPp?.toFixed(2) ?? "n/a",
  })

  const dq = await getDataQualityCounts(store.id, startDate, endDate)
  console.log("\nData quality:", dq)

  const cats = await getCostByCategory(store.id, startDate, endDate)
  console.log("\nBy category:")
  for (const c of cats.slice(0, 8)) {
    console.log(
      `  ${c.category.padEnd(24)} $${c.cogsDollars.toFixed(0).padStart(8)}  ${c.pctOfCogs.toFixed(1).padStart(5)}%`
    )
  }

  const worst = await getWorstMarginItems(store.id, startDate, endDate, 5)
  console.log("\nWorst-margin items (top 5):")
  for (const w of worst) {
    console.log(
      `  ${w.itemName.padEnd(28)} sold=${w.unitsSold.toFixed(0).padStart(5)}  rev=$${w.revenue.toFixed(0).padStart(7)}  cost=${w.foodCostPct.toFixed(1).padStart(5)}%`
    )
  }

  const drivers = await getTopCostDriverIngredients(store.id, startDate, endDate, 10)
  console.log("\nTop cost-driver ingredients (top 10):")
  for (const d of drivers) {
    const arrow =
      d.latestUnitCost != null && d.priorUnitCost != null
        ? d.latestUnitCost > d.priorUnitCost
          ? "▲"
          : d.latestUnitCost < d.priorUnitCost
            ? "▼"
            : "·"
        : "·"
    console.log(
      `  ${d.name.padEnd(28)} $${d.theoreticalDollars.toFixed(0).padStart(7)}  ${d.pctOfCogs.toFixed(1).padStart(5)}%  ${arrow} ${d.latestUnitCost?.toFixed(2) ?? "n/a"}/${d.costUnit ?? "?"}`
    )
  }

  const trend = await getCogsTrend(store.id, startDate, endDate, days > 60 ? "weekly" : "daily")
  console.log("\nTrend (last 7 buckets):")
  for (const b of trend.slice(-7)) {
    console.log(
      `  ${b.bucket}  cogs=$${b.cogsDollars.toFixed(0).padStart(7)}  rev=$${b.revenueDollars.toFixed(0).padStart(7)}  ${b.cogsPct.toFixed(1).padStart(5)}%`
    )
  }

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
