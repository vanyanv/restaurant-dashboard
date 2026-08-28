// Sanity checks applied to OpenAI-extracted invoice data before persistence.

import type { InvoiceExtraction } from "@/types/invoice"
import { goodsLines, goodsSum } from "@/lib/invoice-charges"

export const PAST_DATE_TOLERANCE_DAYS = 60
export const FUTURE_DATE_TOLERANCE_DAYS = 30

// Maximum allowed relative drift between quantity*unitPrice and extendedPrice
// before a line is considered arithmetically inconsistent. 2% covers normal
// rounding (per-lb decimals, sub-cent unit prices) without masking real misreads
// like Premier Meats #2232461 where quantity captured cases instead of pounds
// and the implied math was off by ~60×.
export const LINE_MATH_TOLERANCE = 0.02
const CATCH_WEIGHT_MIN_LB = 5
const CATCH_WEIGHT_MAX_LB = 5_000

const CATCH_WEIGHT_VENDOR_RE =
  /\b(premier\s+meats?|crystal\s+bay|ben\s+e\.?\s+keith)\b/i
const MEAT_LINE_RE =
  /\b(meat|beef|ground\s+beef|angus|chuck|brisket|ribeye|steak|sirloin|pork|bacon|ham|chicken|turkey|poultry|seafood|fish|salmon|tuna)\b/i
const GRAM_UOMS = new Set(["G", "GR", "GM", "GRM", "GRAM", "GRAMS"])
const PAPER_COUNT_PACK_RE =
  /\b(bag|bags|bath\s+tissue|tissue|toilet|napkin|towel|roll|wrap|wrapper|cup|cups|lid|lids|glove|gloves|paper|liner|liners|foil|film|sheet|sheets|straw|straws)\b/i

/**
 * Returns the extracted invoiceDate as a Date, or null if it's obviously wrong.
 *
 * gpt-4o occasionally hallucinates years when an invoice template is unusual
 * (e.g. Premier Meats "CoPilot Invoices" returning 2023; Sysco returning 1926).
 * We compare against the email's receivedAt: if the gap is more than
 * PAST_DATE_TOLERANCE_DAYS in the past or FUTURE_DATE_TOLERANCE_DAYS in the
 * future, we treat the extracted date as unreliable and drop it, letting the
 * caller flag the row for manual REVIEW.
 */
export function sanitizeInvoiceDate(
  extracted: string | null,
  emailReceivedAt: Date | null,
  context: string
): Date | null {
  if (!extracted) return null
  const parsed = new Date(extracted)
  if (Number.isNaN(parsed.getTime())) return null
  if (!emailReceivedAt) return parsed

  const diffDays = (parsed.getTime() - emailReceivedAt.getTime()) / (1000 * 60 * 60 * 24)
  if (diffDays < -PAST_DATE_TOLERANCE_DAYS || diffDays > FUTURE_DATE_TOLERANCE_DAYS) {
    console.warn(
      `Invoice date out of range (${extracted}, email ${emailReceivedAt.toISOString().slice(0, 10)}, diff ${diffDays.toFixed(0)}d) — nulling for ${context}`
    )
    return null
  }
  return parsed
}

export interface LineMathMismatch {
  lineNumber: number
  productName: string
  quantity: number
  unit: string | null
  unitPrice: number
  extendedPrice: number
  /** quantity * unitPrice (what we'd expect extendedPrice to equal). */
  computed: number
  /** extendedPrice / unitPrice — quantity the model probably should have set. */
  impliedQuantity: number | null
}

/**
 * Identify line items whose `quantity * unitPrice` diverges from the printed
 * `extendedPrice` by more than LINE_MATH_TOLERANCE. The most common cause is
 * the model assigning quantity to the wrong column (e.g. "8 cases" instead of
 * "487.52 lb" for catch-weight meat). Lines with a missing unitPrice, missing
 * extendedPrice, or extendedPrice of 0 are skipped because the relative drift
 * isn't meaningful there.
 */
