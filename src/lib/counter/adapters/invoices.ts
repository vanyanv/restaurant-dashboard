import { prisma } from "@/lib/prisma"
import { count, money, pct, titleCase, unitCost } from "@/lib/counter/format"
import { comparisonRange, rangeLabel, toQueryBounds, type DateRange } from "@/lib/counter/date-range"
import type { ChartSpec } from "@/lib/counter/chart-geometry"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
import { mapReady, type SectionData } from "@/lib/counter/section-data"
import type { FigureProps, MListRow, MoneyLine, QueueItem, Row } from "@/components/counter"

/**
 * Invoices — `P.invoices` (`docs/counter/counter-prototype.html:5621`).
 *
 * "A list that ends in a decision, and a review that will not let you approve
 * a gap."
 *
 * Everything below was measured before it was written; the numbers, the
 * queries and the reasoning are in
 * `docs/counter/measurements/2026-08-28-invoices.md`. Four of that document's
 * findings changed what this file computes, and each is restated at the
 * function it changed.
 *
 * ## The two windows, which is the prototype's own division
 *
 * `P.invoices` labels its strip **"Received, 30d"** and its chart
 * `CD.rangeLabel()`. That is not an inconsistency — a received-and-outstanding
 * board is a trailing worklist, and only the SPEND question belongs to the
 * date control. So:
 *
 *   - strip and list  → a fixed trailing 30 days
 *   - spend and products → the reader's range
 *   - documents and the review queue → the whole account
 *
 * It also keeps the page from being blank at its own default. The default
 * preset is `yesterday`; deliveries land on 14 days in 31, so a wholly
 * range-bound invoice page would open empty most mornings.
 */

/** The trailing window the strip and the list are drawn from. */
const RECEIVED_DAYS = 30
/** Rows in the spend-by-product table, and on the phone's list. */
const PRODUCT_ROWS = 8
const PHONE_ROWS = 4
/**
 * How many open items the review queue prints before it stops — the
 * prototype's own three, which is what its landmark sequence is counted on.
 * The meta says "3 of 19", so the queue is a lead rather than the list.
 */
const QUEUE_ITEMS = 3
/** A line reconciles when it lands inside half a cent. */
const EPSILON = 0.02

/**
 * Line rows that are NOT goods.
 *
 * Individual FoodService prints its delivery surcharges below the subtotal
 * rule and the extractor reads them as products, so 47 of this account's
 * invoices failed a naive `SUM(extendedPrice) = subtotal` check for a reason
 * that is not an extraction defect. Excluding exactly these four names takes
 * the account from 173 of 226 reconciling to 219 of 226 — and the seven that
 * remain are all genuinely wrong (measurement §1, §2).
 *
 * Matched on the exact name on purpose. A regex on `fuel|pallet|delivery`
 * catches product names that contain those words and silently un-reconciles
 * invoices that were fine — it did, on 90 Sysco rows, the first time.
 */
const CHARGE_ROWS = new Set([
  "Fuel Charge",
  "Pallet Charge",
  "Miscellaneous Charge",
  "Total SALES TAX",
])

export type InvoiceStatusId = "REVIEW" | "APPROVED" | "MATCHED"

export interface InvoiceListRow {
  id: string
  number: string
  vendor: string
  /** Already formatted — "Aug 20". */
  date: string
  /** For sorting and for the search index; not printed. */
  sortKey: string
  total: string
  status: InvoiceStatusId
  /** How many pages of PDF we hold. 0 = no file. */
  hasPdf: boolean
  /** "19 lines", "1 line", "no lines" — already written. */
  lineLabel: string
  /** Null when it reconciles; the signed shortfall when it does not. */
  gap: string | null
  /** Lower-cased haystack the client's search box matches against. */
  search: string
}

export interface InvoiceHeadline {
  cells: FigureProps[]
  phoneCells: FigureProps[]
}

export interface InvoiceList {
  rows: InvoiceListRow[]
  /** Toggle counts, in the order the filters draw them. */
  statuses: Array<{ id: InvoiceStatusId; label: string; count: number }>
  windowLabel: string
}

export interface InvoiceSpend {
  chart: ChartSpec
  meta: string
  note: string
}

