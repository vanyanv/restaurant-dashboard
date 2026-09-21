import { prisma } from "@/lib/prisma"
import { goodsSum, isChargeRow } from "@/lib/invoice-charges"
import { normalizeVendorName } from "@/lib/vendor-normalize"
import { bytes, count, money, pct, plural, pluralWord, titleCase, unitCost } from "@/lib/counter/format"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
import { mapReady, type SectionData } from "@/lib/counter/section-data"
import type { FigureProps, KvRow, MListRow, MoneyLine, Row } from "@/components/counter"

/**
 * One invoice — `P.invoice` (`docs/counter/counter-prototype.html`, the
 * `P.invoice` block).
 *
 * "The stored PDF and what the model read out of it, side by side, because the
 * failure that matters is a line the table never got."
 *
 * That sentence is the page's whole argument and **this schema cannot make the
 * comparison it describes.** See `headOf`.
 *
 * Measured with the invoices work earlier this session
 * (`docs/counter/measurements/2026-08-28-invoices.md`) and re-probed for this
 * page: all 226 invoices carry a PDF, a raw extraction, a model name and their
 * email provenance, so every panel below has full data except the two the
 * prototype invents.
 *
 * `nodate: true` in the prototype, and rightly — an invoice is a record, not a
 * range. Nothing here reads the date control.
 */

/** Extracted lines the table prints before it stops. */
const LINE_ROWS = 40
/** Rows on the phone's decision list. */
const PHONE_ROWS = 6
/** A line reconciles when it lands inside half a cent. */
const EPSILON = 0.02

export interface InvoiceHead {
  title: string
  sub: string
  cells: FigureProps[]
  phoneCells: FigureProps[]
  /** Null when the invoice ties out — the phone's alert block is dropped. */
  alert: { label: string; value: string; body: string } | null
}

/**
 * The custody check: the stored extraction against the stored line items.
 *
 * `Invoice.rawExtractionJson` is `JSON.stringify(extraction)` and
 * `InvoiceLineItem` is written from `extraction.lineItems` in the same call,
 * carrying `lineNumber` across verbatim. All three writers do it that way —
 * `src/app/api/invoices/sync/route.ts`, `scripts/reprocess-invoices.ts` and
 * `scripts/fix-bad-invoices.ts` — and the second of them additionally DROPS
 * any row whose `lineNumber` is null. So the two collections are the same rows
 * before and after persistence, keyed the same way, and a difference between
 * them is a row that was read and not stored (or stored and not read back).
 *
 * **This is not a second reading of the document.** Nothing in this schema
 * records how many rows the printed page had, so this check sees only what
 * happened BETWEEN the extractor and the table. The other half of the
 * question — whether the extractor itself missed a row — has no witness but
 * the printed subtotal (`headOf`) and the vendor's own subject line
 * (`subjectLineCount`).
 */
export interface InvoiceCustody {
  /**
   * Rows in the stored raw extraction. Null when none is stored, or when the
   * stored string will not parse into a `lineItems` array — in which case
   * nothing below it means anything and every other field reads 0.
   */
  rawRows: number | null
  /** `InvoiceLineItem` rows on this invoice. */
  storedRows: number
  /** Raw rows whose line number has fewer line items behind it than raw rows. */
  missing: number
  /** Those rows' `extendedPrice`, summed. 0 when there are none. */
  missingValue: number
  /**
   * True when at least one missing row carried no finite `extendedPrice`, so
   * `missingValue` is a floor rather than the amount.
   */
  missingValueIsFloor: boolean
  /** Line items at a line number the raw extraction does not account for. */
  surplus: number
  /** Their `extendedPrice`, summed. */
  surplusValue: number
}

export interface InvoiceDocument {
  /** The route that streams the stored PDF, or null when there is no file. */
  href: string | null
  meta: string
  /**
   * The row-for-row reconciliation behind `note`.
   *
   * Carried on the section rather than kept inside `countsNote` so the figure
   * has one owner: the note is prose ABOUT this object, and a second place
   * counting the same rows is how one screen comes to disagree with another.
   */
  custody: InvoiceCustody
  note: string
}

export interface InvoiceReasons {
  rows: Array<{ key: string; kind: string; message: string; lines: string | null }>
  meta: string
  note: string
}

export interface InvoiceLines {
  rows: Row[]
  phoneRows: MListRow[]
  money: MoneyLine[]
  meta: string
  phoneMeta: string
  note: string
  /** What the phone says when no LINE is flagged — see `linesOf`. */
  phoneEmpty: string
  /** True when the goods tie to the printed subtotal. */
  reconciles: boolean
  /**
   * The row the decision writes back to, and where it currently stands.
   *
   * On THIS section rather than on `reasons`, because that is where
   * `P.invoice` puts the control: the `.btnrow` sits inside "What was
   * extracted", under the money lines, and its note reads "Approve unlocks
   * when the gap is zero". The verdict belongs beside the arithmetic it is a
   * verdict on — `reconciles` above is the gate, and both have to arrive in
   * the same section for the page to be able to honour it.
   */
  invoiceId: string
  /** `Invoice.status` — PENDING, MATCHED, REVIEW, APPROVED or REJECTED. */
  status: string
  /** Whether the document is already recorded as a credit rather than a bill. */
  isReturn: boolean
}