export function findLineMathMismatches(
  lineItems: InvoiceExtraction["lineItems"]
): LineMathMismatch[] {
  const mismatches: LineMathMismatch[] = []
  for (const li of lineItems) {
    const qty = Number(li.quantity)
    const unitPrice = Number(li.unitPrice)
    const ext = Number(li.extendedPrice)
    if (!Number.isFinite(qty) || !Number.isFinite(unitPrice) || !Number.isFinite(ext)) continue
    if (Math.abs(ext) < 0.01) continue
    const computed = qty * unitPrice
    const drift = Math.abs(computed - ext) / Math.abs(ext)
    if (drift <= LINE_MATH_TOLERANCE) continue
    mismatches.push({
      lineNumber: li.lineNumber,
      productName: li.productName,
      quantity: qty,
      unit: li.unit,
      unitPrice,
      extendedPrice: ext,
      computed,
      impliedQuantity: unitPrice > 0 ? ext / unitPrice : null,
    })
  }
  return mismatches
}

// Maximum allowed relative drift between the sum of line extendedPrice and the
// invoice's own printed totals before the whole extraction is considered
// unreliable. Sized (with a $1 floor) to absorb rounding and per-line CRV noise
// while still catching dropped/duplicated/shifted lines — e.g. IFS #I28402-00,
// where a fused-column misread dropped ~$120 of lines yet stored a correct
// header total.
export const TOTAL_RECONCILIATION_TOLERANCE = 0.02
export const TOTAL_RECONCILIATION_MIN_GAP_DOLLARS = 1

export interface TotalReconciliationMismatch {
  /** Sum of every finite line extendedPrice, charge rows excluded. */
  lineSum: number
  subtotal: number | null
  taxAmount: number | null
  totalAmount: number
  /** The printed reference the lineSum was measured against. */
  closestReference: number
  /** |lineSum − closestReference|. */
  gap: number
  tolerance: number
  /**
   * How many priced goods lines the sum was taken over. Zero means the
   * extraction produced a header and nothing under it.
   */
  goodsLineCount: number
}

/**
 * Cross-check the extracted line items against the invoice's own printed
 * totals.
 *
 * Two things about this are load-bearing, and both were wrong before
 * 2026-08-28.
 *
 * **1. Charge rows come off the goods side, and then the subtotal is the
 * reference.** Individual FoodService prints pallet and fuel charges below
 * the subtotal rule and the extractor reads them as products. Excluding
 * exactly the four names in `@/lib/invoice-charges` takes this account from
 * 173 of 226 reconciling to 219 — see that module for why the set is exact
 * names and not a regex.
 *
 * **2. It compares against ONE reference, not the closest of three.** The
 * previous version passed a line sum that landed near ANY of {subtotal,
 * total − tax, total}, which is three chances to look right. On this account
 * that let 223 of 226 through and the rule flagged 2 invoices — including
 * neither of the two worth $4,166 between them. With charges excluded the
 * subtotal is the correct and only reference, and `total − tax` is the
 * fallback for invoices that print no subtotal at all.
 *
 * A sum that misses it means lines were dropped, duplicated, or had
 * quantities corrupted — the extraction can't be trusted even when each
 * surviving line looks internally consistent.
 *
 * Returns null when the invoice has no priced goods lines at all. That is NOT
 * a pass: it is a different and larger defect, and `findEmptyExtraction`
 * reports it. Reconciling a header against nothing would only ever produce a
 * gap equal to the whole invoice, which reads as an arithmetic error rather
 * than as the missing-lines problem it is.
 */
