// Diagnose why lettuce canonical has no matched line items, and find chilli.

import { loadEnvLocal } from "../scripts/audit/lib"
loadEnvLocal()

async function main() {
  const { prisma } = await import("../src/lib/prisma")

  // Show all canonicals that look produce-y so we can find chilli/chili/pepper.
  const all = await prisma.canonicalIngredient.findMany({
    where: {
      OR: [
        { name: { contains: "chil", mode: "insensitive" } },
        { name: { contains: "pepper", mode: "insensitive" } },
        { name: { contains: "lettuce", mode: "insensitive" } },
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
  })
  console.log("=== Canonicals matching chil/pepper/lettuce ===")
  for (const c of all) {
    console.log(`  ${c.name.padEnd(50)} (${c.id})  $${c.costPerRecipeUnit ?? "?"}/${c.recipeUnit ?? "?"}  locked=${c.costLocked}  src=${c.costSource}`)
  }

  // Now check lettuce specifically — find its SKU matches and any line items
  // that reference any lettuce-shaped product.
  const lettuce = all.find((c) => /lettuce/i.test(c.name))
  if (lettuce) {
    console.log(`\n=== Lettuce (${lettuce.id}) — sku matches ===`)
    const matches = await prisma.ingredientSkuMatch.findMany({
      where: { canonicalIngredientId: lettuce.id },
      select: {
        vendorName: true,
        sku: true,
        conversionFactor: true,
        fromUnit: true,
        toUnit: true,
      },
    })
    for (const m of matches) {
      console.log(`  ${m.vendorName} sku=${m.sku}  conv: 1 ${m.fromUnit}=${m.conversionFactor} ${m.toUnit}`)
    }

    console.log(`\n=== Lettuce — line items by canonicalIngredientId ===`)
    const linesByCanonical = await prisma.invoiceLineItem.count({
      where: { canonicalIngredientId: lettuce.id },
    })
    console.log(`  count = ${linesByCanonical}`)

    console.log(`\n=== Recent lettuce-shaped lines (any canonical assignment) ===`)
    const lines = await prisma.invoiceLineItem.findMany({
      where: { productName: { contains: "lettuce", mode: "insensitive" } },
      orderBy: { invoice: { invoiceDate: "desc" } },
      take: 5,
      select: {
        productName: true,
        sku: true,
        unit: true,
        packSize: true,
        unitSize: true,
        unitSizeUom: true,
        quantity: true,
        extendedPrice: true,
        canonicalIngredientId: true,
        invoice: { select: { vendorName: true, invoiceNumber: true, invoiceDate: true } },
      },
    })
    for (const l of lines) {
      console.log(
        `  ${l.invoice.invoiceDate.toISOString().slice(0, 10)} ${l.invoice.vendorName} #${l.invoice.invoiceNumber} sku=${l.sku}  ` +
        `pack=${l.packSize}×size=${l.unitSize} ${l.unitSizeUom}  qty=${l.quantity} ext=$${l.extendedPrice}  ` +
        `canonical=${l.canonicalIngredientId ?? "NONE"}  ${l.productName}`
      )
    }
  }

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
