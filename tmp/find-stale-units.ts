import { loadEnvLocal } from "../scripts/audit/lib"
loadEnvLocal()

async function main() {
  const { prisma } = await import("../src/lib/prisma")

  // Find all recipe ingredients referencing our 3 canonicals
  const targets = [
    { name: "packer lettuce boston hydroponic", expectedUnit: "leaf" },
    { name: 'pickle chips sandwich cut 1/8"', expectedUnit: "chip" },
    { name: "peppers whole yellow", expectedUnit: "each" },
  ]

  for (const t of targets) {
    const c = await prisma.canonicalIngredient.findFirst({
      where: { name: t.name },
      select: { id: true },
    })
    if (!c) {
      console.log(`[SKIP] no canonical: ${t.name}`)
      continue
    }
    const rows = await prisma.recipeIngredient.findMany({
      where: { canonicalIngredientId: c.id },
      select: {
        id: true,
        quantity: true,
        unit: true,
        recipe: { select: { itemName: true, category: true } },
      },
    })
    console.log(`\n== ${t.name} (expected unit: ${t.expectedUnit}) ==`)
    for (const r of rows) {
      const stale = r.unit.toLowerCase() !== t.expectedUnit.toLowerCase()
      console.log(
        `  ${stale ? "STALE" : "ok   "}  ${r.quantity} ${r.unit.padEnd(6)}  ${r.recipe.itemName} [${r.recipe.category}]`
      )
    }
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
