// scripts/audit-hollywood-costs.ts
//
// Read-only audit of ingredient cost data for the Hollywood store.
// Dumps three CSVs and one summary JSON to tmp/hollywood-cost-audit/ for the
// markdown report writer to consume. Does not write to the DB.
//
// Usage:
//   npx tsx scripts/audit-hollywood-costs.ts

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

const HOLLYWOOD_STORE_ID = "cmexd4zia0001jr04ljkdt9na"
const OUT_DIR = path.resolve(process.cwd(), "tmp/hollywood-cost-audit")

type Json = Record<string, unknown>

function csvEscape(value: unknown): string {
  if (value == null) return ""
  const s = typeof value === "string" ? value : String(value)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function writeCsv(file: string, rows: Json[]): void {
  if (rows.length === 0) {
    fs.writeFileSync(file, "")
    return
  }
  const headers = Array.from(
    rows.reduce<Set<string>>((acc, r) => {
      Object.keys(r).forEach((k) => acc.add(k))
      return acc
    }, new Set())
  )
  const lines = [headers.join(",")]
  for (const r of rows) {
    lines.push(headers.map((h) => csvEscape(r[h])).join(","))
  }
  fs.writeFileSync(file, lines.join("\n"))
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const { prisma } = await import("@/lib/prisma")
  const { computeRecipeCost } = await import("@/lib/recipe-cost")
  const { canonicalizeUnit, convert } = await import("@/lib/unit-conversion")

  // ── 1. Resolve store + account ──────────────────────────────────────────────
  const store = await prisma.store.findUnique({
    where: { id: HOLLYWOOD_STORE_ID },
    select: { id: true, name: true, accountId: true, ownerId: true, targetCogsPct: true },
  })
  if (!store) {
    console.error(`Store ${HOLLYWOOD_STORE_ID} not found`)
    process.exit(1)
  }
  console.log(`Auditing store: ${store.name} (${store.id}) — account ${store.accountId}`)

  // ── 2. Pull all canonical ingredients for the account ───────────────────────
  const canonicals = await prisma.canonicalIngredient.findMany({
    where: { accountId: store.accountId },
    select: {
      id: true,
      name: true,
      defaultUnit: true,
      recipeUnit: true,
      costPerRecipeUnit: true,
      costSource: true,
      costLocked: true,
      costUpdatedAt: true,
      category: true,
      _count: {
        select: { recipeIngredients: true, invoiceLineItems: true, skuMatches: true },
      },
    },
  })
  console.log(`Canonical ingredients: ${canonicals.length}`)

  // ── 3. Pull all SKU matches and recent invoice line items for those ─────────
  const skuMatches = await prisma.ingredientSkuMatch.findMany({
    where: { accountId: store.accountId },
    select: {
      canonicalIngredientId: true,
      vendorName: true,
      sku: true,
      conversionFactor: true,
      fromUnit: true,
      toUnit: true,
      confirmedAt: true,
    },
  })

  const lineItems = await prisma.invoiceLineItem.findMany({
    where: {
      canonicalIngredientId: { not: null },
      invoice: { accountId: store.accountId },
    },
    orderBy: { invoice: { invoiceDate: "desc" } },
    select: {
      id: true,
      canonicalIngredientId: true,
      sku: true,
      productName: true,
      quantity: true,
      unit: true,
      packSize: true,
      unitSize: true,
      unitSizeUom: true,
      unitPrice: true,
      extendedPrice: true,
      invoice: { select: { invoiceDate: true, vendorName: true } },
    },
  })
  console.log(`Matched invoice line items: ${lineItems.length}`)
  console.log(`SKU matches: ${skuMatches.length}`)

  // Index line items per canonical (already sorted desc by invoiceDate)
  const liByCanonical = new Map<string, typeof lineItems>()
  for (const li of lineItems) {
    if (!li.canonicalIngredientId) continue
    const arr = liByCanonical.get(li.canonicalIngredientId) ?? []
    arr.push(li)
    liByCanonical.set(li.canonicalIngredientId, arr)
  }

  // ── 4. Pull recipes for the account ─────────────────────────────────────────
  const recipes = await prisma.recipe.findMany({
    where: { accountId: store.accountId },
    select: {
      id: true,
      itemName: true,
      category: true,
      isSellable: true,
      foodCostOverride: true,
      ingredients: {
        select: {
          id: true,
          quantity: true,
          unit: true,
          ingredientName: true,
          canonicalIngredientId: true,
          componentRecipeId: true,
        },
      },
    },
  })
  console.log(`Recipes: ${recipes.length}`)

  // Identify ingredients used in any recipe (directly)
  const usedCanonicalIds = new Set<string>()
  for (const r of recipes) {
    for (const ri of r.ingredients) {
      if (ri.canonicalIngredientId) usedCanonicalIds.add(ri.canonicalIngredientId)
    }
  }

  // ── 5. Daily COGS items (last 30 days) for the Hollywood store ──────────────
  const since = new Date()
  since.setDate(since.getDate() - 30)
  const dailyCogs = await prisma.dailyCogsItem.findMany({
    where: { storeId: store.id, date: { gte: since } },
    select: {
      date: true,
      itemName: true,
      category: true,
      qtySold: true,
      salesRevenue: true,
      unitCost: true,
      lineCost: true,
      status: true,
      partialCost: true,
      recipeId: true,
    },
  })
  console.log(`DailyCogsItem rows (last 30d): ${dailyCogs.length}`)

  // ── 6. Bucket 1: data integrity flags ───────────────────────────────────────
  const NOW = new Date()
  const STALE_DAYS = 90
  const flags: Json[] = []

  for (const c of canonicals) {
    const usedInRecipe = usedCanonicalIds.has(c.id)
    const lis = liByCanonical.get(c.id) ?? []
    const latest = lis[0]

    // Stale
    if (
      usedInRecipe &&
      c.costPerRecipeUnit != null &&
      c.costUpdatedAt &&
      (NOW.getTime() - c.costUpdatedAt.getTime()) / 86400000 > STALE_DAYS
    ) {
      flags.push({
        bucket: "stale",
        canonicalId: c.id,
        name: c.name,
        recipeUnit: c.recipeUnit,
        cost: c.costPerRecipeUnit,
        costUpdatedAt: c.costUpdatedAt?.toISOString(),
        ageDays: Math.floor(
          (NOW.getTime() - c.costUpdatedAt.getTime()) / 86400000
        ),
        latestInvoiceDate: latest?.invoice.invoiceDate?.toISOString() ?? null,
      })
    }

    // Missing cost on a used ingredient
    if (
      usedInRecipe &&
      (c.costPerRecipeUnit == null || c.costPerRecipeUnit === 0)
    ) {
      flags.push({
        bucket: "missing-cost",
        canonicalId: c.id,
        name: c.name,
        recipeUnit: c.recipeUnit,
        cost: c.costPerRecipeUnit,
        costSource: c.costSource,
        invoiceLinesMatched: lis.length,
      })
    }

    // Locked + drifting
    if (c.costLocked && c.costPerRecipeUnit != null && latest && c.recipeUnit) {
      // Compare to derived per-recipeUnit price from the latest invoice line.
      const liUnit = latest.unit ?? ""
      const recipeUnit = c.recipeUnit
      const norm = canonicalizeUnit(recipeUnit)
      const liNorm = canonicalizeUnit(liUnit)
      let derived: number | null = null
      if (norm && liNorm && norm === liNorm && latest.unitPrice > 0) {
        derived = latest.unitPrice
      } else if (norm && liNorm && convert(1, liUnit, recipeUnit) != null) {
        const factor = convert(1, liUnit, recipeUnit)!
        derived = factor > 0 ? latest.unitPrice / factor : null
      }
      if (
        derived != null &&
        derived > 0 &&
        Math.abs(derived - c.costPerRecipeUnit) / c.costPerRecipeUnit > 0.2
      ) {
        flags.push({
          bucket: "locked-drift",
          canonicalId: c.id,
          name: c.name,
          recipeUnit: c.recipeUnit,
          lockedCost: c.costPerRecipeUnit,
          derivedFromLatestInvoice: derived,
          delta: derived - c.costPerRecipeUnit,
          latestVendor: latest.invoice.vendorName,
          latestSku: latest.sku,
          latestInvoiceDate: latest.invoice.invoiceDate?.toISOString() ?? null,
        })
      }
    }

    // Cross-vendor spread (>30%) on normalized $/recipeUnit, where derivable
    if (lis.length >= 2 && c.recipeUnit) {
      const vendorPrices: Array<{ vendor: string; sku: string | null; price: number; date: string | null }> = []
      const seenVendors = new Set<string>()
      for (const li of lis.slice(0, 12)) {
        const liUnit = li.unit ?? ""
        const norm = canonicalizeUnit(c.recipeUnit)
        const liNorm = canonicalizeUnit(liUnit)
        let derived: number | null = null
        if (norm && liNorm && norm === liNorm && li.unitPrice > 0) {
          derived = li.unitPrice
        } else if (norm && liNorm) {
          const factor = convert(1, liUnit, c.recipeUnit)
          if (factor != null && factor > 0) derived = li.unitPrice / factor
        }
        const key = `${li.invoice.vendorName}::${li.sku ?? li.productName}`
        if (derived != null && derived > 0 && !seenVendors.has(key)) {
          seenVendors.add(key)
          vendorPrices.push({
            vendor: li.invoice.vendorName,
            sku: li.sku,
            price: derived,
            date: li.invoice.invoiceDate?.toISOString() ?? null,
          })
        }
      }
      if (vendorPrices.length >= 2) {
        const min = Math.min(...vendorPrices.map((v) => v.price))
        const max = Math.max(...vendorPrices.map((v) => v.price))
        if (min > 0 && (max - min) / min > 0.3) {
          flags.push({
            bucket: "cross-vendor-spread",
            canonicalId: c.id,
            name: c.name,
            recipeUnit: c.recipeUnit,
            currentCost: c.costPerRecipeUnit,
            min,
            max,
            spreadPct: (max - min) / min,
            sources: JSON.stringify(vendorPrices),
          })
        }
      }
    }

    // Conversion gap: SKU match exists but its fromUnit/toUnit can't bridge to recipeUnit
    const matches = skuMatches.filter((m) => m.canonicalIngredientId === c.id)
    for (const m of matches) {
      if (!c.recipeUnit) continue
      const factor = m.conversionFactor
      const fromCat = canonicalizeUnit(m.fromUnit)
      const toCat = canonicalizeUnit(m.toUnit)
      const recipeCat = canonicalizeUnit(c.recipeUnit)
      // If toUnit normalizes to recipeUnit category, fine. If not, and conversion can't bridge, flag.
      const compatible =
        toCat &&
        recipeCat &&
        (toCat === recipeCat || convert(1, m.toUnit, c.recipeUnit) != null)
      if (!compatible && factor === 1) {
        flags.push({
          bucket: "conversion-gap",
          canonicalId: c.id,
          name: c.name,
          recipeUnit: c.recipeUnit,
          skuVendor: m.vendorName,
          sku: m.sku,
          fromUnit: m.fromUnit,
          toUnit: m.toUnit,
          conversionFactor: m.conversionFactor,
        })
      }
    }

    // Suspicious magnitude
    if (
      c.costPerRecipeUnit != null &&
      (c.costPerRecipeUnit < 0.001 || c.costPerRecipeUnit > 500)
    ) {
      flags.push({
        bucket: "suspicious-magnitude",
        canonicalId: c.id,
        name: c.name,
        recipeUnit: c.recipeUnit,
        cost: c.costPerRecipeUnit,
        costSource: c.costSource,
      })
    }
  }

  writeCsv(path.join(OUT_DIR, "1-data-integrity-flags.csv"), flags)
  console.log(`Wrote ${flags.length} integrity flags`)

  // ── 7. Bucket 2: reasonability (just dump normalized $/lb, $/fl oz, $/each) ─
  const normalized: Json[] = []
  for (const c of canonicals) {
    if (!c.recipeUnit || c.costPerRecipeUnit == null) continue
    const recipeUnit = c.recipeUnit
    const cost = c.costPerRecipeUnit
    const recipeCat = canonicalizeUnit(recipeUnit)
    let perLb: number | null = null
    let perFlOz: number | null = null
    let perEach: number | null = null
    if (recipeCat === "lb" || recipeCat === "oz" || recipeCat === "g" || recipeCat === "kg") {
      const f = convert(1, "lb", recipeUnit)
      if (f != null && f > 0) perLb = cost * f
    } else if (
      recipeCat === "fl oz" || recipeCat === "ml" || recipeCat === "l" ||
      recipeCat === "cup" || recipeCat === "pt" || recipeCat === "qt" || recipeCat === "gal"
    ) {
      const f = convert(1, "fl oz", recipeUnit)
      if (f != null && f > 0) perFlOz = cost * f
    } else if (recipeCat === "each" || recipeCat === "dz") {
      const f = convert(1, "each", recipeUnit)
      if (f != null && f > 0) perEach = cost * f
    }
    normalized.push({
      canonicalId: c.id,
      name: c.name,
      category: c.category,
      recipeUnit,
      cost,
      costSource: c.costSource,
      perLb,
      perFlOz,
      perEach,
      usedInRecipe: usedCanonicalIds.has(c.id),
      invoiceLines: (liByCanonical.get(c.id) ?? []).length,
    })
  }
  writeCsv(path.join(OUT_DIR, "2-normalized-prices.csv"), normalized)
  console.log(`Wrote ${normalized.length} normalized price rows`)

  // ── 8. Bucket 3: walk every recipe and dump cost result ─────────────────────
  const recipeWalks: Json[] = []
  for (const r of recipes) {
    try {
      const result = await computeRecipeCost(r.id)
      recipeWalks.push({
        recipeId: r.id,
        itemName: r.itemName,
        category: r.category,
        isSellable: r.isSellable,
        ingredientCount: r.ingredients.length,
        totalCost: result.totalCost,
        partial: result.partial,
        foodCostOverride: r.foodCostOverride,
        missingLines: result.lines.filter((l) => l.missingCost).length,
        missingNames: JSON.stringify(
          result.lines.filter((l) => l.missingCost).map((l) => l.name)
        ),
        lines: JSON.stringify(
          result.lines.map((l) => ({
            kind: l.kind,
            name: l.name,
            qty: l.quantity,
            unit: l.unit,
            unitCost: l.unitCost,
            costUnit: l.costUnit,
            lineCost: l.lineCost,
            missing: l.missingCost,
          }))
        ),
      })
    } catch (e) {
      recipeWalks.push({
        recipeId: r.id,
        itemName: r.itemName,
        category: r.category,
        isSellable: r.isSellable,
        ingredientCount: r.ingredients.length,
        totalCost: null,
        partial: true,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }
  writeCsv(path.join(OUT_DIR, "3-recipe-walks.csv"), recipeWalks)
  console.log(`Walked ${recipeWalks.length} recipes`)

  // ── 9. DailyCogsItem partial flags ──────────────────────────────────────────
  const partialDailyCogs = dailyCogs.filter((d) => d.partialCost)
  writeCsv(
    path.join(OUT_DIR, "4-daily-cogs-partial.csv"),
    partialDailyCogs.map((d) => ({
      date: d.date.toISOString().slice(0, 10),
      itemName: d.itemName,
      category: d.category,
      qtySold: d.qtySold,
      salesRevenue: d.salesRevenue,
      unitCost: d.unitCost,
      lineCost: d.lineCost,
      status: d.status,
    }))
  )
  console.log(`DailyCogsItem partial rows (last 30d): ${partialDailyCogs.length}`)

  // ── 10. Summary JSON ────────────────────────────────────────────────────────
  const summary = {
    storeId: store.id,
    storeName: store.name,
    accountId: store.accountId,
    targetCogsPct: store.targetCogsPct,
    counts: {
      canonicals: canonicals.length,
      canonicalsUsedInRecipes: usedCanonicalIds.size,
      canonicalsWithCost: canonicals.filter((c) => c.costPerRecipeUnit != null).length,
      canonicalsLocked: canonicals.filter((c) => c.costLocked).length,
      skuMatches: skuMatches.length,
      lineItemsMatched: lineItems.length,
      recipes: recipes.length,
      recipesSellable: recipes.filter((r) => r.isSellable).length,
      dailyCogsLast30d: dailyCogs.length,
      dailyCogsPartial: partialDailyCogs.length,
    },
    flags: {
      stale: flags.filter((f) => f.bucket === "stale").length,
      missingCost: flags.filter((f) => f.bucket === "missing-cost").length,
      lockedDrift: flags.filter((f) => f.bucket === "locked-drift").length,
      crossVendorSpread: flags.filter((f) => f.bucket === "cross-vendor-spread").length,
      conversionGap: flags.filter((f) => f.bucket === "conversion-gap").length,
      suspiciousMagnitude: flags.filter((f) => f.bucket === "suspicious-magnitude").length,
    },
    recipes: {
      total: recipeWalks.length,
      partial: recipeWalks.filter((w) => w.partial).length,
      withErrors: recipeWalks.filter((w) => w.error != null).length,
    },
  }
  fs.writeFileSync(path.join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2))
  console.log("Summary:")
  console.log(JSON.stringify(summary, null, 2))

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
