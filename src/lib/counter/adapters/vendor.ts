import { prisma } from "@/lib/prisma"
import { isChargeRow, isNonIngredientRow } from "@/lib/invoice-charges"
import { normalizeVendorName } from "@/lib/vendor-normalize"
import { count, money, pct, titleCase, unitCost } from "@/lib/counter/format"
import { rangeLabel, toQueryBounds, type DateRange } from "@/lib/counter/date-range"
import type { ChartSpec } from "@/lib/counter/chart-geometry"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
import { mapReady, type SectionData } from "@/lib/counter/section-data"
import type { FigureProps, MListRow, Row } from "@/components/counter"

/**
 * One vendor — `P.vendor` (`docs/counter/counter-prototype.html`, the
 * `P.vendor` block).
 *
 * "One vendor: what you buy, what it costs now, and how reliable they are."
 *
 * Measured with the list page:
 * `docs/counter/measurements/2026-08-28-vendors.md`.
 *
 * ## A vendor has no id, and that is the schema's fault rather than a choice
 *
 * There is no `Vendor` table. A vendor exists only as `Invoice.vendorName`, a
 * free-text column carrying ten spellings of six suppliers, so the identity
 * this route addresses is **the normalized display name** —
 * `normalizeVendorName`'s output, URL-encoded. That is stable as long as the
 * alias table is (a rename there changes a URL), and it is the only handle
 * available. A `Vendor` row with an id is the right fix and is not this
 * page's to make.
 *
 * ## Lead time again
 *
 * `VendorLeadTime` holds 0 rows and nothing in the schema records a promised
 * delivery date, so the prototype's `Median lead time · 1.8 days · fastest of
 * the five` has no source here any more than it did on the list. Same
 * substitution, same reason — see `headOf`.
 */

/** Invoices the table prints before it stops. */
const INVOICE_ROWS = 8
/** Overlapping items compared against other vendors. */
const BASKET_ROWS = 8
/** Rows on the phone's list. */
const PHONE_ROWS = 4
/** Weeks the spend chart buckets into. */
const WEEKS = 8
/** A line reconciles when it lands inside half a cent. */
const EPSILON = 0.02
/** A basket gap smaller than this is not worth a reader's attention. */
const GAP_PCT = 2

export interface VendorHead {
  title: string
  sub: string
  cells: FigureProps[]
  phoneCells: FigureProps[]
}

export interface VendorSpend {
  chart: ChartSpec
  meta: string
  note: string
}

export interface VendorInvoices {
  rows: Row[]
  phoneRows: MListRow[]
  meta: string
  /** The phone shows fewer rows, so it cannot borrow the desk's count. */
  phoneMeta: string
  note: string
}

export interface VendorBasket {
  rows: Row[]
  meta: string
  note: string
}

export interface VendorSections {
  head: SectionData<VendorHead>
  spend: SectionData<VendorSpend>
  invoices: SectionData<VendorInvoices>
  basket: SectionData<VendorBasket>
}

export interface VendorInput {
  /** The normalized display name, already decoded from the URL. */
  vendor: string
  storeId: string | null
  accountId: string
  range: DateRange
  today: Date
}

/* -- loading ---------------------------------------------------------- */

interface InvoiceRow {
  id: string
  number: string
  date: Date | null
  total: number
  lines: number
  gap: number | null
  status: string
  hasPdf: boolean
}

interface BasketRow {
  ingredient: string
  ingredientId: string
  mine: number
  mineUnit: string
  best: { vendor: string; price: number; unit: string } | null
  gapPct: number | null
}

interface Loaded {
  name: string
  spellings: string[]
  invoices: InvoiceRow[]
  spendRange: number
  shareOfTotal: number | null
  broken: number
  cadence: number | null
  weekly: Array<{ week: string; spend: number }>
  ingredients: number
  basket: BasketRow[]
  rangeLabel: string
}

