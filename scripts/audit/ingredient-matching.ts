// Ingredient matching audit.
//
// Three checks:
//   1. sku_ambiguity       — (vendor, sku) has mapped to >1 canonical over invoice
//                            history (IngredientSkuMatch stores the LATEST; but
//                            past InvoiceLineItem rows may point to old ones,
//                            creating a quiet inconsistency)
//   2. stale_locked_canonical — costLocked=true canonicals on live recipes whose
//                               costUpdatedAt is >180d old
//   3. orphan_alias        — IngredientAlias rows where the same store also has
//                            a (vendor, sku) match pointing to the same canonical
//                            — dead-path that can silently win and apply wrong
//                            conversion if both fire

import { loadEnvLocal, type Finding, money } from "./lib"

loadEnvLocal()

export async function auditIngredientMatching(): Promise<Finding[]> {
  const { prisma } = await import("../../src/lib/prisma")
  const findings: Finding[] = []

  // ── 1. sku_ambiguity ────────────────────────────────────────────
  // Group matched invoice line items by (vendor, sku), check distinct canonical ids.
  type SkuRow = { vendor: string; sku: string; canonicals: string; rowCount: bigint; dollars: number }
  const skuRows = await prisma.$queryRaw<Array<{ vendor: string; sku: string; canonical_ids: string[]; row_count: bigint; dollars: number }>>`
    SELECT i."vendorName" AS "vendor",
           li."sku" AS "sku",
           ARRAY_AGG(DISTINCT li."canonicalIngredientId") AS "canonical_ids",
           COUNT(*) AS "row_count",
           SUM(li."extendedPrice")::float AS "dollars"
    FROM "InvoiceLineItem" li
    JOIN "Invoice" i ON i."id" = li."invoiceId"
    WHERE li."sku" IS NOT NULL
      AND li."canonicalIngredientId" IS NOT NULL
    GROUP BY i."vendorName", li."sku"
    HAVING COUNT(DISTINCT li."canonicalIngredientId") > 1
  `
  for (const row of skuRows) {
    findings.push({
      domain: "ingredient-matching",
      check: "sku_ambiguity",
      severity: "WARNING",
      message: `${row.vendor} SKU "${row.sku}" has mapped to ${row.canonical_ids.length} different canonicals over ${Number(row.row_count)} lines (${money(row.dollars)})`,
      entity: { kind: "vendorSku", id: `${row.vendor}::${row.sku}`, label: `${row.vendor} / ${row.sku}` },
      details: {
        vendor: row.vendor,
        sku: row.sku,
        canonicalIds: row.canonical_ids,
        rowCount: Number(row.row_count),
        dollars: row.dollars,
      },
      deltaDollars: row.dollars,
    })
  }

  // ── 2. stale_locked_canonical ──────────────────────────────────
  const liveCanonicals = await prisma.$queryRaw<Array<{
    id: string
    name: string
    ownerId: string
    costLocked: boolean
    costPerRecipeUnit: number | null
    costUpdatedAt: Date | null
    recipeCount: bigint
  }>>`
    SELECT c."id",
           c."name",
           c."ownerId",
           c."costLocked",
           c."costPerRecipeUnit",
           c."costUpdatedAt",
           COUNT(DISTINCT ri."recipeId") AS "recipeCount"
    FROM "CanonicalIngredient" c
    JOIN "RecipeIngredient" ri ON ri."canonicalIngredientId" = c."id"
    JOIN "Recipe" r ON r."id" = ri."recipeId" AND r."isSellable" = TRUE
    WHERE c."costLocked" = TRUE
    GROUP BY c."id", c."name", c."ownerId", c."costLocked", c."costPerRecipeUnit", c."costUpdatedAt"
  `

  const now = Date.now()
  for (const c of liveCanonicals) {
    if (!c.costUpdatedAt) {
      findings.push({
        domain: "ingredient-matching",
        check: "stale_locked_canonical",
        severity: "WARNING",
        message: `${c.name} — costLocked=true but costUpdatedAt is null; used in ${Number(c.recipeCount)} live recipe(s)`,
        entity: { kind: "canonical", id: c.id, label: c.name },
        details: {
          ownerId: c.ownerId,
          costPerRecipeUnit: c.costPerRecipeUnit,
          recipeCount: Number(c.recipeCount),
        },
      })
      continue
    }
    const days = (now - c.costUpdatedAt.getTime()) / (1000 * 60 * 60 * 24)
    if (days > 180) {
      const severity: "CRITICAL" | "WARNING" = days > 365 ? "CRITICAL" : "WARNING"
      findings.push({
        domain: "ingredient-matching",
        check: "stale_locked_canonical",
        severity,
        message: `${c.name} — locked cost ${money(c.costPerRecipeUnit)} last touched ${days.toFixed(0)}d ago (${Number(c.recipeCount)} live recipe(s))`,
        entity: { kind: "canonical", id: c.id, label: c.name },
        details: {
          ownerId: c.ownerId,
          costPerRecipeUnit: c.costPerRecipeUnit,
          costUpdatedAt: c.costUpdatedAt.toISOString(),
          daysSinceUpdate: days,
          recipeCount: Number(c.recipeCount),
        },
        deltaDollars: c.costPerRecipeUnit ?? 0,
      })
    }
  }

  // ── 3. orphan_alias ──────────────────────────────────────────
  // An alias for a (store, rawName) where the same rawName has been seen on an
  // invoice with a non-null sku AND a (vendor, sku) match exists. The sku path
  // always wins now, making the alias dead. Flag because an alias with a wrong
  // conversionFactor could mask a real match bug if the sku path ever breaks.
  const aliases = await prisma.ingredientAlias.findMany({
    select: {
      id: true,
      storeId: true,
      rawName: true,
      canonicalIngredientId: true,
      canonicalName: true,
    },
  })
  if (aliases.length > 0) {
    const skuMatches = await prisma.ingredientSkuMatch.findMany({
      select: { ownerId: true, canonicalIngredientId: true, vendorName: true, sku: true },
    })
    const skuByCanonical = new Map<string, Array<{ vendor: string; sku: string }>>()
    for (const m of skuMatches) {
      const list = skuByCanonical.get(m.canonicalIngredientId) ?? []
      list.push({ vendor: m.vendorName, sku: m.sku })
      skuByCanonical.set(m.canonicalIngredientId, list)
    }

    // For each alias, check if the same store has invoice lines for the same rawName
    // that are matched by SKU (i.e. would have used sku path instead of alias).
    const sample = aliases.slice(0, 500) // cap runtime; aliases grow slowly
    for (const a of sample) {
      if (!a.canonicalIngredientId) continue
      const skusForCanonical = skuByCanonical.get(a.canonicalIngredientId)
      if (!skusForCanonical || skusForCanonical.length === 0) continue
      const hasSkuLine = await prisma.invoiceLineItem.findFirst({
        where: {
          productName: a.rawName,
          sku: { not: null },
          canonicalIngredientId: a.canonicalIngredientId,
          invoice: { storeId: a.storeId },
        },
        select: { id: true },
      })
      if (hasSkuLine) {
        findings.push({
          domain: "ingredient-matching",
          check: "orphan_alias",
          severity: "WARNING",
          message: `Alias for "${a.rawName}" (store ${a.storeId.slice(-6)}) is dead — same product now matches via (vendor, sku). Can silently apply wrong conversion if sku match ever breaks.`,
          entity: { kind: "alias", id: a.id, label: a.rawName },
          details: {
            storeId: a.storeId,
            rawName: a.rawName,
            canonicalIngredientId: a.canonicalIngredientId,
            canonicalName: a.canonicalName,
            activeSkus: skusForCanonical,
          },
        })
      }
    }
  }

  return findings
}

if (require.main === module) {
  auditIngredientMatching()
    .then((f) => {
      console.log(JSON.stringify(f, null, 2))
      const counts = { CRITICAL: 0, WARNING: 0, INFO: 0 }
      for (const x of f) counts[x.severity]++
      console.error(`ingredient-matching: ${f.length} findings  crit=${counts.CRITICAL} warn=${counts.WARNING} info=${counts.INFO}`)
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
