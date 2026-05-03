import assert from "node:assert/strict"
import { loadEnvLocal } from "./audit/lib"
import { CogsStatus } from "@/generated/prisma/client"
import type { RecipeCostResult } from "@/lib/recipe-cost"
import type { ModifierUsage } from "@/lib/cogs-materializer"

const date = new Date("2026-05-01T00:00:00.000Z")
const storeId = "store_test"

function cost(totalCost: number, partial = false): RecipeCostResult {
  return {
    recipeId: "recipe",
    itemName: "Recipe",
    totalCost,
    partial,
    lines: [],
    asOf: date,
  }
}

async function main() {
  loadEnvLocal()
  const { computeFoodCogsRows } = await import("@/lib/cogs-materializer")

  const mappingByName = new Map([
    ["Mapped", "recipe_mapped"],
    ["No Cost", "recipe_no_cost"],
    ["Split Item", "recipe_split"],
  ])
  const recipeByName = new Map<string, string>()
  const modifierUsageByItem = new Map<string, ModifierUsage>([
    [
      "Split Item",
      {
        extraLineCost: 8,
        missingMappings: false,
        breakdown: [{ skuId: "mod_1", name: "Add Cheese", uses: 4, unitCost: 2 }],
      },
    ],
  ])

  const rows = await computeFoodCogsRows({
    storeId,
    date,
    mappingByName,
    recipeByName,
    modifierUsageByItem,
    menuRows: [
      {
        itemName: "Mapped",
        category: "Entrees",
        fpQuantitySold: 2,
        tpQuantitySold: 0,
        fpTotalSales: 20,
        tpTotalSales: 0,
      },
      {
        itemName: "Unmapped",
        category: "Entrees",
        fpQuantitySold: 1,
        tpQuantitySold: 0,
        fpTotalSales: 10,
        tpTotalSales: 0,
      },
      {
        itemName: "No Cost",
        category: "Entrees",
        fpQuantitySold: 3,
        tpQuantitySold: 0,
        fpTotalSales: 30,
        tpTotalSales: 0,
      },
      {
        itemName: "Split Item",
        category: "A",
        fpQuantitySold: 1,
        tpQuantitySold: 0,
        fpTotalSales: 10,
        tpTotalSales: 0,
      },
      {
        itemName: "Split Item",
        category: "B",
        fpQuantitySold: 3,
        tpQuantitySold: 0,
        fpTotalSales: 30,
        tpTotalSales: 0,
      },
    ],
    costFor: async (recipeId) => {
      if (recipeId === "recipe_mapped") return cost(5)
      if (recipeId === "recipe_no_cost") return cost(0, true)
      if (recipeId === "recipe_split") return cost(2)
      return null
    },
  })

  const mapped = rows.find((row) => row.itemName === "Mapped")
  assert.equal(mapped?.status, CogsStatus.COSTED)
  assert.equal(mapped?.lineCost, 10)
  assert.equal(mapped?.unitCost, 5)

  const unmapped = rows.find((row) => row.itemName === "Unmapped")
  assert.equal(unmapped?.status, CogsStatus.UNMAPPED)
  assert.equal(unmapped?.lineCost, 0)
  assert.equal(unmapped?.salesRevenue, 10)

  const missing = rows.find((row) => row.itemName === "No Cost")
  assert.equal(missing?.status, CogsStatus.MISSING_COST)
  assert.equal(missing?.lineCost, 0)
  assert.equal(missing?.partialCost, true)

  const split = rows.filter((row) => row.itemName === "Split Item")
  assert.equal(split.length, 2)
  assert.equal(split.reduce((acc, row) => acc + row.lineCost, 0), 16)
  assert.equal(split.find((row) => row.category === "A")?.lineCost, 4)
  assert.equal(split.find((row) => row.category === "B")?.lineCost, 12)

  console.log("COGS materializer logic checks passed")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
