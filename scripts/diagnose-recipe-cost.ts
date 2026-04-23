// scripts/diagnose-recipe-cost.ts
//
// Read-only diagnostic for the recipe cost pipeline.
//
//   pnpm tsx scripts/diagnose-recipe-cost.ts "Chris N Eddy's Double Slider"
//   pnpm tsx scripts/diagnose-recipe-cost.ts           # audit all sellable recipes
//
// For a single recipe: dumps every ingredient with canonical unit / cost / source
// and the latest matched invoice line shape. For the audit: flags any recipe
// whose computed cost deviates from foodCostOverride by > max($0.50, 50%).

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

function money(n: number | null | undefined, decimals = 4): string {
  if (n == null) return "—"
  return `$${n.toFixed(decimals)}`
}

async function diagnoseOne(recipeName: string) {
  const { prisma } = await import("../src/lib/prisma")
  const { computeRecipeCost } = await import("../src/lib/recipe-cost")

  const recipe = await prisma.recipe.findFirst({
    where: { itemName: { contains: recipeName, mode: "insensitive" } },
    select: {
      id: true,
      itemName: true,
      servingSize: true,
      foodCostOverride: true,
      ownerId: true,
      ingredients: {
        select: {
          id: true,
          ingredientName: true,
          quantity: true,
          unit: true,
          canonicalIngredientId: true,
          componentRecipeId: true,
          canonicalIngredient: {
            select: {
              id: true,
              name: true,
              recipeUnit: true,
              costPerRecipeUnit: true,
              costSource: true,
              costUpdatedAt: true,
            },
          },
          componentRecipe: { select: { id: true, itemName: true } },
        },
      },
    },
  })

  if (!recipe) {
    console.log(`No recipe matching "${recipeName}".`)
    await prisma.$disconnect()
    return
  }

  console.log(`\n=== ${recipe.itemName} (id=${recipe.id}) ===`)
  console.log(`servingSize=${recipe.servingSize}  foodCostOverride=${money(recipe.foodCostOverride)}`)
  console.log("")

  // Per-ingredient deep dive with latest invoice line.
  for (const ing of recipe.ingredients) {
    const label = ing.ingredientName ?? ing.canonicalIngredient?.name ?? ing.componentRecipe?.itemName ?? "?"
    console.log(`• ${label}  qty=${ing.quantity} unit="${ing.unit}"`)

    if (ing.componentRecipeId) {
      const sub = await computeRecipeCost(ing.componentRecipeId).catch((e) => {
        console.log(`    sub-recipe failed: ${e}`)
        return null
      })
      if (sub) {
        console.log(`    ↳ sub-recipe "${sub.itemName}" totalCost=${money(sub.totalCost)}  partial=${sub.partial}`)
        console.log(`    ↳ sub-line cost = ${money(sub.totalCost * ing.quantity)}`)
      }
      continue
    }

    if (!ing.canonicalIngredientId || !ing.canonicalIngredient) {
      console.log(`    ⚠ no canonical link`)
      continue
    }

    const c = ing.canonicalIngredient
    console.log(
      `    canonical: "${c.name}"  recipeUnit="${c.recipeUnit ?? "—"}"  costPerRecipeUnit=${money(c.costPerRecipeUnit)} source=${c.costSource ?? "—"}`
    )

    const line = await prisma.invoiceLineItem.findFirst({
      where: { canonicalIngredientId: c.id, quantity: { gt: 0 } },
      orderBy: { invoice: { invoiceDate: "desc" } },
      select: {
        productName: true,
        quantity: true,
        unit: true,
        packSize: true,
        unitSize: true,
        unitSizeUom: true,
        unitPrice: true,
        extendedPrice: true,
        invoice: { select: { vendorName: true, invoiceDate: true } },
      },
    })
    if (line) {
      console.log(
        `    latest invoice: ${line.invoice.vendorName} ${line.invoice.invoiceDate?.toISOString().slice(0, 10) ?? "—"} "${line.productName}"`
      )
      console.log(
        `      qty=${line.quantity} unit="${line.unit ?? "—"}" packSize=${line.packSize ?? "—"} unitSize=${line.unitSize ?? "—"} unitSizeUom="${line.unitSizeUom ?? "—"}" unitPrice=${money(line.unitPrice)} extendedPrice=${money(line.extendedPrice)}`
      )
    } else {
      console.log(`    (no matched invoice line)`)
    }
  }

  // Now compute via the real pipeline and show per-line result.
  console.log("\n--- computeRecipeCost() result ---")
  const result = await computeRecipeCost(recipe.id)
  console.log(`total=${money(result.totalCost, 2)}  partial=${result.partial}`)
  console.log(`override=${money(recipe.foodCostOverride, 2)}`)
  const diff = recipe.foodCostOverride != null ? result.totalCost - recipe.foodCostOverride : null
  if (diff != null) {
    const pct = recipe.foodCostOverride !== 0 ? (diff / recipe.foodCostOverride) * 100 : 0
    console.log(`Δ vs override: ${money(diff, 2)}  (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)`)
  }
  console.log("")
  for (const ln of result.lines) {
    const uc = ln.unitCost != null ? money(ln.unitCost) : "—"
    const cu = ln.costUnit ?? ln.unit
    console.log(
      `  ${ln.missingCost ? "✗" : "✓"} ${ln.name}  ${ln.quantity} ${ln.unit} × ${uc}/${cu} = ${money(ln.lineCost, 4)}${ln.costSource ? ` [${ln.costSource}]` : ""}`
    )
  }

  await prisma.$disconnect()
}

