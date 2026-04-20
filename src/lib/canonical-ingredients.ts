import { prisma } from "@/lib/prisma"
import { normalizeVendorName } from "@/lib/vendor-normalize"

/** Rough lowercase + collapse-whitespace + strip-trailing-parens normalizer. */
function normalizeProductName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*\([^)]*\)\s*$/g, "")
    .trim()
}

export type SeedResult = {
  canonicalsCreated: number
  aliasesCreated: number
  skuMatchesCreated: number
  skipped: number
}

/**
 * Walk every unlinked InvoiceLineItem for this owner and give each one a
 * canonical ingredient. Identity precedence:
 *
 *   1. (normalizedVendor, sku) → existing IngredientSkuMatch          (preferred; survives name variants)
 *   2. (normalizedVendor, sku) seen on another line in this pass     (same SKU, no match yet; reuse the canonical we picked)
 *   3. productName → existing CanonicalIngredient by normalized name  (legacy; last resort)
 *   4. create a new canonical
 *
 * When we create or find a canonical for a SKU-carrying line, we also upsert
 * an IngredientSkuMatch so subsequent invoices with the same (vendor, sku)
 * auto-link without any manual review.
 *
 * Lines without a SKU keep the existing per-store IngredientAlias fallback.
 */
export async function seedCanonicalIngredientsFromInvoices(
  ownerId: string
): Promise<SeedResult> {
  const lineItems = await prisma.invoiceLineItem.findMany({
    where: { invoice: { ownerId }, canonicalIngredientId: null },
    select: {
      id: true,
      sku: true,
      productName: true,
      unit: true,
      category: true,
      invoice: { select: { vendorName: true, storeId: true } },
    },
  })

  const existingSkuMatches = await prisma.ingredientSkuMatch.findMany({
    where: { ownerId },
    select: { vendorName: true, sku: true, canonicalIngredientId: true },
  })
  const skuIndex = new Map<string, string>(
    existingSkuMatches.map((m) => [`${m.vendorName}::${m.sku}`, m.canonicalIngredientId])
  )

  const existingAliases = await prisma.ingredientAlias.findMany({
    where: { store: { ownerId } },
    select: { storeId: true, rawName: true },
  })
  const seenAlias = new Set(
    existingAliases.map((a) => `${a.storeId}::${a.rawName.toLowerCase()}`)
  )

  const existingCanonicals = await prisma.canonicalIngredient.findMany({
    where: { ownerId },
    select: { id: true, name: true },
  })
  const canonicalByName = new Map(
    existingCanonicals.map((c) => [c.name.toLowerCase(), c.id])
  )

  let canonicalsCreated = 0
  let aliasesCreated = 0
  let skuMatchesCreated = 0
  let skipped = 0

  for (const li of lineItems) {
    const vendor = normalizeVendorName(li.invoice.vendorName)
    const skuKey = li.sku ? `${vendor}::${li.sku}` : null
    const canonicalName = normalizeProductName(li.productName)
    const now = new Date()

    // Path A: SKU-carrying line — identity is (vendor, sku).
    if (skuKey && li.sku) {
      let canonicalId = skuIndex.get(skuKey)
      if (!canonicalId) {
        // First time seeing this SKU — try name reuse, else create.
        canonicalId = canonicalByName.get(canonicalName)
        if (!canonicalId) {
          const created = await prisma.canonicalIngredient.create({
            data: {
              ownerId,
              name: canonicalName,
              defaultUnit: li.unit ?? "unit",
              category: li.category ?? null,
            },
          })
          canonicalId = created.id
          canonicalByName.set(canonicalName, canonicalId)
          canonicalsCreated++
        }
        await prisma.ingredientSkuMatch.upsert({
          where: {
            ownerId_vendorName_sku: { ownerId, vendorName: vendor, sku: li.sku },
          },
          update: { canonicalIngredientId: canonicalId, confirmedAt: now },
          create: {
            ownerId,
            vendorName: vendor,
            sku: li.sku,
            canonicalIngredientId: canonicalId,
            conversionFactor: 1,
            fromUnit: li.unit ?? "unit",
            toUnit: li.unit ?? "unit",
            confirmedBy: ownerId,
          },
        })
        skuIndex.set(skuKey, canonicalId)
        skuMatchesCreated++
      }

      await prisma.invoiceLineItem.update({
        where: { id: li.id },
        data: { canonicalIngredientId: canonicalId, matchSource: "sku", matchedAt: now },
      })
      continue
    }

    // Path B: no SKU — per-store alias by raw productName.
    if (!li.invoice.storeId) {
      skipped++
      continue
    }
    const aliasKey = `${li.invoice.storeId}::${li.productName.toLowerCase()}`
    if (seenAlias.has(aliasKey)) {
      skipped++
      continue
    }

    let canonicalId = canonicalByName.get(canonicalName)
    if (!canonicalId) {
      const created = await prisma.canonicalIngredient.create({
        data: {
          ownerId,
          name: canonicalName,
          defaultUnit: li.unit ?? "unit",
          category: li.category ?? null,
        },
      })
      canonicalId = created.id
      canonicalByName.set(canonicalName, canonicalId)
      canonicalsCreated++
    }

    await prisma.ingredientAlias.create({
      data: {
        storeId: li.invoice.storeId,
        canonicalIngredientId: canonicalId,
        canonicalName,
        rawName: li.productName,
        fromUnit: li.unit ?? "unit",
        toUnit: li.unit ?? "unit",
        conversionFactor: 1,
      },
    })
    await prisma.invoiceLineItem.update({
      where: { id: li.id },
      data: { canonicalIngredientId: canonicalId, matchSource: "alias", matchedAt: now },
    })
    seenAlias.add(aliasKey)
    aliasesCreated++
  }

  return { canonicalsCreated, aliasesCreated, skuMatchesCreated, skipped }
}