export interface InvoicePanels {
  arrival: { rows: KvRow[]; meta: string }
  storage: { rows: KvRow[]; meta: string }
  matching: { rows: KvRow[]; meta: string; note: string }
}

export interface InvoiceSections {
  head: SectionData<InvoiceHead>
  document: SectionData<InvoiceDocument>
  reasons: SectionData<InvoiceReasons>
  lines: SectionData<InvoiceLines>
  panels: SectionData<InvoicePanels>
}

export interface InvoiceInput {
  invoiceId: string
  accountId: string
}

/* -- loading ---------------------------------------------------------- */

interface LineRow {
  lineNumber: number
  sku: string | null
  productName: string
  quantity: number
  unit: string | null
  unitPrice: number
  extendedPrice: number
  packSize: number | null
  unitSize: number | null
  unitSizeUom: string | null
  matchedTo: string | null
  matchSource: string | null
  isCharge: boolean
}

interface Reason {
  kind: string
  message: string
  lineNumbers?: number[]
}

interface Loaded {
  id: string
  number: string
  vendor: string
  rawVendor: string
  date: Date | null
  dueDate: Date | null
  status: string
  total: number
  subtotal: number | null
  tax: number | null
  isReturn: boolean
  lines: LineRow[]
  goods: number
  gap: number | null
  reasons: Reason[]
  matchConfidence: number | null
  storeName: string | null
  email: { from: string | null; subject: string | null; at: Date | null; attachment: string | null }
  pdfPath: string | null
  /** `Invoice.pdfSize` — the stored object's byte count. Null when none is held. */
  pdfBytes: number | null
  model: string | null
  /** The stored extraction's rows against the stored line items. */
  custody: InvoiceCustody
  /** Lines the VENDOR states in the email subject, when it states one. */
  subjectLines: number | null
}

/** One row of `rawExtractionJson.lineItems`, read defensively. */
interface RawExtractionRow {
  lineNumber: number | null
  extendedPrice: number | null
}

/**
 * Reads `rawExtractionJson` as ROWS rather than as a count.
 *
 * Everything is optional on the way in: the column is a `String?` written by
 * three different callers over the life of this account, and a shape that does
 * not parse is a reason to say the check cannot run, never a reason to throw
 * on a page.
 */
function rawExtractionRows(json: string | null): RawExtractionRow[] | null {
  if (!json) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object") return null
  const lineItems = (parsed as { lineItems?: unknown }).lineItems
  if (!Array.isArray(lineItems)) return null
  return lineItems.map((row) => {
    const r = (row ?? {}) as { lineNumber?: unknown; extendedPrice?: unknown }
    return {
      lineNumber: typeof r.lineNumber === "number" && Number.isFinite(r.lineNumber)
        ? r.lineNumber
        : null,
      extendedPrice: typeof r.extendedPrice === "number" && Number.isFinite(r.extendedPrice)
        ? r.extendedPrice
        : null,
    }
  })
}

/**
 * Pairs the extraction's rows to the stored line items by line number.
 *
 * A line number can legitimately repeat (a document that bills the same code
 * twice), so the pairing is a MULTISET comparison rather than a set one:
 * within each line number, the raw rows beyond the stored count are missing
 * and the stored rows beyond the raw count are surplus. A raw row with no
 * usable line number can never have been stored under one — every writer
 * copies `lineNumber` straight across, and the reprocess script discards such
 * a row outright — so it is counted missing.
 *
 * Where several rows share a line number and only some survived, WHICH of them
 * is the missing one is not recoverable; the excess is taken in the order the
 * extraction lists them. The COUNT is exact either way, and the value is exact
 * whenever the rows sharing a line number carry the same price, which is the
 * only case this has been seen in.
 */
