// scripts/smoke-modifier-cogs.ts
// Phase 3 end-to-end smoke:
//   1. Pick a real OtterOrder day.
//   2. Temporarily create a modifier recipe "Mod: Add Lettuce (smoke)" that
//      contains one RecipeIngredient with foodCostOverride set to a known $.
//   3. Map the most-used "Add Lettuce" sub-item SKU on one store → that recipe.
//   4. Run recomputeDailyCogsForDay and print the DailyCogsItem rows for items
//      that had "Add Lettuce" modifiers that day.
//   5. Restore (delete mapping + recipe).

import fs from "fs"
import path from "path"

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return
  const content = fs.readFileSync(envPath, "utf-8")
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "")
    if (!process.env[key]) process.env[key] = val
  }
}

loadEnvLocal()

async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const { recomputeDailyCogsForDay } = await import("../src/lib/cogs-materializer")

  // Pick the most-used "Add Lettuce" sub-item SKU on any store.
  const targetName = "Add Lettuce"
  const topLettuce = await prisma.otterOrderSubItem.groupBy({
    by: ["skuId"],
    where: { name: targetName },
    _count: { skuId: true },
    orderBy: { _count: { skuId: "desc" } },
    take: 1,
  })
  if (topLettuce.length === 0) {
    console.log(`No OtterOrderSubItem with name='${targetName}' — aborting.`)
    await prisma.$disconnect()
    return
  }
  const lettuceSkuId = topLettuce[0].skuId
  console.log(`Target modifier: ${targetName}  SKU=${lettuceSkuId}  (×${topLettuce[0]._count.skuId} orders)`)

  // Pick a store + day with this modifier on a menu item.
  const sampleOrder = await prisma.otterOrder.findFirst({
    where: {
      items: { some: { subItems: { some: { skuId: lettuceSkuId } } } },
    },
    orderBy: { referenceTimeLocal: "desc" },
    select: {
      storeId: true,
      referenceTimeLocal: true,
      store: { select: { ownerId: true, name: true } },
      items: {
        select: {
          name: true,
          quantity: true,
          subItems: { select: { skuId: true, name: true, quantity: true } },
        },
      },
    },
  })
  if (!sampleOrder) {
    console.log("No order with this modifier — aborting.")
    await prisma.$disconnect()
    return
  }
  const day = new Date(sampleOrder.referenceTimeLocal)
  day.setUTCHours(0, 0, 0, 0)
  console.log(`Using store ${sampleOrder.store.name}  day=${day.toISOString().slice(0, 10)}`)

  // Temporarily create a modifier recipe with a known cost. We use
  // foodCostOverride so we don't rely on canonical lookups wired up or not.
  const KNOWN_MOD_COST = 0.05
  const recipe = await prisma.recipe.create({
    data: {
      ownerId: sampleOrder.store.ownerId,
      itemName: `Mod: Add Lettuce (smoke ${Date.now()})`,
      category: "Modifier",
      servingSize: 1,
      foodCostOverride: KNOWN_MOD_COST,
      isSellable: false,
    },
  })
  console.log(`Created test recipe ${recipe.itemName}  (override=$${KNOWN_MOD_COST})`)

  try {
    // Map sub-item SKU → recipe for the target store only.
    await prisma.otterSubItemMapping.upsert({
      where: { storeId_skuId: { storeId: sampleOrder.storeId, skuId: lettuceSkuId } },
      create: {
        storeId: sampleOrder.storeId,
        skuId: lettuceSkuId,
        otterSubItemName: targetName,
        recipeId: recipe.id,
      },
      update: { recipeId: recipe.id, otterSubItemName: targetName },
    })
    console.log(`Mapped SKU → recipe.`)

    // Recompute the day.
    const { rowsWritten } = await recomputeDailyCogsForDay({
      storeId: sampleOrder.storeId,
      date: day,
      ownerId: sampleOrder.store.ownerId,
    })
    console.log(`\nrecomputeDailyCogsForDay wrote ${rowsWritten} rows.`)

    // Walk OtterOrderSubItem for this day/store to know WHICH items used the modifier.
    const dayEnd = new Date(day)
    dayEnd.setUTCHours(23, 59, 59, 999)
    const uses = await prisma.otterOrderSubItem.findMany({
      where: {
        skuId: lettuceSkuId,
        orderItem: {
          order: {
            storeId: sampleOrder.storeId,
            referenceTimeLocal: { gte: day, lte: dayEnd },
          },
        },
      },
      select: {
        quantity: true,
        orderItem: { select: { name: true, quantity: true } },
      },
    })
    const usesByItem = new Map<string, number>()
    for (const u of uses) {
      const n = (u.quantity ?? 1) * (u.orderItem.quantity ?? 1)
      usesByItem.set(u.orderItem.name, (usesByItem.get(u.orderItem.name) ?? 0) + n)
    }
    console.log(`\nItems that used '${targetName}' on this day:`)
    for (const [name, n] of usesByItem) {
      console.log(`   ${name.padEnd(60)}  ${n} uses  → expected +$${(n * KNOWN_MOD_COST).toFixed(4)} mod cost`)
    }

    // Show DailyCogsItem rows for those items.
    const itemNames = [...usesByItem.keys()]
    const rows = await prisma.dailyCogsItem.findMany({
      where: {
        storeId: sampleOrder.storeId,
        date: day,
        itemName: { in: itemNames },
      },
      select: {
        itemName: true,
        qtySold: true,
        unitCost: true,
        lineCost: true,
        status: true,
        recipe: { select: { itemName: true, foodCostOverride: true } },
      },
    })
    console.log(`\nDailyCogsItem rows post-recompute:`)
    for (const r of rows) {
      const baseOverride = r.recipe?.foodCostOverride ?? null
      const baseGuess = baseOverride != null ? baseOverride * r.qtySold : null
      const expectedMod = (usesByItem.get(r.itemName) ?? 0) * KNOWN_MOD_COST
      const expectedTotal = baseGuess != null ? baseGuess + expectedMod : null
      console.log(
        `   ${r.itemName.padEnd(55)} qty=${r.qtySold} unitCost=$${r.unitCost?.toFixed(4) ?? "—"} lineCost=$${r.lineCost.toFixed(4)}  (expected ≈ $${expectedTotal?.toFixed(4) ?? "—"})`
      )
    }
  } finally {
    // Cleanup
    await prisma.otterSubItemMapping.deleteMany({
      where: { storeId: sampleOrder.storeId, skuId: lettuceSkuId },
    })
    await prisma.recipe.delete({ where: { id: recipe.id } })
    // Re-recompute the day so DailyCogsItem is back to pre-smoke state.
    await recomputeDailyCogsForDay({
      storeId: sampleOrder.storeId,
      date: day,
      ownerId: sampleOrder.store.ownerId,
    })
    console.log(`\n(cleaned up mapping + recipe + re-materialized day)`)
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
