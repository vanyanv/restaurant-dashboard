import { prisma } from "@/lib/prisma"
import { normalizeVendorName } from "@/lib/vendor-normalize"
import { recomputeCanonicalCost } from "@/lib/ingredient-cost"

export type MatchResult = {
  matchedBySku: number
  matchedByAlias: number
  unmatched: number
  costsUpdated: number
}

/**
 * For each given invoice (by id), look at its line items and try to link them
 * to a CanonicalIngredient:
 *   1. (vendor, sku) → IngredientSkuMatch   (preferred, learned from prior confirms)
 *   2. productName    → IngredientAlias      (fallback for skuless vendors / legacy)
 *
 * Leaves `canonicalIngredientId` null when neither path hits — those land in
 * the "Needs review" queue at /dashboard/ingredients.
 *
 * Safe to re-run: only touches line items where canonicalIngredientId is null.
 */
export async function matchNewLineItems(
  accountId: string,
  invoiceIds: string[]
): Promise<MatchResult> {
  if (invoiceIds.length === 0) {
    return { matchedBySku: 0, matchedByAlias: 0, unmatched: 0, costsUpdated: 0 }
  }

  const invoices = await prisma.invoice.findMany({
    where: { id: { in: invoiceIds }, accountId },
    select: {
      id: true,
      vendorName: true,
      storeId: true,
      lineItems: {
        where: { canonicalIngredientId: null },
        select: { id: true, sku: true, productName: true },
      },
    },
  })

  // Pre-load sku matches for this account in one go.
  const skuMatches = await prisma.ingredientSkuMatch.findMany({
    where: { accountId },
    select: { vendorName: true, sku: true, canonicalIngredientId: true },
  })
  const skuIndex = new Map<string, string>()
  for (const m of skuMatches) {
    skuIndex.set(`${m.vendorName}::${m.sku}`, m.canonicalIngredientId)
  }

  // Pre-load aliases per store.
  const storeIds = [...new Set(invoices.map((i) => i.storeId).filter((s): s is string => !!s))]
  const aliases = storeIds.length
    ? await prisma.ingredientAlias.findMany({
        where: { storeId: { in: storeIds }, canonicalIngredientId: { not: null } },
        select: { storeId: true, rawName: true, canonicalIngredientId: true },
      })
    : []
  const aliasIndex = new Map<string, string>()
  for (const a of aliases) {
    if (a.canonicalIngredientId) {
      aliasIndex.set(`${a.storeId}::${a.rawName.toLowerCase()}`, a.canonicalIngredientId)
    }
  }

  let matchedBySku = 0
  let matchedByAlias = 0
  let unmatched = 0
  const now = new Date()
  const touchedCanonicals = new Set<string>()

  for (const inv of invoices) {
    const vendor = normalizeVendorName(inv.vendorName)
    for (const li of inv.lineItems) {
      let canonicalId: string | undefined
      let source: "sku" | "alias" | undefined

      if (li.sku) {
        canonicalId = skuIndex.get(`${vendor}::${li.sku}`)
        if (canonicalId) source = "sku"
      }
      if (!canonicalId && inv.storeId) {
        canonicalId = aliasIndex.get(`${inv.storeId}::${li.productName.toLowerCase()}`)
        if (canonicalId) source = "alias"
      }

      if (canonicalId && source) {
        await prisma.invoiceLineItem.update({
          where: { id: li.id },
          data: {
            canonicalIngredientId: canonicalId,
            matchSource: source,
            matchedAt: now,
          },
        })
        touchedCanonicals.add(canonicalId)
        if (source === "sku") matchedBySku++
        else matchedByAlias++
      } else {
        unmatched++
      }
    }
  }

  // Now that new line items are linked, refresh each touched canonical's
  // cost-per-recipe-unit from its most recent matched line (respects costLocked).
  let costsUpdated = 0
  for (const canonicalId of touchedCanonicals) {
    try {
      const res = await recomputeCanonicalCost(canonicalId)
      if (res.status === "updated") costsUpdated++
    } catch (e) {
      console.warn("[matchNewLineItems] recomputeCanonicalCost failed:", e)
    }
  }

  return { matchedBySku, matchedByAlias, unmatched, costsUpdated }
}