export interface InvoiceDocuments {
  rows: Row[]
  meta: string
  lead: string
  actions: Array<{ label: string; href: string; primary?: boolean }>
}

export interface InvoiceReview {
  items: QueueItem[]
  money: MoneyLine[]
  meta: string
  note: string
}

export interface ProductRow {
  key: string
  name: string
  vendor: string
  qty: string
  spend: string
  price: string
  /** "▲ 18%", "flat", "no prior" — already written. */
  moved: string
  /**
   * How the move reads. The prototype's own two marks: a rise is `warn`, a
   * fall is `good` — because this is what an ingredient COST did, and a cost
   * that fell is good news. Null draws the toneless grey tag.
   */
  movedTone: "warn" | "good" | null
}

export interface InvoiceProducts {
  rows: ProductRow[]
  phoneRows: MListRow[]
  meta: string
  note: string
}

export interface InvoicePhoneQueues {
  /** The same worklist the desk's queue draws, worst first. */
  needsLook: MListRow[]
  settled: MListRow[]
  needsMeta: string
  settledMeta: string
  /** "12 in review · 7 do not reconcile" — the phone's own subtitle. */
  sub: string
  /** Where the button goes: the worst open item, or the list itself. */
  firstHref: string
}

export interface InvoicesSections {
  headline: SectionData<InvoiceHeadline>
  list: SectionData<InvoiceList>
  spend: SectionData<InvoiceSpend>
  documents: SectionData<InvoiceDocuments>
  review: SectionData<InvoiceReview>
  products: SectionData<InvoiceProducts>
  phoneQueues: SectionData<InvoicePhoneQueues>
}

export interface InvoicesInput {
  range: DateRange
  presetId: string
  storeId: string | null
  accountId: string
  /** The reader's today, so the trailing 30 days is theirs and not the server's. */
  today: Date
}

/* -- loading ---------------------------------------------------------- */

interface LoadedLine {
  productName: string
  canonicalId: string | null
  canonicalName: string | null
  quantity: number
  unit: string | null
  unitPrice: number
  extendedPrice: number
}

interface LoadedInvoice {
  id: string
  number: string
  vendor: string
  invoiceDate: Date | null
  totalAmount: number
  subtotal: number | null
  status: InvoiceStatusId
  hasPdf: boolean
  reviewReasons: ReviewReason[]
  lines: LoadedLine[]
}

interface ReviewReason {
  kind: string
  message: string
  /** Which extracted lines tripped the rule. Empty when the rule names none. */
  lines: number[]
}

interface InvoiceData {
  /** The whole account, so the queue and the document panel can be worklists. */
  all: LoadedInvoice[]
  /** The trailing `RECEIVED_DAYS`. */
  received: LoadedInvoice[]
  /** The reader's range. */
  inRange: LoadedInvoice[]
  /** The window before the reader's, same length. Null when there is none. */
  prior: LoadedInvoice[] | null
  rangeLabelText: string
}

function isStatus(v: string): v is InvoiceStatusId {
  return v === "REVIEW" || v === "APPROVED" || v === "MATCHED"
}

/**
 * `reviewReasons` is `Json?`. Six of this account's twelve REVIEW rows predate
 * the column and hold `null`; the page says so rather than inventing a reason
 * (measurement §7).
 */
function reasonsOf(raw: unknown): ReviewReason[] {
  if (!Array.isArray(raw)) return []
  const out: ReviewReason[] = []
  for (const r of raw) {
    if (r && typeof r === "object" && "message" in r && typeof r.message === "string") {
      const raw = "lineNumbers" in r ? r.lineNumbers : null
      out.push({
        kind: "kind" in r && typeof r.kind === "string" ? r.kind : "review",
        message: r.message,
        lines: Array.isArray(raw) ? raw.filter((n): n is number => typeof n === "number") : [],
      })
    }
  }
  return out
}

