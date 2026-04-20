// scripts/smoke-recipe-cost.ts
// Phase 1 smoke test: set manual recipeUnit + costPerRecipeUnit on a few real
// canonicals, compute cost for each existing recipe, compare to foodCostOverride,
// then restore. Safe to run repeatedly. Not committed to production flow.

import fs from "fs"
import path from "path"

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return
  const content = fs.readFileSync(envPath, "utf-8")
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "")
    if (!process.env[key]) process.env[key] = val
  }
}

loadEnvLocal()

async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const { computeRecipeCost } = await import("../src/lib/recipe-cost")

  // Pre-existing recipes have ingredientName strings but no canonical FKs.
  // Temporarily bind the "Beef Ground" row of the Single Slider recipe to the
  // Ground Beef canonical, set a manual cost on that canonical, verify the
  // computation, then restore.
  const row = await prisma.recipeIngredient.findFirst({
    where: { ingredientName: "Beef Ground", recipe: { itemName: "Single Slider" } },
    select: { id: true, ingredientName: true, quantity: true, unit: true, canonicalIngredientId: true, recipeId: true },
  })
  if (!row) {
    console.log("No 'Beef Ground' row on Single Slider — skipping smoke.")
    await prisma.$disconnect()
    return
  }
  console.log(`Row: ${row.ingredientName} ${row.quantity} ${row.unit}  (canonical=${row.canonicalIngredientId ?? "-"})`)

  const canonical = await prisma.canonicalIngredient.findFirst({
    where: { name: { contains: "ground beef", mode: "insensitive" } },
    select: { id: true, name: true, recipeUnit: true, costPerRecipeUnit: true, costSource: true },
  })
  if (!canonical) {
    console.log("No ground-beef canonical found — aborting.")
    await prisma.$disconnect()
    return
  }
  console.log(`Canonical: "${canonical.name}"  unit=${canonical.recipeUnit ?? "-"}  cost=${canonical.costPerRecipeUnit ?? "-"}`)

  const origCanonical = { ...canonical }
  const origRowCanonical = row.canonicalIngredientId

  try {
    await prisma.canonicalIngredient.update({
      where: { id: canonical.id },
      data: { recipeUnit: "lb", costPerRecipeUnit: 4.37, costSource: "manual", costUpdatedAt: new Date() },
    })
    await prisma.recipeIngredient.update({
      where: { id: row.id },
      data: { canonicalIngredientId: canonical.id },
    })

    const result = await computeRecipeCost(row.recipeId)
    console.log(`\nSingle Slider cost after binding: $${result.totalCost.toFixed(4)}  partial=${result.partial}`)
    for (const ln of result.lines) {
      const cu = ln.costUnit ?? ln.unit
      if (ln.refId === canonical.id || ln.name.toLowerCase().includes("beef ground")) {
        console.log(`  → ${ln.name}: ${ln.quantity} ${ln.unit} × $${ln.unitCost?.toFixed(4)}/${cu} = $${ln.lineCost.toFixed(4)}  [${ln.costSource ?? "-"}]`)
      } else {
        console.log(`    ${ln.name}  ${ln.missingCost ? "(no cost)" : `$${ln.lineCost.toFixed(4)}`}`)
      }
    }
  } finally {
    await prisma.recipeIngredient.update({
      where: { id: row.id },
      data: { canonicalIngredientId: origRowCanonical },
    })
    await prisma.canonicalIngredient.update({
      where: { id: canonical.id },
      data: {
        recipeUnit: origCanonical.recipeUnit,
        costPerRecipeUnit: origCanonical.costPerRecipeUnit,
        costSource: origCanonical.costSource,
      },
    })
    console.log("\n(restored originals)")
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
