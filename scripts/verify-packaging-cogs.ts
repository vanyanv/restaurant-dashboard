import { loadEnvLocal } from "./audit/lib"

async function main() {
  loadEnvLocal()
  const { prisma } = await import("@/lib/prisma")
  const end = new Date("2026-05-17T00:00:00.000Z")
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - 30)

  const stores = await prisma.store.findMany({
    select: { id: true, name: true },
  })

  console.log(`\n=== Packaging COGS Verification (${start.toISOString().slice(0,10)} → ${end.toISOString().slice(0,10)}) ===\n`)

  for (const store of stores) {
    const rows = await prisma.dailyCogsItem.findMany({
      where: {
        storeId: store.id,
        date: { gte: start, lte: end },
      },
      select: { date: true, category: true, lineCost: true, status: true, qtySold: true, itemName: true },
    })

    if (rows.length === 0) {
      console.log(`[${store.name}] no daily-cogs rows in window`)
      continue
    }

    const food = rows.filter(r => r.category !== "Packaging")
    const pkg = rows.filter(r => r.category === "Packaging")

    const foodCost = food.reduce((s, r) => s + r.lineCost, 0)
    const pkgCost = pkg.reduce((s, r) => s + r.lineCost, 0)
    const pkgMissing = pkg.filter(r => r.status === "MISSING_COST").length
    const pkgCosted = pkg.filter(r => r.status === "COSTED").length

    const daysWithFood = new Set(food.map(r => r.date.toISOString().slice(0,10))).size
    const daysWithPkg = new Set(pkg.map(r => r.date.toISOString().slice(0,10))).size

    console.log(`[${store.name}]`)
    console.log(`  days w/ food rows:      ${daysWithFood}`)
    console.log(`  days w/ packaging rows: ${daysWithPkg}`)
    console.log(`  food COGS (30d):        $${foodCost.toFixed(2)}`)
    console.log(`  packaging COGS (30d):   $${pkgCost.toFixed(2)}`)
    console.log(`  packaging share of total: ${foodCost+pkgCost>0 ? ((pkgCost/(foodCost+pkgCost))*100).toFixed(2) : 0}%`)
    console.log(`  packaging rows COSTED / MISSING_COST: ${pkgCosted} / ${pkgMissing}`)

    const byGroup = new Map<string, { qty: number; cost: number; missing: number }>()
    for (const r of pkg) {
      const g = r.itemName.replace(/^Packaging - /, "")
      const e = byGroup.get(g) ?? { qty: 0, cost: 0, missing: 0 }
      e.qty += r.qtySold
      e.cost += r.lineCost
      if (r.status === "MISSING_COST") e.missing += 1
      byGroup.set(g, e)
    }
    if (byGroup.size > 0) {
      console.log(`  by container group:`)
      for (const [g, e] of [...byGroup.entries()].sort((a,b) => b[1].cost - a[1].cost)) {
        console.log(`    ${g.padEnd(30)} qty=${String(e.qty).padStart(6)}  cost=$${e.cost.toFixed(2).padStart(9)}  missingCostDays=${e.missing}`)
      }
    }
    console.log()
  }

  const focusStore = stores.find(s => /hollywood/i.test(s.name)) ?? stores[0]
  if (focusStore) {
    console.log(`\n=== P&L summation replay for [${focusStore.name}] last 7 days ===`)
    const pnlStart = new Date(end)
    pnlStart.setUTCDate(pnlStart.getUTCDate() - 7)

    const rows = await prisma.dailyCogsItem.findMany({
      where: { storeId: focusStore.id, date: { gte: pnlStart, lte: end } },
      select: { category: true, lineCost: true, status: true },
    })
    let total = 0
    let pkgOnly = 0
    let foodOnly = 0
    for (const r of rows) {
      if (r.status === "UNMAPPED") continue
      total += r.lineCost
      if (r.category === "Packaging") pkgOnly += r.lineCost
      else foodOnly += r.lineCost
    }
    console.log(`  P&L totalCogs (status != UNMAPPED): $${total.toFixed(2)}`)
    console.log(`    of which food:       $${foodOnly.toFixed(2)}`)
    console.log(`    of which packaging:  $${pkgOnly.toFixed(2)}  (${total>0 ? ((pkgOnly/total)*100).toFixed(2) : 0}%)`)
  }

  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
