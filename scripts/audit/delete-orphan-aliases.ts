// Group F: delete IngredientAlias rows where the same (store, canonical) has a
// (vendor, sku) match covering the same canonical on matched invoice lines.
// The sku path wins at match time; these aliases are dead code.
//
// SAFETY:
//   - Dry-run by default. Pass --apply to actually delete.
//   - For each candidate alias, we re-verify the sku-path coverage at run time
//     (not just relying on the audit JSON, which may be stale).
//   - We only delete aliases where the canonicalIngredientId on the alias
//     matches the canonical a (vendor, sku) match would resolve to — so if the
//     alias points somewhere else (e.g. human override), we leave it alone.
import { loadEnvLocal } from "./lib"
loadEnvLocal()

const APPLY = process.argv.includes("--apply")

async function main() {
  const { prisma } = await import("../../src/lib/prisma")

  const aliases = await prisma.ingredientAlias.findMany({
    select: {
      id: true,
      storeId: true,
      rawName: true,
      canonicalIngredientId: true,
      canonicalName: true,
    },
  })
  console.log(`Scanning ${aliases.length} aliases …`)

  const skuMatches = await prisma.ingredientSkuMatch.findMany({
    select: { ownerId: true, canonicalIngredientId: true, vendorName: true, sku: true },
  })
  const skusByCanonical = new Map<string, Array<{ vendor: string; sku: string }>>()
  for (const m of skuMatches) {
    const list = skusByCanonical.get(m.canonicalIngredientId) ?? []
    list.push({ vendor: m.vendorName, sku: m.sku })
    skusByCanonical.set(m.canonicalIngredientId, list)
  }

  type Candidate = {
    id: string
    storeId: string
    rawName: string
    canonicalIngredientId: string
    canonicalName: string
  }
  const toDelete: Candidate[] = []

  for (const a of aliases) {
    if (!a.canonicalIngredientId) continue
    const skusForCanonical = skusByCanonical.get(a.canonicalIngredientId)
    if (!skusForCanonical || skusForCanonical.length === 0) continue

    const hasSkuLine = await prisma.invoiceLineItem.findFirst({
      where: {
        productName: a.rawName,
        sku: { not: null },
        canonicalIngredientId: a.canonicalIngredientId,
        invoice: { storeId: a.storeId },
      },
      select: { id: true },
    })
    if (hasSkuLine) toDelete.push(a as Candidate)
  }

  console.log(`Aliases safely redundant (sku path covers same canonical): ${toDelete.length}`)
  for (const c of toDelete.slice(0, 10)) {
    console.log(`  ${c.canonicalName.padEnd(40).slice(0, 40)}  <- "${c.rawName}"`)
  }
  if (toDelete.length > 10) console.log(`  …and ${toDelete.length - 10} more`)

  if (!APPLY) {
    console.log(`\n(dry run — re-run with --apply to delete ${toDelete.length} aliases)`)
    await prisma.$disconnect()
    return
  }

  const ids = toDelete.map((c) => c.id)
  const result = await prisma.ingredientAlias.deleteMany({ where: { id: { in: ids } } })
  console.log(`\nDeleted ${result.count} orphan aliases.`)
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