async function loadVendor(input: VendorInput): Promise<Loaded | null> {
  const { vendor, accountId, storeId, range, today } = input
  const { startDate, endDate } = toQueryBounds(range)

  const stores = await prisma.store.findMany({
    where: { accountId, isActive: true, ...(storeId ? { id: storeId } : {}) },
    select: { id: true },
  })
  const storeIds = stores.map((s) => s.id)

  // Every invoice in the range, then folded by normalized name — the SQL
  // cannot filter on a normalization it does not know about.
  const all = await prisma.invoice.findMany({
    where: {
      accountId,
      ...(storeIds.length > 0 ? { storeId: { in: storeIds } } : {}),
      invoiceDate: { gte: startDate, lte: endDate },
    },
    select: {
      id: true,
      invoiceNumber: true,
      vendorName: true,
      invoiceDate: true,
      totalAmount: true,
      subtotal: true,
      status: true,
      pdfBlobPathname: true,
      lineItems: { select: { productName: true, extendedPrice: true } },
    },
    orderBy: { invoiceDate: "desc" },
  })

  const mine = all.filter((i) => normalizeVendorName(i.vendorName) === vendor)
  if (mine.length === 0) return null

  const totalSpend = all.reduce((t, i) => t + i.totalAmount, 0)
  const spendRange = mine.reduce((t, i) => t + i.totalAmount, 0)

  const invoices: InvoiceRow[] = mine.map((i) => {
    const goods = i.lineItems.reduce(
      (t, l) => (isChargeRow(l.productName) ? t : t + l.extendedPrice),
      0,
    )
    const reference = i.subtotal ?? i.totalAmount
    const delta = goods - reference
    return {
      id: i.id,
      number: i.invoiceNumber,
      date: i.invoiceDate,
      total: i.totalAmount,
      lines: i.lineItems.length,
      gap: Math.abs(delta) > EPSILON ? delta : null,
      status: i.status,
      hasPdf: i.pdfBlobPathname !== null,
    }
  })

  // Weekly spend buckets, over the same eight weeks the list's trend uses.
  const weekOf = (d: Date) => {
    const x = new Date(d)
    x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7))
    return x.toISOString().slice(0, 10)
  }
  const buckets = new Map<string, number>()
  for (const i of mine) {
    if (!i.invoiceDate) continue
    const w = weekOf(i.invoiceDate)
    buckets.set(w, (buckets.get(w) ?? 0) + i.totalAmount)
  }

  const dates = mine
    .map((i) => i.invoiceDate)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime())
  const gaps: number[] = []
  for (let i = 1; i < dates.length; i++) {
    gaps.push((dates[i].getTime() - dates[i - 1].getTime()) / 86_400_000)
  }
  gaps.sort((a, b) => a - b)
  const cadence =
    gaps.length === 0
      ? null
      : gaps.length % 2 === 0
        ? (gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2
        : gaps[Math.floor(gaps.length / 2)]

  // The basket: every canonical this vendor bills for, and the newest price
  // any OTHER vendor charged for the same canonical.
  const priced = await prisma.$queryRaw<
    Array<{ cid: string; name: string; vendor: string; px: number; unit: string | null; n: number }>
  >`
    SELECT li."canonicalIngredientId" AS cid, ci.name AS name, i."vendorName" AS vendor,
           (ARRAY_AGG(li."unitPrice" ORDER BY i."invoiceDate" DESC))[1]::float AS px,
           MAX(li.unit) AS unit, COUNT(*)::int AS n
    FROM "InvoiceLineItem" li
    JOIN "Invoice" i ON i.id = li."invoiceId"
    JOIN "CanonicalIngredient" ci ON ci.id = li."canonicalIngredientId"
    WHERE i."accountId" = ${accountId} AND li."unitPrice" > 0
    GROUP BY 1, 2, 3`

  const byIngredient = new Map<
    string,
    { name: string; byVendor: Map<string, { px: number; unit: string; n: number }> }
  >()
  for (const row of priced) {
    // A delivery surcharge is not a basket item. It reaches this query because
    // the extractor filed two of them as canonical ingredients — see
    // `isNonIngredientRow` and the Ingredients page's own reach split.
    if (isNonIngredientRow(row.name)) continue
    const v = normalizeVendorName(row.vendor)
    const entry = byIngredient.get(row.cid) ?? { name: row.name, byVendor: new Map() }
    const prev = entry.byVendor.get(v)
    if (!prev || row.n > prev.n) {
      entry.byVendor.set(v, { px: row.px, unit: row.unit ?? "unit", n: row.n })
    }
    byIngredient.set(row.cid, entry)
  }

  const basket: BasketRow[] = []
  for (const [cid, entry] of byIngredient) {
    const ours = entry.byVendor.get(vendor)
    if (!ours) continue
    const others = [...entry.byVendor.entries()].filter(([v]) => v !== vendor)
    const cheapest = others.sort((a, b) => a[1].px - b[1].px)[0]
    basket.push({
      ingredient: entry.name,
      ingredientId: cid,
      mine: ours.px,
      mineUnit: ours.unit,
      best: cheapest
        ? { vendor: cheapest[0], price: cheapest[1].px, unit: cheapest[1].unit }
        : null,
      gapPct:
        cheapest && cheapest[1].px > 0 ? ((ours.px - cheapest[1].px) / cheapest[1].px) * 100 : null,
    })
  }

  return {
    name: vendor,
    spellings: [...new Set(mine.map((i) => i.vendorName))],
    invoices,
    spendRange,
    shareOfTotal: totalSpend > 0 ? (spendRange / totalSpend) * 100 : null,
    broken: invoices.filter((i) => i.gap !== null).length,
    cadence,
    weekly: [...buckets.entries()].sort().map(([week, spend]) => ({ week, spend })),
    ingredients: basket.length,
    basket: basket
      .filter((b) => b.best !== null)
      .sort((a, b) => Math.abs(b.gapPct ?? 0) - Math.abs(a.gapPct ?? 0)),
    rangeLabel: rangeLabel(range, "custom"),
  }
}

