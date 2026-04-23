// Read-only diagnostic: for the "Signature Double Patty & Cheese Slider", list
// every modifier skuId seen on orders (last 90 days), aggregate by name + skuId,
// and show which are mapped in OtterSubItemMapping vs which are orphans.
// Also pull the base OtterItemMapping and recipe cost for sanity.
import { loadEnvLocal, money } from "./lib"
loadEnvLocal()

const SLIDER_SKU = "ff7c1603-6be0-4eb5-8f69-0ae73da2d2ad"

async function main() {
  const { prisma } = await import("../../src/lib/prisma")
  const { computeRecipeCost } = await import("../../src/lib/recipe-cost")

  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date(end)
  start.setDate(start.getDate() - 90)
  start.setHours(0, 0, 0, 0)

  // 1. OtterOrderItems for the slider (last 90d, across all stores).
  const items = await prisma.otterOrderItem.findMany({
    where: {
      skuId: SLIDER_SKU,
      order: { referenceTimeLocal: { gte: start, lt: end } },
    },
    select: {
      id: true,
      name: true,
      quantity: true,
      price: true,
      order: { select: { storeId: true } },
      subItems: { select: { skuId: true, name: true, quantity: true, price: true, subHeader: true } },
    },
  })

  if (items.length === 0) {
    console.log("No order items found for slider SKU in last 90 days.")
    await prisma.$disconnect()
    return
  }

  const storeIds = new Set(items.map((i) => i.order.storeId))
  console.log(`Slider order lines: ${items.length}  stores: ${storeIds.size}`)
  const totalSliderQty = items.reduce((s, i) => s + i.quantity, 0)
  const totalSliderRev = items.reduce((s, i) => s + i.price * i.quantity, 0)
  console.log(`  Σ qty   = ${totalSliderQty.toFixed(0)}`)
  console.log(`  Σ rev   = ${money(totalSliderRev)}`)

  // 2. Base-item mapping.
  const baseMappings = await prisma.otterItemMapping.findMany({
    where: { OR: [{ skuId: SLIDER_SKU }, { otterItemName: { contains: "Signature Double Patty" } }] },
    select: { storeId: true, otterItemName: true, skuId: true, recipeId: true, recipe: { select: { itemName: true } } },
  })
  console.log(`\nBase OtterItemMapping rows: ${baseMappings.length}`)
  for (const m of baseMappings) {
    let cost = "?"
    try {
      const r = await computeRecipeCost(m.recipeId, new Date())
      cost = money(r.totalCost)
    } catch {}
    console.log(`  store=${m.storeId.slice(0, 8)}…  recipe="${m.recipe.itemName}"  baseCost=${cost}`)
  }

  // 3. Aggregate modifiers across all slider orders.
  type ModStat = { skuId: string; names: Set<string>; subHeaders: Set<string>; uses: number; parentQty: number }
  const byMod = new Map<string, ModStat>()
  for (const item of items) {
    for (const s of item.subItems) {
      const k = s.skuId
      const stat = byMod.get(k) ?? { skuId: k, names: new Set(), subHeaders: new Set(), uses: 0, parentQty: 0 }
      stat.names.add(s.name)
      if (s.subHeader) stat.subHeaders.add(s.subHeader)
      stat.uses += s.quantity * item.quantity
      stat.parentQty += item.quantity
      byMod.set(k, stat)
    }
  }

  // 4. Check each modifier against OtterSubItemMapping.
  const modSkuIds = Array.from(byMod.keys())
  const subMappings = await prisma.otterSubItemMapping.findMany({
    where: { skuId: { in: modSkuIds }, storeId: { in: Array.from(storeIds) } },
    select: { skuId: true, storeId: true, recipeId: true, recipe: { select: { itemName: true } } },
  })
  const mappedByKey = new Map<string, { recipeId: string; recipeName: string }>()
  for (const m of subMappings) {
    mappedByKey.set(`${m.storeId}|${m.skuId}`, { recipeId: m.recipeId, recipeName: m.recipe.itemName })
  }

  // For simplicity, mark a modifier "mapped" if it's mapped in ANY of the stores where the slider is sold.
  const mappedAny = new Set(subMappings.map((m) => m.skuId))

  console.log(`\nDistinct modifiers seen on slider orders: ${byMod.size}`)
  console.log(`  mapped (some store): ${mappedAny.size}`)
  console.log(`  unmapped everywhere: ${byMod.size - mappedAny.size}\n`)

  // Pre-cost mapped modifier recipes (once each) so we can display per-slider cost contribution.
  const uniqueRecipeIds = Array.from(new Set(subMappings.map((m) => m.recipeId)))
  const recipeCost = new Map<string, number>()
  for (const rid of uniqueRecipeIds) {
    try {
      const r = await computeRecipeCost(rid, new Date())
      recipeCost.set(rid, r.totalCost)
    } catch {
      recipeCost.set(rid, 0)
    }
  }

  const rows = Array.from(byMod.values()).sort((a, b) => b.uses - a.uses)
  console.log(`${"modifier name".padEnd(42)}${"uses".padStart(8)}${"uses/slider".padStart(13)}${"mapped".padStart(9)}${"recipe cost".padStart(14)}${"$ missing/slider".padStart(18)}`)
  console.log("-".repeat(104))
  let totalMissingPerSlider = 0
  let totalExtraPerSlider = 0
  for (const r of rows) {
    const name = Array.from(r.names).join(" / ").slice(0, 40)
    const mapped = mappedAny.has(r.skuId)
    // Average uses per slider sold (uses / parentQty).
    const usesPerSlider = r.parentQty > 0 ? r.uses / r.parentQty : 0
    // If mapped in at least one store, show the recipe cost from the first matching row.
    const firstMatch = subMappings.find((m) => m.skuId === r.skuId)
    const rc = firstMatch ? (recipeCost.get(firstMatch.recipeId) ?? 0) : 0
    const costPerSlider = usesPerSlider * rc
    if (mapped) totalExtraPerSlider += costPerSlider
    else totalMissingPerSlider += usesPerSlider * 0 // unknown — see below
    const mark = mapped ? "YES" : " — "
    console.log(
      `${name.padEnd(42)}${r.uses.toFixed(0).padStart(8)}${usesPerSlider.toFixed(2).padStart(13)}${mark.padStart(9)}${money(rc).padStart(14)}${(mapped ? money(costPerSlider) : "???").padStart(18)}`
    )
  }

  console.log("-".repeat(104))
  console.log(`Current modifier COGS per slider (mapped only): ${money(totalExtraPerSlider)}`)
  console.log(`Unmapped modifiers per slider: ${rows.filter((r) => !mappedAny.has(r.skuId)).reduce((s, r) => s + (r.parentQty > 0 ? r.uses / r.parentQty : 0), 0).toFixed(2)} uses (cost unknown until mapped)`)

  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