function custodyOf(
  json: string | null,
  stored: ReadonlyArray<{ lineNumber: number; extendedPrice: number }>,
): InvoiceCustody {
  const empty: InvoiceCustody = {
    rawRows: null,
    storedRows: stored.length,
    missing: 0,
    missingValue: 0,
    missingValueIsFloor: false,
    surplus: 0,
    surplusValue: 0,
  }

  const raw = rawExtractionRows(json)
  if (raw === null) return empty

  const NO_NUMBER = "no line number"
  const key = (n: number | null) => (n === null ? NO_NUMBER : String(n))

  const rawBy = new Map<string, RawExtractionRow[]>()
  for (const r of raw) {
    const k = key(r.lineNumber)
    const list = rawBy.get(k)
    if (list) list.push(r)
    else rawBy.set(k, [r])
  }

  const storedBy = new Map<string, number[]>()
  for (const l of stored) {
    const k = key(l.lineNumber)
    const list = storedBy.get(k)
    if (list) list.push(l.extendedPrice)
    else storedBy.set(k, [l.extendedPrice])
  }

  let missing = 0
  let missingValue = 0
  let missingValueIsFloor = false
  for (const [k, rows] of rawBy) {
    // A raw row with no line number was never storable under one, so it is
    // compared against nothing rather than against the stored rows that also
    // lack one — the writers never produce those.
    const held = k === NO_NUMBER ? 0 : (storedBy.get(k)?.length ?? 0)
    for (const row of rows.slice(held)) {
      missing += 1
      if (row.extendedPrice === null) missingValueIsFloor = true
      else missingValue += row.extendedPrice
    }
  }

  let surplus = 0
  let surplusValue = 0
  for (const [k, prices] of storedBy) {
    const read = k === NO_NUMBER ? 0 : (rawBy.get(k)?.length ?? 0)
    for (const price of prices.slice(read)) {
      surplus += 1
      surplusValue += price
    }
  }

  return {
    rawRows: raw.length,
    storedRows: stored.length,
    missing,
    missingValue,
    missingValueIsFloor,
    surplus,
    surplusValue,
  }
}

async function loadInvoice(input: InvoiceInput): Promise<Loaded | null> {
  const { invoiceId, accountId } = input

  const inv = await prisma.invoice.findFirst({
    where: { id: invoiceId, accountId },
    select: {
      id: true,
      invoiceNumber: true,
      vendorName: true,
      invoiceDate: true,
      dueDate: true,
      status: true,
      totalAmount: true,
      subtotal: true,
      taxAmount: true,
      isReturn: true,
      reviewReasons: true,
      matchConfidence: true,
      emailSubject: true,
      emailReceivedAt: true,
      attachmentName: true,
      pdfBlobPathname: true,
      pdfSize: true,
      extractionModel: true,
      rawExtractionJson: true,
      store: { select: { name: true } },
      lineItems: {
        select: {
          lineNumber: true,
          sku: true,
          productName: true,
          quantity: true,
          unit: true,
          unitPrice: true,
          extendedPrice: true,
          packSize: true,
          unitSize: true,
          unitSizeUom: true,
          matchSource: true,
          canonicalIngredient: { select: { name: true } },
        },
        orderBy: { lineNumber: "asc" },
      },
    },
  })
  if (!inv) return null

  const goods = goodsSum(inv.lineItems)
  const reference = inv.subtotal ?? inv.totalAmount
  const delta = goods - reference

  // The raw extraction is the MODEL'S OUTPUT, not the document — see `headOf`
  // for what that rules out and `custodyOf` for what it does prove.
  const custody = custodyOf(inv.rawExtractionJson, inv.lineItems)

  const reasons = Array.isArray(inv.reviewReasons) ? (inv.reviewReasons as unknown as Reason[]) : []

  return {
    id: inv.id,
    number: inv.invoiceNumber,
    vendor: normalizeVendorName(inv.vendorName),
    rawVendor: inv.vendorName,
    date: inv.invoiceDate,
    dueDate: inv.dueDate,
    status: inv.status,
    total: inv.totalAmount,
    subtotal: inv.subtotal,
    tax: inv.taxAmount,
    isReturn: inv.isReturn,
    lines: inv.lineItems.map((l) => ({
      lineNumber: l.lineNumber,
      sku: l.sku,
      productName: l.productName,
      quantity: l.quantity,
      unit: l.unit,
      unitPrice: l.unitPrice,
      extendedPrice: l.extendedPrice,
      packSize: l.packSize,
      unitSize: l.unitSize,
      unitSizeUom: l.unitSizeUom,
      matchedTo: l.canonicalIngredient?.name ?? null,
      matchSource: l.matchSource,
      isCharge: isChargeRow(l.productName),
    })),
    goods,
    gap: Math.abs(delta) > EPSILON ? delta : null,
    reasons,
    matchConfidence: inv.matchConfidence,
    storeName: inv.store?.name ?? null,
    email: {
      from: null,
      subject: inv.emailSubject,
      at: inv.emailReceivedAt,
      attachment: inv.attachmentName,
    },
    pdfPath: inv.pdfBlobPathname,
    pdfBytes: inv.pdfSize,
    model: inv.extractionModel,
    custody,
    subjectLines: subjectLineCount(inv.emailSubject),
  }
}

