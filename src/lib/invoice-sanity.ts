// Sanity checks applied to OpenAI-extracted invoice data before persistence.

import type { InvoiceExtraction } from "@/types/invoice"
import { goodsLines, tieOut, TIE_OUT_TOLERANCE } from "@/lib/invoice-charges"
import { convert } from "@/lib/unit-conversion"

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
const GRAM_UOMS = new Set(["G", "GR", "GM", "GRM", "GRAM", "GRAMS", "GS", "GMS", "GRS"])
const PAPER_COUNT_PACK_RE =
  /\b(bag|bags|bath\s+tissue|tissue|toilet|napkin|towel|roll|wrap|wrapper|cup|cups|lid|lids|glove|gloves|paper|liner|liners|foil|film|sheet|sheets|straw|straws)\b/i

// Disposables counted by the piece, for the pack-shape rules only. Narrower
// than PAPER_COUNT_PACK_RE on purpose: "bag", "roll", "wrap" and "plate" are
// also food ("FRIES 6/5 LB BAG", "HAMBURGER ROLL", "BEEF PLATE"), and these
// rules excuse or accuse a line on the strength of the name alone.
const DISPOSABLE_NAME_RE =
  /\b(cup|cups|lid|lids|liner|liners|napkin|napkins|tissue|towel|towels|glove|gloves|straw|straws|paper|cutlery|fork|forks|knife|knives|spoon|spoons|spork|sporks|container|containers|cont|clamshell|tray|trays|carrier|label|labels)\b/i

function isDisposable(line: { productName: string; description?: string | null; category: string | null }): boolean {
  return (
    line.category?.trim().toLowerCase() === "paper/supplies" ||
    DISPOSABLE_NAME_RE.test(`${line.productName} ${line.description ?? ""}`)
  )
}

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

// The tolerance used to be 2% of the total with a $1 floor — about $20 on a
// typical IFS delivery, which is room for a whole dropped line. It is now
// `TIE_OUT_TOLERANCE` ($1) from `@/lib/invoice-charges`, the same figure the
// Approve gate reads; trying each reading of the fee rows is what absorbs the
// vendor-layout noise the wide percentage used to.

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
 * **3. (2026-10-28) The fee rows are now tried both ways.** The exact-name
 * set missed IFS's new "Freight/Misc." and Sysco's six spellings of a fuel
 * surcharge, and it is the Approve gate's arithmetic too, so `tieOut` tries
 * each fee row inside and outside the subtotal. That is still not point 2's
 * three free chances: fee rows are a few dollars each, the tolerance fell
 * from 2% to $1, and the one extra reading (all lines plus tax against the
 * total) is the document's own identity. See `tieOut` for the measurement.
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
  if (!Number.isFinite(totalAmount)) return null
  const priced = goodsLines(extraction.lineItems)
  // No lines is `findEmptyExtraction`'s finding (the page shows the same gap).
  // A zero total is NOT skipped any more: the Approve gate reads `tieOut` on
  // it, so the sync must too or a $0 header over $100 of lines imports clean
  // and can never be approved.
  if (priced.length === 0) return null

  const subtotal = extraction.subtotal != null ? Number(extraction.subtotal) : null
  const taxAmount = extraction.taxAmount != null ? Number(extraction.taxAmount) : null
  // Since 2026-10-28 the same `tieOut` the Approve gate reads, so an invoice
  // the sync lets through is one the owner can approve, and the reverse.
  const t = tieOut(extraction.lineItems, {
    subtotal: subtotal != null && Number.isFinite(subtotal) ? subtotal : null,
    taxAmount: taxAmount != null && Number.isFinite(taxAmount) ? taxAmount : null,
    totalAmount,
  })
  if (t.reconciles) return null
  return {
    lineSum: t.goods,
    subtotal: t.referenceKind === "subtotal" ? subtotal : null,
    taxAmount,
    totalAmount,
    closestReference: t.reference,
    gap: Math.abs(t.gap),
    tolerance: TIE_OUT_TOLERANCE,
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
    | "not_a_supplier"
    | "not_an_invoice"
    | "unknown"
  /** Owner-facing sentence. Amounts pre-formatted; no jargon. */
  message: string
  /** Invoice line numbers this reason points at, for row-level flagging. */
  lineNumbers?: number[]
}