export function findTotalReconciliationMismatch(
  extraction: Pick<
    InvoiceExtraction,
    "lineItems" | "subtotal" | "taxAmount" | "totalAmount"
  >
): TotalReconciliationMismatch | null {
  const totalAmount = Number(extraction.totalAmount)
  if (!Number.isFinite(totalAmount) || Math.abs(totalAmount) < 0.01) return null

  const priced = goodsLines(extraction.lineItems)
  if (priced.length === 0) return null
  const lineSum = goodsSum(extraction.lineItems)

  const subtotal = extraction.subtotal != null ? Number(extraction.subtotal) : null
  const taxAmount = extraction.taxAmount != null ? Number(extraction.taxAmount) : null

  // The subtotal is what the goods side is supposed to add up to. Only when a
  // vendor prints none do we fall back to backing tax out of the total.
  const closestReference =
    subtotal != null && Number.isFinite(subtotal) ? subtotal : totalAmount - (taxAmount ?? 0)
  const gap = Math.abs(lineSum - closestReference)

  const tolerance = Math.max(
    TOTAL_RECONCILIATION_MIN_GAP_DOLLARS,
    TOTAL_RECONCILIATION_TOLERANCE * Math.abs(totalAmount)
  )
  if (gap <= tolerance) return null

  return {
    lineSum,
    subtotal,
    taxAmount,
    totalAmount,
    closestReference,
    gap,
    tolerance,
    goodsLineCount: priced.length,
  }
}

export interface EmptyExtraction {
  totalAmount: number
  /** Rows stored against the invoice, including unpriced and charge rows. */
  storedLines: number
}

/**
 * An invoice that carries a total but no priced goods lines.
 *
 * This used to be the first `return null` inside the reconciliation check,
 * which meant the single worst extraction outcome — a header with nothing
 * under it — was the one shape that could never be flagged. IFS G95788-00 sat
 * MATCHED with $1,474.06 of goods and zero lines, and no rule had an opinion
 * about it: every ingredient, every price and every quantity on that delivery
 * is simply absent from the account, and the invoice total makes the books
 * look complete.
 */
export function findEmptyExtraction(
  extraction: Pick<InvoiceExtraction, "lineItems" | "totalAmount">
): EmptyExtraction | null {
  const totalAmount = Number(extraction.totalAmount)
  if (!Number.isFinite(totalAmount) || Math.abs(totalAmount) < 0.01) return null
  if (goodsLines(extraction.lineItems).length > 0) return null
  return { totalAmount, storedLines: extraction.lineItems.length }
}

// ─── Review reasons ───

/**
 * The owner-facing record of WHY an invoice landed in REVIEW. Persisted on the
 * Invoice row at sync time and rendered on the detail page — a bare REVIEW
 * badge with no explanation turns a 30-second confirm into archaeology
 * against the PDF.
 */
export interface ReviewReason {
  kind:
    | "date_suspect"
    | "line_math"
    | "pack_shape"
    | "total_reconciliation"
    | "no_lines"
    | "low_match_confidence"
    | "no_store_match"
    | "unknown"
  /** Owner-facing sentence. Amounts pre-formatted; no jargon. */
  message: string
  /** Invoice line numbers this reason points at, for row-level flagging. */
  lineNumbers?: number[]
}