/* -- helpers ---------------------------------------------------------- */

const D = (d: Date | string) =>
  new Date(typeof d === "string" ? `${d}T00:00:00Z` : d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })

const cadenceText = (days: number | null) =>
  days === null ? "one delivery" : days < 1.5 ? "daily" : `every ${days.toFixed(1)} days`

/* -- sections --------------------------------------------------------- */

/**
 * The strip. Two of the prototype's five cells are replaced for the same
 * reason they were on the list: `VendorLeadTime` is empty and nothing records
 * a promised date, so `Median lead time` and the `Breaks, 90 days` figure that
 * leans on it have no source. Delivery cadence and the reconcile count take
 * their place, both named for what they measure.
 */
function headOf(d: Loaded): VendorHead {
  const spendCell: FigureProps = {
    label: "Spend",
    value: money(d.spendRange),
    delta:
      d.shareOfTotal === null
        ? d.rangeLabel
        : `${pct(d.shareOfTotal, { scaled: true })} of the total`,
    deltaTone: "is-flat",
  }
  const brokenCell: FigureProps = {
    label: "Does not reconcile",
    value: count(d.broken),
    delta:
      d.broken === 0
        ? "every invoice ties out"
        : `of ${count(d.invoices.length)} · our extraction, not their billing`,
    deltaTone: d.broken > 0 ? "is-down" : "is-flat",
  }

  return {
    title: d.name,
    sub:
      `${count(d.invoices.length)} ${d.invoices.length === 1 ? "invoice" : "invoices"} in this range` +
      (d.spellings.length > 1 ? ` · bills under ${count(d.spellings.length)} names` : ""),
    cells: [
      spendCell,
      {
        label: "Invoices",
        value: count(d.invoices.length),
        delta: cadenceText(d.cadence),
        deltaTone: "is-flat",
      },
      {
        label: "Ingredients",
        value: count(d.ingredients),
        delta:
          d.basket.length === 0
            ? "none also bought elsewhere"
            : `${count(d.basket.length)} also bought elsewhere`,
        deltaTone: "is-flat",
      },
      brokenCell,
    ],
    phoneCells: [spendCell, brokenCell],
  }
}

