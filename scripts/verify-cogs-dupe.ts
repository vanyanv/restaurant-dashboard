import { loadEnvLocal } from "./audit/lib"

async function main() {
  loadEnvLocal()
  const { prisma } = await import("@/lib/prisma")
  console.log("\n=== 0. DailyCogsItem: exact duplicate guard ===")
  const exactDailyCogsDuplicates = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*)::bigint AS n FROM (
      SELECT "storeId", "date", "itemName", "category"
      FROM "DailyCogsItem"
      GROUP BY "storeId", "date", "itemName", "category"
      HAVING COUNT(*) > 1
    ) t
  `
  console.log(
    `  Exact duplicate (storeId, date, itemName, category) groups: ${exactDailyCogsDuplicates[0].n}`
  )

  console.log("\n=== 1. OtterMenuItem: same itemName under multiple categories on the same day ===")
  const dupMenuRaw = await prisma.$queryRaw<Array<{ storeId: string; date: Date; itemName: string; category_count: bigint; categories: string[] }>>`
    SELECT "storeId", "date", "itemName",
           COUNT(DISTINCT "category") AS category_count,
           ARRAY_AGG(DISTINCT "category") AS categories
    FROM "OtterMenuItem"
    WHERE "isModifier" = false
      AND "date" >= '2026-01-01'
    GROUP BY "storeId", "date", "itemName"
    HAVING COUNT(DISTINCT "category") > 1
    ORDER BY category_count DESC, "date" DESC
    LIMIT 10
  `
  console.log("Examples with >1 category for same item/day:")
  for (const r of dupMenuRaw) {
    console.log(`  ${r.date.toISOString().slice(0,10)}  "${r.itemName}"  [${r.categories.join(" | ")}]  (${r.category_count} categories)`)
  }
  const totalDup = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*)::bigint AS n FROM (
      SELECT "storeId", "date", "itemName"
      FROM "OtterMenuItem"
      WHERE "isModifier" = false AND "date" >= '2026-01-01'
      GROUP BY "storeId", "date", "itemName"
      HAVING COUNT(DISTINCT "category") > 1
    ) t
  `
  console.log(`  TOTAL (storeId, date, itemName) groups with >1 category since 2026-01-01: ${totalDup[0].n}`)

  console.log("\n=== 2. DailyCogsItem: duplicate-category rows with high unitCost spread ===")
  const cogsSpread = await prisma.$queryRaw<Array<{ storeId: string; date: Date; itemName: string; rows: bigint; min_unit: number; max_unit: number; sum_qty: bigint; sum_line: number }>>`
    SELECT "storeId", "date", "itemName",
           COUNT(*) AS rows,
           MIN("unitCost") AS min_unit,
           MAX("unitCost") AS max_unit,
           SUM("qtySold")::bigint AS sum_qty,
           SUM("lineCost") AS sum_line
    FROM "DailyCogsItem"
    WHERE "date" >= '2026-01-01'
      AND "category" <> 'Packaging'
      AND "unitCost" IS NOT NULL
    GROUP BY "storeId", "date", "itemName"
    HAVING COUNT(*) > 1 AND MAX("unitCost") - MIN("unitCost") > 5
    ORDER BY (MAX("unitCost") - MIN("unitCost")) DESC
    LIMIT 15
  `
  console.log("Top 15 worst unit-cost spreads (same itemName, multiple category rows):")
  for (const r of cogsSpread) {
    console.log(`  ${r.date.toISOString().slice(0,10)}  "${r.itemName}"  rows=${r.rows}  unit min/max=$${r.min_unit?.toFixed(2)}/$${r.max_unit?.toFixed(2)}  qty=${r.sum_qty}  line=$${r.sum_line?.toFixed(2)}`)
  }

  console.log("\n=== 3. Pick worst case → look at row-level breakdown + verify modifier hypothesis ===")
  if (cogsSpread.length > 0) {
    const worst = cogsSpread[0]
    console.log(`\n  Inspecting: ${worst.date.toISOString().slice(0,10)} "${worst.itemName}" (storeId=${worst.storeId})`)
    const rows = await prisma.dailyCogsItem.findMany({
      where: { storeId: worst.storeId, date: worst.date, itemName: worst.itemName },
      select: { category: true, qtySold: true, salesRevenue: true, unitCost: true, lineCost: true, status: true, partialCost: true },
      orderBy: { qtySold: "desc" },
    })
    console.log("  DailyCogsItem rows:")
    for (const r of rows) {
      console.log(`    cat="${r.category}"  qty=${r.qtySold}  rev=$${r.salesRevenue?.toFixed(2)}  unit=$${r.unitCost?.toFixed(2)}  line=$${r.lineCost?.toFixed(2)}  status=${r.status} partial=${r.partialCost}`)
    }

    // What does OtterMenuItem look like for the same item/day?
    const dayEnd = new Date(worst.date); dayEnd.setUTCHours(23,59,59,999)
    const menu = await prisma.otterMenuItem.findMany({
      where: { storeId: worst.storeId, itemName: worst.itemName, date: { gte: worst.date, lte: dayEnd }, isModifier: false },
      select: { category: true, fpQuantitySold: true, tpQuantitySold: true, fpTotalSales: true, tpTotalSales: true },
    })
    console.log("  OtterMenuItem rows for the same item/day:")
    for (const r of menu) {
      const qty = (r.fpQuantitySold ?? 0) + (r.tpQuantitySold ?? 0)
      const rev = (r.fpTotalSales ?? 0) + (r.tpTotalSales ?? 0)
      console.log(`    cat="${r.category}"  qty=${qty} rev=$${rev?.toFixed(2)}`)
    }

    // What modifier cost did this item accrue from OtterOrderSubItem?
    const subItems = await prisma.otterOrderSubItem.findMany({
      where: {
        orderItem: {
          name: worst.itemName,
          order: { storeId: worst.storeId, referenceTimeLocal: { gte: worst.date, lte: dayEnd } },
        },
      },
      select: { skuId: true, name: true, quantity: true, orderItem: { select: { quantity: true } } },
    })
    let totalUses = 0
    const bySku = new Map<string, { name: string; uses: number }>()
    for (const s of subItems) {
      const uses = (s.quantity ?? 1) * (s.orderItem?.quantity ?? 1)
      totalUses += uses
      const key = s.skuId ?? `(no-sku):${s.name}`
      const existing = bySku.get(key) ?? { name: s.name, uses: 0 }
      existing.uses += uses
      bySku.set(key, existing)
    }
    console.log(`  Modifier uses for "${worst.itemName}" that day: total ${totalUses} (subItem rows: ${subItems.length})`)
    const top = [...bySku.entries()].sort((a,b)=>b[1].uses - a[1].uses).slice(0,5)
    for (const [sku, v] of top) {
      console.log(`    sku=${sku}  name="${v.name}"  uses=${v.uses}`)
    }

    // Direct math test: does (max - min) * qty(low-row) ≈ extraLineCost ?
    const sortedByQty = [...rows].sort((a,b)=>b.qtySold - a.qtySold)
    if (sortedByQty.length >= 2 && sortedByQty[0].unitCost != null && sortedByQty[1].unitCost != null) {
      const baseUnit = sortedByQty[0].unitCost
      // Bigger unit row likely the one with low qty getting full mod cost concentrated
      const inflated = [...sortedByQty].sort((a,b)=>(b.unitCost ?? 0)-(a.unitCost ?? 0))[0]
      const baseRow  = sortedByQty[0]
      console.log("\n  Hypothesis check:")
      console.log(`    base row: cat="${baseRow.category}" qty=${baseRow.qtySold} unit=$${baseRow.unitCost?.toFixed(2)} line=$${baseRow.lineCost?.toFixed(2)}`)
      console.log(`    inflated: cat="${inflated.category}" qty=${inflated.qtySold} unit=$${inflated.unitCost?.toFixed(2)} line=$${inflated.lineCost?.toFixed(2)}`)
      // If base recipe alone costs X, lineCost = X*qty + extraMod. The "low qty" row should have unit ≈ X + extraMod/qty.
      // We can derive extraMod per row: (unit - X) * qty for the inflated row.
      // We don't know X here, but if both rows have the SAME extraMod, their lineCosts should differ by base*qty + extraMod respectively.
      const sumLineFromCogs = rows.reduce((s,r)=>s + (r.lineCost ?? 0), 0)
      console.log(`    sum(lineCost) across all category rows: $${sumLineFromCogs.toFixed(2)}`)
      console.log(`    If modifier is duplicated N=${rows.length} times, true cogs ≈ sum - (N-1)*extraMod_per_row`)
    }
  }

  console.log("\n=== 4. Distinct affected stores ===")
  const stores = await prisma.$queryRaw<Array<{ storeId: string; affected_groups: bigint }>>`
    SELECT "storeId", COUNT(*)::bigint AS affected_groups FROM (
      SELECT "storeId", "date", "itemName"
      FROM "DailyCogsItem"
      WHERE "date" >= '2026-01-01' AND "category" <> 'Packaging'
      GROUP BY "storeId", "date", "itemName"
      HAVING COUNT(*) > 1
    ) t
    GROUP BY "storeId" ORDER BY affected_groups DESC
  `
  for (const s of stores) {
    console.log(`  storeId=${s.storeId}  affected (item,day) groups: ${s.affected_groups}`)
  }
}

main().then(()=>process.exit(0)).catch(e=>{console.error(e); process.exit(1)})