/**
 * The line count the VENDOR states in its own email subject.
 *
 * Individual FoodService and Vitco both send
 * `CHRIS N EDDY'S Order: G95788-00 Total: $1,543.56 Lines: 22`. **79 of this
 * account's 226 invoices carry one** — every IFS invoice and every Vitco
 * invoice; Sysco, Premier Meats, Bear State and Premier Deli send none.
 *
 * This is the count the prototype wanted and this file's first draft said did
 * not exist. It does, for a third of the account, and it is not ours — the
 * vendor is telling us how many lines it sent.
 */
function subjectLineCount(subject: string | null): number | null {
  const m = subject?.match(/\bLines:\s*(\d+)/i)
  return m ? Number(m[1]) : null
}

/* -- helpers ---------------------------------------------------------- */

const D = (d: Date | null) =>
  d === null
    ? "—"
    : d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })

const DT = (d: Date | null) =>
  d === null
    ? "—"
    : d.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "UTC",
      })

/**
 * The readable tail of an R2 object key.
 *
 * Keys are `invoices/{outlook message id}_-{uuid}.pdf`. The message id is over
 * 150 characters of base64 and identifies the MAIL, which this page already
 * names by subject and arrival time; the uuid identifies the object.
 */
function shortKey(path: string | null): string {
  if (!path) return "—"
  const tail = path.split("_-").pop()
  return tail && tail !== path ? `invoices/…_-${tail}` : path
}

const REASON_LABEL: Record<string, string> = {
  no_lines: "Nothing was extracted",
  total_reconciliation: "The lines do not sum to the subtotal",
  line_math: "A line's arithmetic does not hold",
  pack_shape: "A pack shape looks wrong",
  date_suspect: "The printed date is implausible",
  low_match_confidence: "The store match is uncertain",
  no_store_match: "No store matched the address",
  unknown: "Flagged",
}

/* -- sections --------------------------------------------------------- */

/**
 * The strip, and the comparison this page cannot make.
 *
 * `P.invoice` reads `Printed total / Extracted (18 of 19 lines) / Gap (1 line
 * not extracted) / Flagged / Posts to`, and its own note says the failure that
 * matters is "a line the table never got".
 *
 * **Nothing in this schema records how many lines the DOCUMENT had.**
 * `rawExtractionJson` is the MODEL'S OUTPUT, not a second reading of the page,
 * so "18 of 19" is a denominator nobody has and this strip does not print one.
 *
 * That output is still worth comparing against — just for a different
 * question. `custodyOf` pairs its rows to the stored line items and finds the
 * ones that were read and never persisted; it answers "did we KEEP what was
 * read", where this strip answers "does what we kept agree with what the
 * document prints". The document pane carries that half. (An earlier draft of
 * this paragraph claimed the raw count "equals the stored count on every
 * invoice checked", which `countsNote` below had already disproved on nine of
 * them — G95788-00 returned 21 rows and stored none.)
 *
 * What survives is better than a guess and is the same check the Invoices page
 * and the sync now run: **the printed subtotal is the document's own claim
 * about its goods**, so `goods − subtotal` is the only evidence a line went
 * missing. A gap of $1,474.06 on an invoice with no lines is not "one line not
 * extracted", it is "the document says $1,474.06 of goods and we hold none of
 * it". So the cells are `Printed`, `Extracted`, `Gap` — with the gap stated
 * against the subtotal rather than against an invented line count — and
 * `Flagged` counts the reasons actually stored on the row.
 */