const fmt = (n: number) =>
  `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function composeReviewReasons(input: {
  dateSuspect: boolean
  mathMismatches: LineMathMismatch[]
  packAnomalies: PackShapeAnomaly[]
  totalMismatch: TotalReconciliationMismatch | null
  /**
   * Optional, and only because of where it is called from. The sync route and
   * the backfill both pass it and both must. The pre-Counter invoice detail
   * page replays these rules at read time for rows that never had reasons
   * stored, and it lives under a path whose lint exemption is keyed to its
   * bytes being unchanged — editing it to add one argument would cost it the
   * exemption and demand a full Counter rebuild of a page already slated for
   * deletion. Omitting it there costs nothing real: every row that has this
   * defect now carries the reason on the row itself, written by the backfill.
   */
  emptyExtraction?: EmptyExtraction | null
  /** Store auto-match confidence 0..1, or null when no store matched. */
  matchConfidence: number | null
  matched: boolean
}): ReviewReason[] {
  const reasons: ReviewReason[] = []

  // First, because it subsumes every line-level reason below: there are no
  // lines to have anything wrong with.
  if (input.emptyExtraction) {
    const e = input.emptyExtraction
    reasons.push({
      kind: "no_lines",
      message:
        `The invoice totals ${fmt(e.totalAmount)} but extraction produced ` +
        (e.storedLines === 0 ? "no line items at all" : `${e.storedLines} line(s) with no readable price`) +
        " — nothing on this delivery reached the ingredient catalogue. Re-run extraction against the PDF.",
    })
  }

  if (input.dateSuspect) {
    reasons.push({
      kind: "date_suspect",
      message:
        "The printed invoice date is implausible next to the email's arrival date — the date was cleared and needs a manual check against the PDF.",
    })
  }

  for (const m of input.mathMismatches) {
    reasons.push({
      kind: "line_math",
      message:
        `Line ${m.lineNumber} "${m.productName}": ${m.quantity} ${m.unit ?? "×"} at ${fmt(m.unitPrice)} ` +
        `computes to ${fmt(m.computed)}, but the invoice prints ${fmt(m.extendedPrice)}` +
        (m.impliedQuantity != null
          ? ` — quantity was probably misread (implied ≈ ${m.impliedQuantity.toFixed(2)}).`
          : " — quantity or price was misread."),
      lineNumbers: [m.lineNumber],
    })
  }

  for (const a of input.packAnomalies) {
    reasons.push({
      kind: "pack_shape",
      message: `Line ${a.lineNumber} "${a.productName}": pack shape looks wrong (${a.reasons.join("; ")}) — this distorts the ingredient's $/unit if approved as-is.`,
      lineNumbers: [a.lineNumber],
    })
  }

  if (input.totalMismatch) {
    const t = input.totalMismatch
    reasons.push({
      kind: "total_reconciliation",
      message:
        `The ${fmt(t.lineSum)} of goods on ${t.goodsLineCount} extracted line(s) doesn't reconcile with the ` +
        `invoice's printed ${t.subtotal != null ? "subtotal" : "total less tax"} ${fmt(t.closestReference)} ` +
        `(gap ${fmt(t.gap)}) — lines were likely dropped, duplicated, or had quantities corrupted during ` +
        "extraction. Compare the line list against the PDF before approving.",
    })
  }

  // Sanity issues above already force REVIEW; the match-quality reasons only
  // matter when they are what put the invoice here.
  if (reasons.length === 0) {
    if (!input.matched) {
      reasons.push({
        kind: "no_store_match",
        message: "No store matched the delivery address — assign one before approving.",
      })
    } else if (input.matchConfidence != null && input.matchConfidence < 0.85) {
      reasons.push({
        kind: "low_match_confidence",
        message: `Store auto-match confidence is ${(input.matchConfidence * 100).toFixed(0)}% — confirm the assignment is right.`,
      })
    }
  }

  return reasons
}

function roundQuantity(value: number): number {
  return Math.round(value * 1000) / 1000
}

const CATCH_WEIGHT_MIN_PER_CASE_LB = 0.25
const CATCH_WEIGHT_MAX_PER_CASE_LB = 200
const CATCH_WEIGHT_MAX_INFERRED_CASES = 30

/**
 * Pull a comma-separated list of per-case weights out of an invoice line's
 * description text. Premier Meats and similar catch-weight vendors print the
 * actual weighed value of each carton below the line (e.g.
 * `"70.45, 70.45, 71.05, 70.25, ..."`). When at least two numbers in the
 * plausible per-case weight range are joined only by commas + whitespace, this
 * returns them in order. Otherwise returns null — the caller must validate
 * against the line's total quantity before acting on the result.
 */
