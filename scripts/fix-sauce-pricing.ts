// scripts/fix-sauce-pricing.ts
//
// Idempotent correction for Vitco sauce SKUs:
// - 15725 is the pre-portioned 1.5 oz sauce cup, costed per each.
// - 15726 is bulk house sauce, costed per oz.
//
// Dry-run by default.
//   ./node_modules/.bin/tsx scripts/fix-sauce-pricing.ts
//   ./node_modules/.bin/tsx scripts/fix-sauce-pricing.ts --commit

import { loadEnvLocal } from "./audit/lib"

loadEnvLocal()

const COMMIT = process.argv.includes("--commit")
const VENDOR = "Vitco Foodservice"
const BULK_NAME = "chris & eddy's house sauce"
const CUP_NAME = "chris & eddy's house sauce cup 1.5 oz"
const BULK_COST_PER_OZ = 0.19765625
const CUP_COST_PER_EACH = 0.6049444444

type PrismaClient = typeof import("../src/lib/prisma").prisma

type Context = {
  ownerId: string
  accountId: string
}

function money(n: number | null | undefined): string {
  return n == null ? "-" : `$${n.toFixed(6)}`
}

async function resolveContext(prisma: PrismaClient): Promise<Context> {
  const existingBulk = await prisma.canonicalIngredient.findFirst({
    where: { name: BULK_NAME },
    select: { ownerId: true, accountId: true },
  })
  if (existingBulk) return existingBulk

  const owner = await prisma.user.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, accountId: true },
  })
  if (!owner) throw new Error("No user found to own sauce canonicals.")
  return { ownerId: owner.id, accountId: owner.accountId }
}

async function printSummary(prisma: PrismaClient, label: string, accountId: string): Promise<void> {
  const canonicals = await prisma.canonicalIngredient.findMany({
    where: { accountId, name: { in: [BULK_NAME, CUP_NAME] } },
    select: {
      name: true,
      recipeUnit: true,
      costPerRecipeUnit: true,
      costSource: true,
      costLocked: true,
      _count: { select: { invoiceLineItems: true, recipeIngredients: true, skuMatches: true } },
    },
    orderBy: { name: "asc" },
  })
  console.log(`\n${label}: canonicals`)
  for (const c of canonicals) {
    console.log(
      `  ${c.name}: ${money(c.costPerRecipeUnit)}/${c.recipeUnit ?? "-"} ` +
        `source=${c.costSource ?? "-"} locked=${c.costLocked} ` +
        `lines=${c._count.invoiceLineItems} recipes=${c._count.recipeIngredients} skus=${c._count.skuMatches}`
    )
  }

  const matches = await prisma.ingredientSkuMatch.findMany({
    where: { accountId, sku: { in: ["15725", "15726"] } },
    select: {
      vendorName: true,
      sku: true,
      conversionFactor: true,
      fromUnit: true,
      toUnit: true,
      canonicalIngredient: { select: { name: true } },
    },
    orderBy: { sku: "asc" },
  })
  console.log(`${label}: SKU matches`)
  for (const m of matches) {
    console.log(
      `  ${m.vendorName} ${m.sku} -> ${m.canonicalIngredient.name} ` +
        `(1 ${m.fromUnit} = ${m.conversionFactor} ${m.toUnit})`
    )
  }

  const recipe = await prisma.recipe.findFirst({
    where: { accountId, itemName: "Extra Chris N Eddy's Sauce" },
    select: {
      foodCostOverride: true,
      ingredients: {
        select: {
          quantity: true,
          unit: true,
          canonicalIngredient: { select: { name: true } },
          componentRecipe: { select: { itemName: true } },
        },
      },
    },
  })
  console.log(`${label}: Extra Chris N Eddy's Sauce`)
  if (!recipe) {
    console.log("  missing")
  } else {
    console.log(`  override=${money(recipe.foodCostOverride)}`)
    for (const i of recipe.ingredients) {
      console.log(
        `  ${i.quantity} ${i.unit} ${i.canonicalIngredient?.name ?? i.componentRecipe?.itemName ?? "missing-ref"}`
      )
    }
  }
}

