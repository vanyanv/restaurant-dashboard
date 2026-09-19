import { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import { COST_CANDIDATE_WINDOW, selectNonSpikeCostIndex } from "@/lib/invoice-line-shape"
import {
  resolveLineUnitCost,
  type CanonicalIngredientCost,
} from "@/lib/canonical-ingredients"
import { logger } from "@/lib/logger"

type ProvenanceRow = {
  canonicalIngredientId: string
  lineItemId: string
  invoiceId: string
  sku: string | null
  productName: string
  quantity: number
  unit: string | null
  packSize: number | null
  unitSize: number | null
  unitSizeUom: string | null
  unitPrice: number
  extendedPrice: number
  invoiceDate: Date
  vendorName: string
}

/**
 * Batched equivalent of `getCanonicalIngredientCost` for every canonical on
 * `accountId`. Runs in three batched queries:
 *   1. canonical rows
 *   2. DISTINCT ON for the latest matched invoice line per canonical (FK path)
 *   3. alias fallback for canonicals that have no direct FK match yet
 *
 * Step 3 was previously omitted "for performance," but that caused listing
 * surfaces to show null cost for canonicals that the single-row path
 * (`getCanonicalIngredientCost`) successfully costs via the alias fallback.
 * Now mirrored so detail and list views agree.
 */
export async function batchCanonicalCosts(
  accountId: string
): Promise<Map<string, CanonicalIngredientCost>> {
  const canonicals = await prisma.canonicalIngredient.findMany({
    where: { accountId },
    select: {
      id: true,
      recipeUnit: true,
      costPerRecipeUnit: true,
      costSource: true,
      costUpdatedAt: true,
      yieldFactor: true,
    },
  })

  const out = new Map<string, CanonicalIngredientCost>()
  if (canonicals.length === 0) return out

  const ids = canonicals.map((c) => c.id)

  // A short window of recent lines per canonical, newest first — not just the
  // newest one. `getCanonicalIngredientCost` pulls the same window so the
  // spike guard has price history to judge the newest line against, and a
  // batch that pulled a single row had nothing to judge and so ran no guard
  // at all. That is how the ingredients LIST showed the $47/lb mis-parse that
  // the ingredient's own DETAIL page rejected, off the same invoice.
  const rows = await prisma.$queryRaw<ProvenanceRow[]>(Prisma.sql`
    SELECT * FROM (
      SELECT
      ROW_NUMBER() OVER (
        PARTITION BY li."canonicalIngredientId" ORDER BY i."invoiceDate" DESC
      ) AS rn,
      li."canonicalIngredientId" AS "canonicalIngredientId",
      li."id"            AS "lineItemId",
      li."invoiceId"     AS "invoiceId",
      li."sku"           AS "sku",
      li."productName"   AS "productName",
      li."quantity"      AS "quantity",
      li."unit"          AS "unit",
      li."packSize"      AS "packSize",
      li."unitSize"      AS "unitSize",
      li."unitSizeUom"   AS "unitSizeUom",
      li."unitPrice"     AS "unitPrice",
      li."extendedPrice" AS "extendedPrice",
      i."invoiceDate"    AS "invoiceDate",
      i."vendorName"     AS "vendorName"
    FROM "InvoiceLineItem" li
    JOIN "Invoice" i ON i."id" = li."invoiceId"
    WHERE i."accountId" = ${accountId}
      AND li."canonicalIngredientId" = ANY(${ids}::text[])
      AND li."quantity" > 0
      AND i."invoiceDate" IS NOT NULL
    ) ranked
    WHERE rn <= ${COST_CANDIDATE_WINDOW}
    ORDER BY "canonicalIngredientId", rn
  `)

  // Newest first within each canonical, which is the order the guard expects.
  const provenanceWindow = new Map<string, ProvenanceRow[]>()
  for (const r of rows) {
    const list = provenanceWindow.get(r.canonicalIngredientId) ?? []
    list.push(r)
    provenanceWindow.set(r.canonicalIngredientId, list)
  }

  // The vendor-specific conversion the single-row path applies. Without it a
  // canonical whose vendor SKU carries its own factor was costed one way on
  // its detail page and another on every list that showed it.
  const vendorMatches = await prisma.ingredientSkuMatch.findMany({
    where: { canonicalIngredientId: { in: ids } },
    select: {
      canonicalIngredientId: true,
      conversionFactor: true,
      fromUnit: true,
      toUnit: true,
    },
  })
  const vendorByCanonical = new Map<
    string,
    { conversionFactor: number; fromUnit: string; toUnit: string }
  >()
  for (const m of vendorMatches) {
    if (!m.canonicalIngredientId) continue
    if (!vendorByCanonical.has(m.canonicalIngredientId)) {
      vendorByCanonical.set(m.canonicalIngredientId, {
        conversionFactor: m.conversionFactor,
        fromUnit: m.fromUnit,
        toUnit: m.toUnit,
      })
    }
  }

  for (const c of canonicals) {
    const window = provenanceWindow.get(c.id) ?? []
    const prov = window[0]

    const useCanonical =
      c.costPerRecipeUnit != null && !!c.recipeUnit

    if (useCanonical) {
      out.set(c.id, {
        unitCost: c.costPerRecipeUnit!,
        unit: c.recipeUnit!,
        source: c.costSource === "invoice" ? "invoice" : "manual",
        asOfDate: prov?.invoiceDate ?? c.costUpdatedAt ?? new Date(),
        sourceInvoiceId: prov?.invoiceId ?? null,
        sourceLineItemId: prov?.lineItemId ?? null,
        sourceVendor: prov?.vendorName ?? null,
        sourceSku: prov?.sku ?? null,
        sourceProductName: prov?.productName ?? null,
        yieldFactor: c.yieldFactor,
      })
      continue
    }

    if (!prov) continue

    // One rule for "what does this line cost per recipe unit", shared with
    // `getCanonicalIngredientCost`: pack-shape derivation first, then the
    // legacy raw `extendedPrice / quantity` fallback, then the spike guard
    // over the window. The batch used to inline its own version of the first
    // two and skip the third.
    const vendorMatch = c.recipeUnit ? vendorByCanonical.get(c.id) ?? null : null
    const resolved = window
      .map((line) => ({ line, cost: resolveLineUnitCost(line, c.recipeUnit, vendorMatch) }))
      .filter(
        (r): r is { line: ProvenanceRow; cost: { unitCost: number; unit: string } } =>
          r.cost !== null,
      )
    if (resolved.length === 0) continue

    const { index, rejectedSpike } = selectNonSpikeCostIndex(
      resolved.map((r) => r.cost.unitCost),
    )
    const chosen = resolved[index]

    if (rejectedSpike) {
      const newest = resolved[0]
      logger.warn(
        `[cost-guard] canonical ${c.id}: rejected spiked invoice cost ` +
          `$${newest.cost.unitCost.toFixed(2)}/${newest.cost.unit} (line ${newest.line.lineItemId}, ` +
          `invoice ${newest.line.invoiceId}); using $${chosen.cost.unitCost.toFixed(2)}/${chosen.cost.unit} ` +
          `from ${chosen.line.invoiceDate.toISOString().slice(0, 10)} instead`,
      )
    }

    out.set(c.id, {
      unitCost: chosen.cost.unitCost,
      unit: chosen.cost.unit,
      source: "invoice",
      asOfDate: chosen.line.invoiceDate,
      sourceInvoiceId: chosen.line.invoiceId,
      sourceLineItemId: chosen.line.lineItemId,
      sourceVendor: chosen.line.vendorName,
      sourceSku: chosen.line.sku,
      sourceProductName: chosen.line.productName,
      // Without this the recipes built on a guarded ingredient never read as
      // partial: `recipe-cost.ts` branches on it, and the batch path — the
      // one every list uses — could never set it.
      costGuardTriggered: rejectedSpike,
      yieldFactor: c.yieldFactor,
    })
  }

  // Alias fallback for canonicals that still have no cost. Mirrors the
  // tail of `getCanonicalIngredientCost` so listing matches detail.
  const stillMissing = canonicals.filter((c) => !out.has(c.id))
  if (stillMissing.length > 0) {
    const aliases = await prisma.ingredientAlias.findMany({
      where: { canonicalIngredientId: { in: stillMissing.map((c) => c.id) } },
      select: {
        canonicalIngredientId: true,
        storeId: true,
        rawName: true,
        conversionFactor: true,
        toUnit: true,
      },
    })
    if (aliases.length > 0) {
      const aliasByCanonical = new Map<string, typeof aliases>()
      for (const a of aliases) {
        if (!a.canonicalIngredientId) continue
        const list = aliasByCanonical.get(a.canonicalIngredientId) ?? []
        list.push(a)
        aliasByCanonical.set(a.canonicalIngredientId, list)
      }

      const candidates = await prisma.invoiceLineItem.findMany({
        where: {
          canonicalIngredientId: null,
          invoice: { storeId: { in: aliases.map((a) => a.storeId) } },
          productName: { in: aliases.map((a) => a.rawName) },
        },
        orderBy: { invoice: { invoiceDate: "desc" } },
        take: 50 * stillMissing.length,
        select: {
          id: true,
          invoiceId: true,
          sku: true,
          productName: true,
          quantity: true,
          extendedPrice: true,
          invoice: { select: { invoiceDate: true, storeId: true, vendorName: true } },
        },
      })

      for (const c of stillMissing) {
        const aliasList = aliasByCanonical.get(c.id)
        if (!aliasList) continue
        const aliasLookup = new Map(
          aliasList.map((a) => [`${a.storeId}::${a.rawName.toLowerCase()}`, a])
        )
        for (const li of candidates) {
          if (!li.invoice.invoiceDate || !li.invoice.storeId) continue
          const alias = aliasLookup.get(
            `${li.invoice.storeId}::${li.productName.toLowerCase()}`
          )
          if (!alias) continue
          const normalizedQty = li.quantity * alias.conversionFactor
          if (normalizedQty <= 0) continue
          out.set(c.id, {
            unitCost: li.extendedPrice / normalizedQty,
            unit: alias.toUnit,
            source: "invoice",
            asOfDate: li.invoice.invoiceDate,
            sourceInvoiceId: li.invoiceId,
            sourceLineItemId: li.id,
            sourceVendor: li.invoice.vendorName,
            sourceSku: li.sku,
            sourceProductName: li.productName,
            yieldFactor: c.yieldFactor,
          })
          break
        }
      }
    }
  }

  return out
}
