import { prisma } from "@/lib/prisma"
import { normalizeVendorName } from "@/lib/vendor-normalize"
import { deriveCostFromLineItem } from "@/lib/ingredient-cost"
import { canonicalizeUnit } from "@/lib/unit-conversion"

/**
 * Normalize an invoice-line unit into the canonical token we want stored on
 * IngredientSkuMatch / CanonicalIngredient. Falls back to a trimmed, lowercased
 * version of the raw string when we don't have a synonym — keeps round-trip
 * fidelity while protecting downstream conversion from R365's "OZ-wt" / "OZ-fl"
 * style tokens.
 */
function normalizeUnitToken(raw: string | null | undefined): string {
  if (!raw) return "unit"
  const canon = canonicalizeUnit(raw)
  if (canon) return canon
  return raw.trim().toLowerCase() || "unit"
}

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
              defaultUnit: normalizeUnitToken(li.unit),
              category: li.category ?? null,
            },
          })
          canonicalId = created.id
          canonicalByName.set(canonicalName, canonicalId)
          canonicalsCreated++
        }
        const normalizedUnit = normalizeUnitToken(li.unit)
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
            fromUnit: normalizedUnit,
            toUnit: normalizedUnit,
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

    const normalizedUnit = normalizeUnitToken(li.unit)
    let canonicalId = canonicalByName.get(canonicalName)
    if (!canonicalId) {
      const created = await prisma.canonicalIngredient.create({
        data: {
          ownerId,
          name: canonicalName,
          defaultUnit: normalizedUnit,
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
        fromUnit: normalizedUnit,
        toUnit: normalizedUnit,
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
  /** "manual" if from canonical.costPerRecipeUnit; "invoice" otherwise. */
  source: "manual" | "invoice"
  asOfDate: Date
  /** Invoice provenance — populated only when source === "invoice". */
  sourceInvoiceId: string | null
  sourceLineItemId: string | null
  sourceVendor: string | null
  sourceSku: string | null
  sourceProductName: string | null
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
  // Load canonical metadata once — we need `recipeUnit` for both branches
  // to normalize invoice costs into cost-per-recipe-unit.
  const canonical = await prisma.canonicalIngredient.findUnique({
    where: { id: canonicalIngredientId },
    select: {
      recipeUnit: true,
      costPerRecipeUnit: true,
      costSource: true,
      costUpdatedAt: true,
    },
  })

  // Builder mode (no asOf) — trust the canonical's precomputed value.
  //
  // Also use the canonical value for `asOf` queries when the cost was set
  // manually. Manual prices are authoritative per-unit ($/each, $/oz, …) and
  // we don't store their history; falling back to raw invoice data in the
  // dated path would silently apply the wrong unit (e.g. $36/EA-case for
  // pickle jars where the user meant $0.036/each-pickle). If a user later
  // overrides a manual price, old P&Ls will reflect the new value — a
  // deliberate trade-off vs. surfacing garbage invoice units.
  const useCanonical =
    canonical?.costPerRecipeUnit != null &&
    canonical.recipeUnit &&
    (asOf === undefined || canonical.costSource === "manual")
  if (useCanonical) {
    // The canonical's costPerRecipeUnit is authoritative for the price, but its
    // `costUpdatedAt` lags behind invoice arrivals (locked canonicals, same-value
    // recomputes, and derivation failures all skip the write). Always pull
    // vendor / SKU / invoice date from the actual most-recent matched line so
    // the UI reflects the latest invoice even when the stored cost didn't move.
    const latest = await prisma.invoiceLineItem.findFirst({
      where: {
        canonicalIngredientId,
        quantity: { gt: 0 },
        invoice: asOf ? { invoiceDate: { lte: asOf } } : undefined,
      },
      orderBy: { invoice: { invoiceDate: "desc" } },
      select: {
        id: true,
        invoiceId: true,
        sku: true,
        productName: true,
        invoice: { select: { invoiceDate: true, vendorName: true } },
      },
    })
    return {
      unitCost: canonical!.costPerRecipeUnit!,
      unit: canonical!.recipeUnit!,
      source: canonical!.costSource === "invoice" ? "invoice" : "manual",
      asOfDate:
        latest?.invoice.invoiceDate ?? canonical!.costUpdatedAt ?? new Date(),
      sourceInvoiceId: latest?.invoiceId ?? null,
      sourceLineItemId: latest?.id ?? null,
      sourceVendor: latest?.invoice.vendorName ?? null,
      sourceSku: latest?.sku ?? null,
      sourceProductName: latest?.productName ?? null,
    }
  }

  // Period-matched mode: find the most recent invoice line on-or-before asOf.
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
      packSize: true,
      unitSize: true,
      unitSizeUom: true,
      unitPrice: true,
      extendedPrice: true,
      invoice: { select: { invoiceDate: true, vendorName: true } },
    },
  })

  if (direct && direct.invoice.invoiceDate) {
    // Prefer the hydration path: derive $/recipeUnit using packSize/unitSize,
    // matching how `recomputeCanonicalCost` computes the non-asOf value.
    if (canonical?.recipeUnit) {
      const vendorMatch = await prisma.ingredientSkuMatch.findFirst({
        where: { canonicalIngredientId },
        select: { conversionFactor: true, fromUnit: true, toUnit: true },
      })
      const derived = deriveCostFromLineItem(
        direct,
        canonical.recipeUnit,
        vendorMatch
          ? { conversionFactor: vendorMatch.conversionFactor, fromUnit: vendorMatch.fromUnit, toUnit: vendorMatch.toUnit }
          : undefined
      )
      if (derived != null) {
        return {
          unitCost: derived,
          unit: canonical.recipeUnit,
          source: "invoice",
          asOfDate: direct.invoice.invoiceDate,
          sourceInvoiceId: direct.invoiceId,
          sourceLineItemId: direct.id,
          sourceVendor: direct.invoice.vendorName,
          sourceSku: direct.sku,
          sourceProductName: direct.productName,
        }
      }
    }
    // Fallback: legacy raw-invoice-unit path (no recipeUnit or derivation failed).
    return {
      unitCost: direct.extendedPrice / direct.quantity,
      unit: direct.unit ?? "unit",
      source: "invoice",
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
      source: "invoice",
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