async function auditAll() {
  const { prisma } = await import("../src/lib/prisma")
  const { batchRecipeCosts } = await import("../src/lib/recipe-cost-batch")

  // Pick the sole owner / first owner — we expect a single-tenant DB here, but
  // if there are multiple we audit each one.
  const owners = await prisma.recipe.groupBy({
    by: ["ownerId"],
    _count: { _all: true },
  })
  if (owners.length === 0) {
    console.log("No recipes in DB.")
    await prisma.$disconnect()
    return
  }

  for (const o of owners) {
    console.log(`\n=== Owner ${o.ownerId}  (${o._count._all} recipes) ===`)
    const costs = await batchRecipeCosts(o.ownerId)
    const recipes = await prisma.recipe.findMany({
      where: { ownerId: o.ownerId, isSellable: true },
      select: { id: true, itemName: true, foodCostOverride: true },
      orderBy: { itemName: "asc" },
    })

    type Flag = { name: string; computed: number; override: number | null; partial: boolean; diff: number; pct: number }
    const flags: Flag[] = []

    for (const r of recipes) {
      const c = costs.get(r.id)
      if (!c) continue
      const override = r.foodCostOverride
      const threshold = Math.max(0.5, (override ?? 0) * 0.5)
      if (override == null) {
        if (c.totalCost === 0) {
          flags.push({ name: r.itemName, computed: 0, override: null, partial: c.partial, diff: 0, pct: 0 })
        }
        continue
      }
      const diff = c.totalCost - override
      if (Math.abs(diff) > threshold) {
        flags.push({ name: r.itemName, computed: c.totalCost, override, partial: c.partial, diff, pct: override !== 0 ? (diff / override) * 100 : 0 })
      }
    }

    if (flags.length === 0) {
      console.log("✓ All sellable recipes within ±50% / ±$0.50 of foodCostOverride.")
    } else {
      console.log(`⚠ ${flags.length} recipe(s) flagged:\n`)
      flags.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
      console.log("  RECIPE".padEnd(48) + "COMPUTED".padStart(12) + "OVERRIDE".padStart(12) + "Δ".padStart(12) + "  PARTIAL")
      for (const f of flags) {
        console.log(
          "  " + f.name.padEnd(46).slice(0, 46) +
          money(f.computed, 2).padStart(12) +
          money(f.override, 2).padStart(12) +
          money(f.diff, 2).padStart(12) +
          "  " + (f.partial ? "yes" : "no") +
          (f.override != null && f.override !== 0 ? `   (${f.pct >= 0 ? "+" : ""}${f.pct.toFixed(0)}%)` : "")
        )
      }
    }
  }

  await prisma.$disconnect()
}

async function main() {
  const arg = process.argv[2]
  if (arg) {
    await diagnoseOne(arg)
  } else {
    await auditAll()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