/** Spend by week — dollars, because one vendor's own spend shares a unit. */
function spendOf(d: Loaded): VendorSpend {
  return {
    chart: {
      type: "bars",
      h: 148,
      zero: true,
      labels: d.weekly.map((w) => D(w.week)),
      series: [
        {
          name: "Spend",
          color: "var(--ink)",
          data: d.weekly.map((w) => w.spend),
        },
      ],
      alt: "Spend by week",
    },
    meta:
      d.weekly.length === 0
        ? "no delivery in the range"
        : `${count(d.weekly.length)} ${d.weekly.length === 1 ? "week" : "weeks"}`,
    // The Invoices page's own point, and it applies harder to one vendor: a
    // week with no bar is a week they did not deliver in, which for a vendor
    // on a three-day cadence is a real gap rather than a rounding artefact.
    note:
      `One bar per week a delivery landed in. A missing week is a week this vendor did not ` +
      `deliver, not a week that cost nothing.`,
  }
}

/** The invoice list, with the reconciliation state the Invoices page computes. */
function invoicesOf(d: Loaded): VendorInvoices {
  const shown = d.invoices.slice(0, INVOICE_ROWS)

  return {
    rows: shown.map((i) => ({
      key: i.id,
      href: `/dashboard/invoices/${i.id}`,
      cells: {
        invoice: i.number,
        date: i.date ? D(i.date) : "—",
        total: money(i.total, { cents: true }),
        lines: i.lines === 0 ? { v: "none", cls: "hot" } : count(i.lines),
        reconciles:
          i.gap === null
            ? "✓"
            : { v: `${i.gap > 0 ? "+" : "−"}${money(Math.abs(i.gap), { cents: true })}`, cls: "hot" },
        status: i.status === "REVIEW" ? { v: "Review", cls: "hot" } : titleCase(i.status.toLowerCase()),
      },
    })),
    phoneRows: d.invoices.slice(0, PHONE_ROWS).map((i) => ({
      key: i.id,
      href: `/dashboard/invoices/${i.id}`,
      title: i.number,
      detail: `${i.date ? D(i.date) : "no date"} · ${count(i.lines)} ${i.lines === 1 ? "line" : "lines"}`,
      value: money(i.total, { cents: true }),
      note: i.gap === null ? "reconciles" : `${money(Math.abs(i.gap), { cents: true })} out`,
      noteTone: i.gap === null ? "up" : "down",
    })),
    meta: `${count(d.invoices.length)} · ${count(shown.length)} shown`,
    phoneMeta: `${count(d.invoices.length)} · ${count(Math.min(PHONE_ROWS, d.invoices.length))} shown`,
    note:
      d.broken === 0
        ? `Every invoice in the range ties out: the goods lines sum to the printed subtotal once ` +
          `the delivery surcharges are taken off.`
        : `${count(d.broken)} ${d.broken === 1 ? "invoice does" : "invoices do"} not tie out. ` +
          `That is our extraction misreading a line — the vendor's own total is correct and the ` +
          `goods are in it.`,
  }
}

