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

  const stores = await prisma.store.findMany({ select: { id: true, name: true } })
  const storeIds = stores.map((s) => s.id)
  const nameById = new Map(stores.map((s) => [s.id, s.name]))

  console.log("=== 1. DATE RANGES ===\n")

  for (const s of stores) {
    const orderRange = await prisma.otterOrder.aggregate({
      where: { storeId: s.id },
      _min: { referenceTimeLocal: true },
      _max: { referenceTimeLocal: true },
      _count: { id: true },
    })
    const menuItemRange = await prisma.otterMenuItem.aggregate({
      where: { storeId: s.id },
      _min: { date: true },
      _max: { date: true },
      _count: { id: true },
    })
    console.log(`  ${s.name}`)
    console.log(`    OtterOrder:    ${orderRange._count.id} rows, ${orderRange._min.referenceTimeLocal?.toISOString().slice(0, 10) ?? "—"} → ${orderRange._max.referenceTimeLocal?.toISOString().slice(0, 10) ?? "—"}`)
    console.log(`    OtterMenuItem: ${menuItemRange._count.id} rows, ${menuItemRange._min.date?.toISOString().slice(0, 10) ?? "—"} → ${menuItemRange._max.date?.toISOString().slice(0, 10) ?? "—"}`)
  }

  console.log("\n=== 2. ITEM SKU DRIFT (OtterOrderItem → OtterItemMapping) ===\n")

  const itemRows = await prisma.otterOrderItem.groupBy({
    by: ["skuId", "name"],
    _count: { skuId: true },
    _sum: { quantity: true },
  })
  const itemMaps = await prisma.otterItemMapping.findMany({
    where: { storeId: { in: storeIds } },
    select: { skuId: true, otterItemName: true },
  })
  const mappedItemSkus = new Set(itemMaps.filter((m) => m.skuId).map((m) => m.skuId as string))
  const mappedItemNames = new Set(itemMaps.map((m) => m.otterItemName))

  let unmappedItems = 0
  const unmappedItemRows: Array<{ skuId: string; name: string; qty: number }> = []
  for (const it of itemRows) {
    const mappedBySku = mappedItemSkus.has(it.skuId)
    const mappedByName = mappedItemNames.has(it.name)
    if (!mappedBySku && !mappedByName) {
      unmappedItems++
      unmappedItemRows.push({ skuId: it.skuId, name: it.name, qty: it._sum.quantity ?? 0 })
    }
  }
  unmappedItemRows.sort((a, b) => b.qty - a.qty)
  for (const r of unmappedItemRows) {
    console.log(`  qty=${r.qty.toFixed(0).padStart(5)}  sku=${r.skuId}  name="${r.name}"`)
  }
  if (unmappedItems === 0) console.log("  (no drift — every order item matches current mappings)")

  console.log("\n=== 3. MODIFIER SKU DRIFT (OtterOrderSubItem → OtterSubItemMapping) ===\n")

  const subRows = await prisma.otterOrderSubItem.groupBy({
    by: ["skuId", "name"],
    _count: { skuId: true },
    _sum: { quantity: true },
  })
  const subMaps = await prisma.otterSubItemMapping.findMany({
    where: { storeId: { in: storeIds } },
    select: { skuId: true },
  })
  const mappedSubSkus = new Set(subMaps.map((m) => m.skuId))

  let unmappedSubs = 0
  const unmappedSubRows: Array<{ skuId: string; name: string; qty: number }> = []
  for (const s of subRows) {
    if (!mappedSubSkus.has(s.skuId)) {
      unmappedSubs++
      unmappedSubRows.push({ skuId: s.skuId, name: s.name, qty: s._sum.quantity ?? 0 })
    }
  }
  unmappedSubRows.sort((a, b) => b.qty - a.qty)
  for (const r of unmappedSubRows.slice(0, 30)) {
    console.log(`  qty=${r.qty.toFixed(0).padStart(5)}  sku=${r.skuId}  name="${r.name}"`)
  }
  if (unmappedSubs === 0) console.log("  (no drift — every order sub-item matches current mappings)")
  else if (unmappedSubs > 30) console.log(`  ... and ${unmappedSubs - 30} more`)

  console.log("\n=== 4. DailyCogsItem COVERAGE (last 90d) ===\n")

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 90)
  cutoff.setUTCHours(0, 0, 0, 0)

  for (const s of stores) {
    const menuDays = await prisma.otterMenuItem.groupBy({
      by: ["date"],
      where: { storeId: s.id, isModifier: false, date: { gte: cutoff } },
    })
    const cogsDays = await prisma.dailyCogsItem.groupBy({
      by: ["date"],
      where: { storeId: s.id, date: { gte: cutoff } },
    })
    const menuDateSet = new Set(menuDays.map((d) => d.date.toISOString().slice(0, 10)))
    const cogsDateSet = new Set(cogsDays.map((d) => d.date.toISOString().slice(0, 10)))
    const missing = [...menuDateSet].filter((d) => !cogsDateSet.has(d)).sort()
    console.log(`  ${s.name}: menuDays=${menuDateSet.size}  cogsDays=${cogsDateSet.size}  missing=${missing.length}`)
    if (missing.length > 0 && missing.length <= 10) console.log(`    gaps: ${missing.join(", ")}`)
  }

  console.log("\n=== SUMMARY ===")
  console.log(`  item SKU drift rows:      ${unmappedItems}`)
  console.log(`  modifier SKU drift rows:  ${unmappedSubs}`)

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
