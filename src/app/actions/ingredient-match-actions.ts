"use server"

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/generated/prisma/client"
import { normalizeVendorName } from "@/lib/vendor-normalize"
import { invalidateDailyCogs } from "@/lib/cogs-invalidate"
import { recomputeCanonicalCost } from "@/lib/ingredient-cost"
import { revalidatePath } from "next/cache"

async function requireOwnerId(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  return session?.user?.id ?? null
}

export type UnmatchedLineItemGroup = {
  /** Stable key combining vendor+sku (or vendor+productName when sku is null). */
  key: string
  vendorName: string
  sku: string | null
  productName: string
  unit: string | null
  sampleLineItemId: string
  occurrences: number
  totalSpend: number
  lastSeen: Date | null
  /** Normalized preview cost derived from the sample line: "$3.30/lb" or null. */
  derivedCostPreview: { costPerBase: number; baseUnit: string } | null
}

/**
 * Capped at 200 groups: owners with deep history can accumulate tens of
 * thousands of unmatched lines, and the UI surfaces highest-spend first so
 * the long tail isn't actionable enough to pay the scan cost for.
 */
export async function listUnmatchedLineItems(): Promise<UnmatchedLineItemGroup[]> {
  const ownerId = await requireOwnerId()
  if (!ownerId) return []

  // Group at the DB — vendor_name on Invoice, plus sku/product_name/unit on
  // InvoiceLineItem. Pick one sample line id per group (latest by invoiceDate)
  // so the downstream preview-cost lookup is O(200), not O(all unmatched).
  const rawGroups = await prisma.$queryRaw<
    Array<{
      vendorName: string
      sku: string | null
      productName: string
      unit: string | null
      occurrences: number
      totalSpend: Prisma.Decimal | number | null
      lastSeen: Date | null
      sampleLineItemId: string
    }>
  >(Prisma.sql`
    SELECT
      i."vendorName"       AS "vendorName",
      li.sku               AS "sku",
      li."productName"     AS "productName",
      li.unit              AS "unit",
      COUNT(*)::int        AS "occurrences",
      SUM(li."extendedPrice") AS "totalSpend",
      MAX(i."invoiceDate") AS "lastSeen",
      (ARRAY_AGG(li.id ORDER BY i."invoiceDate" DESC NULLS LAST))[1] AS "sampleLineItemId"
    FROM "InvoiceLineItem" li
    JOIN "Invoice" i ON i.id = li."invoiceId"
    WHERE i."ownerId" = ${ownerId}
      AND li."canonicalIngredientId" IS NULL
    GROUP BY i."vendorName", li.sku, li."productName", li.unit
    ORDER BY SUM(li."extendedPrice") DESC
    LIMIT 200
  `)

  if (rawGroups.length === 0) return []

  const sampleIds = rawGroups.map((r) => r.sampleLineItemId)
  const samples = await prisma.invoiceLineItem.findMany({
    where: { id: { in: sampleIds } },
    select: {
      id: true,
      quantity: true,
      packSize: true,
      unitSize: true,
      unitSizeUom: true,
      unit: true,
      extendedPrice: true,
    },
  })

  const previewBySample = new Map<
    string,
    UnmatchedLineItemGroup["derivedCostPreview"]
  >()
  for (const li of samples) {
    const packSize = li.packSize ?? 1
    const unitSize = li.unitSize ?? 1
    const totalBaseQty = li.quantity * packSize * unitSize
    const baseUom = li.unitSizeUom ?? li.unit
    const derivedCostPreview =
      totalBaseQty > 0 && baseUom && li.extendedPrice > 0
        ? {
            costPerBase: li.extendedPrice / totalBaseQty,
            baseUnit: baseUom.toLowerCase(),
          }
        : null
    previewBySample.set(li.id, derivedCostPreview)
  }

  const toNumber = (v: Prisma.Decimal | number | null | undefined): number => {
    if (v == null) return 0
    if (typeof v === "number") return v
    return Number(v.toString())
  }

  // Merge by normalized vendor (aliases like "SYSCO" / "Sysco Corp" collapse
  // to the same display vendor). SQL-side grouping used the raw vendorName,
  // so two raw-vendor rows can land on the same normalized key here.
  const merged = new Map<string, UnmatchedLineItemGroup>()
  for (const r of rawGroups) {
    const vendor = normalizeVendorName(r.vendorName)
    const key = r.sku
      ? `${vendor}::sku::${r.sku}`
      : `${vendor}::name::${r.productName.toLowerCase()}`
    const spend = toNumber(r.totalSpend)
    const existing = merged.get(key)
    if (existing) {
      existing.occurrences += Number(r.occurrences)
      existing.totalSpend += spend
      if (r.lastSeen && (!existing.lastSeen || r.lastSeen > existing.lastSeen)) {
        existing.lastSeen = r.lastSeen
        existing.sampleLineItemId = r.sampleLineItemId
        existing.derivedCostPreview =
          previewBySample.get(r.sampleLineItemId) ?? null
      }
    } else {
      merged.set(key, {
        key,
        vendorName: vendor,
        sku: r.sku,
        productName: r.productName,
        unit: r.unit,
        sampleLineItemId: r.sampleLineItemId,
        occurrences: Number(r.occurrences),
        totalSpend: spend,
        lastSeen: r.lastSeen,
        derivedCostPreview:
          previewBySample.get(r.sampleLineItemId) ?? null,
      })
    }
  }

  return [...merged.values()].sort((a, b) => b.totalSpend - a.totalSpend)
}