export function parsePerCaseWeights(description: string | null): number[] | null {
  if (!description) return null

  const numRe = /\b\d{1,3}(?:\.\d{1,3})?\b/g
  const matches: Array<{ value: number; start: number; end: number }> = []
  let m: RegExpExecArray | null
  while ((m = numRe.exec(description)) !== null) {
    matches.push({
      value: parseFloat(m[0]),
      start: m.index,
      end: m.index + m[0].length,
    })
  }
  if (matches.length < 2) return null

  // Find the longest contiguous run where the gap between consecutive matches
  // is exactly one comma plus surrounding whitespace (newlines count).
  let bestRun: number[] = []
  let currentRun: number[] = [matches[0].value]
  for (let i = 1; i < matches.length; i++) {
    const gap = description.slice(matches[i - 1].end, matches[i].start)
    if (/^\s*,\s*$/.test(gap)) {
      currentRun.push(matches[i].value)
    } else {
      if (currentRun.length > bestRun.length) bestRun = currentRun
      currentRun = [matches[i].value]
    }
  }
  if (currentRun.length > bestRun.length) bestRun = currentRun

  if (bestRun.length < 2) return null
  const allInRange = bestRun.every(
    (v) => v >= CATCH_WEIGHT_MIN_PER_CASE_LB && v <= CATCH_WEIGHT_MAX_PER_CASE_LB
  )
  if (!allInRange) return null
  return bestRun
}

/**
 * Given the line's original carton count (before catch-weight normalization
 * rewrote `quantity → impliedLB`) and the implied LB total, infer pack fields:
 *
 *   packSize  = round(|originalQuantity|)   if it's a plausible integer ∈ [1, 30]
 *   unitSize  = |impliedQuantity| / packSize
 *   unitSizeUom = "LB"
 *
 * Returns null when no plausible inference can be made.
 */
function inferCatchWeightPackFromCartonCount(
  originalQuantity: number,
  impliedQuantity: number
): { packSize: number; unitSize: number; unitSizeUom: "LB" } | null {
  const absCases = Math.abs(originalQuantity)
  if (!Number.isFinite(absCases) || absCases <= 0) return null
  const rounded = Math.round(absCases)
  if (Math.abs(rounded - absCases) > 0.01) return null
  if (rounded < 1 || rounded > CATCH_WEIGHT_MAX_INFERRED_CASES) return null
  const unitSize = Math.abs(impliedQuantity) / rounded
  if (!Number.isFinite(unitSize) || unitSize <= 0) return null
  if (unitSize < CATCH_WEIGHT_MIN_PER_CASE_LB || unitSize > CATCH_WEIGHT_MAX_PER_CASE_LB) return null
  return { packSize: rounded, unitSize, unitSizeUom: "LB" }
}

function isCatchWeightCandidate(
  vendorName: string | null | undefined,
  line: InvoiceExtraction["lineItems"][number],
  impliedQuantity: number
): boolean {
  const currentUnit = line.unit?.trim().toUpperCase() ?? ""
  if (currentUnit === "LB") return false

  const category = line.category?.trim().toLowerCase() ?? ""
  const productText = `${line.productName} ${line.description ?? ""}`
  const vendorLooksMeat = CATCH_WEIGHT_VENDOR_RE.test(vendorName ?? "")
  const lineLooksMeat =
    category === "meat" ||
    category === "poultry" ||
    category === "seafood" ||
    MEAT_LINE_RE.test(productText)

  if (!vendorLooksMeat && !lineLooksMeat) return false

  const absImplied = Math.abs(impliedQuantity)
  if (absImplied < CATCH_WEIGHT_MIN_LB || absImplied > CATCH_WEIGHT_MAX_LB) {
    return false
  }

  // Catch-weight misses usually capture case/carton count, while the printed
  // dollars are per pound. Avoid rewriting tiny corrections or fee-like rows.
  return Math.abs(impliedQuantity) > Math.abs(Number(line.quantity)) * 3
}