async function main(): Promise<void> {
  const { prisma } = await import("../src/lib/prisma")
  const ctx = await resolveContext(prisma)
  const now = new Date()

  console.log(`\n${COMMIT ? "COMMIT" : "DRY-RUN"} sauce pricing correction`)
  console.log(`account=${ctx.accountId} owner=${ctx.ownerId}`)

  await printSummary(prisma, "Before", ctx.accountId)

  if (!COMMIT) {
    console.log("\nDry-run only. Re-run with --commit to apply.")
    await prisma.$disconnect()
    return
  }

  await prisma.$transaction(async (tx) => {
    const bulk = await tx.canonicalIngredient.upsert({
      where: { accountId_name: { accountId: ctx.accountId, name: BULK_NAME } },
      update: {
        recipeUnit: "oz",
        costPerRecipeUnit: BULK_COST_PER_OZ,
        costSource: "invoice",
        costLocked: false,
        costUpdatedAt: now,
      },
      create: {
        ownerId: ctx.ownerId,
        accountId: ctx.accountId,
        name: BULK_NAME,
        defaultUnit: "CS",
        recipeUnit: "oz",
        costPerRecipeUnit: BULK_COST_PER_OZ,
        costSource: "invoice",
        costLocked: false,
        costUpdatedAt: now,
      },
      select: { id: true },
    })

    const cup = await tx.canonicalIngredient.upsert({
      where: { accountId_name: { accountId: ctx.accountId, name: CUP_NAME } },
      update: {
        recipeUnit: "each",
        costPerRecipeUnit: CUP_COST_PER_EACH,
        costSource: "invoice",
        costLocked: false,
        costUpdatedAt: now,
      },
      create: {
        ownerId: ctx.ownerId,
        accountId: ctx.accountId,
        name: CUP_NAME,
        defaultUnit: "each",
        recipeUnit: "each",
        costPerRecipeUnit: CUP_COST_PER_EACH,
        costSource: "invoice",
        costLocked: false,
        costUpdatedAt: now,
      },
      select: { id: true },
    })

    await tx.ingredientSkuMatch.upsert({
      where: { accountId_vendorName_sku: { accountId: ctx.accountId, vendorName: VENDOR, sku: "15725" } },
      update: {
        ownerId: ctx.ownerId,
        canonicalIngredientId: cup.id,
        conversionFactor: 1.5,
        fromUnit: "each",
        toUnit: "oz",
        confirmedBy: ctx.ownerId,
        confirmedAt: now,
      },
      create: {
        ownerId: ctx.ownerId,
        accountId: ctx.accountId,
        vendorName: VENDOR,
        sku: "15725",
        canonicalIngredientId: cup.id,
        conversionFactor: 1.5,
        fromUnit: "each",
        toUnit: "oz",
        confirmedBy: ctx.ownerId,
      },
    })

    await tx.ingredientSkuMatch.upsert({
      where: { accountId_vendorName_sku: { accountId: ctx.accountId, vendorName: VENDOR, sku: "15726" } },
      update: {
        ownerId: ctx.ownerId,
        canonicalIngredientId: bulk.id,
        conversionFactor: 1,
        fromUnit: "lb",
        toUnit: "lb",
        confirmedBy: ctx.ownerId,
        confirmedAt: now,
      },
      create: {
        ownerId: ctx.ownerId,
        accountId: ctx.accountId,
        vendorName: VENDOR,
        sku: "15726",
        canonicalIngredientId: bulk.id,
        conversionFactor: 1,
        fromUnit: "lb",
        toUnit: "lb",
        confirmedBy: ctx.ownerId,
      },
    })

    await tx.invoiceLineItem.updateMany({
      where: { sku: "15725", invoice: { accountId: ctx.accountId } },
      data: { canonicalIngredientId: cup.id, matchSource: "sku", matchedAt: now },
    })
    await tx.invoiceLineItem.updateMany({
      where: { sku: "15726", invoice: { accountId: ctx.accountId } },
      data: { canonicalIngredientId: bulk.id, matchSource: "sku", matchedAt: now },
    })

    const recipe = await tx.recipe.upsert({
      where: {
        accountId_itemName_category: {
          accountId: ctx.accountId,
          itemName: "Extra Chris N Eddy's Sauce",
          category: "On The Side",
        },
      },
      update: {
        foodCostOverride: null,
        isSellable: true,
        notes: "Pre-portioned 1.5 oz house sauce cup. Cost follows Vitco SKU 15725 invoices.",
      },
      create: {
        ownerId: ctx.ownerId,
        accountId: ctx.accountId,
        itemName: "Extra Chris N Eddy's Sauce",
        category: "On The Side",
        servingSize: 1,
        isSellable: true,
        notes: "Pre-portioned 1.5 oz house sauce cup. Cost follows Vitco SKU 15725 invoices.",
      },
      select: { id: true },
    })

    await tx.recipeIngredient.deleteMany({ where: { recipeId: recipe.id } })
    await tx.recipeIngredient.create({
      data: {
        recipeId: recipe.id,
        canonicalIngredientId: cup.id,
        quantity: 1,
        unit: "each",
        ingredientName: "House Sauce Cup",
      },
    })
  })

  const { recomputeCanonicalCost } = await import("../src/lib/ingredient-cost")
  await recomputeCanonicalCost(
    (await prisma.canonicalIngredient.findFirstOrThrow({
      where: { accountId: ctx.accountId, name: BULK_NAME },
      select: { id: true },
    })).id
  )
  await recomputeCanonicalCost(
    (await prisma.canonicalIngredient.findFirstOrThrow({
      where: { accountId: ctx.accountId, name: CUP_NAME },
      select: { id: true },
    })).id
  )

  await printSummary(prisma, "After", ctx.accountId)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
