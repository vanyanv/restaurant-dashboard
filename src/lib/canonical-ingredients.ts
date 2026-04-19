import { prisma } from "@/lib/prisma"

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
  skipped: number
}

/**
 * Walk every InvoiceLineItem for this owner. For each raw productName that has
 * no IngredientAlias yet (across any of the owner's stores), create:
 *   - a CanonicalIngredient named after the normalized productName (if missing), and
 *   - a per-store IngredientAlias pointing at it (conversionFactor = 1).
 *
 * No fuzzy grouping — that's for the user to do via the UI. This just makes sure
 * every invoice item has something to map to, so the cost-lookup path is unblocked.
 */
export async function seedCanonicalIngredientsFromInvoices(
  ownerId: string
): Promise<SeedResult> {
  const lineItems = await prisma.invoiceLineItem.findMany({
    where: { invoice: { ownerId } },
    select: {
      productName: true,
      unit: true,
      category: true,
      invoice: { select: { storeId: true } },
    },
  })

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
  let skipped = 0

  for (const li of lineItems) {
    if (!li.invoice.storeId) {
      skipped++
      continue
    }
    const rawKey = `${li.invoice.storeId}::${li.productName.toLowerCase()}`
    if (seenAlias.has(rawKey)) {
      skipped++
      continue
    }

    const canonicalName = normalizeProductName(li.productName)
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
    seenAlias.add(rawKey)
    aliasesCreated++
  }

  return { canonicalsCreated, aliasesCreated, skipped }
}

export type CanonicalIngredientCost = {
  unitCost: number
  unit: string
  asOfDate: Date
  sourceInvoiceId: string
  sourceLineItemId: string
}

/**
 * Resolve the unit cost of a canonical ingredient.
 *
 * - If `asOf` is undefined, returns the *latest* invoice price (builder mode).
 * - If `asOf` is set, returns the most recent price on or before that date
 *   (P&L / period-matched mode).
 *
 * Returns `null` when no matching invoice line item exists.
 */
export async function getCanonicalIngredientCost(
  canonicalIngredientId: string,
  asOf?: Date
): Promise<CanonicalIngredientCost | null> {
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
      productName: true,
      quantity: true,
      unitPrice: true,
      extendedPrice: true,
      invoice: { select: { invoiceDate: true, storeId: true } },
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
    }
  }

  return null
}
