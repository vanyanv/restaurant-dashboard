// Vendor+SKU pack-shape priors — data-driven correction of LLM pack-split
// mistakes at invoice-sync time.
//
// Restaurant supply is overwhelmingly repeat purchase: the same (vendor, sku)
// arrives week after week with an identical physical case, yet each extraction
// re-derives the PACK/SIZE split from a noisy fused column and lands on a
// different shape (Sysco 7370699 "Greeno Cup PET 20 oz" has been extracted
// nine different ways). This module votes over the shapes already stored for
// a (vendor, sku) and, when a stable majority exists, overrides a
// freshly-extracted line that disagrees — a generalized, data-driven
// KNOWN_SKU_PACK_PROFILES.
//
// Kept free of Prisma / I/O: the sync route fetches prior rows and passes
// them in, so tests exercise the voting and application logic directly.

import type { InvoiceExtraction, InvoiceExtractionLineItem } from "@/types/invoice"
import { canonicalizeUnit } from "@/lib/unit-conversion"
import { looksLikePaperCountPack } from "@/lib/invoice-sanity"

/** Minimum agreeing prior lines before a shape is trusted as a prior. */
export const PRIOR_MIN_SUPPORT = 3

export interface PriorShapeRow {
  vendorName: string | null
  sku: string | null
  productName: string
  category: string | null
  unit: string | null
  packSize: number | null
  unitSize: number | null
  unitSizeUom: string | null
}

export interface PackShapePrior {
  unit: string
  packSize: number
  unitSize: number
  unitSizeUom: string
  /** Votes for the winning shape group. */
  support: number
  /** Total eligible voting lines. */
  eligible: number
}

export interface PackPriorCorrection {
  lineNumber: number
  sku: string
  productName: string
  from: { packSize: number | null; unitSize: number | null; unitSizeUom: string | null }
  to: { packSize: number; unitSize: number; unitSizeUom: string }
  support: number
  eligible: number
}

const MASS_VOLUME_CLASSES = new Set([
  "lb", "oz", "g", "kg",
  "gal", "qt", "pt", "cup", "fl oz", "ml", "l",
])

/**
 * Collapse a raw unitSizeUom into a comparison class so synonym noise
 * (CT / EA / PC / null on count goods, G / GR / GRAM on packets) doesn't
 * fracture the vote. Unrecognized tokens pass through lowercased; a missing
 * uom on a packed line means "count" in practice.
 */
function uomClass(uom: string | null | undefined): string {
  const canonical = canonicalizeUnit(uom)
  if (canonical) return canonical
  const cleaned = uom?.trim().toLowerCase() ?? ""
  return cleaned === "" ? "each" : cleaned
}

/**
 * The name-leak signature: on count-pack paper goods (cups, lids, gloves,
 * bags…) a mass/volume unitSizeUom is essentially always the model promoting
 * a container volume printed in the product NAME ("CUP PET 20 OZ") into the
 * pack fields. Such shapes are excluded from voting — the physical case is
 * counted, not weighed.
 */
function isNameLeakProneShape(row: PriorShapeRow): boolean {
  return (
    MASS_VOLUME_CLASSES.has(uomClass(row.unitSizeUom)) &&
    looksLikePaperCountPack(row)
  )
}

interface ShapeVote {
  count: number
  /** Exact (packSize, unitSize, rawUom) representations seen in this group. */
  exemplars: Map<string, { count: number; packSize: number; unitSize: number; uomRaw: string | null }>
}

/**
 * Vote over the pack shapes previously stored for one (vendor, sku).
 *
 * Shapes agree when they share (order unit, uom class, packSize × unitSize) —
 * so 10×100 CT and 1×1000 CT are the same vote, and CT/EA/null noise
 * collapses. The winner must reach PRIOR_MIN_SUPPORT votes AND a strict
 * majority of eligible lines. Catch-weight lines (order unit and size uom in
 * the same class, e.g. LB/LB meat) never vote: their per-case weights
 * legitimately differ on every invoice.
 *
 * Returns the modal exact split of the winning group, or null when history
 * is too thin or too contested to trust.
 */
