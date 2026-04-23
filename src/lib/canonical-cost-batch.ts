import { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import {
  deriveCostFromLineItem,
  type LineItemForCost,
} from "@/lib/ingredient-cost"
import type { CanonicalIngredientCost } from "@/lib/canonical-ingredients"

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
 * Batched equivalent of `getCanonicalIngredientCost` for every canonical owned
 * by `ownerId`. Runs in two queries: one `findMany` for the canonical rows and
 * one `DISTINCT ON` raw query for the latest matched invoice line per canonical.
 *
 * Mirrors the "useCanonical" / derive / raw-invoice branches of the single-row
 * path; the legacy alias-based fallback is intentionally omitted — this loader
 * is for the listing surface where it is fine to render a canonical with null
 * latest-invoice fields when no FK match exists.
 */
export async function batchCanonicalCosts(
  ownerId: string
): Promise<Map<string, CanonicalIngredientCost>> {
  const canonicals = await prisma.canonicalIngredient.findMany({
    where: { ownerId },
    select: {
      id: true,
      recipeUnit: true,
      costPerRecipeUnit: true,
      costSource: true,
      costUpdatedAt: true,
    },
  })

  const out = new Map<string, CanonicalIngredientCost>()
  if (canonicals.length === 0) return out

  const ids = canonicals.map((c) => c.id)

  // Latest matched invoice line per canonical. DISTINCT ON lets Postgres pick
  // the first row per (canonical_ingredient_id) after our ORDER BY, avoiding
  // an N+1 findFirst.
  const rows = await prisma.$queryRaw<ProvenanceRow[]>(Prisma.sql`
    SELECT DISTINCT ON (li."canonicalIngredientId")
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
    WHERE i."ownerId" = ${ownerId}
      AND li."canonicalIngredientId" = ANY(${ids}::text[])
      AND li."quantity" > 0
      AND i."invoiceDate" IS NOT NULL
    ORDER BY li."canonicalIngredientId", i."invoiceDate" DESC
  `)

  const provenance = new Map<string, ProvenanceRow>()
  for (const r of rows) provenance.set(r.canonicalIngredientId, r)

  for (const c of canonicals) {
    const prov = provenance.get(c.id)

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
      })
      continue
    }

    if (!prov) continue

    if (c.recipeUnit) {
      const line: LineItemForCost = {
        quantity: prov.quantity,
        unit: prov.unit,
        packSize: prov.packSize,
        unitSize: prov.unitSize,
        unitSizeUom: prov.unitSizeUom,
        unitPrice: prov.unitPrice,
        extendedPrice: prov.extendedPrice,
      }
      const derived = deriveCostFromLineItem(line, c.recipeUnit)
      if (derived != null) {
        out.set(c.id, {
          unitCost: derived,
          unit: c.recipeUnit,
          source: "invoice",
          asOfDate: prov.invoiceDate,
          sourceInvoiceId: prov.invoiceId,
          sourceLineItemId: prov.lineItemId,
          sourceVendor: prov.vendorName,
          sourceSku: prov.sku,
          sourceProductName: prov.productName,
        })
        continue
      }
    }

    // Raw-invoice-unit fallback (no recipeUnit, or derivation failed).
    if (prov.quantity > 0) {
      out.set(c.id, {
        unitCost: prov.extendedPrice / prov.quantity,
        unit: prov.unit ?? "unit",
        source: "invoice",
        asOfDate: prov.invoiceDate,
        sourceInvoiceId: prov.invoiceId,
        sourceLineItemId: prov.lineItemId,
        sourceVendor: prov.vendorName,
        sourceSku: prov.sku,
        sourceProductName: prov.productName,
      })
    }
  }

  return out
}
