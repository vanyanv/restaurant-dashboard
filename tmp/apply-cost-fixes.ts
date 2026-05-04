// Focused patch for the lettuce + pickle + chilli cost fixes.
// authoring-session.ts has unrelated downstream issues that prevent it from
// running cleanly today; this script applies only the planned canonical/recipe
// updates idempotently via direct prisma writes.
//
// Usage:
//   ./node_modules/.bin/tsx tmp/apply-cost-fixes.ts            # dry run
//   ./node_modules/.bin/tsx tmp/apply-cost-fixes.ts --commit   # apply

import { loadEnvLocal } from "../scripts/audit/lib"
loadEnvLocal()

const COMMIT = process.argv.includes("--commit")

type CanonicalUpdate = {
  name: string
  recipeUnit: string
  costPerRecipeUnit: number
  reason: string
}

const CANONICAL_UPDATES: CanonicalUpdate[] = [
  {
    name: "packer lettuce boston hydroponic",
    recipeUnit: "leaf",
    costPerRecipeUnit: 0.149,
    reason: "Sysco 12-count case @ $26.89 = $2.24/head; 15 usable leaves/head → $0.149/leaf.",
  },
  {
    name: 'pickle chips sandwich cut 1/8"',
    recipeUnit: "chip",
    costPerRecipeUnit: 0.018,
    reason: "Premier Deli 5-gal pail @ $36 / 2000 sandwich-cut chips = $0.018/chip.",
  },
  {
    name: "peppers whole yellow",
    recipeUnit: "each",
    costPerRecipeUnit: 0.0611,
    reason: "5-gal bucket ≈ 800 chilies (owner-revised) @ $48.85 → $0.0611/chili.",
  },
]

type RecipeIngredientUpdate = {
  recipeItemName: string
  recipeCategory: string
  canonicalName: string
  newQuantity: number
  newUnit: string
}

const RECIPE_INGREDIENT_UPDATES: RecipeIngredientUpdate[] = [
  {
    recipeItemName: "Mod: Add Lettuce",
    recipeCategory: "Modifier",
    canonicalName: "packer lettuce boston hydroponic",
    newQuantity: 1,
    newUnit: "leaf",
  },
  {
    recipeItemName: "Mod: Add Pickle",
    recipeCategory: "Modifier",
    canonicalName: 'pickle chips sandwich cut 1/8"',
    newQuantity: 3,
    newUnit: "chip",
  },
  {
    recipeItemName: "Mod: Extra Pickles",
    recipeCategory: "Modifier",
    canonicalName: 'pickle chips sandwich cut 1/8"',
    newQuantity: 2.5,
    newUnit: "chip",
  },
]