/**
 * Fix LLM catch-weight mistakes where a meat invoice line captures the carton
 * count (e.g. `6 CS`) even though unitPrice and extendedPrice prove the printed
 * purchasable quantity is pounds.
 *
 * After rewriting `quantity → impliedLB, unit → "LB"`, the function also tries
 * to recover the case structure that was originally on the invoice. Preference
 * order:
 *
 *   1. Per-case weight list in `description` (most reliable — uses
 *      `parsePerCaseWeights` and validates that the sum is within 2% of the
 *      implied LB total).
 *   2. The original `quantity` value (the carton count the model captured
 *      before we realized it should be a pound total), when it's a plausible
 *      integer in `[1, CATCH_WEIGHT_MAX_INFERRED_CASES]`.
 *
 * If neither yields a sane result, pack fields stay null. Downstream readers
 * use the convention `unit === "LB" && packSize >= 1 && unitSizeUom === "LB"`
 * as the catch-weight signature.
 */
export function normalizeCatchWeightMeatLines(
  extraction: InvoiceExtraction
): InvoiceExtraction {
  let changed = false
  const lineItems = extraction.lineItems.map((line) => {
    const qty = Number(line.quantity)
    const unitPrice = Number(line.unitPrice)
    const ext = Number(line.extendedPrice)
    if (!Number.isFinite(qty) || !Number.isFinite(unitPrice) || !Number.isFinite(ext)) {
      return line
    }
    if (Math.abs(ext) < 0.01 || Math.abs(unitPrice) < 0.0001) return line

    const computed = qty * unitPrice
    const drift = Math.abs(computed - ext) / Math.abs(ext)
    if (drift <= LINE_MATH_TOLERANCE) return line

    const impliedQuantity = ext / unitPrice
    if (
      !Number.isFinite(impliedQuantity) ||
      !isCatchWeightCandidate(extraction.vendorName, line, impliedQuantity)
    ) {
      return line
    }

    // Try description first (more accurate). Fall back to carton count.
    const weights = parsePerCaseWeights(line.description)
    let pack: { packSize: number; unitSize: number; unitSizeUom: "LB" } | null = null
    if (weights) {
      const sum = weights.reduce((acc, v) => acc + v, 0)
      const ratio = Math.abs(sum - Math.abs(impliedQuantity)) / Math.abs(impliedQuantity)
      if (ratio <= LINE_MATH_TOLERANCE) {
        pack = {
          packSize: weights.length,
          unitSize: sum / weights.length,
          unitSizeUom: "LB",
        }
      }
    }
    if (!pack) {
      pack = inferCatchWeightPackFromCartonCount(qty, impliedQuantity)
    }

    changed = true
    return {
      ...line,
      quantity: roundQuantity(impliedQuantity),
      unit: "LB",
      packSize: pack ? pack.packSize : null,
      unitSize: pack ? roundQuantity(pack.unitSize) : null,
      unitSizeUom: pack ? pack.unitSizeUom : null,
    }
  })

  return changed ? { ...extraction, lineItems } : extraction
}

export function looksLikePaperCountPack(line: {
  productName: string
  description?: string | null
  category: string | null
}): boolean {
  const category = line.category?.trim().toLowerCase() ?? ""
  const productText = `${line.productName} ${line.description ?? ""}`
  return (
    category === "paper/supplies" ||
    category === "cleaning" ||
    PAPER_COUNT_PACK_RE.test(productText)
  )
}

/**
 * Fix count-pack lines where the model read a single visible count as
 * `packSize=N, unitSize=1` instead of one case containing N counted items.
 */
export function normalizeCountPackLines(extraction: InvoiceExtraction): InvoiceExtraction {
  let changed = false
  const lineItems = extraction.lineItems.map((line) => {
    const unit = line.unit?.trim().toUpperCase() ?? ""
    const uom = line.unitSizeUom?.trim().toUpperCase() ?? ""
    if (
      unit !== "CS" ||
      (uom !== "" && uom !== "CT") ||
      line.packSize == null ||
      line.unitSize == null ||
      line.packSize <= 50 ||
      line.packSize > 1_000 ||
      line.unitSize > 2 ||
      !looksLikePaperCountPack(line)
    ) {
      return line
    }

    changed = true
    return {
      ...line,
      packSize: 1,
      unitSize: line.packSize,
      unitSizeUom: "CT",
    }
  })

  return changed ? { ...extraction, lineItems } : extraction
}