export type UnmatchedLineItemHit = {
  lineItemId: string
  vendorName: string
  sku: string | null
  productName: string
  unit: string | null
  latestUnitPrice: number
  latestDate: Date | null
  occurrences: number
}

/**
 * Search unmatched invoice line items — used by the in-flow command palette
 * so the user can pick a raw invoice line and match it without leaving the
 * recipe canvas. Returns at most 20 hits, grouped by (vendor, sku).
 */
export async function searchUnmatchedLineItems(
  query: string,
  limit: number = 20
): Promise<UnmatchedLineItemHit[]> {
  const ownerId = await requireOwnerId()
  if (!ownerId) return []

  const q = query.trim()
  if (!q) return []

  const matches = await prisma.invoiceLineItem.findMany({
    where: {
      canonicalIngredientId: null,
      invoice: { ownerId },
      productName: { contains: q, mode: "insensitive" },
    },
    orderBy: { invoice: { invoiceDate: "desc" } },
    take: 200,
    select: {
      id: true,
      sku: true,
      productName: true,
      unit: true,
      unitPrice: true,
      invoice: { select: { vendorName: true, invoiceDate: true } },
    },
  })

  const grouped = new Map<string, UnmatchedLineItemHit>()
  for (const li of matches) {
    const vendor = normalizeVendorName(li.invoice.vendorName)
    const key = li.sku
      ? `${vendor}::sku::${li.sku}`
      : `${vendor}::name::${li.productName.toLowerCase()}`
    const existing = grouped.get(key)
    if (existing) {
      existing.occurrences += 1
      if (li.invoice.invoiceDate && (!existing.latestDate || li.invoice.invoiceDate > existing.latestDate)) {
        existing.latestDate = li.invoice.invoiceDate
        existing.latestUnitPrice = li.unitPrice
      }
    } else {
      grouped.set(key, {
        lineItemId: li.id,
        vendorName: vendor,
        sku: li.sku,
        productName: li.productName,
        unit: li.unit,
        latestUnitPrice: li.unitPrice,
        latestDate: li.invoice.invoiceDate,
        occurrences: 1,
      })
    }
  }

  return [...grouped.values()].slice(0, limit)
}

/**
 * Confirm a (vendor, sku) → canonical match. Upserts the IngredientSkuMatch
 * row, then backfills every past InvoiceLineItem with that (vendor, sku) so
 * historical recipes light up too.
 *
 * If the line item has no SKU, falls back to creating an IngredientAlias so
 * string-based matching still works for skuless vendors.
 */