export function derivePackShapePrior(rows: PriorShapeRow[]): PackShapePrior | null {
  const votes = new Map<string, ShapeVote>()
  let eligible = 0

  for (const row of rows) {
    const unit = row.unit?.trim().toUpperCase() ?? ""
    const packSize = row.packSize
    const unitSize = row.unitSize
    if (
      unit === "" ||
      packSize == null || !isFinite(packSize) || packSize <= 0 ||
      unitSize == null || !isFinite(unitSize) || unitSize <= 0
    ) {
      continue
    }

    const sizeClass = uomClass(row.unitSizeUom)
    const orderCanonical = canonicalizeUnit(row.unit)
    // Catch-weight / already-in-base shape: quantity is the total, pack fields
    // are per-delivery metadata. Never a stable prior.
    if (orderCanonical != null && orderCanonical === sizeClass) continue

    if (isNameLeakProneShape(row)) continue

    eligible++
    const totalBase = Math.round(packSize * unitSize * 1e6) / 1e6
    const groupKey = `${unit}|${sizeClass}|${totalBase}`
    const vote = votes.get(groupKey) ?? { count: 0, exemplars: new Map() }
    vote.count++
    const uomRaw = row.unitSizeUom?.trim().toUpperCase() ?? null
    const exactKey = `${packSize}|${unitSize}|${uomRaw ?? ""}`
    const exemplar = vote.exemplars.get(exactKey) ?? { count: 0, packSize, unitSize, uomRaw }
    exemplar.count++
    vote.exemplars.set(exactKey, exemplar)
    votes.set(groupKey, vote)
  }

  let winnerKey: string | null = null
  let winner: ShapeVote | null = null
  for (const [key, vote] of votes) {
    if (!winner || vote.count > winner.count) {
      winner = vote
      winnerKey = key
    }
  }
  if (!winner || winnerKey == null) return null
  if (winner.count < PRIOR_MIN_SUPPORT) return null
  if (winner.count * 2 <= eligible) return null

  // Modal exact split within the winning group; prefer representations that
  // carry a real uom so the output is always usable downstream.
  const exemplars = [...winner.exemplars.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    if ((a.uomRaw == null) !== (b.uomRaw == null)) return a.uomRaw == null ? 1 : -1
    return 0
  })
  const best = exemplars.find((e) => e.uomRaw != null) ?? exemplars[0]
  if (!best || best.uomRaw == null) return null

  const unit = winnerKey.slice(0, winnerKey.indexOf("|"))
  return {
    unit,
    packSize: best.packSize,
    unitSize: best.unitSize,
    unitSizeUom: best.uomRaw,
    support: winner.count,
    eligible,
  }
}

/**
 * Vendors print under several name variants ("Sysco" vs "Sysco Los Angeles,
 * Inc."), so priors key on the brand stem: the first alphanumeric token of
 * the lowercased vendor name.
 */
function vendorStem(vendorName: string | null | undefined): string | null {
  if (!vendorName) return null
  const token = vendorName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)[0]
  return token && token.length > 0 ? token : null
}

/** Stable map key for a (vendor stem, sku) pair, or null when either is missing. */
export function priorKey(vendorName: string | null, sku: string | null): string | null {
  const stem = vendorStem(vendorName)
  const cleanSku = sku?.trim() ?? ""
  if (!stem || cleanSku === "") return null
  return `${stem}|${cleanSku}`
}

/**
 * Group prior rows by (vendor stem, sku) and derive a prior for each group.
 * Groups whose history is too thin or contested simply don't appear.
 */
export function buildPackShapePriors(rows: PriorShapeRow[]): Map<string, PackShapePrior> {
  const grouped = new Map<string, PriorShapeRow[]>()
  for (const row of rows) {
    const key = priorKey(row.vendorName, row.sku)
    if (!key) continue
    const bucket = grouped.get(key)
    if (bucket) bucket.push(row)
    else grouped.set(key, [row])
  }

  const priors = new Map<string, PackShapePrior>()
  for (const [key, bucket] of grouped) {
    const prior = derivePackShapePrior(bucket)
    if (prior) priors.set(key, prior)
  }
  return priors
}

function lineAgreesWithPrior(
  line: InvoiceExtractionLineItem,
  prior: PackShapePrior
): boolean {
  if (line.packSize == null || line.unitSize == null) return false
  if (line.packSize <= 0 || line.unitSize <= 0) return false
  if (uomClass(line.unitSizeUom) !== uomClass(prior.unitSizeUom)) return false
  const lineTotal = Math.round(line.packSize * line.unitSize * 1e6) / 1e6
  const priorTotal = Math.round(prior.packSize * prior.unitSize * 1e6) / 1e6
  return lineTotal === priorTotal
}

/**
 * Rewrite extraction lines whose pack shape disagrees with a strong
 * historical prior for the same (vendor, sku). Only fires when the line's
 * order unit matches the prior's (overriding across unit semantics would
 * corrupt quantity math). Arithmetically equivalent splits (10×100 vs
 * 1×1000 CT) are left untouched.
 *
 * Returns the (possibly new) extraction plus a correction record per
 * rewritten line for logging.
 */
export function applyPackShapePriors(
  extraction: InvoiceExtraction,
  priors: Map<string, PackShapePrior>
): { extraction: InvoiceExtraction; corrections: PackPriorCorrection[] } {
  if (priors.size === 0) return { extraction, corrections: [] }

  const corrections: PackPriorCorrection[] = []
  let changed = false
  const lineItems = extraction.lineItems.map((line) => {
    if (!line.sku) return line
    const key = priorKey(extraction.vendorName, line.sku)
    if (!key) return line
    const prior = priors.get(key)
    if (!prior) return line

    if ((line.unit?.trim().toUpperCase() ?? "") !== prior.unit) return line
    if (lineAgreesWithPrior(line, prior)) return line

    corrections.push({
      lineNumber: line.lineNumber,
      sku: line.sku,
      productName: line.productName,
      from: { packSize: line.packSize, unitSize: line.unitSize, unitSizeUom: line.unitSizeUom },
      to: { packSize: prior.packSize, unitSize: prior.unitSize, unitSizeUom: prior.unitSizeUom },
      support: prior.support,
      eligible: prior.eligible,
    })
    changed = true
    return {
      ...line,
      packSize: prior.packSize,
      unitSize: prior.unitSize,
      unitSizeUom: prior.unitSizeUom,
    }
  })

  return {
    extraction: changed ? { ...extraction, lineItems } : extraction,
    corrections,
  }
}
