// Read-only: pull the Double Slider recipe, find its ground-beef canonical
// ingredient, and show the canonical's current cost + the last 6 months of
// matched invoice lines so we can judge whether costPerRecipeUnit is stale/off.
import { loadEnvLocal, money } from "./lib"
loadEnvLocal()

async function main() {
  const { prisma } = await import("../../src/lib/prisma")
  const { deriveCostFromLineItem } = await import("../../src/lib/ingredient-cost")

  const recipes = await prisma.recipe.findMany({
    where: { itemName: { contains: "Double Slider" } },
    select: {
      id: true,
      itemName: true,
      ownerId: true,
      ingredients: {
        select: {
          id: true,
          quantity: true,
          unit: true,
          canonicalIngredientId: true,
          canonicalIngredient: {
            select: {
              id: true,
              name: true,
              recipeUnit: true,
              costPerRecipeUnit: true,
              costLocked: true,
              costUpdatedAt: true,
            },
          },
        },
      },
    },
  })

  if (recipes.length === 0) {
    console.log("No Double Slider recipe found.")
    await prisma.$disconnect()
    return
  }

  for (const recipe of recipes) {
    console.log(`\n=== Recipe: ${recipe.itemName}  (owner=${recipe.ownerId.slice(0, 8)}…) ===`)
    console.log(`${"ingredient".padEnd(38)}${"qty".padStart(8)}${"uom".padStart(8)}${"recipeUnit".padStart(12)}${"$/recipeUnit".padStart(14)}${"locked".padStart(8)}${"lastUpdated".padStart(14)}`)
    for (const i of recipe.ingredients) {
      const c = i.canonicalIngredient
      if (!c) {
        console.log(`${"(no canonical)".padEnd(38)}${i.quantity.toFixed(2).padStart(8)}${(i.unit ?? "").padStart(8)}`)
        continue
      }
      const updated = c.costUpdatedAt ? c.costUpdatedAt.toISOString().slice(0, 10) : "(never)"
      console.log(
        `${c.name.padEnd(38).slice(0, 38)}${i.quantity.toFixed(3).padStart(8)}${(i.unit ?? "").padStart(8)}${(c.recipeUnit ?? "").padStart(12)}${money(c.costPerRecipeUnit ?? 0).padStart(14)}${(c.costLocked ? "YES" : "no").padStart(8)}${updated.padStart(14)}`
      )
    }

    // Focus on the beef ingredient.
    const beef = recipe.ingredients.find((i) =>
      i.canonicalIngredient && /beef|ground/i.test(i.canonicalIngredient.name)
    )
    if (!beef || !beef.canonicalIngredient) continue
    const c = beef.canonicalIngredient

    console.log(`\n--- Beef canonical: "${c.name}" ---`)
    console.log(`  current costPerRecipeUnit = ${money(c.costPerRecipeUnit ?? 0)} per ${c.recipeUnit}`)
    console.log(`  locked = ${c.costLocked}`)
    console.log(`  lastUpdated = ${c.costUpdatedAt?.toISOString().slice(0, 10) ?? "(never)"}`)

    // Last 12 matched invoice lines for this canonical.
    const end = new Date()
    const start = new Date(end)
    start.setDate(start.getDate() - 180)

    const lines = await prisma.invoiceLineItem.findMany({
      where: {
        canonicalIngredientId: c.id,
        invoice: { invoiceDate: { gte: start, lt: end } },
      },
      select: {
        id: true,
        productName: true,
        sku: true,
        quantity: true,
        unit: true,
        packSize: true,
        unitSize: true,
        unitSizeUom: true,
        unitPrice: true,
        extendedPrice: true,
        invoice: { select: { vendorName: true, invoiceDate: true, storeId: true } },
      },
      orderBy: { invoice: { invoiceDate: "desc" } },
      take: 20,
    })
    console.log(`\n  Last ${lines.length} matched invoice lines (180d):`)
    console.log(
      `    ${"date".padEnd(12)}${"vendor".padEnd(16)}${"product".padEnd(30)}${"qty×pack×size".padEnd(18)}${"$/case".padStart(10)}${"$/recipeUnit".padStart(15)}`
    )
    for (const l of lines) {
      const packDesc = `${l.quantity ?? 0}${l.unit ?? ""} ×${l.packSize ?? "-"}×${l.unitSize ?? "-"}${l.unitSizeUom ?? ""}`
      let derived = "?"
      try {
        const d = deriveCostFromLineItem(
          {
            quantity: l.quantity ?? 0,
            unit: l.unit,
            packSize: l.packSize,
            unitSize: l.unitSize,
            unitSizeUom: l.unitSizeUom,
            extendedPrice: l.extendedPrice ?? 0,
          },
          c.recipeUnit ?? ""
        )
        derived = d != null ? money(d) : "n/a"
      } catch (e) {
        derived = `err: ${(e as Error).message.slice(0, 25)}`
      }
      console.log(
        `    ${l.invoice.invoiceDate?.toISOString().slice(0, 10).padEnd(12) ?? "-".padEnd(12)}${l.invoice.vendorName.slice(0, 15).padEnd(16)}${(l.productName ?? "").slice(0, 29).padEnd(30)}${packDesc.padEnd(18)}${money(l.unitPrice ?? 0).padStart(10)}${derived.padStart(15)}`
      )
    }

    // Show a straight price trajectory (median $/recipeUnit by month).
    const byMonth = new Map<string, number[]>()
    for (const l of lines) {
      try {
        const d = deriveCostFromLineItem(
          {
            quantity: l.quantity ?? 0,
            unit: l.unit,
            packSize: l.packSize,
            unitSize: l.unitSize,
            unitSizeUom: l.unitSizeUom,
            extendedPrice: l.extendedPrice ?? 0,
          },
          c.recipeUnit ?? ""
        )
        if (d == null || !l.invoice.invoiceDate) continue
        const m = l.invoice.invoiceDate.toISOString().slice(0, 7)
        const arr = byMonth.get(m) ?? []
        arr.push(d)
        byMonth.set(m, arr)
      } catch {}
    }
    console.log(`\n  Month-by-month median $/recipeUnit:`)
    for (const m of Array.from(byMonth.keys()).sort()) {
      const arr = byMonth.get(m)!.sort((a, b) => a - b)
      const med = arr[Math.floor(arr.length / 2)]
      console.log(`    ${m}  n=${arr.length.toString().padStart(2)}  median=${money(med)}  (range ${money(arr[0])}–${money(arr[arr.length - 1])})`)
    }

    // Implied contribution to slider base recipe:
    console.log(`\n  → Beef contribution per slider: ${beef.quantity} ${beef.unit} × ${money(c.costPerRecipeUnit ?? 0)}/${c.recipeUnit} = ${money((beef.quantity) * (c.costPerRecipeUnit ?? 0))}`)
  }

  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