export async function confirmSkuMatch(input: {
  lineItemId: string
  canonicalIngredientId?: string
  newCanonical?: { name: string; defaultUnit: string; category?: string | null }
}): Promise<{ backfilled: number; canonicalIngredientId: string }> {
  const ownerId = await requireOwnerId()
  if (!ownerId) throw new Error("Not authenticated")

  const li = await prisma.invoiceLineItem.findFirst({
    where: { id: input.lineItemId, invoice: { ownerId } },
    select: {
      id: true,
      sku: true,
      productName: true,
      unit: true,
      invoice: { select: { vendorName: true, storeId: true } },
    },
  })
  if (!li) throw new Error("Line item not found")

  const vendor = normalizeVendorName(li.invoice.vendorName)

  let canonicalId = input.canonicalIngredientId
  if (!canonicalId && input.newCanonical) {
    const created = await prisma.canonicalIngredient.create({
      data: {
        ownerId,
        name: input.newCanonical.name.trim(),
        defaultUnit: input.newCanonical.defaultUnit,
        category: input.newCanonical.category ?? null,
      },
    })
    canonicalId = created.id
  }
  if (!canonicalId) throw new Error("canonicalIngredientId or newCanonical required")
  const targetCanonicalId: string = canonicalId

  if (li.sku) {
    await prisma.ingredientSkuMatch.upsert({
      where: {
        ownerId_vendorName_sku: { ownerId, vendorName: vendor, sku: li.sku },
      },
      update: {
        canonicalIngredientId: targetCanonicalId,
        confirmedBy: ownerId,
        confirmedAt: new Date(),
      },
      create: {
        ownerId,
        vendorName: vendor,
        sku: li.sku,
        canonicalIngredientId: targetCanonicalId,
        conversionFactor: 1,
        fromUnit: li.unit ?? "unit",
        toUnit: li.unit ?? "unit",
        confirmedBy: ownerId,
      },
    })

    const backfill = await prisma.invoiceLineItem.updateMany({
      where: {
        sku: li.sku,
        canonicalIngredientId: null,
        invoice: { ownerId, vendorName: { equals: li.invoice.vendorName } },
      },
      data: {
        canonicalIngredientId: targetCanonicalId,
        matchSource: "sku",
        matchedAt: new Date(),
      },
    })

    // Auto-derive canonical.costPerRecipeUnit from the newly-linked invoice.
    // No-ops when the canonical is locked, has no recipeUnit, or units don't convert.
    await recomputeCanonicalCost(targetCanonicalId).catch((e) => {
      console.warn("[confirmSkuMatch] recomputeCanonicalCost failed:", e)
    })

    await invalidateDailyCogs({ kind: "owner-full", ownerId })
    revalidatePath("/dashboard/ingredients")
    revalidatePath("/dashboard/menu/catalog")
    revalidatePath("/dashboard/recipes")
    return { backfilled: backfill.count, canonicalIngredientId: targetCanonicalId }
  }

  // No SKU — fall back to IngredientAlias so name matching kicks in.
  if (!li.invoice.storeId) {
    throw new Error(
      "This invoice has no store assigned yet. Assign it first so the alias can be scoped."
    )
  }

  await prisma.ingredientAlias.upsert({
    where: {
      storeId_rawName: { storeId: li.invoice.storeId, rawName: li.productName },
    },
    update: { canonicalIngredientId: targetCanonicalId },
    create: {
      storeId: li.invoice.storeId,
      canonicalIngredientId: targetCanonicalId,
      canonicalName: "",
      rawName: li.productName,
      conversionFactor: 1,
      fromUnit: li.unit ?? "unit",
      toUnit: li.unit ?? "unit",
    },
  })

  const backfill = await prisma.invoiceLineItem.updateMany({
    where: {
      productName: li.productName,
      canonicalIngredientId: null,
      invoice: { ownerId, storeId: li.invoice.storeId },
    },
    data: {
      canonicalIngredientId: targetCanonicalId,
      matchSource: "alias",
      matchedAt: new Date(),
    },
  })

  await recomputeCanonicalCost(targetCanonicalId).catch((e) => {
    console.warn("[confirmSkuMatch/alias] recomputeCanonicalCost failed:", e)
  })

  await invalidateDailyCogs({ kind: "owner-full", ownerId })
  revalidatePath("/dashboard/ingredients")
  revalidatePath("/dashboard/menu/catalog")
  revalidatePath("/dashboard/recipes")
  return { backfilled: backfill.count, canonicalIngredientId: targetCanonicalId }
}

/**
 * Undo a previously-confirmed match. Clears the learned sku match and the FK
 * on all affected line items. Does NOT delete the CanonicalIngredient.
 */
export async function breakSkuMatch(input: {
  vendorName: string
  sku: string
}): Promise<{ cleared: number }> {
  const ownerId = await requireOwnerId()
  if (!ownerId) throw new Error("Not authenticated")

  const vendor = normalizeVendorName(input.vendorName)

  await prisma.ingredientSkuMatch
    .delete({
      where: {
        ownerId_vendorName_sku: { ownerId, vendorName: vendor, sku: input.sku },
      },
    })
    .catch(() => null)

  const cleared = await prisma.invoiceLineItem.updateMany({
    where: {
      sku: input.sku,
      matchSource: "sku",
      invoice: { ownerId, vendorName: { equals: input.vendorName } },
    },
    data: {
      canonicalIngredientId: null,
      matchSource: null,
      matchedAt: null,
    },
  })

  await invalidateDailyCogs({ kind: "owner-full", ownerId })
  revalidatePath("/dashboard/ingredients")
  revalidatePath("/dashboard/menu/catalog")
  revalidatePath("/dashboard/recipes")
  return { cleared: cleared.count }
}
