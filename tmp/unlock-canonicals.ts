// Phase 2e — flip costLocked=false on the three previously-locked canonicals
// and re-derive cost from invoice flow.

import { loadEnvLocal } from "../scripts/audit/lib"
loadEnvLocal()

const APPLY = process.argv.includes("--apply")

const CANONICAL_IDS = [
  "cmo58udyt00283nu9ufwdn6f5", // packer lettuce boston hydroponic
  "cmo58ubkh00143nu9b0c14gi1", // peppers whole yellow (chilli)
  "cmo6v1w56001hiku9yznqu6k0", // pickle chips sandwich cut 1/8"
]

async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const { recomputeCanonicalCost } = await import("../src/lib/ingredient-cost")

  const before = await prisma.canonicalIngredient.findMany({
    where: { id: { in: CANONICAL_IDS } },
    select: { id: true, name: true, recipeUnit: true, costPerRecipeUnit: true, costLocked: true, costSource: true },
  })
  console.log("Before:")
  for (const c of before) {
    console.log(`  ${c.name.padEnd(45)} $${c.costPerRecipeUnit ?? "?"}/${c.recipeUnit}  locked=${c.costLocked}  src=${c.costSource}`)
  }

  if (!APPLY) {
    console.log("\nDRY RUN. Pass --apply to flip locks.")
    await prisma.$disconnect()
    return
  }

  // Flip locks
  await prisma.canonicalIngredient.updateMany({
    where: { id: { in: CANONICAL_IDS } },
    data: { costLocked: false },
  })

  // Re-derive
  for (const id of CANONICAL_IDS) {
    const res = await recomputeCanonicalCost(id)
    console.log(`  ${id}  →  ${JSON.stringify(res)}`)
  }

  const after = await prisma.canonicalIngredient.findMany({
    where: { id: { in: CANONICAL_IDS } },
    select: { id: true, name: true, recipeUnit: true, costPerRecipeUnit: true, costLocked: true, costSource: true },
  })
  console.log("\nAfter:")
  for (const c of after) {
    console.log(`  ${c.name.padEnd(45)} $${c.costPerRecipeUnit ?? "?"}/${c.recipeUnit}  locked=${c.costLocked}  src=${c.costSource}`)
  }

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
