// Rebuild DailyCogsItem rows by force-recomputing every (storeId, date)
// in the lookback window. Owner-scoped, walks each owner's active stores.
// Safe to re-run — writes are upserts and the per-day cleanup is bounded
// to that day, so historical rows from other days are never touched.
import { loadEnvLocal } from "./lib"
loadEnvLocal()

async function main() {
  const { prisma } = await import("../../src/lib/prisma")
  const { recomputeDailyCogsForRange } = await import("../../src/lib/cogs-materializer")

  const lookbackDays = Number.parseInt(process.argv[2] ?? "", 10) || 450
  const endDate = new Date()
  endDate.setUTCHours(0, 0, 0, 0)
  const startDate = new Date(endDate)
  startDate.setUTCDate(startDate.getUTCDate() - lookbackDays)

  const owners = await prisma.recipe.groupBy({ by: ["ownerId"], _count: { _all: true } })
  console.log(`Owners: ${owners.map((o) => o.ownerId).join(", ")}`)
  console.log(
    `Range: ${startDate.toISOString().slice(0, 10)} → ${endDate.toISOString().slice(0, 10)} (${lookbackDays}d)`
  )

  for (const o of owners) {
    const stores = await prisma.store.findMany({
      where: { ownerId: o.ownerId, isActive: true },
      select: { id: true, name: true },
    })
    console.log(`\n▶ Rebuild for owner ${o.ownerId} — ${stores.length} active store(s)`)
    for (const store of stores) {
      const startedAt = Date.now()
      const result = await recomputeDailyCogsForRange({
        storeId: store.id,
        startDate,
        endDate,
        ownerId: o.ownerId,
      })
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0)
      console.log(
        `  ${store.name}: ${result.daysProcessed} day(s), ` +
          `${result.rowsUpserted} upserted, ${result.rowsDeleted} cleaned — ${elapsed}s`
      )
    }
  }

  const after = await prisma.dailyCogsItem.count()
  console.log(`\nDailyCogsItem rows after rebuild: ${after}`)

  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
