// scripts/audit/recipe-system.ts
//
// Read-only audit for recipe costing, canonical ingredient costs, menu mapping,
// and DailyCogsItem coverage. It does not mutate database rows.
//
// Usage:
//   ./node_modules/.bin/tsx scripts/audit/recipe-system.ts
//   ./node_modules/.bin/tsx scripts/audit/recipe-system.ts --json
//   ./node_modules/.bin/tsx scripts/audit/recipe-system.ts --strict

import { loadEnvLocal, money } from "./lib"

loadEnvLocal()

type Jsonish = Record<string, unknown>

function arg(name: string): boolean {
  return process.argv.includes(name)
}

function closeTo(actual: number | null | undefined, expected: number, tolerance: number): boolean {
  return actual != null && Math.abs(actual - expected) <= tolerance
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

function dateKey(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "-"
}

function printSection(title: string): void {
  console.log("")
  console.log(title)
  console.log("-".repeat(title.length))
}

async function main(): Promise<void> {
  const json = arg("--json")
  const strict = arg("--strict")
  const { prisma } = await import("../../src/lib/prisma")
  const { computeIngredientLineCost, computeRecipeCost } = await import("../../src/lib/recipe-cost")
  const { deriveCostFromLineItem } = await import("../../src/lib/ingredient-cost")
  const { unitsCompatible } = await import("../../src/lib/unit-conversion")

  const recipes = await prisma.recipe.findMany({
    select: { id: true, itemName: true, category: true, isSellable: true },
    orderBy: [{ category: "asc" }, { itemName: "asc" }],
  })

  const recipeResults = []
  for (const recipe of recipes) {
    const result = await computeRecipeCost(recipe.id).catch(() => null)
    recipeResults.push({
      ...recipe,
      totalCost: result?.totalCost ?? null,
      partial: result?.partial ?? true,
      lineCount: result?.lines.length ?? 0,
    })
  }
  const partialRecipes = recipeResults.filter((r) => r.partial)

  const knownChecks = []
  const doubleSlider = recipes.find((r) => r.itemName === "Double Slider")
  if (doubleSlider) {
    const result = await computeRecipeCost(doubleSlider.id).catch(() => null)
    const beefLine = result?.lines.find((line) =>
      line.name.toLowerCase().includes("ground beef")
    )
    knownChecks.push({
      name: "Double Slider beef line",
      actual: beefLine?.lineCost ?? null,
      expected: 0.8100010834,
      tolerance: 0.01,
      pass: closeTo(beefLine?.lineCost, 0.8100010834, 0.01),
    })
  }
  const twoSliderCombo = recipes.find((r) => r.itemName === "2 Slider Combo")
  if (twoSliderCombo) {
    const result = await computeRecipeCost(twoSliderCombo.id).catch(() => null)
    knownChecks.push({
      name: "2 Slider Combo total",
      actual: result?.totalCost ?? null,
      expected: 4.1194,
      tolerance: 0.02,
      pass: closeTo(result?.totalCost, 4.1194, 0.02),
    })
  }
  const coke = recipes.find((r) => r.itemName === "Coca Cola (20 oz cup)")
  if (coke) {
    const result = await computeRecipeCost(coke.id).catch(() => null)
    const syrupLine = result?.lines.find((line) =>
      line.name.toLowerCase().includes("syrup")
    )
    knownChecks.push({
      name: "Coca Cola syrup fl oz -> gal line",
      actual: syrupLine?.lineCost ?? null,
      expected: 0.1948125,
      tolerance: 0.01,
      pass: closeTo(syrupLine?.lineCost, 0.1948125, 0.01),
    })
  }

  const recipeLines = await prisma.recipeIngredient.findMany({
    where: {
      canonicalIngredientId: { not: null },
      canonicalIngredient: {
        costPerRecipeUnit: { not: null },
        recipeUnit: { not: null },
      },
    },
    select: {
      id: true,
      quantity: true,
      unit: true,
      recipe: { select: { id: true, itemName: true, category: true } },
      canonicalIngredient: {
        select: {
          id: true,
          name: true,
          recipeUnit: true,
          costPerRecipeUnit: true,
        },
      },
    },
  })

  const conversionSensitive = []
  const incompatibleUnits = []
  for (const line of recipeLines) {
    const canonical = line.canonicalIngredient
    if (!canonical?.recipeUnit || canonical.costPerRecipeUnit == null) continue
    if (!unitsCompatible(line.unit, canonical.recipeUnit)) {
      incompatibleUnits.push({
        recipe: line.recipe.itemName,
        category: line.recipe.category,
        ingredient: canonical.name,
        quantity: line.quantity,
        unit: line.unit,
        costUnit: canonical.recipeUnit,
      })
      continue
    }
    const converted = computeIngredientLineCost({
      ingredientQuantity: line.quantity,
      ingredientUnit: line.unit,
      costUnitCost: canonical.costPerRecipeUnit,
      costUnit: canonical.recipeUnit,
    })
    if (converted.qtyInCostUnit == null) continue
    const naive = line.quantity * canonical.costPerRecipeUnit
    const delta = Math.abs(naive - converted.lineCost)
    if (delta > 0.005) {
      conversionSensitive.push({
        recipe: line.recipe.itemName,
        category: line.recipe.category,
        ingredient: canonical.name,
        quantity: line.quantity,
        unit: line.unit,
        costUnit: canonical.recipeUnit,
        unitCost: canonical.costPerRecipeUnit,
        naiveLineCost: naive,
        correctLineCost: converted.lineCost,
        delta,
      })
    }
  }
  conversionSensitive.sort((a, b) => b.delta - a.delta)

  const canonicals = await prisma.canonicalIngredient.findMany({
    where: {
      costLocked: false,
      invoiceLineItems: { some: { quantity: { gt: 0 } } },
    },
    select: {
      id: true,
      name: true,
      recipeUnit: true,
      costPerRecipeUnit: true,
      costSource: true,
      invoiceLineItems: {
        where: { quantity: { gt: 0 } },
        orderBy: { invoice: { invoiceDate: "desc" } },
        take: 1,
        select: {
          id: true,
          quantity: true,
          unit: true,
          packSize: true,
          unitSize: true,
          unitSizeUom: true,
          unitPrice: true,
          extendedPrice: true,
          invoice: { select: { invoiceDate: true, vendorName: true } },
        },
      },
      skuMatches: {
        take: 1,
        select: { conversionFactor: true, fromUnit: true, toUnit: true },
      },
      _count: { select: { recipeIngredients: true } },
    },
    orderBy: { name: "asc" },
  })

  const noRecipeUnit = []
  const noDerive = []
  const hydrateUpdates = []
  for (const c of canonicals) {
    const line = c.invoiceLineItems[0]
    if (!line) continue
    if (!c.recipeUnit) {
      noRecipeUnit.push({
        name: c.name,
        latestUnit: line.unit,
        latestVendor: line.invoice.vendorName,
        latestDate: dateKey(line.invoice.invoiceDate),
        recipeUses: c._count.recipeIngredients,
      })
      continue
    }
    const conv = c.skuMatches[0]
    const derived = deriveCostFromLineItem(
      line,
      c.recipeUnit,
      conv
        ? {
            conversionFactor: conv.conversionFactor,
            fromUnit: conv.fromUnit,
            toUnit: conv.toUnit,
          }
        : undefined
    )
    if (derived == null) {
      noDerive.push({
        name: c.name,
        recipeUnit: c.recipeUnit,
        invoiceUnit: line.unit,
        unitSizeUom: line.unitSizeUom,
        latestVendor: line.invoice.vendorName,
        latestDate: dateKey(line.invoice.invoiceDate),
        recipeUses: c._count.recipeIngredients,
      })
      continue
    }
    const current = c.costPerRecipeUnit
    if (current == null || Math.abs(current - derived) > 1e-6) {
      hydrateUpdates.push({
        name: c.name,
        recipeUnit: c.recipeUnit,
        currentCost: current,
        derivedCost: derived,
        delta: current == null ? derived : Math.abs(current - derived),
        latestVendor: line.invoice.vendorName,
        latestDate: dateKey(line.invoice.invoiceDate),
        recipeUses: c._count.recipeIngredients,
      })
    }
  }
  hydrateUpdates.sort((a, b) => b.delta - a.delta)

  const cogsStatus = await prisma.dailyCogsItem.groupBy({
    by: ["status"],
    _count: { _all: true },
    _sum: { salesRevenue: true, lineCost: true },
  })

  const missingCogsRows = await prisma.dailyCogsItem.groupBy({
    by: ["storeId", "itemName", "category"],
    where: { status: "MISSING_COST" },
    _count: { _all: true },
    _sum: { qtySold: true, salesRevenue: true, lineCost: true },
    orderBy: { _sum: { salesRevenue: "desc" } },
    take: 20,
  })

  const since = new Date()
  since.setUTCHours(0, 0, 0, 0)
  since.setUTCDate(since.getUTCDate() - 30)

  const recentSales = await prisma.otterMenuItem.groupBy({
    by: ["storeId", "itemName", "category"],
    where: {
      isModifier: false,
      date: { gte: since },
    },
    _sum: {
      fpQuantitySold: true,
      tpQuantitySold: true,
      fpTotalSales: true,
      tpTotalSales: true,
    },
    orderBy: { _sum: { fpTotalSales: "desc" } },
    take: 500,
  })
  const mappings = await prisma.otterItemMapping.findMany({
    select: { storeId: true, otterItemName: true, recipeId: true },
  })
  const mappingKeys = new Set(
    mappings.map((m) => `${m.storeId}::${m.otterItemName.toLowerCase()}`)
  )
  const unmappedSales = recentSales
    .filter((r) => !mappingKeys.has(`${r.storeId}::${r.itemName.toLowerCase()}`))
    .map((r) => ({
      storeId: r.storeId,
      itemName: r.itemName,
      category: r.category,
      qtySold: (r._sum.fpQuantitySold ?? 0) + (r._sum.tpQuantitySold ?? 0),
      salesRevenue: (r._sum.fpTotalSales ?? 0) + (r._sum.tpTotalSales ?? 0),
    }))
    .sort((a, b) => b.salesRevenue - a.salesRevenue)
    .slice(0, 20)

  const report: Jsonish = {
    generatedAt: new Date().toISOString(),
    recipes: {
      total: recipes.length,
      partial: partialRecipes.length,
      partialRecipes,
      knownChecks,
    },
    conversionSensitiveLines: conversionSensitive,
    incompatibleRecipeCostUnits: incompatibleUnits,
    canonicalCostHydration: {
      noRecipeUnit,
      noDerive,
      updateCandidates: hydrateUpdates,
    },
    dailyCogs: {
      status: cogsStatus,
      topMissingCostRows: missingCogsRows,
    },
    menuMapping: {
      lookbackDays: 30,
      topUnmappedSales: unmappedSales,
    },
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  console.log(`Recipe system audit - ${new Date().toISOString()}`)
  printSection("Recipe Costs")
  console.log(`Recipes: ${recipes.length}`)
  console.log(`Partial / missing-cost recipes: ${partialRecipes.length}`)
  console.log("Known regression checks:")
  for (const check of knownChecks) {
    console.log(
      `- ${check.pass ? "PASS" : "FAIL"} ${check.name}: ` +
        `${money(check.actual)} expected ${money(check.expected)}`
    )
  }
  for (const r of partialRecipes.slice(0, 10)) {
    console.log(`- ${r.itemName} [${r.category}] total=${money(r.totalCost)}`)
  }

  printSection("Conversion-Sensitive Lines")
  console.log(`Lines where naive quantity * unit cost would be wrong: ${conversionSensitive.length}`)
  for (const r of conversionSensitive.slice(0, 15)) {
    console.log(
      `- ${r.recipe} / ${r.ingredient}: ${r.quantity} ${r.unit} at ` +
        `${money(r.unitCost)}/${r.costUnit} = ${money(r.correctLineCost)} ` +
        `(naive ${money(r.naiveLineCost)}, delta ${money(r.delta)})`
    )
  }
  console.log(`Incompatible recipe/cost unit lines: ${incompatibleUnits.length}`)

  printSection("Canonical Cost Hydration")
  console.log(`Invoice-backed canonicals missing recipeUnit: ${noRecipeUnit.length}`)
  for (const c of noRecipeUnit.slice(0, 10)) {
    console.log(`- ${c.name}: latest unit ${c.latestUnit ?? "-"}, vendor ${c.latestVendor}, recipes ${c.recipeUses}`)
  }
  console.log(`Canonicals that cannot derive latest invoice cost: ${noDerive.length}`)
  for (const c of noDerive.slice(0, 10)) {
    console.log(`- ${c.name}: invoice ${c.invoiceUnit ?? "-"} / size ${c.unitSizeUom ?? "-"} -> recipe ${c.recipeUnit}`)
  }
  console.log(`Hydration update candidates: ${hydrateUpdates.length}`)
  for (const c of hydrateUpdates.slice(0, 10)) {
    console.log(`- ${c.name}: ${money(c.currentCost)} -> ${money(c.derivedCost)} / ${c.recipeUnit}`)
  }

  printSection("Daily COGS")
  for (const row of cogsStatus) {
    console.log(
      `- ${row.status}: ${row._count._all} rows, ` +
        `sales ${money(row._sum.salesRevenue)}, cogs ${money(row._sum.lineCost)}`
    )
  }
  console.log("Top MISSING_COST rows:")
  for (const row of missingCogsRows.slice(0, 10)) {
    const revenue = row._sum.salesRevenue ?? 0
    console.log(`- ${row.itemName} [${row.category}]: ${row._count._all} rows, revenue ${money(revenue)}`)
  }

  printSection("Menu Mapping")
  console.log(`Top unmapped sales rows over last 30 days: ${unmappedSales.length}`)
  for (const row of unmappedSales.slice(0, 10)) {
    const avg = row.qtySold > 0 ? row.salesRevenue / row.qtySold : 0
    console.log(
      `- ${row.itemName} [${row.category}]: ${row.qtySold.toLocaleString()} sold, ` +
        `${money(row.salesRevenue)} revenue, avg ${money(avg)}`
    )
  }

  const totalCogsSales = cogsStatus.reduce((sum, row) => sum + (row._sum.salesRevenue ?? 0), 0)
  const missingSales =
    cogsStatus.find((row) => row.status === "MISSING_COST")?._sum.salesRevenue ?? 0
  printSection("Summary")
  console.log(`Recipe system food-cost coverage: ${partialRecipes.length === 0 ? "all recipes costed" : "partial recipes need review"}`)
  console.log(`Daily COGS missing-cost revenue share: ${totalCogsSales > 0 ? pct(missingSales / totalCogsSales) : "0.0%"}`)
  console.log("This script is read-only. Review findings before applying DB corrections.")

  if (strict) {
    const failed = knownChecks.filter((check) => !check.pass)
    if (partialRecipes.length > 0 || incompatibleUnits.length > 0 || failed.length > 0) {
      throw new Error(
        `Strict recipe audit failed: ${partialRecipes.length} partial recipes, ` +
          `${incompatibleUnits.length} incompatible unit lines, ${failed.length} failed known checks`
      )
    }
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    const { prisma } = await import("../../src/lib/prisma")
    await prisma.$disconnect()
  })