async function loadInvoices(input: InvoicesInput): Promise<InvoiceData> {
  const { accountId, storeId, range, today } = input

  const stores = await prisma.store.findMany({
    where: { accountId, isActive: true, ...(storeId ? { id: storeId } : {}) },
    select: { id: true },
  })
  const storeIds = stores.map((s) => s.id)

  const rows = storeIds.length === 0
    ? []
    : await prisma.invoice.findMany({
        where: { accountId, storeId: { in: storeIds } },
        select: {
          id: true,
          invoiceNumber: true,
          vendorName: true,
          invoiceDate: true,
          totalAmount: true,
          subtotal: true,
          status: true,
          pdfBlobPathname: true,
          reviewReasons: true,
          lineItems: {
            select: {
              productName: true,
              canonicalIngredientId: true,
              canonicalIngredient: { select: { name: true } },
              quantity: true,
              unit: true,
              unitPrice: true,
              extendedPrice: true,
            },
          },
        },
        orderBy: { invoiceDate: "desc" },
      })

  const all: LoadedInvoice[] = rows.map((r) => ({
    id: r.id,
    number: r.invoiceNumber,
    vendor: r.vendorName,
    invoiceDate: r.invoiceDate,
    totalAmount: r.totalAmount,
    subtotal: r.subtotal,
    status: isStatus(r.status) ? r.status : "MATCHED",
    hasPdf: r.pdfBlobPathname !== null,
    reviewReasons: reasonsOf(r.reviewReasons),
    lines: r.lineItems.map((l) => ({
      productName: l.productName,
      canonicalId: l.canonicalIngredientId,
      canonicalName: l.canonicalIngredient?.name ?? null,
      quantity: l.quantity,
      unit: l.unit,
      unitPrice: l.unitPrice,
      extendedPrice: l.extendedPrice,
    })),
  }))

  const receivedFrom = new Date(today)
  receivedFrom.setDate(receivedFrom.getDate() - RECEIVED_DAYS)

  const within = (list: LoadedInvoice[], r: DateRange) => {
    const { startDate, endDate } = toQueryBounds(r)
    return list.filter(
      (i) => i.invoiceDate !== null && i.invoiceDate >= startDate && i.invoiceDate <= endDate,
    )
  }

  const priorRange = comparisonRange(range, "prev")

  return {
    all,
    received: all.filter((i) => i.invoiceDate !== null && i.invoiceDate >= receivedFrom),
    inRange: within(all, range),
    prior: priorRange ? within(all, priorRange) : null,
    rangeLabelText: rangeLabel(range, "custom"),
  }
}

/* -- reconciliation --------------------------------------------------- */

/** What the invoice PRINTS as the goods total: its subtotal, or its total when it has none. */
const printedOf = (i: LoadedInvoice) => i.subtotal ?? i.totalAmount

/** What the extracted lines say the goods came to, with the four charge rows removed. */
function goodsOf(i: LoadedInvoice): number {
  let sum = 0
  for (const l of i.lines) if (!CHARGE_ROWS.has(l.productName)) sum += l.extendedPrice
  return sum
}

const gapOf = (i: LoadedInvoice) => goodsOf(i) - printedOf(i)
const reconciles = (i: LoadedInvoice) => Math.abs(gapOf(i)) < EPSILON

const sum = (list: LoadedInvoice[]) => list.reduce((t, i) => t + i.totalAmount, 0)

/* -- vendors ---------------------------------------------------------- */

/**
 * Ten vendor names, six vendors (measurement §3). `Vitco Foodservice` and
 * `VITCO FOODSERVICE` are one supplier; so are `Sysco` and
 * `Sysco Los Angeles, Inc.` — except that the second pair does NOT merge under
 * this key, and that is deliberate. Upper-casing and dropping punctuation is a
 * heuristic that can only ever fix a spelling, never a different name, and a
 * key aggressive enough to merge "Sysco Los Angeles, Inc." into "Sysco" would
 * also merge two genuinely different companies that share a first word.
 *
 * So the page merges what a spelling explains and PRINTS the variants it
 * merged. The rest is a vendor table's job, which is the Vendors page.
 */
const vendorKey = (name: string) => name.toUpperCase().replace(/[^A-Z]/g, "")

/* -- sections --------------------------------------------------------- */

const D = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })

function headlineOf(d: InvoiceData): InvoiceHeadline {
  const received = d.received
  const inReview = d.all.filter((i) => i.status === "REVIEW")
  const costed = received.filter((i) => i.status === "MATCHED")
  const broken = d.all.filter((i) => !reconciles(i))
  // The SIGNED net, not the sum of magnitudes. Five invoices are short and two
  // are over; summing the absolutes gives $4,390 while the section's own
  // statement below totals $3,974, and one page must not print two figures for
  // one thing. The statement's is the one that reconciles, so this reads it.
  const net = broken.reduce((t, i) => t + gapOf(i), 0)
  const withPdf = d.all.filter((i) => i.hasPdf).length

  // Every other cell in this strip is the trailing 30 days. This one is the
  // whole account on purpose — an open worklist that expired with the window
  // would tell an owner the six invoices older than a month had been dealt
  // with. Two windows in one strip is exactly the defect this rebuild keeps
  // finding, so the cell says which one it is rather than leaving it to be
  // inferred from the cell beside it.
  const reviewCell: FigureProps = {
    label: "In review",
    value: money(sum(inReview)),
    delta: `${count(inReview.length)} open, all time`,
    deltaTone: inReview.length > 0 ? "is-down" : "is-flat",
  }
  const receivedCell: FigureProps = {
    label: `Received, ${RECEIVED_DAYS}d`,
    value: money(sum(received)),
    delta: `${count(received.length)} invoices`,
    deltaTone: "is-flat",
  }

  return {
    cells: [
      receivedCell,
      {
        // NOT "Posted to COGS". Nothing in this schema records an accounting
        // post; MATCHED is what the sync writes when no sanity rule tripped,
        // and it is the terminal state rather than a step before APPROVED
        // (measurement §7).
        label: "Matched and costed",
        value: money(sum(costed)),
        delta: `${count(costed.length)} of ${count(received.length)}`,
        deltaTone: "is-flat",
      },
      reviewCell,
      {
        label: "Does not reconcile",
        value: count(broken.length),
        delta:
          broken.length === 0
            ? "every invoice ties out"
            : broken.length === 1
              ? broken[0].number
              : `${money(Math.abs(net))} ${net < 0 ? "short" : "over"} in all`,
        deltaTone: broken.length > 0 ? "is-down" : "is-flat",
      },
      {
        label: "PDF on file",
        value: `${count(withPdf)} of ${count(d.all.length)}`,
        delta:
          withPdf === d.all.length
            ? "every one is checkable"
            : `${count(d.all.length - withPdf)} cannot be verified`,
        deltaTone: withPdf === d.all.length ? "is-flat" : "is-down",
      },
    ],
    phoneCells: [reviewCell, receivedCell],
  }
}

const STATUS_LABEL: Record<InvoiceStatusId, string> = {
  REVIEW: "In review",
  APPROVED: "Approved",
  MATCHED: "Matched",
}

function listOf(d: InvoiceData): InvoiceList {
  const rows: InvoiceListRow[] = d.received.map((i) => {
    const gap = reconciles(i) ? null : gapOf(i)
    return {
      id: i.id,
      number: i.number,
      vendor: i.vendor,
      date: i.invoiceDate ? D(i.invoiceDate) : "no date",
      sortKey: i.invoiceDate ? i.invoiceDate.toISOString() : "",
      total: money(i.totalAmount, { cents: true }),
      status: i.status,
      hasPdf: i.hasPdf,
      lineLabel:
        i.lines.length === 0
          ? "no lines"
          : `${i.lines.length} line${i.lines.length === 1 ? "" : "s"}`,
      gap:
        gap === null
          ? null
          : `${money(Math.abs(gap), { cents: true })} ${gap < 0 ? "short" : "over"}`,
      search: `${i.number} ${i.vendor} ${i.lines.map((l) => l.productName).join(" ")}`.toLowerCase(),
    }
  })

  const statuses = (["REVIEW", "APPROVED", "MATCHED"] as const).map((id) => ({
    id,
    label: STATUS_LABEL[id],
    count: rows.filter((r) => r.status === id).length,
  }))

  return { rows, statuses, windowLabel: `last ${RECEIVED_DAYS} days` }
}