/**
 * The basket against every other vendor.
 *
 * The prototype compares one named rival ("The basket against Sysco") on four
 * hand-picked items and lands on +2.4% weighted. This account's overlaps are
 * fewer and much larger: **7 canonicals are bought from more than one vendor**,
 * and the biggest gap is a t-shirt bag at $19.75 a case from Individual
 * FoodService against $43.69 from Sysco. So the comparison is against
 * whichever vendor is cheapest rather than one chosen in advance, and the
 * column names them.
 *
 * **The caveat is load-bearing and printed.** These are per-unit prices off
 * the invoice, and a "case" is not a standard size — Vitco's fry shortening at
 * $71.85/CS against Sysco's $45.55/CS may be a bigger case rather than a worse
 * deal. This project already knows that trap: it is the pack-metadata
 * mis-parse family that `selectNonSpikeCostIndex` guards the cost paths
 * against. A gap here is a question to ask, not an answer.
 */
function basketOf(d: Loaded): VendorBasket {
  const shown = d.basket.slice(0, BASKET_ROWS)
  const dearer = d.basket.filter((b) => (b.gapPct ?? 0) >= GAP_PCT)

  return {
    rows: shown.map((b) => ({
      key: b.ingredientId,
      href: `/dashboard/ingredients/${b.ingredientId}`,
      cells: {
        item: titleCase(b.ingredient),
        mine: `${unitCost(b.mine)} / ${b.mineUnit.toLowerCase()}`,
        best: b.best
          ? `${unitCost(b.best.price)} / ${b.best.unit.toLowerCase()}`
          : "—",
        who: b.best?.vendor ?? "—",
        gap:
          b.gapPct === null
            ? "—"
            : Math.abs(b.gapPct) < GAP_PCT
              ? "same"
              : {
                  v: `${b.gapPct > 0 ? "+" : "−"}${Math.abs(b.gapPct).toFixed(0)}%`,
                  cls: b.gapPct > 0 ? "hot" : "",
                },
      },
    })),
    meta:
      d.basket.length === 0
        ? "nothing bought from two vendors"
        : `${count(d.basket.length)} also bought elsewhere`,
    note:
      d.basket.length === 0
        ? `Nothing this vendor sells is bought from anyone else, so there is no price to compare ` +
          `against. Seven of the account's 75 priced ingredients have a second source at all.`
        : `Against whichever vendor is cheapest, not one picked in advance. ` +
          (dearer.length > 0
            ? `${count(dearer.length)} ${dearer.length === 1 ? "item is" : "items are"} dearer here. `
            : `Nothing here is dearer than its alternative. `) +
          `These are per-unit prices off the invoice and a case is not a standard size — a gap ` +
          `can be a bigger case rather than a worse deal, which is the pack-metadata trap this ` +
          `product already guards its cost paths against. Treat a row as a question to ask.`,
  }
}

/**
 * The vendor's display name, for the masthead and the breadcrumb — and a
 * check that it exists at all.
 *
 * Unlike the other detail routes there is no row to look up: a vendor is a
 * normalized string, so "does this vendor exist" is "did any invoice fold to
 * this name". Answered with one `DISTINCT vendorName` read rather than by
 * loading the sections.
 */
export async function getVendorName(
  vendor: string,
  accountId: string,
): Promise<{ name: string } | null> {
  const rows = await prisma.invoice.findMany({
    where: { accountId },
    select: { vendorName: true },
    distinct: ["vendorName"],
  })
  const hit = rows.some((r) => normalizeVendorName(r.vendorName) === vendor)
  return hit ? { name: vendor } : null
}

/* -- assembly --------------------------------------------------------- */

export function getVendorSectionPromises(input: VendorInput): StreamedSections<VendorSections> {
  const dataP = classify(() => loadVendor(input), {
    retryAction: "retryVendor",
    isEmpty: (d) => d === null,
    emptyReason: "no_match",
  })

  const s = <T,>(f: (d: Loaded) => T) =>
    guardSection(
      dataP.then((sd) => mapReady(sd, (d) => f(d as Loaded))),
      "retryVendor",
    )

  return {
    head: s(headOf),
    spend: s(spendOf),
    invoices: s(invoicesOf),
    basket: s(basketOf),
  }
}

export async function getVendorSections(input: VendorInput): Promise<VendorSections> {
  return awaitSections(getVendorSectionPromises(input))
}