export interface PackShapeAnomaly {
  lineNumber: number
  productName: string
  unit: string | null
  packSize: number | null
  unitSize: number | null
  unitSizeUom: string | null
  reasons: string[]
}

/**
 * Rules below target known fused-column OCR bug signatures (e.g. Sysco lettuce
 * "112 CT" parsed as packSize=112 instead of packSize=1, unitSize=12). They are
 * intentionally narrow to avoid false-flagging legitimate cases like
 * "30 × 1-LB butter solids" or "9 × 8-count rolls".
 *
 * When any rule fires the line is reported as an anomaly; the sync route uses
 * the presence of anomalies to route the invoice to REVIEW status instead of
 * auto-MATCHED.
 */
export function findPackShapeAnomalies(
  lineItems: InvoiceExtraction["lineItems"]
): PackShapeAnomaly[] {
  const anomalies: PackShapeAnomaly[] = []
  for (const li of lineItems) {
    const reasons: string[] = []

    // Rule 1 — implausibly high packSize on case-goods. Real-world case-goods
    // almost never exceed 50/pack; values >50 are essentially always a fused-
    // column mis-split (e.g. "112 CT" → packSize=112).
    const unitSizeUom = li.unitSizeUom?.trim().toUpperCase() ?? null
    const isSmallGramPacketCase =
      unitSizeUom != null &&
      GRAM_UOMS.has(unitSizeUom) &&
      li.unitSize != null &&
      li.unitSize > 0 &&
      li.unitSize <= 10 &&
      li.packSize != null &&
      li.packSize <= 1_000
    const isLargePaperCountPackCase =
      (unitSizeUom == null || unitSizeUom === "CT") &&
      li.packSize != null &&
      li.packSize <= 200 &&
      li.unitSize != null &&
      li.unitSize >= 100 &&
      li.unitSize <= 2_000 &&
      looksLikePaperCountPack(li)

    if (
      li.unit === "CS" &&
      li.packSize != null &&
      li.packSize > 50 &&
      !isSmallGramPacketCase &&
      !isLargePaperCountPackCase
    ) {
      reasons.push(
        `packSize=${li.packSize} for unit=CS is implausibly high — likely a fused PACK/SIZE split`
      )
    }

    // Rule 2 — CT-packed goods with the lettuce-bug shape (high pack, low size).
    // Produce/case-goods CT almost always has packSize=1 with unitSize=count.
    // The fusion bug flips this: "1 CS × 12 CT" misreads as packSize≥10, unitSize≤2.
    if (
      li.unitSizeUom === "CT" &&
      li.unitSize != null &&
      li.packSize != null &&
      li.unitSize <= 2 &&
      li.packSize > 6
    ) {
      reasons.push(
        `CT pack-shape ${li.packSize}×${li.unitSize} looks fused — produce/case-goods ` +
          `CT typically has packSize=1 with unitSize=count`
      )
    }

    // Rule 3 — implausibly large unitSize on weight/volume goods. unitSize values
    // beyond reasonable container size for the UoM indicate a mis-split where the
    // model dragged extra digits into unitSize.
    if (li.unitSize != null && li.unitSizeUom != null) {
      const limits: Record<string, number> = {
        OZ: 256,
        "FL OZ": 128,
        LB: 50,
        GAL: 10,
      }
      const limit = limits[li.unitSizeUom.toUpperCase()]
      if (limit != null && li.unitSize > limit * 4) {
        reasons.push(
          `unitSize=${li.unitSize} ${li.unitSizeUom} exceeds plausible container size (≤${limit} typical)`
        )
      }
    }

    if (reasons.length > 0) {
      anomalies.push({
        lineNumber: li.lineNumber,
        productName: li.productName,
        unit: li.unit,
        packSize: li.packSize,
        unitSize: li.unitSize,
        unitSizeUom: li.unitSizeUom,
        reasons,
      })
    }
  }
  return anomalies
}
