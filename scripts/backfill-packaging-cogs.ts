// One-shot backfill for packaging-only DailyCogsItem rows.
//
// This is intentionally narrower than scripts/backfill-daily-cogs.ts: it does
// not recompute food recipe rows, so it can apply container COGS without
// re-walking every historical recipe.
//
// Run with:
//   ./node_modules/.bin/tsx scripts/backfill-packaging-cogs.ts 90

import { loadEnvLocal } from "./audit/lib"

loadEnvLocal()

async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const { recomputePackagingCogsForRange } = await import("../src/lib/cogs-materializer")

  const lookbackDays = Number.parseInt(process.argv[2] ?? "", 10) || 90

  const endDate = new Date()
  endDate.setUTCHours(0, 0, 0, 0)
  const startDate = new Date(endDate)
  startDate.setUTCDate(startDate.getUTCDate() - lookbackDays)

  const stores = await prisma.store.findMany({
    where: { isActive: true },
    select: { id: true, name: true, accountId: true },
  })

  console.log(
    `Backfilling packaging COGS for ${stores.length} store(s), lookback ${lookbackDays}d ` +
      `(${startDate.toISOString().slice(0, 10)} -> ${endDate.toISOString().slice(0, 10)})`
  )

  let totalDays = 0
  let totalUpserted = 0
  let totalDeleted = 0
  let totalLineCost = 0

  for (const store of stores) {
    const result = await recomputePackagingCogsForRange({
      storeId: store.id,
      accountId: store.accountId,
      startDate,
      endDate,
    })
    totalDays += result.daysProcessed
    totalUpserted += result.rowsUpserted
    totalDeleted += result.rowsDeleted
    totalLineCost += result.lineCost
    console.log(
      `  ${store.name}: ${result.daysProcessed} day(s), ` +
        `${result.rowsUpserted} upserted, ${result.rowsDeleted} cleaned, ` +
        `$${result.lineCost.toFixed(2)} packaging COGS`
    )
  }

  console.log(
    `Done: ${totalDays} day(s), ${totalUpserted} upserted, ` +
      `${totalDeleted} cleaned, $${totalLineCost.toFixed(2)} packaging COGS`
  )
  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