function headOf(d: Loaded): InvoiceHead {
  const goodsLines = d.lines.filter((l) => !l.isCharge).length
  const chargeLines = d.lines.length - goodsLines

  const extractedCell: FigureProps = {
    label: "Extracted",
    value: money(d.goods, { cents: true }),
    delta:
      d.lines.length === 0
        ? "no lines at all"
        : `${count(goodsLines)} goods ${goodsLines === 1 ? "line" : "lines"}` +
          (chargeLines > 0 ? ` · ${count(chargeLines)} charge` : ""),
    deltaTone: d.lines.length === 0 ? "is-down" : "is-flat",
  }
  const gapCell: FigureProps = {
    label: "Gap",
    value: d.gap === null ? "—" : money(Math.abs(d.gap), { cents: true }),
    delta:
      d.gap === null
        ? "ties to the printed subtotal"
        : d.gap > 0
          ? "more than the document prints"
          : "less than the document prints",
    deltaTone: d.gap === null ? "is-flat" : "is-down",
  }

  return {
    title: d.number,
    // `dueDate` is stored by the sync from the extractor's own reading of the
    // document and was rendered nowhere in this product. It goes on the
    // record's own facts line, beside the date it was billed. No "overdue"
    // here: this route takes no clock (`InvoiceInput` is an id and an account,
    // because `P.invoice` is `nodate: true`), and the list — which does take
    // the reader's today — is where the date is judged against it.
    sub:
      `${d.vendor} · ${D(d.date)} · ` +
      `${d.dueDate ? `due ${D(d.dueDate)}` : "no due date printed"} · ` +
      `${count(d.lines.length)} ` +
      `${d.lines.length === 1 ? "line" : "lines"} extracted` +
      (d.storeName ? ` · ${d.storeName}` : ""),
    cells: [
      {
        label: d.subtotal === null ? "Printed total" : "Printed subtotal",
        value: money(d.subtotal ?? d.total, { cents: true }),
        delta: d.subtotal === null ? "no subtotal printed" : `${money(d.total, { cents: true })} with tax`,
        deltaTone: "is-flat",
      },
      extractedCell,
      gapCell,
      {
        label: "Flagged",
        value: count(d.reasons.length),
        delta: d.reasons.length === 0 ? "no rule flagged it" : "read, but not trusted",
        deltaTone: d.reasons.length > 0 ? "is-down" : "is-flat",
      },
      {
        label: "Status",
        value: titleCase(d.status.toLowerCase()),
        delta: d.status === "APPROVED" ? "posted to COGS" : "not posted yet",
        deltaTone: d.status === "REVIEW" ? "is-down" : "is-flat",
      },
    ],
    phoneCells: [extractedCell, gapCell],
    alert:
      d.gap === null
        ? null
        : {
            label: d.lines.length === 0 ? "Nothing was extracted" : "The lines do not add up",
            value: money(Math.abs(d.gap), { cents: true }),
            body:
              d.lines.length === 0
                ? `The document prints ${money(d.subtotal ?? d.total, { cents: true })} of goods ` +
                  `and we hold none of it. Every ingredient and price on this delivery is absent.`
                : `The ${plural(d.lines.filter((l) => !l.isCharge).length, "goods line")} ` +
                  `${pluralWord(d.lines.filter((l) => !l.isCharge).length, "comes", "come")} to ` +
                  `${money(d.goods, { cents: true })} against a printed ` +
                  `${money(d.subtotal ?? d.total, { cents: true })}.`,
          },
  }
}

/**
 * The document pane.
 *
 * The prototype renders the PDF beside the extraction and labels it "as
 * received · 2 pages". **Page count is not stored** — no column holds one and
 * nothing writes one — so the meta says what we do know: that the file is
 * held, privately, and is the only copy that proves what a line said.
 *
 * This paragraph read "Page count and file size are not stored —
 * `pdfBlobPathname` and `pdfBlobUrl` are all the row carries" and was wrong
 * about the size: `Invoice.pdfSize` and `Invoice.pdfUploadedAt` are on the row
 * too, and the sync and both PDF backfill scripts all write the size. The
 * storage panel printed "not recorded" about a column that records it. See
 * `panelsOf`.
 *
 * The pane links rather than embeds. The object is private and served through
 * `/api/invoices/{id}/pdf`, which checks the session and the account before it
 * streams a byte; an `<iframe>` of that route would work and would also mean
 * every page load fetches a PDF nobody asked to see.
 */
function documentOf(d: Loaded): InvoiceDocument {
  // NO `.kv` OF COUNTS. This section used to carry one — Attachment, Read by,
  // Lines stored, The model returned, The vendor says — and it was a landmark
  // the fixture does not draw here: `P.invoice`'s `docPane()` is the DOCUMENT,
  // and the counts are the paragraph under it. The `.kv` was removed when the
  // PDF was embedded, and the field that fed it was left behind, built on
  // every request and rendered by neither surface. The counts live in `note`,
  // and the reconciliation they describe lives in `custody`, where a caller
  // can read the figures rather than the sentence.
  return {
    href: d.pdfPath ? `/api/invoices/${d.id}/pdf` : null,
    meta: d.pdfPath ? "held, private" : "no file",
    custody: d.custody,
    note: countsNote(d),
  }
}

/**
 * Three counts of the same thing, what it means when they disagree, and what
 * the disagreement is worth.
 *
 * Ours is the `InvoiceLineItem` rows. The model's is
 * `rawExtractionJson.lineItems` — what the extractor read before anything
 * persisted it. The vendor's is the count IFS and Vitco put in their own email
 * subject, present on 79 of the account's 226 invoices.
 *
 * They agree on 217. The nine that disagree are all IFS, and the direction
 * matters: **stored one MORE than the vendor says** is this page counting the
 * fuel and pallet charge rows the vendor does not, which is arithmetic rather
 * than loss; **stored one FEWER** is a line that went missing, and on
 * H04728-00 it is corroborated by a $124.68 reconciliation gap from an
 * entirely separate check.
 *
 * G95788-00 is the case that matters. **The model returned 21 lines and zero
 * were stored.** The extraction worked; persisting it did not. That is a
 * different defect from the one the `no_lines` reason on that row describes
 * ("extraction produced no line items at all"), and a different fix: the lines
 * are still sitting in `rawExtractionJson` and can be replayed without going
 * near the PDF or the model again.
 *
 * ## The money, which the counts alone do not carry
 *
 * "One line short" is a different problem on a $40 case of lettuce than on a
 * $2,600 meat order, and the count cannot tell them apart. `custodyOf` pairs
 * the extraction's rows to the stored ones by line number, so the rows with
 * nothing behind them are identified individually and their own
 * `extendedPrice` can be summed — that sum is what this note states. It is the
 * value of what was READ AND NOT STORED, which is not the same figure as the
 * strip's Gap: the Gap is the goods lines against the printed subtotal, and it
 * is the only evidence available about a row the extractor never read in the
 * first place.
 */
