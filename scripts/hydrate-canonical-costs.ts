// scripts/hydrate-canonical-costs.ts
//
// For every canonical ingredient that has a matched invoice line item, derive
// its cost-per-recipe-unit from the most recent line and write it to the
// canonical. Optionally fills in `recipeUnit` from the line's base UOM when
// the canonical has none.
//
// Dry-run by default. Skips locked canonicals. Idempotent.
//
// Usage:
//   npx tsx scripts/hydrate-canonical-costs.ts                 # dry-run
//   npx tsx scripts/hydrate-canonical-costs.ts --commit         # apply
//   npx tsx scripts/hydrate-canonical-costs.ts --fill-unit      # (+) auto-set recipeUnit from baseUom when blank

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

type CliArgs = { commit: boolean; fillUnit: boolean }

function parseArgs(): CliArgs {
  let commit = false
  let fillUnit = false
  for (const arg of process.argv.slice(2)) {
    if (arg === "--commit") commit = true
    else if (arg === "--dry-run") commit = false
    else if (arg === "--fill-unit") fillUnit = true
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: npx tsx scripts/hydrate-canonical-costs.ts [--commit] [--fill-unit]\n" +
          "  --commit     apply updates (default is dry-run)\n" +
          "  --fill-unit  auto-set recipeUnit from baseUom when blank (otherwise skipped)"
      )
      process.exit(0)
    } else {
      console.error(`Unknown arg: ${arg}`)
      process.exit(1)
    }
  }
  return { commit, fillUnit }
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n - 1) + "…"
  return s.padEnd(n)
}

async function main() {
  const cli = parseArgs()
  const mode = cli.commit ? "COMMIT" : "DRY-RUN"
  console.log(`\n${mode}: hydrate canonical.costPerRecipeUnit from matched invoices\n`)
  if (cli.fillUnit) {
    console.log("  (--fill-unit enabled: will set recipeUnit from baseUom when blank)")
  }

  const { prisma } = await import("../src/lib/prisma")
  const { deriveCostFromLineItem } = await import("../src/lib/ingredient-cost")
  const { canonicalizeUnit } = await import("../src/lib/unit-conversion")

  // Canonicals that have at least one FK-linked line item, not cost-locked.
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
    },
  })
  console.log(`Found ${canonicals.length} candidate canonicals (matched + unlocked).\n`)

  const header =
    pad("canonical", 48) +
    pad("cur unit", 10) +
    pad("cur cost", 12) +
    pad("new unit", 10) +
    pad("new cost", 14) +
    "action"
  console.log(header)
  console.log("-".repeat(120))

  let toUpdate = 0
  let toFillUnit = 0
  let skippedNoUnit = 0
  let skippedNoDerive = 0
  let unchanged = 0
  let updated = 0
  let unitFilled = 0

  for (const c of canonicals) {
    // Most recent matched line for this canonical.
    const line = await prisma.invoiceLineItem.findFirst({
      where: { canonicalIngredientId: c.id, quantity: { gt: 0 } },
      orderBy: { invoice: { invoiceDate: "desc" } },
      select: {
        id: true,
        quantity: true,
        unit: true,
        packSize: true,
        unitSize: true,
        unitSizeUom: true,
        unitPrice: true,
        extendedPrice: true,
      },
    })
    if (!line) continue

    // Per-ingredient conversion from the SKU match (if any).
    const conv = await prisma.ingredientSkuMatch.findFirst({
      where: { canonicalIngredientId: c.id },
      select: { conversionFactor: true, fromUnit: true, toUnit: true },
    })

    // Decide recipeUnit for derivation: existing, or baseUom if --fill-unit.
    const baseUom = line.unitSizeUom ?? line.unit
    let targetUnit = c.recipeUnit
    let willFillUnit = false
    if (!targetUnit && cli.fillUnit && baseUom) {
      targetUnit = canonicalizeUnit(baseUom) ?? baseUom.toLowerCase()
      willFillUnit = true
      toFillUnit++
    }
    if (!targetUnit) {
      skippedNoUnit++
      console.log(
        pad(c.name, 48) +
          pad(c.recipeUnit ?? "—", 10) +
          pad(c.costPerRecipeUnit != null ? `$${c.costPerRecipeUnit.toFixed(4)}` : "—", 12) +
          pad("—", 10) +
          pad("—", 14) +
          "skip (no recipeUnit, use --fill-unit)"
      )
      continue
    }

    const derived = deriveCostFromLineItem(
      line,
      targetUnit,
      conv ? { conversionFactor: conv.conversionFactor, fromUnit: conv.fromUnit, toUnit: conv.toUnit } : undefined
    )
    if (derived == null) {
      skippedNoDerive++
      console.log(
        pad(c.name, 48) +
          pad(c.recipeUnit ?? "—", 10) +
          pad(c.costPerRecipeUnit != null ? `$${c.costPerRecipeUnit.toFixed(4)}` : "—", 12) +
          pad(targetUnit, 10) +
          pad("—", 14) +
          `skip (can't convert ${baseUom} → ${targetUnit})`
      )
      continue
    }

    const same =
      c.costPerRecipeUnit != null && Math.abs(c.costPerRecipeUnit - derived) < 1e-6 && !willFillUnit
    const action = same ? "unchanged" : willFillUnit ? "update + fill unit" : "update"
    if (same) unchanged++
    else toUpdate++

    console.log(
      pad(c.name, 48) +
        pad(c.recipeUnit ?? "—", 10) +
        pad(c.costPerRecipeUnit != null ? `$${c.costPerRecipeUnit.toFixed(4)}` : "—", 12) +
        pad(targetUnit, 10) +
        pad(`$${derived.toFixed(4)}`, 14) +
        action
    )

    if (!cli.commit) continue
    if (same) continue

    await prisma.canonicalIngredient.update({
      where: { id: c.id },
      data: {
        recipeUnit: targetUnit,
        costPerRecipeUnit: derived,
        costSource: "invoice",
        costUpdatedAt: new Date(),
      },
    })
    updated++
    if (willFillUnit) unitFilled++
  }

  console.log("\n=== SUMMARY ===")
  console.log(`  candidates:                 ${canonicals.length}`)
  console.log(`  will update cost:           ${toUpdate}`)
  console.log(`  will fill recipeUnit:       ${toFillUnit}`)
  console.log(`  unchanged (same cost):      ${unchanged}`)
  console.log(`  skipped (no recipeUnit):    ${skippedNoUnit}`)
  console.log(`  skipped (can't convert):    ${skippedNoDerive}`)
  if (cli.commit) {
    console.log(`\n  updated rows:               ${updated}`)
    console.log(`  recipeUnits filled:         ${unitFilled}`)
  } else {
    console.log(`\n(dry-run — no changes written. Re-run with --commit to apply.)`)
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
