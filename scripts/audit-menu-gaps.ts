import fs from "fs"
import path from "path"
function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue
    const i = t.indexOf("="); if (i === -1) continue
    const k = t.slice(0, i).trim(), v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "")
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnvLocal()

async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const { computeRecipeCost } = await import("../src/lib/recipe-cost")

  const recipes = await prisma.recipe.findMany({
    select: {
      id: true,
      itemName: true,
      category: true,
      foodCostOverride: true,
      isSellable: true,
      _count: { select: { ingredients: true, otterItemMappings: true, otterSubItemMappings: true } },
    },
    orderBy: [{ category: "asc" }, { itemName: "asc" }],
  })

  const emptyRecipes: typeof recipes = []
  const partialCostRecipes: Array<{ r: (typeof recipes)[number]; missing: string[] }> = []
  const unmappedRecipes: typeof recipes = []

  for (const r of recipes) {
    if (r._count.ingredients === 0) {
      emptyRecipes.push(r)
      continue
    }
    const cost = await computeRecipeCost(r.id)
    if (cost.partial) {
      const missing = cost.lines.filter((ln) => ln.unitCost == null).map((ln) => ln.name)
      partialCostRecipes.push({ r, missing })
    }
    if (r.isSellable && r._count.otterItemMappings === 0 && r._count.otterSubItemMappings === 0) {
      unmappedRecipes.push(r)
    }
  }

  console.log("=== RECIPES WITH ZERO INGREDIENTS ===")
  if (emptyRecipes.length === 0) console.log("  (none)")
  for (const r of emptyRecipes) {
    const ov = r.foodCostOverride != null ? ` override=$${r.foodCostOverride.toFixed(2)}` : " NO OVERRIDE"
    console.log(`  [${r.category}] ${r.itemName}${ov}`)
  }

  console.log("\n=== RECIPES WITH INGREDIENTS BUT MISSING COSTS (partial) ===")
  if (partialCostRecipes.length === 0) console.log("  (none)")
  for (const { r, missing } of partialCostRecipes) {
    console.log(`  [${r.category}] ${r.itemName}`)
    for (const m of missing) console.log(`      missing cost: ${m}`)
  }

  console.log("\n=== SELLABLE RECIPES WITH NO OTTER MAPPING (item or sub-item) ===")
  if (unmappedRecipes.length === 0) console.log("  (none)")
  for (const r of unmappedRecipes) {
    console.log(`  [${r.category}] ${r.itemName}`)
  }

  const seenItemsRaw = await prisma.otterOrderItem.groupBy({
    by: ["skuId", "name"],
    _count: { skuId: true },
    _sum: { quantity: true },
  })
  const seenItems = seenItemsRaw
    .map((g) => ({ skuId: g.skuId, name: g.name, orders: g._count.skuId, qty: g._sum.quantity ?? 0 }))
    .sort((a, b) => b.qty - a.qty)

  const storeIds = (await prisma.store.findMany({ select: { id: true } })).map((s) => s.id)
  const itemMaps = await prisma.otterItemMapping.findMany({
    where: { storeId: { in: storeIds } },
    select: { skuId: true, otterItemName: true },
  })
  const mappedItemSkus = new Set(itemMaps.filter((m) => m.skuId).map((m) => m.skuId as string))
  const mappedItemNames = new Set(itemMaps.map((m) => m.otterItemName))

  console.log("\n=== OTTER ITEMS SEEN IN ORDERS WITH NO MAPPING ===")
  let missingItemCount = 0
  for (const it of seenItems) {
    if (mappedItemSkus.has(it.skuId)) continue
    if (mappedItemNames.has(it.name)) continue
    missingItemCount++
    console.log(`  qty=${it.qty.toFixed(0).padStart(5)}  orders=${String(it.orders).padStart(4)}  sku=${it.skuId}  name="${it.name}"`)
  }
  if (missingItemCount === 0) console.log("  (none)")

  const seenSubRaw = await prisma.otterOrderSubItem.groupBy({
    by: ["skuId", "name"],
    _count: { skuId: true },
    _sum: { quantity: true },
  })
  const seenSubs = seenSubRaw
    .map((g) => ({ skuId: g.skuId, name: g.name, orders: g._count.skuId, qty: g._sum.quantity ?? 0 }))
    .sort((a, b) => b.qty - a.qty)

  const subMaps = await prisma.otterSubItemMapping.findMany({
    where: { storeId: { in: storeIds } },
    select: { skuId: true },
  })
  const mappedSubSkus = new Set(subMaps.map((m) => m.skuId))

  console.log("\n=== OTTER SUB-ITEMS (MODIFIERS) SEEN IN ORDERS WITH NO MAPPING ===")
  let missingSubCount = 0
  const top = seenSubs.filter((s) => !mappedSubSkus.has(s.skuId)).slice(0, 40)
  for (const s of top) {
    missingSubCount++
    console.log(`  qty=${s.qty.toFixed(0).padStart(6)}  orders=${String(s.orders).padStart(5)}  sku=${s.skuId}  name="${s.name}"`)
  }
  const totalMissingSubs = seenSubs.filter((s) => !mappedSubSkus.has(s.skuId)).length
  if (missingSubCount === 0) console.log("  (none)")
  else if (totalMissingSubs > 40) console.log(`  ... and ${totalMissingSubs - 40} more (showing top 40 by qty)`)

  console.log("\n=== SUMMARY ===")
  console.log(`  total recipes:                    ${recipes.length}`)
  console.log(`  recipes with 0 ingredients:       ${emptyRecipes.length}`)
  console.log(`  recipes with partial cost:        ${partialCostRecipes.length}`)
  console.log(`  sellable recipes unmapped:        ${unmappedRecipes.length}`)
  console.log(`  otter items unmapped (seen):      ${missingItemCount}`)
  console.log(`  otter sub-items unmapped (seen):  ${totalMissingSubs}`)

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