function spendOf(d: InvoiceData): InvoiceSpend {
  const byDay = new Map<string, number>()
  for (const i of d.inRange) {
    if (!i.invoiceDate) continue
    const k = i.invoiceDate.toISOString().slice(0, 10)
    byDay.set(k, (byDay.get(k) ?? 0) + i.totalAmount)
  }

  const days = [...byDay.keys()].sort()
  const delivered = days.length

  return {
    chart: {
      type: "bars",
      h: 140,
      zero: true,
      labels: days.map((k) => D(new Date(`${k}T00:00:00Z`))),
      series: [{ name: "Invoiced", color: "var(--ink)", data: days.map((k) => byDay.get(k) ?? 0) }],
      alt: "Invoiced spend by delivery day",
    },
    meta: `${d.rangeLabelText} · hover for the day`,
    // Deliveries land on 14 days in 31 (measurement §7). A bar per CALENDAR
    // day would draw seventeen empty columns and read as seventeen days with
    // no spend; a bar per DELIVERY day is what actually happened.
    note:
      `One bar per delivery day — ${count(delivered)} in this range, not one per calendar day. ` +
      `Invoices arrive with the truck, and the days between them are not days that cost nothing.`,
  }
}

function documentsOf(d: InvoiceData): InvoiceDocuments {
  const held = d.all.filter((i) => i.hasPdf)
  const noFile = d.all.length - held.length
  const unread = d.all.filter((i) => i.hasPdf && i.lines.length === 0)

  return {
    rows: [
      {
        key: "read",
        cells: {
          held: { v: "Read into lines", cls: "held" },
          n: count(held.length - unread.length),
          do: "Open it beside the lines and check",
        },
      },
      {
        key: "unread",
        cells: {
          held: { v: "Stored, not read", cls: "held is-none" },
          n: count(unread.length),
          do:
            unread.length === 0
              ? "Nothing to re-read"
              : `Re-extract ${unread.map((i) => i.number).join(", ")}`,
        },
      },
      {
        key: "none",
        cells: {
          held: { v: "No file", cls: "held is-none" },
          n: count(noFile),
          do: noFile === 0 ? "Nothing to refetch" : "Refetch from the original email",
        },
      },
    ],
    meta: `${count(held.length)} of ${count(d.all.length)} have the file`,
    // The prototype's argument, kept; its subject, replaced. It was written
    // for an account where 3 of 34 predated object storage. Here the file is
    // held for every one of them, and the custody gap that IS real is the
    // invoice we hold and never read (measurement §6).
    lead:
      `Invoices arrive as email attachments and the PDF goes straight into private object ` +
      `storage — it is the only copy that proves what a line said, so every figure downstream ` +
      `is checkable against it. ` +
      (noFile === 0
        ? `Every one of these ${count(d.all.length)} has its file. The gap is one layer in: ` +
          `${count(unread.length)} of them ` +
          (unread.length === 1 ? "was" : "were") +
          ` stored and never read into lines, so ` +
          (unread.length === 1 ? "its" : "their") +
          ` goods are in the total and in nothing else.`
        : `${count(noFile)} of these ${count(d.all.length)} have no file: they were synced before ` +
          `storage was switched on, and their extractions cannot be verified against anything.`),
    // ONE button, as the prototype draws it. It goes to the document that was
    // never read when there is one, because that is the only thing on this
    // panel a reader can act on; with nothing to re-read it goes to where the
    // goods landed instead.
    actions: [
      unread.length > 0
        ? { label: `Open ${unread[0].number}`, href: `/dashboard/invoices/${unread[0].id}` }
        : { label: "Where the goods landed", href: "/dashboard/cogs" },
    ],
  }
}

/**
 * The worklist, and it is not the same list as `status = REVIEW`.
 *
 * Two invoices that no rule ever flagged are the two largest errors in the
 * account — a credit memo whose single return was extracted twice
 * (−$2,691.45 counted as −$5,382.90) and a $1,474.06 invoice with a header and
 * zero lines. Both are `MATCHED`. The queue is ordered by what the mistake is
 * WORTH, so those two lead it and the pack-shape warnings follow
 * (measurement §2, §8).
 */
