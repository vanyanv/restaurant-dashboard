// Backfill canonicalIngredientId on line items that were re-extracted but
// never re-linked to their canonical. Uses the existing matchNewLineItems
// path so logic stays identical to the sync flow.
//
// Read-only by default. Pass --apply to actually run.

import { loadEnvLocal } from "../scripts/audit/lib"
loadEnvLocal()

const APPLY = process.argv.includes("--apply")

async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const { matchNewLineItems } = await import("../src/lib/ingredient-matching")
  const { normalizeVendorName } = await import("../src/lib/vendor-normalize")

  // Find all invoices with at least one line item where canonicalIngredientId
  // is null AND a sku/vendor pair exists in IngredientSkuMatch.
  const matches = await prisma.ingredientSkuMatch.findMany({
    select: { vendorName: true, sku: true, accountId: true, canonicalIngredientId: true },
  })
  const skuKeys = new Set(matches.map((m) => `${m.vendorName}::${m.sku}`))

  const candidates = await prisma.invoiceLineItem.findMany({
    where: { canonicalIngredientId: null, sku: { not: null } },
    select: {
      id: true,
      sku: true,
      productName: true,
      invoice: { select: { id: true, vendorName: true, accountId: true, invoiceNumber: true } },
    },
  })

  // Filter to those whose (normalized vendor, sku) actually appears in a match.
  const wouldMatch = candidates.filter((l) => {
    const key = `${normalizeVendorName(l.invoice.vendorName)}::${l.sku}`
    return skuKeys.has(key)
  })

  console.log(`${candidates.length} unmatched line items with sku, ${wouldMatch.length} have a known IngredientSkuMatch`)

  // Group by (accountId, invoiceId)
  const byAccount = new Map<string, Set<string>>()
  for (const l of wouldMatch) {
    if (!byAccount.has(l.invoice.accountId)) byAccount.set(l.invoice.accountId, new Set())
    byAccount.get(l.invoice.accountId)!.add(l.invoice.id)
  }
  console.log(`Across ${byAccount.size} accounts, ${[...byAccount.values()].reduce((a, s) => a + s.size, 0)} invoices`)

  // Print breakdown by sku
  const bySku = new Map<string, number>()
  for (const l of wouldMatch) {
    const k = `${l.invoice.vendorName}::${l.sku}`
    bySku.set(k, (bySku.get(k) ?? 0) + 1)
  }
  console.log("\nBreakdown by (vendor, sku):")
  for (const [k, n] of [...bySku.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(4)}  ${k}`)
  }

  if (!APPLY) {
    console.log("\nDRY RUN. Pass --apply to actually re-match.")
    await prisma.$disconnect()
    return
  }

  let totalSku = 0, totalAlias = 0, totalUn = 0, totalCosts = 0
  for (const [accountId, invSet] of byAccount.entries()) {
    const ids = [...invSet]
    console.log(`\n[apply] account=${accountId}  invoices=${ids.length}`)
    const res = await matchNewLineItems(accountId, ids)
    console.log(`  matchedBySku=${res.matchedBySku}  matchedByAlias=${res.matchedByAlias}  unmatched=${res.unmatched}  costsUpdated=${res.costsUpdated}`)
    totalSku += res.matchedBySku
    totalAlias += res.matchedByAlias
    totalUn += res.unmatched
    totalCosts += res.costsUpdated
  }
  console.log(`\nTOTAL: matchedBySku=${totalSku}  matchedByAlias=${totalAlias}  unmatched=${totalUn}  costsUpdated=${totalCosts}`)

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
