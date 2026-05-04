import { loadEnvLocal } from "../scripts/audit/lib"
loadEnvLocal()

const COMMIT = process.argv.includes("--commit")

async function main() {
  const { prisma } = await import("../src/lib/prisma")

  const c = await prisma.canonicalIngredient.findFirst({
    where: { name: 'pickle chips sandwich cut 1/8"' },
    select: { id: true },
  })
  if (!c) {
    console.log("no pickle canonical found")
    return
  }
  const recipe = await prisma.recipe.findFirst({
    where: { itemName: "Extra Side of Pickles", category: "A La Carte" },
    select: { id: true },
  })
  if (!recipe) {
    console.log("no Extra Side of Pickles recipe found")
    return
  }
  const ri = await prisma.recipeIngredient.findFirst({
    where: { recipeId: recipe.id, canonicalIngredientId: c.id },
    select: { id: true, quantity: true, unit: true },
  })
  if (!ri) {
    console.log("no pickle ingredient row on Extra Side of Pickles")
    return
  }
  console.log(`Extra Side of Pickles → pickle chips`)
  console.log(`  before: ${ri.quantity} ${ri.unit}`)
  console.log(`  after:  ${ri.quantity} chip`)
  if (COMMIT) {
    await prisma.recipeIngredient.update({
      where: { id: ri.id },
      data: { unit: "chip" },
    })
    console.log("  COMMITTED")
  } else {
    console.log("  DRY RUN — re-run with --commit to apply")
  }
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
