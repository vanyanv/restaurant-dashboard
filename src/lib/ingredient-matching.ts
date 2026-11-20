import { prisma } from "@/lib/prisma"
import { Prisma } from "@/generated/prisma/client"
import { vendorMatchKey } from "@/lib/vendor-normalize"
import { recomputeCanonicalCost } from "@/lib/ingredient-cost"

export type MatchResult = {
  matchedBySku: number
  matchedByAlias: number
  matchedByName: number
  unmatched: number
  costsUpdated: number
}

/**
 * For each given invoice (by id), look at its line items and try to link them
 * to a CanonicalIngredient:
 *   1. (vendor, sku) → IngredientSkuMatch   (preferred, learned from prior confirms)
 *   2. productName    → IngredientAlias      (fallback for skuless vendors / legacy)
 *   3. productName    → an earlier matched line, any vendor or store, when
 *      that exact name (case and punctuation aside) has only ever been
 *      linked to one ingredient. This is what carries a vendor that starts
 *      billing under a new name: its SKUs and per-store aliases are unknown
 *      under the new key, but "Syrup Coca Cola Zero Sugar" is still the
 *      ingredient it was. A name seen on two ingredients proves nothing and
 *      is left for review.
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
    return { matchedBySku: 0, matchedByAlias: 0, matchedByName: 0, unmatched: 0, costsUpdated: 0 }
  }

  const invoices = await prisma.invoice.findMany({
    where: { id: { in: invoiceIds }, accountId },
    select: {
      id: true,
      vendorName: true,
      storeId: true,
      lineItems: {
        where: { canonicalIngredientId: null },
        select: { id: true, sku: true, productName: true, unit: true },
      },
    },
  })

  // Pre-load sku matches for this account in one go.
  const skuMatches = await prisma.ingredientSkuMatch.findMany({
    where: { accountId },
    select: { vendorKey: true, sku: true, canonicalIngredientId: true },
  })
  const skuIndex = new Map<string, string>()
  for (const m of skuMatches) {
    skuIndex.set(`${m.vendorKey}::${m.sku}`, m.canonicalIngredientId)
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

  const nameIndex = await loadUniqueProductNames(
    accountId,
    invoices.flatMap((i) => i.lineItems.map((li) => li.productName))
  )

  let matchedBySku = 0
  let matchedByAlias = 0
  let matchedByName = 0
  let unmatched = 0
  const now = new Date()
  const touchedCanonicals = new Set<string>()
  const links: LineLink[] = []

  for (const inv of invoices) {
    const vendor = vendorMatchKey(inv.vendorName)
    for (const li of inv.lineItems) {
      let canonicalId: string | undefined
      let source: "sku" | "alias" | "name" | undefined

      if (li.sku) {
        canonicalId = skuIndex.get(`${vendor}::${li.sku}`)
        if (canonicalId) source = "sku"
      }
      if (!canonicalId && inv.storeId) {
        canonicalId = aliasIndex.get(`${inv.storeId}::${li.productName.toLowerCase()}`)
        if (canonicalId) source = "alias"
      }
      if (!canonicalId) {
        const known = nameIndex.get(productNameKey(li.productName))
        // A different invoice unit (CS vs LB) would cost the line on another
        // basis than the ingredient's history; that one is for a person.
        if (known && (!li.unit || known.units.size === 0 || known.units.has(li.unit.toUpperCase()))) {
          canonicalId = known.canonicalId
          source = "name"
        }
      }

      if (canonicalId && source) {
        links.push({ id: li.id, canonicalIngredientId: canonicalId, matchSource: source })
        touchedCanonicals.add(canonicalId)
        if (source === "sku") matchedBySku++
        else if (source === "alias") matchedByAlias++
        else matchedByName++
      } else {
        unmatched++
      }
    }
  }

  // Every link in one statement (it was one UPDATE per line, which on a
  // 40-line Sysco bill was 40 round trips and the slowest part of a sync).
  await linkLineItems(links, now)

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

  return { matchedBySku, matchedByAlias, matchedByName, unmatched, costsUpdated }
}

export type LineLink = { id: string; canonicalIngredientId: string; matchSource: string }

/**
 * Link many invoice lines to their ingredients in one
 * `UPDATE ... FROM (VALUES ...)`. Only lines still unmatched are touched, so a
 * line someone matched by hand in the meantime keeps their pick. Returns the
 * number of rows written.
 */
export async function linkLineItems(links: LineLink[], matchedAt: Date): Promise<number> {
  if (links.length === 0) return 0
  const values = Prisma.join(
    links.map((l) => Prisma.sql`(${l.id}::text, ${l.canonicalIngredientId}::text, ${l.matchSource}::text)`)
  )
  return prisma.$executeRaw`
    UPDATE "InvoiceLineItem" AS li SET
      "canonicalIngredientId" = v.cid,
      "matchSource" = v.src,
      "matchedAt" = ${matchedAt}::timestamp
    FROM (VALUES ${values}) AS v(id, cid, src)
    WHERE li."id" = v.id AND li."canonicalIngredientId" IS NULL`
}

/** Case, punctuation and spacing are noise in a product name, as in a vendor's. */
export function productNameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

/**
 * Product name → ingredient, for the names in this batch that every line
 * matched by SKU or by hand has linked to the same one ingredient, with the
 * invoice units those lines came in. Names linked to more than one are dropped
 * rather than guessed at. Alias and name matches are left out on purpose: a
 * guess must not become the evidence for the next guess.
 */
async function loadUniqueProductNames(
  accountId: string,
  productNames: string[]
): Promise<Map<string, { canonicalId: string; units: Set<string> }>> {
  const out = new Map<string, { canonicalId: string; units: Set<string> }>()
  const names = [...new Set(productNames.map((n) => n.trim()).filter(Boolean))]
  if (names.length === 0) return out
  const rows = await prisma.invoiceLineItem.groupBy({
    by: ["productName", "canonicalIngredientId", "unit"],
    where: {
      canonicalIngredientId: { not: null },
      matchSource: { in: ["sku", "manual"] },
      productName: { in: names, mode: "insensitive" },
      invoice: { accountId },
    },
  })
  const owners = new Map<string, { canonicals: Set<string>; units: Set<string> }>()
  for (const r of rows) {
    if (!r.canonicalIngredientId) continue
    const key = productNameKey(r.productName)
    if (!key) continue
    const entry = owners.get(key) ?? { canonicals: new Set<string>(), units: new Set<string>() }
    entry.canonicals.add(r.canonicalIngredientId)
    if (r.unit) entry.units.add(r.unit.toUpperCase())
    owners.set(key, entry)
  }
  for (const [key, entry] of owners) {
    if (entry.canonicals.size === 1) {
      out.set(key, { canonicalId: [...entry.canonicals][0], units: entry.units })
    }
  }
  return out
}
