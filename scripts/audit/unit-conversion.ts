// Unit-conversion audit.
//
// Exercises src/lib/unit-conversion.ts against every distinct (fromUom, toUom)
// pair that actually appears in the data:
//   - (RecipeIngredient.unit) × (CanonicalIngredient.recipeUnit) — used by recipe-cost
//   - (InvoiceLineItem.{unit, unitSizeUom}) × (CanonicalIngredient.recipeUnit) — used by deriveCostFromLineItem
//
// Flags:
//   - pair falls through to per-ingredient conversionFactor but none configured
//   - pair is cross-category (mass ↔ volume) without a conversionFactor
//   - round-trip error convert(1, A→B→A) − 1 > 0.01 (only within-category)

import { loadEnvLocal, type Finding } from "./lib"

loadEnvLocal()

export async function auditUnitConversion(): Promise<Finding[]> {
  const { prisma } = await import("../../src/lib/prisma")
  const { canonicalizeUnit, convert, unitsCompatible } = await import(
    "../../src/lib/unit-conversion"
  )
  const findings: Finding[] = []

  // ── Pair 1: recipe → canonical ────────────────────────────────────────
  const recipeRows = await prisma.recipeIngredient.findMany({
    where: { canonicalIngredientId: { not: null } },
    select: {
      unit: true,
      canonicalIngredientId: true,
      canonicalIngredient: { select: { id: true, name: true, recipeUnit: true, ownerId: true } },
      recipe: { select: { id: true, itemName: true } },
    },
  })

  // Build lookup for per-canonical IngredientSkuMatch conversionFactors.
  const skuMatches = await prisma.ingredientSkuMatch.findMany({
    select: { canonicalIngredientId: true, fromUnit: true, toUnit: true, conversionFactor: true },
  })
  const hasConv = new Set(skuMatches.map((m) => m.canonicalIngredientId))

  type PairStats = {
    from: string
    to: string
    category: "same" | "cross" | "unknown"
    sampleRecipe: string | null
    sampleCanonical: string | null
    canonicalIds: Set<string>
    recipeCount: number
    anyMissingConv: boolean
  }
  const pairs = new Map<string, PairStats>()

  for (const r of recipeRows) {
    const c = r.canonicalIngredient
    if (!c || !c.recipeUnit) continue
    const from = r.unit.trim().toLowerCase()
    const to = c.recipeUnit.trim().toLowerCase()
    if (from === to) continue

    const key = `${from}→${to}`
    let stats = pairs.get(key)
    if (!stats) {
      const canFrom = canonicalizeUnit(from)
      const canTo = canonicalizeUnit(to)
      const category: "same" | "cross" | "unknown" =
        canFrom && canTo ? (unitsCompatible(from, to) ? "same" : "cross") : "unknown"
      stats = {
        from,
        to,
        category,
        sampleRecipe: r.recipe.itemName,
        sampleCanonical: c.name,
        canonicalIds: new Set(),
        recipeCount: 0,
        anyMissingConv: false,
      }
      pairs.set(key, stats)
    }
    stats.recipeCount++
    stats.canonicalIds.add(c.id)
    if (!hasConv.has(c.id)) stats.anyMissingConv = true
  }

  for (const [, p] of pairs) {
    // Cross-category without a per-canonical conversion = broken path; every
    // recipe using this will get lineCost=0 and partial=true.
    if (p.category === "cross" && p.anyMissingConv) {
      findings.push({
        domain: "unit-conversion",
        check: "cross_category_no_conversion",
        severity: "CRITICAL",
        message: `${p.from} → ${p.to} used by ${p.recipeCount} recipe line(s) (e.g. "${p.sampleRecipe}" / ${p.sampleCanonical}) but units are different categories and ${p.canonicalIds.size - [...p.canonicalIds].filter((id) => hasConv.has(id)).length} canonical(s) have no conversionFactor`,
        entity: { kind: "unitPair", id: `${p.from}→${p.to}`, label: `${p.from}→${p.to}` },
        details: {
          pair: `${p.from}→${p.to}`,
          category: p.category,
          recipeLineCount: p.recipeCount,
          canonicalCount: p.canonicalIds.size,
          sampleRecipe: p.sampleRecipe,
          sampleCanonical: p.sampleCanonical,
        },
        deltaDollars: p.recipeCount,
      })
      continue
    }

    if (p.category === "unknown") {
      findings.push({
        domain: "unit-conversion",
        check: "unknown_unit",
        severity: "WARNING",
        message: `${p.from} → ${p.to}: at least one side is not a recognized unit (used by ${p.recipeCount} recipe line(s))`,
        entity: { kind: "unitPair", id: `${p.from}→${p.to}`, label: `${p.from}→${p.to}` },
        details: {
          pair: `${p.from}→${p.to}`,
          recipeLineCount: p.recipeCount,
          sampleRecipe: p.sampleRecipe,
          sampleCanonical: p.sampleCanonical,
          fromCanonical: canonicalizeUnit(p.from),
          toCanonical: canonicalizeUnit(p.to),
        },
        deltaDollars: p.recipeCount,
      })
      continue
    }

    // Within-category: check round-trip error.
    if (p.category === "same") {
      const fwd = convert(1, p.from, p.to)
      if (fwd == null) continue
      const back = convert(fwd, p.to, p.from)
      if (back == null) continue
      const err = Math.abs(back - 1)
      if (err > 0.01) {
        findings.push({
          domain: "unit-conversion",
          check: "round_trip_error",
          severity: "WARNING",
          message: `${p.from} ↔ ${p.to} round-trip error ${(err * 100).toFixed(2)}% (${p.recipeCount} recipe line(s) affected)`,
          entity: { kind: "unitPair", id: `${p.from}↔${p.to}`, label: `${p.from}↔${p.to}` },
          details: { pair: `${p.from}↔${p.to}`, forward: fwd, backward: back, error: err, recipeLineCount: p.recipeCount },
          deltaDollars: p.recipeCount,
          deltaPct: err,
        })
      }
    }
  }

  // ── Pair 2: invoice base unit → canonical recipeUnit ──────────────────
  // Only flag cross-category (which deriveCostFromLineItem() returns null for
  // when there's no per-ingredient conversionFactor).
  const liRows = await prisma.invoiceLineItem.findMany({
    where: { canonicalIngredientId: { not: null } },
    select: {
      unit: true,
      unitSize: true,
      unitSizeUom: true,
      canonicalIngredientId: true,
      canonicalIngredient: { select: { id: true, name: true, recipeUnit: true } },
      invoice: { select: { vendorName: true, invoiceNumber: true } },
    },
  })

  const invoicePairs = new Map<
    string,
    { from: string; to: string; lineCount: number; canonicalIds: Set<string>; sample: string }
  >()
  for (const li of liRows) {
    const c = li.canonicalIngredient
    if (!c || !c.recipeUnit) continue
    const rawFrom = (li.unitSize && li.unitSize > 0 ? li.unitSizeUom : null) ?? li.unit ?? li.unitSizeUom
    if (!rawFrom) continue
    const from = rawFrom.trim().toLowerCase()
    const to = c.recipeUnit.trim().toLowerCase()
    if (from === to) continue
    const key = `${from}→${to}`
    let stats = invoicePairs.get(key)
    if (!stats) {
      stats = {
        from,
        to,
        lineCount: 0,
        canonicalIds: new Set(),
        sample: `${li.invoice.vendorName} ${li.invoice.invoiceNumber} / ${c.name}`,
      }
      invoicePairs.set(key, stats)
    }
    stats.lineCount++
    stats.canonicalIds.add(c.id)
  }

  for (const [, p] of invoicePairs) {
    const canFrom = canonicalizeUnit(p.from)
    const canTo = canonicalizeUnit(p.to)
    if (canFrom && canTo && unitsCompatible(p.from, p.to)) continue
    const missingConv = [...p.canonicalIds].filter((id) => !hasConv.has(id)).length
    if (missingConv === 0) continue
    const severity = !canFrom || !canTo ? "WARNING" : "CRITICAL"
    findings.push({
      domain: "unit-conversion",
      check: "invoice_pair_not_derivable",
      severity,
      message: `Invoice base unit "${p.from}" → recipeUnit "${p.to}": ${missingConv}/${p.canonicalIds.size} canonical(s) lack a conversionFactor to bridge (${p.lineCount} invoice line(s))`,
      entity: { kind: "unitPair", id: `${p.from}→${p.to}`, label: `${p.from}→${p.to}` },
      details: {
        pair: `${p.from}→${p.to}`,
        lineCount: p.lineCount,
        canonicalCount: p.canonicalIds.size,
        missingConversionCount: missingConv,
        fromCanonical: canFrom,
        toCanonical: canTo,
        sample: p.sample,
      },
      deltaDollars: p.lineCount,
    })
  }

  return findings
}

if (require.main === module) {
  auditUnitConversion()
    .then((f) => {
      console.log(JSON.stringify(f, null, 2))
      const counts = { CRITICAL: 0, WARNING: 0, INFO: 0 }
      for (const x of f) counts[x.severity]++
      console.error(`unit-conversion: ${f.length} findings  crit=${counts.CRITICAL} warn=${counts.WARNING} info=${counts.INFO}`)
    })
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
    .finally(async () => {
      const { prisma } = await import("../../src/lib/prisma")
      await prisma.$disconnect()
    })
}
