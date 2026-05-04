// Preview what recomputeCanonicalCost would do for the locked canonicals,
// WITHOUT actually flipping costLocked or writing anything.

import { loadEnvLocal } from "../scripts/audit/lib"
loadEnvLocal()

async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const { deriveCostFromLineItem } = await import("../src/lib/ingredient-cost")

  const targets = await prisma.canonicalIngredient.findMany({
    where: {
      OR: [
        { name: { contains: "lettuce", mode: "insensitive" } },
        { name: { contains: "pickle", mode: "insensitive" } },
        { name: { contains: "peppers whole yellow", mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      name: true,
      recipeUnit: true,
      costPerRecipeUnit: true,
      costLocked: true,
      costSource: true,
    },
    orderBy: { name: "asc" },
  })

  for (const c of targets) {
    console.log(`\n=== ${c.name} (${c.id}) ===`)
    console.log(
      `  recipeUnit=${c.recipeUnit ?? "?"}  current=$${c.costPerRecipeUnit ?? "?"}/${c.recipeUnit ?? "?"}  ` +
      `locked=${c.costLocked}  source=${c.costSource ?? "?"}`
    )

    if (!c.recipeUnit) {
      console.log("  (skip: no recipeUnit)")
      continue
    }

    const line = await prisma.invoiceLineItem.findFirst({
      where: { canonicalIngredientId: c.id, quantity: { not: 0 } },
      orderBy: { invoice: { invoiceDate: "desc" } },
      select: {
        id: true,
        productName: true,
        quantity: true,
        unit: true,
        packSize: true,
        unitSize: true,
        unitSizeUom: true,
        unitPrice: true,
        extendedPrice: true,
        invoice: { select: { vendorName: true, invoiceNumber: true, invoiceDate: true } },
      },
    })

    if (!line) {
      console.log("  (no matched line item)")
      continue
    }

    console.log(
      `  most-recent line: ${line.invoice.vendorName} #${line.invoice.invoiceNumber} ` +
      `(${line.invoice.invoiceDate.toISOString().slice(0, 10)})`
    )
    console.log(
      `    ${line.productName}  qty=${line.quantity} ${line.unit} ` +
      `pack=${line.packSize} × size=${line.unitSize} ${line.unitSizeUom}  ` +
      `extPrice=$${line.extendedPrice}`
    )

    const vendorMatch = await prisma.ingredientSkuMatch.findFirst({
      where: { canonicalIngredientId: c.id },
      select: { conversionFactor: true, fromUnit: true, toUnit: true },
    })
    if (vendorMatch) {
      console.log(
        `    using ingredient conv: 1 ${vendorMatch.fromUnit} = ${vendorMatch.conversionFactor} ${vendorMatch.toUnit}`
      )
    }

    const derived = deriveCostFromLineItem(
      line,
      c.recipeUnit,
      vendorMatch
        ? {
            conversionFactor: vendorMatch.conversionFactor,
            fromUnit: vendorMatch.fromUnit,
            toUnit: vendorMatch.toUnit,
          }
        : undefined
    )

    if (derived == null) {
      console.log(`    DERIVED: null (cannot bridge units to ${c.recipeUnit})`)
    } else {
      const cur = c.costPerRecipeUnit ?? 0
      const delta = derived - cur
      console.log(
        `    DERIVED: $${derived.toFixed(6)}/${c.recipeUnit}  ` +
        `(current locked at $${cur.toFixed(6)}, Δ=${delta >= 0 ? "+" : ""}${delta.toFixed(6)})`
      )
    }
  }

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
