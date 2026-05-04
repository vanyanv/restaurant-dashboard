// Verify why line items aren't linking. Check normalized vendor + sku key match.

import { loadEnvLocal } from "../scripts/audit/lib"
loadEnvLocal()

async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const { normalizeVendorName } = await import("../src/lib/vendor-normalize")

  // Show all lettuce/pickle/peppers SKU matches verbatim.
  const ids = ["cmo58udyt00283nu9ufwdn6f5", "cmo6v1w56001hiku9yznqu6k0", "cmo58ubkh00143nu9b0c14gi1"]
  const matches = await prisma.ingredientSkuMatch.findMany({
    where: { canonicalIngredientId: { in: ids } },
    select: {
      vendorName: true,
      sku: true,
      canonicalIngredientId: true,
      conversionFactor: true,
      fromUnit: true,
      toUnit: true,
    },
  })
  console.log("=== IngredientSkuMatch rows for the 3 locked canonicals ===")
  for (const m of matches) {
    console.log(`  canonical=${m.canonicalIngredientId}  vendor="${m.vendorName}"  sku="${m.sku}"  conv 1 ${m.fromUnit}=${m.conversionFactor} ${m.toUnit}`)
  }

  // For each, find recent line items with that sku and show vendor normalization comparison.
  console.log("\n=== Line items by sku and vendor-key comparison ===")
  for (const m of matches) {
    const lines = await prisma.invoiceLineItem.findMany({
      where: { sku: m.sku },
      orderBy: { invoice: { invoiceDate: "desc" } },
      take: 3,
      select: {
        productName: true,
        canonicalIngredientId: true,
        invoice: { select: { vendorName: true, accountId: true } },
      },
    })
    for (const l of lines) {
      const liveKey = `${normalizeVendorName(l.invoice.vendorName)}::${m.sku}`
      const matchKey = `${m.vendorName}::${m.sku}`
      const ok = liveKey === matchKey ? "✓" : "✗"
      console.log(
        `  ${ok} sku=${m.sku}  invoice-vendor="${l.invoice.vendorName}" → "${normalizeVendorName(l.invoice.vendorName)}"  ` +
        `match-vendor="${m.vendorName}"  canonical-on-line=${l.canonicalIngredientId ?? "NONE"}  ${l.productName.slice(0, 35)}`
      )
    }
  }

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