function reviewOf(d: InvoiceData): InvoiceReview {
  interface Candidate {
    key: string
    weight: number
    item: QueueItem
  }
  const candidates: Candidate[] = []

  for (const i of d.all.filter((x) => !reconciles(x))) {
    const gap = gapOf(i)
    const doubled =
      i.lines.length === 2 &&
      Math.abs(gap - printedOf(i)) < EPSILON &&
      i.lines[0].productName.startsWith(i.lines[1].productName.slice(0, 20))
    candidates.push({
      key: i.id,
      weight: Math.abs(gap),
      item: {
        key: i.id,
        tone: "bad",
        lead: money(Math.abs(gap)),
        unit: gap < 0 ? "short" : "over",
        title: `${i.number} · ${i.vendor}`,
        body:
          i.lines.length === 0
            ? `The document is on file and no lines were read from it. ${money(printedOf(i), { cents: true })} of goods ` +
              `is in the invoice total and in nothing that costs a plate.`
            : doubled
              ? `The two lines read ${money(i.lines[0].extendedPrice, { cents: true })} each — ` +
                `${money(goodsOf(i), { cents: true })} together — against a printed ` +
                `${money(printedOf(i), { cents: true })}. One return, extracted twice: anything reading lines ` +
                `rather than the total sees double the credit.`
              : `${count(i.lines.length)} lines come to ${money(goodsOf(i), { cents: true })} against a printed ` +
                `${money(printedOf(i), { cents: true })}. Delivery charges are already excluded.`,
        act: "Open the document",
        href: `/dashboard/invoices/${i.id}`,
      },
    })
  }

  for (const i of d.all.filter((x) => x.status === "REVIEW")) {
    const reason = i.reviewReasons[0]
    // The lead figure says WHERE, not how much, and that is the prototype's
    // own choice (`lead: 'L' + l[0]`). A pack shape read wrong does not move
    // the invoice total by a cent, so leading with $2,646 would put the
    // invoice's whole value behind a red flag that is not about its value.
    // It is weighed for ORDER by the invoice's size, because a mis-priced
    // line on a big invoice distorts more.
    const at = reason?.lines[0]
    candidates.push({
      key: `r-${i.id}`,
      weight: Math.abs(i.totalAmount) / 100,
      item: {
        key: `r-${i.id}`,
        tone: "warn",
        lead: at === undefined ? String(i.lines.length) : `L${at}`,
        unit: at === undefined ? "lines" : reason!.kind.replace(/_/g, " "),
        title: `${i.number} · ${i.vendor}`,
        body:
          reason?.message ??
          `Held for review before the sync recorded why. It reconciles and it has its file; ` +
            `what it needs is a reader, not a fix.`,
        act: "Check against the page",
        href: `/dashboard/invoices/${i.id}`,
      },
    })
  }

  candidates.sort((a, b) => b.weight - a.weight)
  const shown = candidates.slice(0, QUEUE_ITEMS)

  const goods = d.all.reduce((t, i) => t + goodsOf(i), 0)
  const charges = d.all.reduce(
    (t, i) => t + i.lines.filter((l) => CHARGE_ROWS.has(l.productName)).reduce((s, l) => s + l.extendedPrice, 0),
    0,
  )
  const printed = d.all.reduce((t, i) => t + printedOf(i), 0)
  const ok = d.all.filter(reconciles).length

  return {
    items: shown.map((c) => c.item),
    // THREE lines with the third the total, which is what `money()` draws here
    // (`counter-prototype.html:5674`) and what the landmark sequence counts.
    // The charge rows are named in the first label and quantified in the note
    // rather than given a line of their own.
    money: [
      { label: "Goods, as extracted", value: money(goods, { cents: true }) },
      { label: "Printed on the invoices", value: money(printed, { cents: true }) },
      {
        label: "Left unexplained",
        value: money(goods - printed, { cents: true }),
        tone: Math.abs(goods - printed) < 1 ? "good" : "bad",
        total: true,
      },
    ],
    meta:
      candidates.length > QUEUE_ITEMS
        ? `${count(shown.length)} of ${count(candidates.length)} · worst first`
        : `${count(candidates.length)} open`,
    note:
      `${count(ok)} of ${count(d.all.length)} invoices tie out to the cent once the four ` +
      `delivery and tax rows are taken off the goods side. Checked without that rule the count ` +
      `is ${count(d.all.filter((i) => Math.abs(i.lines.reduce((t, l) => t + l.extendedPrice, 0) - printedOf(i)) < EPSILON).length)}, ` +
      `and the difference is invoices that were never wrong. ` +
      `Of the ${count(d.all.length - ok)} that remain, ` +
      `${count(d.all.filter((i) => !reconciles(i) && gapOf(i) < 0).length)} read short and ` +
      `${count(d.all.filter((i) => !reconciles(i) && gapOf(i) > 0).length)} read over, so they partly ` +
      `cancel — the total above is the net, and there is more error than that in the file. ` +
      `${money(charges, { cents: true })} of delivery and tax rows is off the goods side before ` +
      `any of this is counted.`,
  }
}

