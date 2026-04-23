// Invoice-domain audit. Four sub-checks:
//
//   1. header_vs_lines       — Invoice.totalAmount ≈ Σ extendedPrice + taxAmount
//   2. line_arithmetic       — line.extendedPrice ≈ quantity × unitPrice
//   3. canonical_linkage     — % of lines linked to a CanonicalIngredient, by vendor
//   4. canonical_cost_freshness — costPerRecipeUnit matches derive() on latest line,
//                                 and not stale (>90/180d) when costLocked=false.
//
// Read-only. Loads lib/ingredient-cost for #4 to mirror production derivation.

import { loadEnvLocal, type Finding, classifyDollarDelta, money, pct, shortId } from "./lib"

loadEnvLocal()

export async function auditInvoices(): Promise<Finding[]> {
  const { prisma } = await import("../../src/lib/prisma")
  const { deriveCostFromLineItem } = await import("../../src/lib/ingredient-cost")
  const findings: Finding[] = []

  // ── 1. header_vs_lines ──────────────────────────────────────────────────
  // Per invoice: |totalAmount − (Σ extendedPrice + taxAmount)|. We ignore
  // invoices with no line items (some are header-only records from email
  // forwarding that never got OCR'd) and invoices with totalAmount 0.
  const invoices = await prisma.invoice.findMany({
    select: {
      id: true,
      ownerId: true,
      storeId: true,
      vendorName: true,
      invoiceNumber: true,
      invoiceDate: true,
      subtotal: true,
      taxAmount: true,
      totalAmount: true,
      status: true,
      lineItems: {
        select: {
          id: true,
          lineNumber: true,
          productName: true,
          quantity: true,
          unitPrice: true,
          extendedPrice: true,
          sku: true,
          canonicalIngredientId: true,
        },
      },
    },
  })

  for (const inv of invoices) {
    if (inv.lineItems.length === 0) continue
    if (inv.totalAmount === 0 && (inv.taxAmount ?? 0) === 0) continue

    const lineSum = inv.lineItems.reduce((s, l) => s + l.extendedPrice, 0)
    const tax = inv.taxAmount ?? 0
    const computed = lineSum + tax
    const delta = inv.totalAmount - computed
    const absDelta = Math.abs(delta)
    const severity = classifyDollarDelta(absDelta, inv.totalAmount)
    if (severity === "INFO") continue

    findings.push({
      domain: "invoices",
      check: "header_vs_lines",
      severity,
      message: `${inv.vendorName} ${inv.invoiceNumber} — header ${money(inv.totalAmount)} vs Σlines+tax ${money(computed)} (Δ ${money(delta)})`,
      entity: {
        kind: "invoice",
        id: inv.id,
        label: `${inv.vendorName} ${inv.invoiceNumber}`,
      },
      details: {
        invoiceDate: inv.invoiceDate?.toISOString().slice(0, 10) ?? null,
        storeId: inv.storeId,
        status: inv.status,
        header: inv.totalAmount,
        lineSum,
        tax,
        delta,
        lineCount: inv.lineItems.length,
      },
      deltaDollars: absDelta,
      deltaPct: inv.totalAmount > 0 ? absDelta / inv.totalAmount : null as unknown as number,
    })
  }

  // ── 2. line_arithmetic ──────────────────────────────────────────────────
  // Per line: |extendedPrice − quantity × unitPrice|. Noise is rampant here
  // because some vendors round unitPrice to 2dp and Σ doesn't match.
  for (const inv of invoices) {
    for (const li of inv.lineItems) {
      const computed = li.quantity * li.unitPrice
      const delta = li.extendedPrice - computed
      const absDelta = Math.abs(delta)
      const severity = classifyDollarDelta(absDelta, li.extendedPrice)
      if (severity === "INFO") continue

      findings.push({
        domain: "invoices",
        check: "line_arithmetic",
        severity,
        message: `${inv.vendorName} ${inv.invoiceNumber} line ${li.lineNumber} "${li.productName.slice(0, 40)}" — ${li.quantity} × ${money(li.unitPrice)} = ${money(computed)}, got ${money(li.extendedPrice)}`,
        entity: {
          kind: "lineItem",
          id: li.id,
          label: `${inv.vendorName} ${inv.invoiceNumber} / ${li.productName.slice(0, 40)}`,
        },
        details: {
          invoiceId: inv.id,
          lineNumber: li.lineNumber,
          productName: li.productName,
          sku: li.sku,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          extendedPrice: li.extendedPrice,
          computed,
          delta,
        },
        deltaDollars: absDelta,
        deltaPct: li.extendedPrice > 0 ? absDelta / li.extendedPrice : null as unknown as number,
      })
    }
  }

  // ── 3. canonical_linkage ────────────────────────────────────────────────
  // Aggregate orphan rate by vendor, weighted by extendedPrice dollars.
  // Report vendors with <80% coverage where orphan value exceeds the
  // CRITICAL threshold ($1) — these are the ones dragging COGS visibility.
  const byVendor = new Map<
    string,
    { total: number; linked: number; orphanDollars: number; orphanLines: number; ownerId: string }
  >()
  for (const inv of invoices) {
    const key = `${inv.ownerId}::${inv.vendorName}`
    let bucket = byVendor.get(key)
    if (!bucket) {
      bucket = { total: 0, linked: 0, orphanDollars: 0, orphanLines: 0, ownerId: inv.ownerId }
      byVendor.set(key, bucket)
    }
    for (const li of inv.lineItems) {
      bucket.total++
      if (li.canonicalIngredientId) bucket.linked++
      else {
        bucket.orphanLines++
        bucket.orphanDollars += li.extendedPrice
      }
    }
  }

  for (const [key, b] of byVendor) {
    if (b.total === 0) continue
    const coverage = b.linked / b.total
    if (coverage >= 0.8) continue
    // Tiny vendors with <$100 orphaned are INFO — no meaningful COGS drag.
    const severity: "CRITICAL" | "WARNING" =
      b.orphanDollars >= 500 && coverage < 0.5
        ? "CRITICAL"
        : "WARNING"
    const vendorName = key.split("::")[1]
    findings.push({
      domain: "invoices",
      check: "canonical_linkage",
      severity,
      message: `${vendorName} — ${b.orphanLines}/${b.total} lines unlinked (${pct(1 - coverage)}), ${money(b.orphanDollars)} of COGS with no canonical`,
      entity: { kind: "vendor", id: key, label: vendorName },
      details: {
        ownerId: b.ownerId,
        vendorName,
        totalLines: b.total,
        linkedLines: b.linked,
        orphanLines: b.orphanLines,
        orphanDollars: b.orphanDollars,
        coverage,
      },
      deltaDollars: b.orphanDollars,
      deltaPct: 1 - coverage,
    })
  }

  // ── 4. canonical_cost_freshness ─────────────────────────────────────────
  // For every non-locked canonical with a set recipeUnit, compare the stored
  // costPerRecipeUnit against what deriveCostFromLineItem() produces from the
  // latest matched invoice line. Flag:
  //   - drift > $0.01 or > 1%        → WARNING/CRITICAL via classifier
  //   - costUpdatedAt > 180 days     → WARNING (stale)
  //   - costUpdatedAt > 365 days     → CRITICAL (very stale)
  //   - canonical has matched lines but costPerRecipeUnit is null → WARNING
  const canonicals = await prisma.canonicalIngredient.findMany({
    select: {
      id: true,
      ownerId: true,
      name: true,
      recipeUnit: true,
      costPerRecipeUnit: true,
      costSource: true,
      costLocked: true,
      costUpdatedAt: true,
    },
  })

  // Pre-load latest matched line per canonical in a single query (same shape
  // as canonical-cost-batch.ts but not owner-scoped; unbounded — DB is small).
  const latestLines = await prisma.$queryRaw<Array<{
    canonicalIngredientId: string
    lineItemId: string
    invoiceId: string
    productName: string
    sku: string | null
    quantity: number
    unit: string | null
    packSize: number | null
    unitSize: number | null
    unitSizeUom: string | null
    unitPrice: number
    extendedPrice: number
    invoiceDate: Date
    vendorName: string
  }>>`
    SELECT DISTINCT ON (li."canonicalIngredientId")
      li."canonicalIngredientId" AS "canonicalIngredientId",
      li."id"           AS "lineItemId",
      li."invoiceId"    AS "invoiceId",
      li."productName"  AS "productName",
      li."sku"          AS "sku",
      li."quantity"     AS "quantity",
      li."unit"         AS "unit",
      li."packSize"     AS "packSize",
      li."unitSize"     AS "unitSize",
      li."unitSizeUom"  AS "unitSizeUom",
      li."unitPrice"    AS "unitPrice",
      li."extendedPrice" AS "extendedPrice",
      i."invoiceDate"   AS "invoiceDate",
      i."vendorName"    AS "vendorName"
    FROM "InvoiceLineItem" li
    JOIN "Invoice" i ON i."id" = li."invoiceId"
    WHERE li."canonicalIngredientId" IS NOT NULL
      AND li."quantity" > 0
      AND i."invoiceDate" IS NOT NULL
    ORDER BY li."canonicalIngredientId", i."invoiceDate" DESC
  `
  const byCanonical = new Map(latestLines.map((r) => [r.canonicalIngredientId, r]))

  // Per-canonical vendor match, for conversionFactor (rare — mostly cross-category).
  const skuMatches = await prisma.ingredientSkuMatch.findMany({
    select: { canonicalIngredientId: true, conversionFactor: true, fromUnit: true, toUnit: true },
  })
  const convByCanonical = new Map<string, (typeof skuMatches)[number]>()
  for (const m of skuMatches) {
    if (!convByCanonical.has(m.canonicalIngredientId)) convByCanonical.set(m.canonicalIngredientId, m)
  }

  const now = Date.now()
  for (const c of canonicals) {
    const prov = byCanonical.get(c.id)
    if (!prov) {
      // No matched line yet. If recipes reference this canonical, it's a
      // MISSING_COST root cause — flag, but attribute to the matching domain.
      // Here we only care about freshness for canonicals that HAVE a match.
      continue
    }

    // Staleness by costUpdatedAt (skip when null and costPerRecipeUnit null — orphan).
    if (!c.costLocked && c.costUpdatedAt) {
      const daysSince = (now - c.costUpdatedAt.getTime()) / (1000 * 60 * 60 * 24)
      if (daysSince > 365) {
        findings.push({
          domain: "invoices",
          check: "canonical_cost_freshness",
          severity: "CRITICAL",
          message: `${c.name} — cost hasn't been refreshed in ${daysSince.toFixed(0)}d (last ${c.costUpdatedAt.toISOString().slice(0, 10)})`,
          entity: { kind: "canonical", id: c.id, label: c.name },
          details: {
            ownerId: c.ownerId,
            costPerRecipeUnit: c.costPerRecipeUnit,
            recipeUnit: c.recipeUnit,
            costSource: c.costSource,
            costUpdatedAt: c.costUpdatedAt.toISOString(),
            daysSinceUpdate: daysSince,
            latestInvoiceDate: prov.invoiceDate.toISOString().slice(0, 10),
          },
          deltaDollars: c.costPerRecipeUnit ?? 0,
        })
      } else if (daysSince > 180) {
        findings.push({
          domain: "invoices",
          check: "canonical_cost_freshness",
          severity: "WARNING",
          message: `${c.name} — cost stale: ${daysSince.toFixed(0)}d since last update`,
          entity: { kind: "canonical", id: c.id, label: c.name },
          details: {
            ownerId: c.ownerId,
            costPerRecipeUnit: c.costPerRecipeUnit,
            recipeUnit: c.recipeUnit,
            costUpdatedAt: c.costUpdatedAt.toISOString(),
            daysSinceUpdate: daysSince,
          },
          deltaDollars: c.costPerRecipeUnit ?? 0,
        })
      }
    }

    // Drift — only meaningful when we have a recipeUnit and an unlocked cost.
    if (c.costLocked) continue
    if (!c.recipeUnit) {
      if (c.costPerRecipeUnit == null) {
        // Has matched lines but no recipeUnit — can't derive cost.
        findings.push({
          domain: "invoices",
          check: "canonical_cost_freshness",
          severity: "WARNING",
          message: `${c.name} — canonical has matched invoice lines but no recipeUnit set (blocks cost derivation)`,
          entity: { kind: "canonical", id: c.id, label: c.name },
          details: { ownerId: c.ownerId },
        })
      }
      continue
    }

    const conv = convByCanonical.get(c.id)
    const derived = deriveCostFromLineItem(
      {
        quantity: prov.quantity,
        unit: prov.unit,
        packSize: prov.packSize,
        unitSize: prov.unitSize,
        unitSizeUom: prov.unitSizeUom,
        unitPrice: prov.unitPrice,
        extendedPrice: prov.extendedPrice,
      },
      c.recipeUnit,
      conv
        ? { conversionFactor: conv.conversionFactor, fromUnit: conv.fromUnit, toUnit: conv.toUnit }
        : undefined
    )

    if (derived == null) {
      findings.push({
        domain: "invoices",
        check: "canonical_cost_freshness",
        severity: "WARNING",
        message: `${c.name} — latest invoice line can't be converted to ${c.recipeUnit} (derive returned null)`,
        entity: { kind: "canonical", id: c.id, label: c.name },
        details: {
          ownerId: c.ownerId,
          recipeUnit: c.recipeUnit,
          lineUnit: prov.unit,
          unitSizeUom: prov.unitSizeUom,
          vendorName: prov.vendorName,
          invoiceDate: prov.invoiceDate.toISOString().slice(0, 10),
          hasConversion: !!conv,
        },
      })
      continue
    }

    if (c.costPerRecipeUnit == null) {
      findings.push({
        domain: "invoices",
        check: "canonical_cost_freshness",
        severity: "WARNING",
        message: `${c.name} — canonical has no costPerRecipeUnit but latest invoice derives ${money(derived)}/${c.recipeUnit}`,
        entity: { kind: "canonical", id: c.id, label: c.name },
        details: {
          ownerId: c.ownerId,
          derived,
          recipeUnit: c.recipeUnit,
          vendorName: prov.vendorName,
          invoiceDate: prov.invoiceDate.toISOString().slice(0, 10),
        },
        deltaDollars: derived,
      })
      continue
    }

    const delta = c.costPerRecipeUnit - derived
    const absDelta = Math.abs(delta)
    const severity = classifyDollarDelta(absDelta, c.costPerRecipeUnit)
    if (severity === "INFO") continue

    findings.push({
      domain: "invoices",
      check: "canonical_cost_freshness",
      severity,
      message: `${c.name} — stored ${money(c.costPerRecipeUnit)}/${c.recipeUnit} vs latest invoice derive ${money(derived)}/${c.recipeUnit} (Δ ${money(delta)})`,
      entity: { kind: "canonical", id: c.id, label: c.name },
      details: {
        ownerId: c.ownerId,
        stored: c.costPerRecipeUnit,
        derived,
        delta,
        recipeUnit: c.recipeUnit,
        costSource: c.costSource,
        vendorName: prov.vendorName,
        invoiceDate: prov.invoiceDate.toISOString().slice(0, 10),
      },
      deltaDollars: absDelta,
      deltaPct: c.costPerRecipeUnit > 0 ? absDelta / c.costPerRecipeUnit : null as unknown as number,
    })
  }

  return findings
}

if (require.main === module) {
  auditInvoices()
    .then((f) => {
      console.log(JSON.stringify(f, null, 2))
      const counts = { CRITICAL: 0, WARNING: 0, INFO: 0 }
      for (const x of f) counts[x.severity]++
      console.error(`invoices: ${f.length} findings  crit=${counts.CRITICAL} warn=${counts.WARNING} info=${counts.INFO}`)
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