function countsNote(d: Loaded): string {
  const stored = d.lines.length
  const c = d.custody
  const parts: string[] = []

  if (c.rawRows === null) {
    parts.push(
      `No raw extraction is stored for this invoice, so there is nothing to check the ` +
        `${plural(stored, "stored line")} against — whether the extractor read more rows than ` +
        `these cannot be answered from here.`,
    )
  } else {
    // The two directions are stated INDEPENDENTLY, not as a chain: an invoice
    // can drop one row and store another twice, and an `else if` would print
    // the first and silently swallow the second.
    const kept = c.rawRows - c.missing
    if (c.missing > 0) {
      // A floor of exactly zero is not a figure, it is the absence of one —
      // every row that went missing carried no extended price, so "at least
      // $0.00" would be a number standing in for "we cannot say".
      const unpriced = c.missingValueIsFloor && c.missingValue === 0
      const worth = unpriced
        ? `, worth an amount the stored extraction does not state,`
        : ` worth ${c.missingValueIsFloor ? "at least " : ""}${money(c.missingValue, { cents: true })}`
      parts.push(
        `The extraction holds ${plural(c.rawRows, "row")} and ${count(kept)} of them ` +
          `${pluralWord(kept, "is", "are")} in the table: ` +
          `${plural(c.missing, "row")}${worth} ` +
          `${pluralWord(c.missing, "was", "were")} read and never stored.` +
          (c.missingValueIsFloor && !unpriced
            ? ` "At least", because one of the rows that went missing carries no extended ` +
              `price of its own, so that figure is a floor and not the amount.`
            : ``) +
          ` The extraction worked and persisting it did not, so those rows are still in the ` +
          `stored raw output and can be replayed without reading the PDF again.`,
      )
    }
    if (c.surplus > 0) {
      parts.push(
        `${plural(c.surplus, "line")} in the table ${pluralWord(c.surplus, "is", "are")} at a ` +
          `line number the extraction's ${plural(c.rawRows, "row")} does not account for, worth ` +
          `${money(c.surplusValue, { cents: true })} — a row stored twice, or stored after the ` +
          `raw output was last written. Anything reading lines rather than the printed total ` +
          `counts it twice.`,
      )
    }
    if (c.missing === 0 && c.surplus === 0) {
      parts.push(
        c.rawRows === 1
          ? `The extraction's one row is in the table.`
          : `Every one of the extraction's ${plural(c.rawRows, "row")} is in the table, row for ` +
            `row.`,
      )
    }
  }

  if (d.subjectLines !== null && d.subjectLines !== stored) {
    const short = d.subjectLines > stored
    parts.push(
      `The vendor's own subject line says ${count(d.subjectLines)}, ` +
        (short
          ? (stored === 0
              ? `and we hold none of them. `
              : `${count(d.subjectLines - stored)} more than we hold. `) +
            `That is the only outside witness to what the document contained, and it says ` +
            `something is missing.`
          : `${count(stored - d.subjectLines)} fewer than we hold — we count the delivery ` +
            `surcharge rows as lines and the vendor does not, which is a definition rather than ` +
            `a defect.`),
    )
  } else if (d.subjectLines !== null) {
    parts.push(`The vendor's own subject line says ${count(d.subjectLines)} too.`)
  } else {
    parts.push(
      `This vendor does not state a line count, so nothing outside this system says how many ` +
        `rows the page had.`,
    )
  }

  if (!d.pdfPath) {
    return `No file is held for this invoice, so nothing here can be checked against the ` +
      `document it came from. ${parts.join(" ")}`
  }
  return (
    `${parts.join(" ")} The PDF is the only copy that proves what a line said, and it opens ` +
    `through a route that checks your session first — the object itself is private.`
  )
}

/**
 * Why this is in review — the reasons the sync actually stored.
 *
 * These are `Invoice.reviewReasons`, written by `composeReviewReasons`. 35 of
 * the account's 226 invoices carry them, and 26 of those were written by the
 * backfill earlier this session because the rules that produce them postdate
 * the sync that wrote the rows.
 *
 * An invoice with no reasons is not necessarily clean — it may simply predate
 * every rule — and the empty state says that rather than "all good".
 */
