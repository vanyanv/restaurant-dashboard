// Group G: investigate why Hollywood's 90-day COGS% is 12.3% (flagged as outside
// the typical 15-65% band). Possible root causes:
//   H1. Unmapped menu items — revenue counted but no COGS.
//   H2. Missing_cost rows — recipe found but canonical costs missing, COGS=0.
//   H3. Category composition — if all revenue is from high-margin items, maybe
//       12% is legit.
//   H4. Recipe food cost overrides set too low.
//   H5. Modifier revenue without modifier cost mapping.
//   H6. Revenue miscategorized (e.g. all under one category + their recipes are
//       costed via foodCostOverride that's low).
import { loadEnvLocal, money } from "./lib"
loadEnvLocal()

async function main() {
  const { prisma } = await import("../../src/lib/prisma")

  const hw = await prisma.store.findFirst({
    where: { name: { contains: "Hollywood" } },
    select: { id: true, name: true, ownerId: true, targetCogsPct: true },
  })
  if (!hw) {
    console.log("Hollywood store not found")
    await prisma.$disconnect()
    return
  }
  console.log(`Store: ${hw.name}  target=${hw.targetCogsPct}%`)

  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date(end)
  start.setDate(start.getDate() - 90)
  start.setHours(0, 0, 0, 0)

  const agg = await prisma.dailyCogsItem.aggregate({
    where: { storeId: hw.id, date: { gte: start, lt: end } },
    _sum: { lineCost: true, salesRevenue: true, qtySold: true },
    _count: { _all: true },
  })
  console.log(`\n90-day totals: ${agg._count._all} rows`)
  console.log(`  cogsDollars  = ${money(agg._sum.lineCost ?? 0)}`)
  console.log(`  revenue      = ${money(agg._sum.salesRevenue ?? 0)}`)
  console.log(`  cogsPct      = ${(((agg._sum.lineCost ?? 0) / (agg._sum.salesRevenue ?? 1)) * 100).toFixed(2)}%`)

  // H1+H2: status breakdown weighted by revenue and cost.
  const byStatus = await prisma.dailyCogsItem.groupBy({
    by: ["status"],
    where: { storeId: hw.id, date: { gte: start, lt: end } },
    _sum: { salesRevenue: true, lineCost: true },
    _count: { _all: true },
  })
  console.log(`\nStatus breakdown:`)
  for (const s of byStatus) {
    console.log(
      `  ${s.status.padEnd(14)} rows=${s._count._all}  rev=${money(s._sum.salesRevenue ?? 0)}  cogs=${money(s._sum.lineCost ?? 0)}`
    )
  }

  // H3: by category.
  const byCat = await prisma.dailyCogsItem.groupBy({
    by: ["category"],
    where: { storeId: hw.id, date: { gte: start, lt: end } },
    _sum: { salesRevenue: true, lineCost: true },
  })
  console.log(`\nBy category (top 10 by revenue):`)
  byCat.sort((a, b) => (b._sum.salesRevenue ?? 0) - (a._sum.salesRevenue ?? 0))
  for (const c of byCat.slice(0, 10)) {
    const rev = c._sum.salesRevenue ?? 0
    const cogs = c._sum.lineCost ?? 0
    const pct = rev > 0 ? (cogs / rev) * 100 : 0
    console.log(`  ${(c.category || "(none)").padEnd(28)} rev=${money(rev).padStart(12)}  cogs=${money(cogs).padStart(12)}  cogs%=${pct.toFixed(1).padStart(6)}%`)
  }

  // H4: top items by qty sold — what does their unit cost look like?
  const topItems = await prisma.dailyCogsItem.groupBy({
    by: ["itemName", "recipeId"],
    where: { storeId: hw.id, date: { gte: start, lt: end }, status: "COSTED" },
    _sum: { qtySold: true, salesRevenue: true, lineCost: true },
  })
  topItems.sort((a, b) => (b._sum.salesRevenue ?? 0) - (a._sum.salesRevenue ?? 0))
  console.log(`\nTop 15 items by revenue:`)
  console.log(`  ${"item".padEnd(40)}${"qty".padStart(8)}${"rev".padStart(12)}${"cogs".padStart(12)}${"unitCost".padStart(11)}${"cogs%".padStart(9)}`)
  for (const t of topItems.slice(0, 15)) {
    const qty = t._sum.qtySold ?? 0
    const rev = t._sum.salesRevenue ?? 0
    const cogs = t._sum.lineCost ?? 0
    const uc = qty > 0 ? cogs / qty : 0
    const pct = rev > 0 ? (cogs / rev) * 100 : 0
    console.log(
      `  ${t.itemName.padEnd(40).slice(0, 40)}${qty.toFixed(0).padStart(8)}${money(rev).padStart(12)}${money(cogs).padStart(12)}${money(uc).padStart(11)}${pct.toFixed(1).padStart(8)}%`
    )
  }

  // H4 continued: recipes with foodCostOverride set that are popular.
  const recipesWithOverride = await prisma.recipe.findMany({
    where: { ownerId: hw.ownerId, foodCostOverride: { not: null }, isSellable: true },
    select: { id: true, itemName: true, foodCostOverride: true },
  })
  console.log(`\nRecipes with foodCostOverride set: ${recipesWithOverride.length}`)
  const overrideIds = new Set(recipesWithOverride.map((r) => r.id))
  const overrideRevenue = topItems
    .filter((t) => t.recipeId && overrideIds.has(t.recipeId))
    .reduce((s, t) => s + (t._sum.salesRevenue ?? 0), 0)
  const overrideCogs = topItems
    .filter((t) => t.recipeId && overrideIds.has(t.recipeId))
    .reduce((s, t) => s + (t._sum.lineCost ?? 0), 0)
  console.log(`  90d revenue on override-costed items: ${money(overrideRevenue)}  cogs: ${money(overrideCogs)}  (${overrideRevenue > 0 ? ((overrideCogs / overrideRevenue) * 100).toFixed(1) : "n/a"}%)`)

  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
