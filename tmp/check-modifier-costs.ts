import { loadEnvLocal } from "../scripts/audit/lib"
loadEnvLocal()

async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const { computeRecipeCost } = await import("../src/lib/recipe-cost")

  const targets = [
    "Mod: Add Lettuce",
    "Mod: Add Pickle",
    "Mod: Extra Pickles",
    "Side of Yellow Chilies",
  ]
  const recipes = await prisma.recipe.findMany({
    where: { itemName: { in: targets } },
    select: { id: true, itemName: true, category: true },
  })

  console.log("Modifier costs after fix:\n")
  for (const r of recipes) {
    const result = await computeRecipeCost(r.id)
    console.log(`  ${r.itemName} [${r.category}]`)
    console.log(`    totalCost = $${result.totalCost.toFixed(4)}  (partial=${result.partial})`)
    for (const line of result.lines) {
      console.log(
        `    - ${line.label}: ${line.quantity} ${line.unit} × $${(line.unitCost ?? 0).toFixed(4)}/${line.costUnit ?? "?"} = $${(line.lineCost ?? 0).toFixed(4)}${line.missingCost ? "  [MISSING COST]" : ""}`
      )
    }
    console.log()
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
