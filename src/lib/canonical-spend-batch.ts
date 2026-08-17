/**
 * 90-day purchase totals per canonical ingredient — the Pantry ledger's sort
 * key.
 *
 * Deliberately NOT folded into `batchCanonicalCosts` or
 * `listCanonicalIngredients`: those sit on mobile's and the recipe editor's
 * critical path, and neither needs an aggregation over every invoice line in
 * the window.
 *
 * `extendedPrice` carries its natural sign (returns and credit memos are
 * negative), so the sum is already net spend and needs no special-casing.
 */
import { prisma } from "@/lib/prisma"
import { normalizeVendorName } from "@/lib/vendor-normalize"

export type CanonicalSpend = {
  /** Net dollars purchased in the window. */
  spend: number
  lineCount: number
  /** Normalised supplier names, insertion-ordered. */
  vendors: string[]
  /** Distinct non-blank SKUs. More than one means more than one product. */
  skus: string[]
  lastPurchaseAt: Date | null
}

export const DEFAULT_SPEND_WINDOW_DAYS = 90

export async function batchCanonicalSpend(
  accountId: string,
  days: number = DEFAULT_SPEND_WINDOW_DAYS
): Promise<Map<string, CanonicalSpend>> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const lines = await prisma.invoiceLineItem.findMany({
    where: {
      canonicalIngredientId: { not: null },
      invoice: { accountId, invoiceDate: { gte: since, not: null } },
    },
    select: {
      canonicalIngredientId: true,
      extendedPrice: true,
      sku: true,
      invoice: { select: { vendorName: true, invoiceDate: true } },
    },
  })

  const out = new Map<string, CanonicalSpend>()
  const vendorSets = new Map<string, Set<string>>()
  const skuSets = new Map<string, Set<string>>()

  for (const li of lines) {
    const id = li.canonicalIngredientId
    if (!id) continue

    const row =
      out.get(id) ??
      { spend: 0, lineCount: 0, vendors: [], skus: [], lastPurchaseAt: null }
    row.spend += li.extendedPrice
    row.lineCount += 1
    const date = li.invoice.invoiceDate
    if (date && (row.lastPurchaseAt == null || date > row.lastPurchaseAt)) {
      row.lastPurchaseAt = date
    }
    out.set(id, row)

    const vendors = vendorSets.get(id) ?? new Set<string>()
    vendors.add(normalizeVendorName(li.invoice.vendorName))
    vendorSets.set(id, vendors)

    const sku = li.sku?.trim()
    if (sku) {
      const skus = skuSets.get(id) ?? new Set<string>()
      skus.add(sku)
      skuSets.set(id, skus)
    }
  }

  for (const [id, row] of out) {
    row.vendors = [...(vendorSets.get(id) ?? [])]
    row.skus = [...(skuSets.get(id) ?? [])]
  }

  return out
}