async function main() {
  const { prisma } = await import("../src/lib/prisma")

  console.log(`apply-cost-fixes — ${COMMIT ? "COMMIT" : "DRY RUN"}\n`)

  // ---- Canonicals ----
  console.log("== Canonicals ==")
  for (const u of CANONICAL_UPDATES) {
    const c = await prisma.canonicalIngredient.findFirst({
      where: { name: u.name },
      select: {
        id: true,
        recipeUnit: true,
        costPerRecipeUnit: true,
        costSource: true,
        costLocked: true,
      },
    })
    if (!c) {
      console.log(`  [SKIP] not found: ${u.name}`)
      continue
    }
    console.log(`  ${u.name}`)
    console.log(
      `    before: unit=${c.recipeUnit ?? "-"}  cost=${c.costPerRecipeUnit ?? "-"}  source=${c.costSource ?? "-"}  locked=${c.costLocked}`
    )
    console.log(
      `    after:  unit=${u.recipeUnit}  cost=$${u.costPerRecipeUnit}  source=manual  locked=true`
    )
    console.log(`    why:    ${u.reason}`)
    if (COMMIT) {
      await prisma.canonicalIngredient.update({
        where: { id: c.id },
        data: {
          recipeUnit: u.recipeUnit,
          costPerRecipeUnit: u.costPerRecipeUnit,
          costSource: "manual",
          costLocked: true,
          costUpdatedAt: new Date(),
        },
      })
    }
  }

  // ---- Recipe ingredient unit/qty updates ----
  console.log("\n== Recipe ingredient unit/qty ==")
  for (const u of RECIPE_INGREDIENT_UPDATES) {
    const recipe = await prisma.recipe.findFirst({
      where: { itemName: u.recipeItemName, category: u.recipeCategory },
      select: { id: true },
    })
    if (!recipe) {
      console.log(`  [SKIP] recipe not found: ${u.recipeItemName} [${u.recipeCategory}]`)
      continue
    }
    const canonical = await prisma.canonicalIngredient.findFirst({
      where: { name: u.canonicalName },
      select: { id: true },
    })
    if (!canonical) {
      console.log(`  [SKIP] canonical not found: ${u.canonicalName}`)
      continue
    }
    const ri = await prisma.recipeIngredient.findFirst({
      where: { recipeId: recipe.id, canonicalIngredientId: canonical.id },
      select: { id: true, quantity: true, unit: true },
    })
    if (!ri) {
      console.log(
        `  [SKIP] no ingredient row: ${u.recipeItemName} → ${u.canonicalName}`
      )
      continue
    }
    console.log(`  ${u.recipeItemName} → ${u.canonicalName}`)
    console.log(`    before: ${ri.quantity} ${ri.unit}`)
    console.log(`    after:  ${u.newQuantity} ${u.newUnit}`)
    if (COMMIT) {
      await prisma.recipeIngredient.update({
        where: { id: ri.id },
        data: { quantity: u.newQuantity, unit: u.newUnit },
      })
    }
  }

  // ---- IngredientSkuMatch updates / inserts ----
  console.log("\n== SKU matches ==")
  type SkuMatchUpdate = {
    sku: string
    productNameHint: string
    canonicalName: string
    fromUnit: string
    toUnit: string
    conversionFactor: number
    basis: string
  }
  const SKU_UPDATES: SkuMatchUpdate[] = [
    {
      sku: "G299",
      productNameHint: "peppers whole yellow",
      canonicalName: "peppers whole yellow",
      fromUnit: "GAL",
      toUnit: "each",
      conversionFactor: 160,
      basis: "Peppers Whole Yellow: 5-gal tub ≈ 800 chillies, so 160 chillies/gal.",
    },
    {
      sku: "2717106",
      productNameHint: "packer lettuce boston hydroponic",
      canonicalName: "packer lettuce boston hydroponic",
      fromUnit: "each",
      toUnit: "leaf",
      conversionFactor: 15,
      basis: "Sysco 12-count case = 12 heads; ~15 usable leaves per head.",
    },
    {
      sku: "813",
      productNameHint: "pickle chips sandwich cut",
      canonicalName: 'pickle chips sandwich cut 1/8"',
      fromUnit: "each",
      toUnit: "chip",
      conversionFactor: 2000,
      basis: "Premier Deli 5-gal sandwich-cut pickle pail ≈ 2000 chips per container.",
    },
  ]
  for (const u of SKU_UPDATES) {
    const canonical = await prisma.canonicalIngredient.findFirst({
      where: { name: u.canonicalName },
      select: { id: true, ownerId: true, accountId: true },
    })
    if (!canonical) {
      console.log(`  [SKIP] canonical not found: ${u.canonicalName}`)
      continue
    }
    const matches = await prisma.ingredientSkuMatch.findMany({
      where: { sku: u.sku, canonicalIngredientId: canonical.id },
      select: {
        id: true,
        vendorName: true,
        fromUnit: true,
        toUnit: true,
        conversionFactor: true,
      },
    })
    if (matches.length === 0) {
      console.log(`  ${u.sku} (${u.canonicalName}): NO existing match — creating one`)
      console.log(
        `    new: ${u.fromUnit} → ${u.toUnit}  factor=${u.conversionFactor}  [${u.basis}]`
      )
      if (COMMIT) {
        await prisma.ingredientSkuMatch.create({
          data: {
            ownerId: canonical.ownerId,
            accountId: canonical.accountId,
            vendorName: u.sku === "2717106" ? "Sysco" : "Premier Deli Services, Inc.",
            sku: u.sku,
            canonicalIngredientId: canonical.id,
            fromUnit: u.fromUnit,
            toUnit: u.toUnit,
            conversionFactor: u.conversionFactor,
            confirmedBy: canonical.ownerId,
            confirmedAt: new Date(),
          },
        })
      }
      continue
    }
    for (const m of matches) {
      const changed =
        Math.abs(m.conversionFactor - u.conversionFactor) > 1e-9 ||
        m.fromUnit.toLowerCase() !== u.fromUnit.toLowerCase() ||
        m.toUnit.toLowerCase() !== u.toUnit.toLowerCase()
      console.log(`  ${u.sku} @ ${m.vendorName}`)
      console.log(
        `    before: ${m.fromUnit} → ${m.toUnit}  factor=${m.conversionFactor}`
      )
      console.log(
        `    after:  ${u.fromUnit} → ${u.toUnit}  factor=${u.conversionFactor}  ${changed ? "(updating)" : "(no change)"}`
      )
      if (changed && COMMIT) {
        await prisma.ingredientSkuMatch.update({
          where: { id: m.id },
          data: {
            fromUnit: u.fromUnit,
            toUnit: u.toUnit,
            conversionFactor: u.conversionFactor,
            confirmedAt: new Date(),
          },
        })
      }
    }
  }

  console.log(`\nDone — ${COMMIT ? "COMMITTED" : "DRY RUN (re-run with --commit to apply)"}.`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