/**
 * What the spend was on — grouped on the CANONICAL ingredient.
 *
 * 481 distinct product names cover the same goods four spellings deep; ground
 * beef alone is four rows and $56k spread across them. 98.6% of lines carry a
 * `canonicalIngredientId`, and that column already unifies them, so a table
 * keyed on `productName` would rank a $45k ingredient below a $12k one
 * (measurement §4). Lines with no canonical match — six spellings of a can
 * liner, gloves, a mis-read tax row, $846 in all — are grouped under their own
 * name and counted in the note (§5).
 */
function productsOf(d: InvoiceData): InvoiceProducts {
  interface Agg {
    name: string
    vendors: Set<string>
    qty: number
    unit: string | null
    spend: number
    canonical: boolean
  }

  const build = (list: LoadedInvoice[]) => {
    const by = new Map<string, Agg>()
    for (const i of list) {
      for (const l of i.lines) {
        if (CHARGE_ROWS.has(l.productName)) continue
        const key = l.canonicalId ?? `raw:${l.productName}`
        const a = by.get(key) ?? {
          name: l.canonicalName ?? l.productName,
          vendors: new Set<string>(),
          qty: 0,
          unit: l.unit,
          spend: 0,
          canonical: l.canonicalId !== null,
        }
        a.vendors.add(i.vendor)
        a.qty += l.quantity
        a.spend += l.extendedPrice
        if (a.unit === null) a.unit = l.unit
        by.set(key, a)
      }
    }
    return by
  }

  const now = build(d.inRange)
  const before = d.prior ? build(d.prior) : null

  const ranked = [...now.entries()].sort((a, b) => b[1].spend - a[1].spend)
  const shown = ranked.slice(0, PRODUCT_ROWS)

  const unitPrice = (a: Agg) => (a.qty > 0 ? a.spend / a.qty : null)

  const built = shown.map(([key, a]) => {
    const up = unitPrice(a)
    const was = before ? before.get(key) : undefined
    const wasUp = was ? unitPrice(was) : null
    const move = up !== null && wasUp !== null && wasUp !== 0 ? ((up - wasUp) / wasUp) * 100 : null
    return { key, a, up, move }
  })

  const uncosted = [...now.values()].filter((a) => !a.canonical)
  const uncostedSpend = uncosted.reduce((t, a) => t + a.spend, 0)

  return {
    rows: built.map((r) => ({
      key: r.key,
      name: titleCase(r.a.name),
      vendor:
        r.a.vendors.size === 1
          ? [...r.a.vendors][0]
          : `${count(r.a.vendors.size)} vendors`,
      qty: `${count(Math.round(r.a.qty))}${r.a.unit ? ` ${r.a.unit.toLowerCase()}` : ""}`,
      spend: money(r.a.spend),
      price: r.up === null ? "—" : `${unitCost(r.up)}${r.a.unit ? ` / ${r.a.unit.toLowerCase()}` : ""}`,
      moved:
        r.move === null
          ? "no prior"
          : Math.abs(r.move) < 2
            ? "flat"
            : `${r.move > 0 ? "▲" : "▼"} ${Math.abs(r.move).toFixed(0)}%`,
      movedTone:
        r.move === null || Math.abs(r.move) < 2 ? null : r.move > 0 ? "warn" : "good",
    })),
    phoneRows: built.slice(0, PHONE_ROWS).map((r) => ({
      key: r.key,
      title: titleCase(r.a.name),
      detail:
        r.up === null
          ? [...r.a.vendors][0]
          : `${unitCost(r.up)}${r.a.unit ? ` / ${r.a.unit.toLowerCase()}` : ""}`,
      value: money(r.a.spend),
      note: r.move === null ? undefined : `${r.move > 0 ? "▲" : "▼"} ${Math.abs(r.move).toFixed(0)}%`,
      noteTone: r.move !== null && r.move > 0 ? "down" : "up",
    })),
    meta: `top products · ${d.rangeLabelText}`,
    note:
      `Grouped on the costed ingredient, not on the name the supplier printed — ground beef ` +
      `alone arrives under four spellings. ` +
      (uncosted.length === 0
        ? `Every line in this range is costed.`
        : `${count(uncosted.length)} rows worth ${money(uncostedSpend)} carry no costed ingredient ` +
          `and are listed under the supplier's own name: can liners, gloves and paper, which are ` +
          `real spend and not food cost.`),
  }
}