const fmt = (n: number) =>
  `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** `fmt` with the sign kept, for a line whose credit is the point. */
const fmtSigned = (n: number) => (n < 0 ? `−${fmt(n)}` : fmt(n))

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
        `Line ${m.lineNumber} "${m.productName}": ${m.quantity} ${m.unit ?? "×"} at ${fmtSigned(m.unitPrice)} ` +
        `computes to ${fmtSigned(m.computed)}, but the invoice prints ${fmtSigned(m.extendedPrice)}` +
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
 * packSize is a whole count in the database. A read of "1.5" there failed the
 * whole invoice's save (Sysco 145426990, 2026-10-28), so the email was retried
 * every run. Keep the case total and move it into unitSize instead.
 */
export function foldFractionalPackSizes(extraction: InvoiceExtraction): InvoiceExtraction {
  let changed = false
  const lineItems = extraction.lineItems.map((line) => {
    const { packSize } = line
    if (packSize == null || !isFinite(packSize) || Number.isInteger(packSize)) return line
    changed = true
    const rounded = Math.round(packSize)
    if (Math.abs(packSize - rounded) < 1e-6 && rounded > 0) return { ...line, packSize: rounded }
    return {
      ...line,
      packSize: 1,
      unitSize: Math.round(packSize * (line.unitSize ?? 1) * 1e6) / 1e6,
    }
  })
  return changed ? { ...extraction, lineItems } : extraction
}

/** Every number printed in a name, with "1/2" read as 0.5. */
function numbersInName(text: string): number[] {
  const out: number[] = []
  for (const m of text.matchAll(/(\d+)\s*\/\s*(\d+)|(\d*\.\d+|\d+)/g)) {
    if (m[1] != null && m[2] != null) {
      const den = Number(m[2])
      if (den > 0) out.push(Number(m[1]) / den)
    } else if (m[3] != null) {
      out.push(Number(m[3]))
    }
  }
  return out
}

/**
 * A counted disposable whose case count landed in packSize while the size in
 * its name ("TRAY FOOD 0.5LB", "CUP 20 OZ") was read as unitSize: IFS
 * VBFTHRP came in as 1000 × 0.5 LB, a 500 lb case of paper trays. The case is
 * the count alone, 1 × 1000 CT. Only when the size is printed in the name and
 * the count is too large to be packs of anything.
 */
function isNameSizeReadAsPack(
  line: InvoiceExtraction["lineItems"][number],
  unit: string,
  uom: string
): boolean {
  if (unit !== "CS" || uom === "" || uom === "CT") return false
  const { packSize, unitSize } = line
  if (packSize == null || unitSize == null || unitSize <= 0) return false
  if (!Number.isInteger(packSize) || packSize <= 50 || packSize > ABSURD_PACK_SIZE) return false
  if (convert(1, uom, "lb") == null && convert(1, uom, "fl oz") == null) return false
  if (!isDisposable(line)) return false
  const text = `${line.productName} ${line.description ?? ""}`
  return numbersInName(text).some((n) => Math.abs(n - unitSize) < 1e-9)
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
    if (isNameSizeReadAsPack(line, unit, uom)) {
      changed = true
      return { ...line, packSize: 1, unitSize: line.packSize, unitSizeUom: "CT" }
    }
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

/** A case of more than this many units is a misread whatever the goods. */
const ABSURD_PACK_SIZE = 10_000
/** Heaviest / largest believable single case, in base units (lb, fl oz). */
const MAX_CASE_LB = 200
const MAX_CASE_FL_OZ = 60 * 128

/**
 * Pack fields as one case's total in a base unit, or null when the uom is not
 * a weight or volume this module can convert.
 */
function caseTotalInBase(
  packSize: number,
  unitSize: number,
  uom: string
): { amount: number; limit: number } | null {
  const lb = convert(packSize * unitSize, uom, "lb")
  if (lb != null) return { amount: lb, limit: MAX_CASE_LB }
  const flOz = convert(packSize * unitSize, uom, "fl oz")
  if (flOz != null) return { amount: flOz, limit: MAX_CASE_FL_OZ }
  return null
}

/**
 * Lines whose pack fields look misread — the ones that would distort an
 * ingredient's $/unit if they were trusted.
 *
 * Until 2026-10-28 rule 1 flagged ANY case of more than 50 units. On this
 * account that was 19 of the 25 pack-shape holds, and every one was a real
 * case: the house sauce ships 180 cups to a case, can liners 100, napkins
 * 6,000, cups 1,000. A rule that fires on every Vitco invoice is not a check,
 * it is a queue. The rules now ask whether the case could physically exist:
 *
 *   1. A case of more than 10,000 units (KEVIDKO's fork read as 1,000,000).
 *      Below that, a high count on paper and count goods is ordinary; on
 *      other goods with no weight or volume (the Sysco lettuce "112 CT"
 *      fusion) it is still flagged.
 *   2. A weight or volume case heavier than 200 lb or larger than 60 gal
 *      (an IFS can liner read as 100 × 55 GAL).
 *   3. The lettuce-bug shape, high pack × size ≤ 2 CT, on food only. On
 *      paper goods 6000 × 1 CT and 1 × 6000 CT are the same case.
 *   4. A single unit far beyond any container for its uom.
 *   5. Paper or count goods carrying a weight or volume size: the model has
 *      copied a size out of the product name ("CUP PET 20 OZ") into the pack.
 *
 * `isConfirmed` lets the caller exempt lines whose shape matches this SKU's
 * own accepted history (`lineMatchesPrior` in `@/lib/invoice-pack-prior`).
 * History beats every heuristic here: a shape the vendor has shipped and the
 * account has accepted three or more times is not a misread.
 */
export function findPackShapeAnomalies(
  lineItems: InvoiceExtraction["lineItems"],
  options?: { isConfirmed?: (line: InvoiceExtraction["lineItems"][number]) => boolean }
): PackShapeAnomaly[] {
  const anomalies: PackShapeAnomaly[] = []
  for (const li of lineItems) {
    if (options?.isConfirmed?.(li)) continue
    const reasons: string[] = []

    const unitSizeUom = li.unitSizeUom?.trim().toUpperCase() ?? null
    // Catch-weight lines ordered by the pound: packSize counts cartons and the
    // product is the delivery's weight, not one case.
    const soldByWeight = convert(1, li.unit ?? "", "lb") != null
    const paperOrCount = isDisposable(li)
    const caseTotal =
      li.packSize != null && li.unitSize != null && li.packSize > 0 && li.unitSize > 0 && unitSizeUom
        ? caseTotalInBase(li.packSize, li.unitSize, unitSizeUom)
        : null
    const isSmallGramPacketCase =
      unitSizeUom != null &&
      GRAM_UOMS.has(unitSizeUom) &&
      li.unitSize != null &&
      li.unitSize > 0 &&
      li.unitSize <= 10 &&
      li.packSize != null &&
      li.packSize <= 1_000

    // Rule 1 — a case count no case could hold.
    if (li.packSize != null && li.packSize > ABSURD_PACK_SIZE) {
      reasons.push(`packSize=${li.packSize} is more than any case holds — the pack count was misread`)
    } else if (
      li.unit === "CS" &&
      li.packSize != null &&
      li.packSize > 50 &&
      caseTotal == null &&
      !looksLikePaperCountPack(li) &&
      !paperOrCount &&
      !isSmallGramPacketCase
    ) {
      reasons.push(
        `packSize=${li.packSize} for unit=CS is implausibly high for food sold by count — likely a fused PACK/SIZE split`
      )
    }

    // Rule 2 — a case heavier or larger than anything a vendor ships. Not on
    // catch-weight lines ordered by the pound: there packSize counts cartons
    // and the product is the delivery's total weight, not one case.
    if (caseTotal != null && !soldByWeight && caseTotal.amount > caseTotal.limit) {
      reasons.push(
        `${li.packSize} × ${li.unitSize} ${li.unitSizeUom} is more than one case can weigh or hold`
      )
    }

    // Rule 3 — the lettuce-bug shape on food (paper goods are counted either way).
    if (
      unitSizeUom === "CT" &&
      !paperOrCount &&
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

    // Rule 4 — one unit far beyond any container for its uom.
    if (li.unitSize != null && unitSizeUom != null) {
      const limits: Record<string, number> = {
        OZ: 256,
        "FL OZ": 128,
        LB: 50,
        GAL: 10,
      }
      const limit = limits[unitSizeUom]
      if (limit != null && li.unitSize > limit * 4) {
        reasons.push(
          `unitSize=${li.unitSize} ${li.unitSizeUom} exceeds plausible container size (≤${limit} typical)`
        )
      }
    }

    // Rule 5 — a size from the product name copied into a counted case.
    // Disposables only: the "cleaning" category also covers sanitiser sold by
    // the gallon, and "bag"/"roll" also name food.
    if (caseTotal != null && !soldByWeight && !isSmallGramPacketCase && paperOrCount) {
      reasons.push(
        `${li.unitSizeUom} on a counted item — the size in the product name was read as the pack`
      )
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

// ─── Self-healing ───

/**
 * Drop a line the extractor read twice, when that alone makes the invoice add
 * up.
 *
 * Premier Meats credit 2250793 printed one return line and a "Return/Cancelled
 * Order" note under it; the model stored both as lines, so the $2,691.45
 * credit read as $5,382.90 and sat in review with nothing the owner could do
 * but reject it. A duplicate is the same SKU, quantity, unit price and amount,
 * with the second name the whole first name plus, at most, a note. It is only dropped when the tie-out
 * fails with it and passes without it — two genuinely identical cases of
 * something on one delivery are left alone.
 */
export function dropDuplicatedLines(extraction: InvoiceExtraction): {
  extraction: InvoiceExtraction
  dropped: number[]
} {
  const head = {
    subtotal: extraction.subtotal,
    taxAmount: extraction.taxAmount,
    totalAmount: extraction.totalAmount,
  }
  let lines = extraction.lineItems
  const dropped: number[] = []
  if (tieOut(lines, head).reconciles) return { extraction, dropped }

  const name = (n: string) => n.trim().toLowerCase()
  for (let j = 1; j < lines.length; j++) {
    const b = lines[j]
    // Same SKU (never two blanks), same money, and the second name is the
    // whole first name — possibly with a note after it ("… Return/Cancelled
    // Order") — so two different products can never pair up.
    const twin = lines.slice(0, j).find(
      (a) =>
        a.sku != null &&
        a.sku.trim() !== "" &&
        a.sku === b.sku &&
        a.quantity === b.quantity &&
        a.unitPrice === b.unitPrice &&
        a.extendedPrice === b.extendedPrice &&
        name(a.productName).length > 0 &&
        name(b.productName).startsWith(name(a.productName)),
    )
    if (!twin) continue
    const without = lines.filter((_, k) => k !== j)
    if (!tieOut(without, head).reconciles) continue
    dropped.push(b.lineNumber)
    lines = without
    break
  }
  return dropped.length > 0
    ? { extraction: { ...extraction, lineItems: lines }, dropped }
    : { extraction, dropped }
}

/**
 * A credit line read with a positive quantity under a negative amount.
 *
 * Vendors print the minus on the amount only ("1 CS  118.71  118.71-"), and the
 * model carries it to `extendedPrice` but not to `quantity`. The line then
 * fails its own arithmetic and the credit sits in review: Vitco credit
 * 323469-0A on 2026-10-28, and an IFS return of 11 cases fixed by hand the same
 * day. When the size of the amount matches quantity × price, the quantity takes
 * the amount's sign. Anything that does not match is left for the math check.
 */
export function fixCreditLineSigns(extraction: InvoiceExtraction): {
  extraction: InvoiceExtraction
  flipped: number[]
} {
  const flipped: number[] = []
  const lineItems = extraction.lineItems.map((li) => {
    const qty = Number(li.quantity)
    const unitPrice = Number(li.unitPrice)
    const ext = Number(li.extendedPrice)
    if (!(qty > 0 && unitPrice > 0 && ext < 0)) return li
    const drift = Math.abs(qty * unitPrice + ext) / Math.abs(ext)
    if (drift > LINE_MATH_TOLERANCE) return li
    flipped.push(li.lineNumber)
    return { ...li, quantity: -qty }
  })
  return flipped.length > 0
    ? { extraction: { ...extraction, lineItems }, flipped }
    : { extraction, flipped }
}

/**
 * What is wrong with an extraction's money, in words a second read can act on.
 * Empty when the lines add up and every line's arithmetic holds — the problems
 * that lock Approve. Pack shapes are not here: they are corrected from the
 * SKU's history after extraction, not by reading the PDF again.
 */
export function describeMoneyProblems(extraction: InvoiceExtraction): string[] {
  const problems: string[] = []
  const empty = findEmptyExtraction(extraction)
  if (empty) {
    problems.push(
      `No priced line items were read, but the invoice totals ${fmt(empty.totalAmount)}. Read every product line.`,
    )
    return problems
  }
  const total = findTotalReconciliationMismatch(extraction)
  if (total) {
    problems.push(
      `The product lines add up to ${fmt(total.lineSum)} but the invoice prints a ${total.subtotal != null ? "subtotal" : "total less tax"} of ` +
        `${fmt(total.closestReference)}. A line was probably missed, read twice, or had its quantity or price misread.`,
    )
  }
  for (const m of findLineMathMismatches(extraction.lineItems)) {
    problems.push(
      `Line ${m.lineNumber} "${m.productName}": ${m.quantity} × ${fmt(m.unitPrice)} is ${fmt(m.computed)}, not the printed ${fmt(m.extendedPrice)}.`,
    )
  }
  return problems
}

/** Lower is better: an empty read is worst, then a total that misses, then each bad line. */
export function moneyProblemScore(extraction: InvoiceExtraction): number {
  if (findEmptyExtraction(extraction)) return 1_000
  return (
    (findTotalReconciliationMismatch(extraction) ? 100 : 0) +
    findLineMathMismatches(extraction.lineItems).length * 10
  )
}

/** Account paperwork that arrives with bills but is not one. */
const ACCOUNT_PAPER_RE = /\b(statement|payment receipt|remittance|receipt)(?![a-z])/i

/**
 * A statement or payment receipt: named so in the email or file, and no line
 * names a product (its lines are the invoice numbers it pays or lists).
 */
export function isAccountPaper(
  subject: string | null | undefined,
  attachmentName: string | null | undefined,
  lines: { productName: string | null; description?: string | null }[]
): boolean {
  if (!ACCOUNT_PAPER_RE.test(`${subject ?? ""} ${(attachmentName ?? "").replace(/[_.-]+/g, " ")}`)) return false
  return lines.every((li) => !/[a-z]/i.test(`${li.productName ?? ""} ${li.description ?? ""}`))
}
