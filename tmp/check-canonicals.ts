import { loadEnvLocal } from "../scripts/audit/lib"
loadEnvLocal()

async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const names = [
    "packer lettuce boston hydroponic",
    'pickle chips sandwich cut 1/8"',
    "peppers whole yellow",
  ]
  const canonicals = await prisma.canonicalIngredient.findMany({
    where: { name: { in: names } },
    select: {
      name: true,
      recipeUnit: true,
      costPerRecipeUnit: true,
      costSource: true,
      costLocked: true,
      costUpdatedAt: true,
    },
  })
  console.log("CANONICALS:")
  console.log(JSON.stringify(canonicals, null, 2))

  const skuMatches = await prisma.ingredientSkuMatch.findMany({
    where: { sku: { in: ["2717106", "813", "G299"] } },
    select: { vendorName: true, sku: true, fromUnit: true, toUnit: true, conversionFactor: true },
  })
  console.log("\nSKU MATCHES:")
  console.log(JSON.stringify(skuMatches, null, 2))

  const recipes = await prisma.recipe.findMany({
    where: {
      itemName: {
        in: ["Mod: Add Lettuce", "Mod: Add Pickle", "Mod: Extra Pickles", "Side of Yellow Chilies"],
      },
    },
    select: {
      itemName: true,
      ingredients: {
        select: {
          quantity: true,
          unit: true,
          canonicalIngredient: { select: { name: true } },
        },
      },
    },
  })
  console.log("\nRECIPES:")
  console.log(JSON.stringify(recipes, null, 2))

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
