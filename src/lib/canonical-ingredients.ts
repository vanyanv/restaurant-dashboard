import { prisma } from "@/lib/prisma"
import { normalizeVendorName } from "@/lib/vendor-normalize"
import { deriveCostFromLineItem } from "@/lib/ingredient-cost"
import {
  COST_CANDIDATE_WINDOW,
  selectNonSpikeCostIndex,
} from "@/lib/invoice-line-shape"
import { canonicalizeUnit } from "@/lib/unit-conversion"
import { logger } from "@/lib/logger"

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

/** Line items scanned per page — bounds memory on accounts with large
 *  invoice backlogs (the old single findMany loaded every unlinked row). */
const SEED_SCAN_BATCH = 500

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
  ownerId: string,
  accountId: string
): Promise<SeedResult> {
  const existingSkuMatches = await prisma.ingredientSkuMatch.findMany({
    where: { accountId },
    select: { vendorName: true, sku: true, canonicalIngredientId: true },
  })
  const skuIndex = new Map<string, string>(
    existingSkuMatches.map((m) => [`${m.vendorName}::${m.sku}`, m.canonicalIngredientId])
  )

  const existingAliases = await prisma.ingredientAlias.findMany({
    where: { store: { accountId } },
    select: { storeId: true, rawName: true },
  })
  const seenAlias = new Set(
    existingAliases.map((a) => `${a.storeId}::${a.rawName.toLowerCase()}`)
  )

  const existingCanonicals = await prisma.canonicalIngredient.findMany({
    where: { accountId },
    select: { id: true, name: true },
  })
  const canonicalByName = new Map(
    existingCanonicals.map((c) => [c.name.toLowerCase(), c.id])
  )

  let canonicalsCreated = 0
  let aliasesCreated = 0
  let skuMatchesCreated = 0
  let skipped = 0

  // Seek-paginated scan (id > lastId), NOT prisma cursor/skip: the loop sets
  // canonicalIngredientId on rows it has already scanned, and a cursor row
  // that no longer matches the filter would make skip:1 drop a valid row.
  // The dedup indexes above persist across batches.
  let lastId: string | undefined
  while (true) {
    const lineItems = await prisma.invoiceLineItem.findMany({
      where: {
        invoice: { accountId },
        canonicalIngredientId: null,
        ...(lastId ? { id: { gt: lastId } } : {}),
      },
      orderBy: { id: "asc" },
      take: SEED_SCAN_BATCH,
      select: {
        id: true,
        sku: true,
        productName: true,
        unit: true,
        category: true,
        invoice: { select: { vendorName: true, storeId: true } },
      },
    })
    if (lineItems.length === 0) break
    lastId = lineItems[lineItems.length - 1].id

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
                accountId,
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
              accountId,
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
            accountId,
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

    if (lineItems.length < SEED_SCAN_BATCH) break
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
  /**
   * True when the most-recent invoice line derived an implausible price spike
   * (a likely pack-metadata mis-parse) and we fell back to an older in-tolerance
   * line. The returned cost is the trusted fallback; this flag asks callers to
   * surface the bad line for review. See `selectNonSpikeCostIndex`.
   */
  costGuardTriggered?: boolean
}

function shouldSkipRawInvoiceUnitFallback(
  line: {
    unit: string | null
    packSize: number | null
    unitSize: number | null
    unitSizeUom: string | null
  },
  recipeUnit: string | null | undefined
): boolean {
  const normalizedRecipeUnit = canonicalizeUnit(recipeUnit)
  const invoiceUnit = line.unit?.trim().toUpperCase()
  const hasPackShape = line.packSize != null || line.unitSize != null

  return (
    normalizedRecipeUnit === "each" &&
    invoiceUnit === "CS" &&
    hasPackShape &&
    !line.unitSizeUom
  )
}

type InvoiceLineForCost = {
  quantity: number
  unit: string | null
  packSize: number | null
  unitSize: number | null
  unitSizeUom: string | null
  unitPrice: number
  extendedPrice: number
}

/**
 * Resolve a single invoice line to `{ unitCost, unit }` in the canonical's
 * recipe unit. Mirrors the original two-path logic: pack-shape derivation
 * first, then the legacy raw `extendedPrice / quantity` fallback. Returns null
 * when the line can't yield a usable positive cost (so callers can skip it).
 */
function resolveLineUnitCost(
  line: InvoiceLineForCost,
  recipeUnit: string | null | undefined,
  vendorMatch:
    | { conversionFactor: number; fromUnit: string; toUnit: string }
    | null
): { unitCost: number; unit: string } | null {
  if (recipeUnit) {
    const derived = deriveCostFromLineItem(
      line,
      recipeUnit,
      vendorMatch ?? undefined
    )
    if (derived != null) return { unitCost: derived, unit: recipeUnit }
    if (shouldSkipRawInvoiceUnitFallback(line, recipeUnit)) return null
  }
  // Legacy raw-invoice-unit path (no recipeUnit, or derivation failed).
  if (!isFinite(line.quantity) || line.quantity === 0) return null
  const raw = line.extendedPrice / line.quantity
  if (!isFinite(raw) || raw <= 0) return null
  return { unitCost: raw, unit: line.unit ?? "unit" }
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
  asOf?: Date,
  options?: { storeId?: string }
): Promise<CanonicalIngredientCost | null> {
  const storeId = options?.storeId
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

  // Manual prices are authoritative per-recipe-unit ($/each, $/oz, …) and
  // intentionally override both dated and store-scoped invoice lookup. We do
  // not store manual price history, but falling through to raw invoice data can
  // be far worse: a $36/EA case can otherwise masquerade as $36 per pickle.
  const useCanonical =
    canonical?.costPerRecipeUnit != null &&
    canonical.recipeUnit &&
    (canonical.costSource === "manual" || (!storeId && asOf === undefined))
  if (useCanonical) {
    // The canonical's costPerRecipeUnit is authoritative for the price, but its
    // `costUpdatedAt` lags behind invoice arrivals (locked canonicals, same-value
    // recomputes, and derivation failures all skip the write). Always pull
    // vendor / SKU / invoice date from the actual most-recent matched line so
    // the UI reflects the latest invoice even when the stored cost didn't move.
    const latest = await prisma.invoiceLineItem.findFirst({
      where: {
        canonicalIngredientId,
        quantity: { not: 0 },
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
  // When `storeId` is set, prefer this store's own purchase first so per-store
  // COGS reflects this store's actual vendor pricing. If no store-scoped match
  // exists, fall back to the cross-store latest (so a brand-new store still
  // gets a usable price).
  const buildInvoiceWhere = (forStoreId?: string) => {
    if (!asOf && !forStoreId) return undefined
    const w: { invoiceDate?: { lte: Date }; storeId?: string } = {}
    if (asOf) w.invoiceDate = { lte: asOf }
    if (forStoreId) w.storeId = forStoreId
    return w
  }

  const lineSelect = {
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
  } as const

  // Pull a short window of recent lines (newest first) rather than just the
  // single latest, so the spike guard has price history to judge against.
  let recentLines = storeId
    ? await prisma.invoiceLineItem.findMany({
        where: {
          canonicalIngredientId,
          invoice: buildInvoiceWhere(storeId),
          quantity: { not: 0 },
        },
        orderBy: { invoice: { invoiceDate: "desc" } },
        take: COST_CANDIDATE_WINDOW,
        select: lineSelect,
      })
    : []

  if (recentLines.length === 0) {
    recentLines = await prisma.invoiceLineItem.findMany({
      where: {
        canonicalIngredientId,
        invoice: asOf ? { invoiceDate: { lte: asOf } } : undefined,
        quantity: { not: 0 },
      },
      orderBy: { invoice: { invoiceDate: "desc" } },
      take: COST_CANDIDATE_WINDOW,
      select: lineSelect,
    })
  }

  // Need a date for ordering / asOf provenance.
  const dated = recentLines.filter((c) => c.invoice.invoiceDate)

  if (dated.length > 0) {
    const vendorMatch = canonical?.recipeUnit
      ? await prisma.ingredientSkuMatch.findFirst({
          where: { canonicalIngredientId },
          select: { conversionFactor: true, fromUnit: true, toUnit: true },
        })
      : null

    const resolved = dated
      .map((line) => ({
        line,
        cost: resolveLineUnitCost(line, canonical?.recipeUnit, vendorMatch),
      }))
      .filter(
        (r): r is { line: (typeof dated)[number]; cost: { unitCost: number; unit: string } } =>
          r.cost !== null
      )

    if (resolved.length > 0) {
      const { index, rejectedSpike } = selectNonSpikeCostIndex(
        resolved.map((r) => r.cost.unitCost)
      )
      const chosen = resolved[index]

      if (rejectedSpike) {
        const newest = resolved[0]
        logger.warn(
          `[cost-guard] canonical ${canonicalIngredientId}: rejected spiked invoice cost ` +
            `$${newest.cost.unitCost.toFixed(2)}/${newest.cost.unit} (line ${newest.line.id}, ` +
            `invoice ${newest.line.invoiceId}); using $${chosen.cost.unitCost.toFixed(2)}/${chosen.cost.unit} ` +
            `from ${chosen.line.invoice.invoiceDate?.toISOString().slice(0, 10)} instead`
        )
      }

      return {
        unitCost: chosen.cost.unitCost,
        unit: chosen.cost.unit,
        source: "invoice",
        asOfDate: chosen.line.invoice.invoiceDate!,
        sourceInvoiceId: chosen.line.invoiceId,
        sourceLineItemId: chosen.line.id,
        sourceVendor: chosen.line.invoice.vendorName,
        sourceSku: chosen.line.sku,
        sourceProductName: chosen.line.productName,
        costGuardTriggered: rejectedSpike,
      }
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
