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
    WHERE i."accountId" = ${accountId}
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
          })
          break
        }
      }
    }
  }

  return out
}
