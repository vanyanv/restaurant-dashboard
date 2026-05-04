// Sanity check after rematerialization: print latest DailyCogsItem rows
// for the modifiers we changed.

import { loadEnvLocal } from "../scripts/audit/lib"
loadEnvLocal()

async function main() {
  const { prisma } = await import("../src/lib/prisma")

  const itemNames = [
    "Mod: Add Lettuce",
    "Mod: Add Pickle",
    "Mod: Extra Pickles",
    "Side of Yellow Chilies",
  ]
  for (const itemName of itemNames) {
    const rows = await prisma.dailyCogsItem.findMany({
      where: { itemName },
      orderBy: { date: "desc" },
      take: 5,
      select: {
        date: true,
        store: { select: { name: true } },
        qtySold: true,
        unitCost: true,
        lineCost: true,
        status: true,
        partialCost: true,
        costSource: true,
      },
    })
    console.log(`\n== ${itemName} ==`)
    if (rows.length === 0) {
      console.log("  (no rows)")
      continue
    }
    for (const r of rows) {
      const date = r.date.toISOString().slice(0, 10)
      console.log(
        `  ${date} ${r.store.name.padEnd(28)}  qty=${r.qtySold.toFixed(0).padStart(4)}  unitCost=$${r.unitCost.toFixed(4).padStart(7)}  line=$${r.lineCost.toFixed(2).padStart(7)}  ${r.status}${r.partialCost ? " (partial)" : ""}  src=${r.costSource ?? "-"}`
      )
    }
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