export type CanonicalIngredientCost = {
  unitCost: number
  unit: string
  asOfDate: Date
  sourceInvoiceId: string
  sourceLineItemId: string
  sourceVendor: string
  sourceSku: string | null
  sourceProductName: string
}

/**
 * Resolve the unit cost of a canonical ingredient.
 *
 * Primary path: direct FK (InvoiceLineItem.canonicalIngredientId). Picks the
 * most recent invoice line *across any vendor* — whoever we last bought from
 * wins. This is what gives the recipe builder "most recent purchase" pricing.
 *
 * Fallback: legacy alias-based string match, used only for canonicals that
 * have no FK'd line items yet (pre-migration data). Drop this fallback once
 * the review queue is empty.
 *
 * - If `asOf` is undefined, returns the latest price (builder mode).
 * - If `asOf` is set, returns the most recent price on or before that date
 *   (P&L / period-matched mode).
 *
 * Returns `null` when no matching invoice line item exists.
 */
export async function getCanonicalIngredientCost(
  canonicalIngredientId: string,
  asOf?: Date
): Promise<CanonicalIngredientCost | null> {
  // Primary: direct FK match.
  const direct = await prisma.invoiceLineItem.findFirst({
    where: {
      canonicalIngredientId,
      invoice: asOf ? { invoiceDate: { lte: asOf } } : undefined,
      quantity: { gt: 0 },
    },
    orderBy: { invoice: { invoiceDate: "desc" } },
    select: {
      id: true,
      invoiceId: true,
      sku: true,
      productName: true,
      quantity: true,
      unit: true,
      extendedPrice: true,
      invoice: { select: { invoiceDate: true, vendorName: true } },
    },
  })

  if (direct && direct.invoice.invoiceDate) {
    return {
      unitCost: direct.extendedPrice / direct.quantity,
      unit: direct.unit ?? "unit",
      asOfDate: direct.invoice.invoiceDate,
      sourceInvoiceId: direct.invoiceId,
      sourceLineItemId: direct.id,
      sourceVendor: direct.invoice.vendorName,
      sourceSku: direct.sku,
      sourceProductName: direct.productName,
    }
  }

  // Fallback: alias-based lookup for canonicals not yet FK-matched.
  const aliases = await prisma.ingredientAlias.findMany({
    where: { canonicalIngredientId },
    select: {
      storeId: true,
      rawName: true,
      conversionFactor: true,
      toUnit: true,
    },
  })
  if (aliases.length === 0) return null

  const candidates = await prisma.invoiceLineItem.findMany({
    where: {
      canonicalIngredientId: null,
      invoice: {
        invoiceDate: asOf ? { lte: asOf } : undefined,
        storeId: { in: aliases.map((a) => a.storeId) },
      },
      productName: { in: aliases.map((a) => a.rawName) },
    },
    orderBy: { invoice: { invoiceDate: "desc" } },
    take: 50,
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

  if (candidates.length === 0) return null

  const aliasLookup = new Map(
    aliases.map((a) => [`${a.storeId}::${a.rawName.toLowerCase()}`, a])
  )

  for (const li of candidates) {
    if (!li.invoice.invoiceDate || !li.invoice.storeId) continue
    const alias = aliasLookup.get(
      `${li.invoice.storeId}::${li.productName.toLowerCase()}`
    )
    if (!alias) continue

    const normalizedQty = li.quantity * alias.conversionFactor
    if (normalizedQty <= 0) continue

    return {
      unitCost: li.extendedPrice / normalizedQty,
      unit: alias.toUnit,
      asOfDate: li.invoice.invoiceDate,
      sourceInvoiceId: li.invoiceId,
      sourceLineItemId: li.id,
      sourceVendor: li.invoice.vendorName,
      sourceSku: li.sku,
      sourceProductName: li.productName,
    }
  }

  return null
}