function reasonsOf(d: Loaded): InvoiceReasons {
  return {
    rows: d.reasons.map((r, i) => ({
      key: `${r.kind}:${i}`,
      kind: REASON_LABEL[r.kind] ?? titleCase(r.kind.replace(/_/g, " ")),
      message: r.message,
      lines:
        r.lineNumbers && r.lineNumbers.length > 0
          ? `line ${r.lineNumbers.join(", ")}`
          : null,
    })),
    meta:
      d.reasons.length === 0
        ? "nothing flagged"
        : `${count(d.reasons.length)} ${d.reasons.length === 1 ? "reason" : "reasons"}`,
    note:
      d.reasons.length > 0
        ? `Written when the invoice synced, or by the backfill that replayed the rules over rows ` +
          `that synced before those rules existed.`
        : d.gap !== null
          ? `No rule flagged this invoice, and its lines still do not tie to the printed ` +
            `subtotal — so it synced before the check that would have caught it and nothing has ` +
            `replayed the rules over it since.`
          : `No rule flagged this invoice. That is not the same as verified: a rule can only ` +
            `have looked at it if the rule existed when it synced.`,
  }
}

/** The extracted lines, and the arithmetic under them. */
function linesOf(d: Loaded): InvoiceLines {
  const shown = d.lines.slice(0, LINE_ROWS)
  const flagged = new Set(d.reasons.flatMap((r) => r.lineNumbers ?? []))
  const unmatched = d.lines.filter((l) => !l.isCharge && l.matchedTo === null)

  const rows: MoneyLine[] = [
    { label: "Goods extracted", value: money(d.goods, { cents: true }) },
    {
      label: d.subtotal === null ? "Printed total" : "Printed subtotal",
      value: money(d.subtotal ?? d.total, { cents: true }),
    },
    {
      label: "Gap",
      value: d.gap === null ? "none" : money(Math.abs(d.gap), { cents: true }),
      total: true,
    },
  ]

  return {
    rows: shown.map((l) => ({
      key: `${l.lineNumber}`,
      cells: {
        n: count(l.lineNumber),
        product: flagged.has(l.lineNumber)
          ? { v: l.productName, cls: "hot" }
          : l.isCharge
            ? { v: l.productName, cls: "" }
            : l.productName,
        qty: `${l.quantity} ${(l.unit ?? "").toLowerCase()}`.trim(),
        price: unitCost(l.unitPrice),
        ext: money(l.extendedPrice, { cents: true }),
        matched: l.isCharge
          ? "not goods"
          : l.matchedTo === null
            ? { v: "unmatched", cls: "hot" }
            : titleCase(l.matchedTo),
      },
    })),
    phoneRows: d.lines
      .filter((l) => flagged.has(l.lineNumber) || (!l.isCharge && l.matchedTo === null))
      .slice(0, PHONE_ROWS)
      .map((l) => ({
        key: `${l.lineNumber}`,
        title: l.productName,
        detail: flagged.has(l.lineNumber) ? "flagged by a rule" : "matches nothing in the catalogue",
        value: money(l.extendedPrice, { cents: true }),
        note: flagged.has(l.lineNumber) ? "check" : "unmatched",
        noteTone: "down" as const,
      })),
    money: rows,
    // "No rule flagged a line" is not "nothing is wrong", and under a red
    // banner it reads as a contradiction. An invoice can be flagged for
    // something the whole document does — its lines not summing to the printed
    // subtotal — which points at no line in particular.
    phoneEmpty:
      d.reasons.length > 0
        ? `No single line is flagged. What is flagged is the document: ` +
          `${d.reasons[0].kind === "no_lines" ? "nothing was extracted from it" : "its lines do not sum to what it prints"}.`
        : `Every line matched and no rule flagged one.`,
    meta: `${count(d.lines.length)} · ${count(shown.length)} shown`,
    phoneMeta: `${count(d.lines.length)} extracted`,
    reconciles: d.gap === null,
    invoiceId: d.id,
    status: d.status,
    isReturn: d.isReturn,
    note:
      (d.gap === null
        ? `The goods lines tie to the printed subtotal, so nothing on this document is missing ` +
          `from the table. `
        : `The goods lines do not tie to the printed subtotal. The subtotal is the document's ` +
          `own claim about its goods, and it is the ONLY evidence a line went missing — nothing ` +
          `records how many lines the page had, so "N of M extracted" is a fraction nobody can ` +
          `compute. `) +
      (unmatched.length > 0
        ? `${count(unmatched.length)} ${unmatched.length === 1 ? "line matches" : "lines match"} ` +
          `nothing in the ingredient catalogue, so ${unmatched.length === 1 ? "it costs" : "they cost"} ` +
          `nothing until matched.`
        : `Every goods line is matched to an ingredient.`),
  }
}

