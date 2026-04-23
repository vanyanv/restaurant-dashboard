import { loadEnvLocal } from "./lib"
loadEnvLocal()
;(async () => {
  const { prisma } = await import("../../src/lib/prisma")

  const dailyCogsCount = await prisma.dailyCogsItem.count()
  const otterMenuCount = await prisma.otterMenuItem.count()
  const otterOrderCount = await prisma.otterOrder.count()
  const otterSummaryCount = await prisma.otterDailySummary.count()
  const invoiceCount = await prisma.invoice.count()
  const recipeCount = await prisma.recipe.count()
  const canonicalCount = await prisma.canonicalIngredient.count()

  console.log("Table row counts:")
  console.log("  DailyCogsItem     :", dailyCogsCount)
  console.log("  OtterMenuItem     :", otterMenuCount)
  console.log("  OtterOrder        :", otterOrderCount)
  console.log("  OtterDailySummary :", otterSummaryCount)
  console.log("  Invoice           :", invoiceCount)
  console.log("  Recipe            :", recipeCount)
  console.log("  CanonicalIngredient:", canonicalCount)

  // Latest OtterMenuItem date per store — so we know what refill would need to do.
  const menuDays = await prisma.$queryRaw<Array<{ storeId: string; minDate: Date; maxDate: Date; days: bigint }>>`
    SELECT "storeId", MIN("date") AS "minDate", MAX("date") AS "maxDate", COUNT(DISTINCT "date") AS "days"
    FROM "OtterMenuItem"
    WHERE "isModifier" = false
    GROUP BY "storeId"
  `
  console.log("\nOtterMenuItem date coverage per store:")
  for (const m of menuDays) {
    console.log(`  ${m.storeId}: ${m.minDate.toISOString().slice(0,10)} → ${m.maxDate.toISOString().slice(0,10)}  (${Number(m.days)} distinct days)`)
  }

  await prisma.$disconnect()
})()