/**
 * The phone's two lists.
 *
 * The first is NOT `status = REVIEW`. Five of the seven invoices whose figures
 * are actually wrong are `MATCHED` — including the $2,691 double-counted
 * return — so a phone that split on status would file the two largest errors
 * in the account under "Settled" and show a reader twelve pack-shape warnings
 * instead. It is ordered the same way the desk's queue is: by what the mistake
 * is worth, then by the invoice's size.
 */
function phoneQueuesOf(d: InvoiceData): InvoicePhoneQueues {
  const broken = d.all.filter((i) => !reconciles(i))
  const flagged = d.all.filter((i) => i.status === "REVIEW" && reconciles(i))

  const row = (i: LoadedInvoice, note: string, tone: "up" | "down"): MListRow => ({
    key: i.id,
    href: `/dashboard/invoices/${i.id}`,
    title: i.number,
    detail: `${i.vendor}${i.invoiceDate ? ` · ${D(i.invoiceDate)}` : ""}`,
    value: money(i.totalAmount, { cents: true }),
    note,
    noteTone: tone,
  })

  const needs = [
    ...broken
      .slice()
      .sort((a, b) => Math.abs(gapOf(b)) - Math.abs(gapOf(a)))
      .map((i) => {
        const g = gapOf(i)
        return row(i, `${money(Math.abs(g), { cents: true })} ${g < 0 ? "short" : "over"}`, "down")
      }),
    ...flagged
      .slice()
      .sort((a, b) => Math.abs(b.totalAmount) - Math.abs(a.totalAmount))
      .map((i) =>
        row(i, i.reviewReasons[0]?.kind.replace(/_/g, " ") ?? "held, no reason", "down"),
      ),
  ]

  const settled = d.received
    .filter((i) => reconciles(i) && i.status !== "REVIEW")
    .slice(0, 5)
    .map((i) => row(i, "reconciles", "up"))

  return {
    needsLook: needs.slice(0, 5),
    settled,
    needsMeta: count(needs.length),
    settledMeta: `last ${RECEIVED_DAYS} days`,
    sub:
      `${count(flagged.length)} in review · ` +
      `${count(broken.length)} ${broken.length === 1 ? "does" : "do"} not reconcile`,
    firstHref: needs.length > 0 ? `/dashboard/invoices/${needs[0].key}` : "/dashboard/invoices",
  }
}

/* -- assembly --------------------------------------------------------- */

export function getInvoicesSectionPromises(
  input: InvoicesInput,
): StreamedSections<InvoicesSections> {
  const dataP = classify(() => loadInvoices(input), {
    retryAction: "retryInvoices",
    isEmpty: (d) => d.all.length === 0,
    emptyReason: "no_match",
  })

  const s = <T,>(f: (d: InvoiceData) => T) =>
    guardSection(dataP.then((sd) => mapReady(sd, f)), "retryInvoices")

  return {
    headline: s(headlineOf),
    list: s(listOf),
    spend: s(spendOf),
    documents: s(documentsOf),
    review: s(reviewOf),
    products: s(productsOf),
    phoneQueues: s(phoneQueuesOf),
  }
}

export async function getInvoicesSections(input: InvoicesInput): Promise<InvoicesSections> {
  return awaitSections(getInvoicesSectionPromises(input))
}