/** The three provenance panels. Everything here is stored; nothing is derived. */
function panelsOf(d: Loaded): InvoicePanels {
  const goodsLines = d.lines.filter((l) => !l.isCharge)
  const matched = goodsLines.filter((l) => l.matchedTo !== null)
  const bySource = new Map<string, number>()
  for (const l of matched) bySource.set(l.matchSource ?? "unknown", (bySource.get(l.matchSource ?? "unknown") ?? 0) + 1)

  return {
    arrival: {
      meta: "nobody uploaded it",
      rows: [
        { label: "Subject", value: d.email.subject ?? "—" },
        { label: "Received", value: DT(d.email.at) },
        { label: "Attachment", value: d.email.attachment ?? "—" },
        { label: "Read by", value: d.model ?? "—" },
        // The name on the document, kept beside the name we file it under —
        // this vendor has ten spellings across six suppliers and the fold is
        // invisible unless the raw string is shown somewhere.
        { label: "Billed as", value: d.rawVendor },
      ],
    },
    storage: {
      meta: d.pdfPath ? "private object, signed on request" : "nothing stored",
      rows: [
        // The stored key is `invoices/{outlook message id}_-{uuid}.pdf` and the
        // message id runs past 150 characters, which stretches this panel wider
        // than its column and pushes every value beside it off the page. The
        // message id is provenance already shown as Subject and Received, so
        // the row prints the part that identifies the OBJECT.
        { label: "Object", value: shortKey(d.pdfPath) },
        { label: "Served by", value: d.pdfPath ? `/api/invoices/${d.id}/pdf` : "—" },
        // SIZE IS STORED, and this row said "not recorded" about it.
        // `Invoice.pdfSize` is written by the sync
        // (`src/app/api/invoices/sync/route.ts`) and by both PDF backfill
        // scripts; the loader simply never selected the column. Where it is
        // null — nothing uploaded, or a row written before the column carried
        // anything — `bytes()` returns the em-dash, which is the system's own
        // "no value" and not a claim that nothing is recorded.
        //
        // PAGE COUNT genuinely is not stored — no column holds one and nothing
        // writes one — and a blank there would read as "we have not looked"
        // rather than "we never kept it", so that row keeps its words.
        { label: "Size", value: bytes(d.pdfBytes) },
        { label: "Pages", value: "not recorded" },
      ],
    },
    matching: {
      meta: "to the catalogue",
      rows: [
        {
          label: "Lines matched",
          value: `${count(matched.length)} of ${count(goodsLines.length)}`,
        },
        ...[...bySource.entries()].map(([source, n]) => ({
          label: source === "sku" ? "By vendor part number" : `By ${source}`,
          value: count(n),
        })),
        {
          label: "Store match",
          value:
            d.matchConfidence === null
              ? "not scored"
              : pct(d.matchConfidence * 100, { scaled: true }),
        },
        { label: "Store", value: d.storeName ?? "none assigned" },
      ],
      note:
        matched.length === goodsLines.length
          ? `Every goods line reached the catalogue.`
          : `${count(goodsLines.length - matched.length)} ${goodsLines.length - matched.length === 1 ? "line" : "lines"} ` +
            `reached no ingredient, so ${goodsLines.length - matched.length === 1 ? "its" : "their"} ` +
            `spend sits in the invoice total and in no plate cost.`,
    },
  }
}

/**
 * The invoice's number and vendor, for the masthead and the breadcrumb.
 *
 * Same reason as `getRecipeName` and `getIngredientName`: a detail route needs
 * its record's name before the sections resolve, and awaiting the loader would
 * need the `no-awaited-loader` exemption that names only the two order routes.
 */
export async function getInvoiceName(
  invoiceId: string,
  accountId: string,
): Promise<{ name: string; vendor: string } | null> {
  const row = await prisma.invoice.findFirst({
    where: { id: invoiceId, accountId },
    select: { invoiceNumber: true, vendorName: true },
  })
  return row
    ? { name: row.invoiceNumber, vendor: normalizeVendorName(row.vendorName) }
    : null
}

/* -- assembly --------------------------------------------------------- */

export function getInvoiceSectionPromises(
  input: InvoiceInput,
): StreamedSections<InvoiceSections> {
  const dataP = classify(() => loadInvoice(input), {
    retryAction: "retryInvoice",
    isEmpty: (d) => d === null,
    emptyReason: "no_match",
  })

  const s = <T,>(f: (d: Loaded) => T) =>
    guardSection(
      dataP.then((sd) => mapReady(sd, (d) => f(d as Loaded))),
      "retryInvoice",
    )

  return {
    head: s(headOf),
    document: s(documentOf),
    reasons: s(reasonsOf),
    lines: s(linesOf),
    panels: s(panelsOf),
  }
}

export async function getInvoiceSections(input: InvoiceInput): Promise<InvoiceSections> {
  return awaitSections(getInvoiceSectionPromises(input))
}
