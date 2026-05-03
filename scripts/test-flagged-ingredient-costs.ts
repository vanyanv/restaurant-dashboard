import assert from "node:assert/strict"
import { loadEnvLocal } from "./audit/lib"

loadEnvLocal()

const HOLLYWOOD_STORE = "Chris N Eddys - Hollywood"
const PICKLE_NAME = "pickle chips sandwich cut 1/8\""
const SAUCE_LINE_ID = "cmo52brlt0025xju9q6eds5bq"
const LETTUCE_NAME = "packer lettuce boston hydroponic"
const LETTUCE_SKU = "2717106"

function approx(actual: number, expected: number, tolerance: number): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`
  )
}

async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const { getCanonicalIngredientCost } = await import("../src/lib/canonical-ingredients")
  const { computeRecipeCost } = await import("../src/lib/recipe-cost")
  const { deriveCostFromLineItem } = await import("../src/lib/ingredient-cost")

  const store = await prisma.store.findFirst({
    where: { name: HOLLYWOOD_STORE },
    select: { id: true },
  })
  assert.ok(store, `store not found: ${HOLLYWOOD_STORE}`)

  const pickle = await prisma.canonicalIngredient.findFirst({
    where: { name: PICKLE_NAME },
    select: { id: true },
  })
  assert.ok(pickle, `canonical not found: ${PICKLE_NAME}`)

  const pickleCost = await getCanonicalIngredientCost(
    pickle.id,
    new Date("2026-04-16T00:00:00.000Z"),
    { storeId: store.id }
  )
  assert.ok(pickleCost)
  approx(pickleCost.unitCost, 0.036, 0.000001)
  assert.equal(pickleCost.unit, "each")
  assert.equal(pickleCost.source, "manual")

  const addPickle = await prisma.recipe.findFirst({
    where: { itemName: "Mod: Add Pickle" },
    select: { id: true },
  })
  assert.ok(addPickle, "Mod: Add Pickle recipe not found")
  const addPickleCost = await computeRecipeCost(
    addPickle.id,
    new Date("2026-04-16T00:00:00.000Z"),
    { storeId: store.id }
  )
  approx(addPickleCost.totalCost, 0.108, 0.000001)

  const sauceLine = await prisma.invoiceLineItem.findUnique({
    where: { id: SAUCE_LINE_ID },
    select: {
      quantity: true,
      unit: true,
      packSize: true,
      unitSize: true,
      unitSizeUom: true,
      unitPrice: true,
      extendedPrice: true,
    },
  })
  assert.ok(sauceLine, "Bear State sauce line not found")
  const sauceDerived = deriveCostFromLineItem(sauceLine, "oz")
  assert.ok(sauceDerived != null)
  approx(sauceDerived, 0.1830078125, 0.000001)

  const lettuce = await prisma.canonicalIngredient.findFirst({
    where: { name: LETTUCE_NAME },
    select: { recipeUnit: true, costPerRecipeUnit: true, costSource: true, costLocked: true },
  })
  assert.ok(lettuce, `canonical not found: ${LETTUCE_NAME}`)
  assert.equal(lettuce.recipeUnit, "each")
  assert.equal(lettuce.costSource, "invoice")
  assert.equal(lettuce.costLocked, false)
  approx(lettuce.costPerRecipeUnit ?? 0, 26.89 / 112, 0.000001)

  const latestLettuce = await prisma.invoiceLineItem.findFirst({
    where: {
      sku: LETTUCE_SKU,
      canonicalIngredient: { name: LETTUCE_NAME },
      invoice: { invoiceDate: { lte: new Date("2026-05-02T00:00:00.000Z") } },
    },
    orderBy: { invoice: { invoiceDate: "desc" } },
    select: {
      quantity: true,
      unit: true,
      packSize: true,
      unitSize: true,
      unitSizeUom: true,
      unitPrice: true,
      extendedPrice: true,
    },
  })
  assert.ok(latestLettuce, "latest lettuce line not found")
  const lettuceDerived = deriveCostFromLineItem(latestLettuce, "each")
  assert.ok(lettuceDerived != null)
  approx(lettuceDerived, 26.89 / 112, 0.000001)

  await prisma.$disconnect()
  console.log("Flagged ingredient cost checks passed")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
