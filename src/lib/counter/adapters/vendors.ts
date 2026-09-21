import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import {
  BASKET_FLAT_PCT,
  BASKET_WEEKS,
  foldBasketTrends,
  loadVendorBasketWeeks,
} from "@/lib/counter/vendor-basket"
import { isChargeRow } from "@/lib/invoice-charges"
import { normalizeVendorName, vendorMatchKey } from "@/lib/vendor-normalize"
import { count, money, pct, plural } from "@/lib/counter/format"
import { rangeLabel, toQueryBounds, type DateRange } from "@/lib/counter/date-range"
import type { ChartSpec } from "@/lib/counter/chart-geometry"
import { shortLabels } from "@/lib/counter/short-labels"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
import { empty, mapReady, mapReadyTo, ready, type SectionData } from "@/lib/counter/section-data"
import type { FigureProps, MListRow, QueueItem, Row } from "@/components/counter"

/**
 * Vendors — `P.vendors` (`docs/counter/counter-prototype.html`, the
 * `P.vendors` block).
 *
 * "Who you buy from, what they cost, and how long they take."
 *
 * Measured before it was written:
 * `docs/counter/measurements/2026-08-28-vendors.md`. **Half the prototype's
 * strip is about time this account does not record**, and the page's central
 * fact — how many vendors there are — is wrong by four unless the names are
 * merged first. Each is argued at the function it changed.
 */

/** Rows the table prints before it stops. */
const TABLE_ROWS = 8
/** Series on the trend chart — the biggest by spend. */
const SERIES = 4
/** Rows on the phone's list. */
const PHONE_ROWS = 5
/** A trend smaller than this reads "flat". */
const FLAT_PCT = BASKET_FLAT_PCT
/** A line reconciles when it lands inside half a cent — the Invoices page's own. */
const EPSILON = 0.02
/** Characters a legend name is cut to. */
const LEGEND_CHARS = 20

export interface VendorHeadline {
  cells: FigureProps[]
  phoneCells: FigureProps[]
}

export interface VendorTable {
  rows: Row[]
  meta: string
  note: string
}

export interface VendorTrend {
  chart: ChartSpec
  phoneChart: ChartSpec
  meta: string
  note: string
}

export interface VendorWork {
  items: QueueItem[]
  meta: string
}

export interface VendorList {
  rows: MListRow[]
  meta: string
}

export interface VendorsSections {
  headline: SectionData<VendorHeadline>
  table: SectionData<VendorTable>
  trend: SectionData<VendorTrend>
  work: SectionData<VendorWork>
  list: SectionData<VendorList>
}

export interface VendorsInput {
  storeId: string | null
  accountId: string
  range: DateRange
  today: Date
}

/* -- loading ---------------------------------------------------------- */

interface VendorRow {
  /** The normalized display name, which is also the row's identity. */
  name: string
  /** Every raw `vendorName` that folded into it. */
  spellings: string[]
  invoices: number
  spend: number
  /** Invoices in the range whose goods do not tie to the printed subtotal. */
  broken: number
  inReview: number
  /** Median days between consecutive deliveries. Null under two deliveries. */
  cadence: number | null
  /** Percent change in this vendor's own basket median, first week to last. */
  trend: number | null
  firstSeen: Date | null
  lastSeen: Date | null
}

interface VendorData {
  vendors: VendorRow[]
  /** Weekly basket medians, indexed per vendor — the chart's own series. */
  weekly: Array<{ week: string; vendor: string; index: number }>
  totalSpend: number
  activeInRange: number
  rangeLabel: string
}

async function loadVendors(input: VendorsInput): Promise<VendorData> {
  const { accountId, storeId, range, today } = input
  const { startDate, endDate } = toQueryBounds(range)

  const stores = await getScopedStores(accountId, storeId ?? null)
  const storeIds = stores.map((s) => s.id)

  const [invoices, weekly] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        accountId,
        ...(storeIds.length > 0 ? { storeId: { in: storeIds } } : {}),
        invoiceDate: { gte: startDate, lte: endDate },
      },
      select: {
        id: true,
        vendorName: true,
        invoiceDate: true,
        totalAmount: true,
        subtotal: true,
        status: true,
        lineItems: { select: { productName: true, extendedPrice: true } },
      },
      orderBy: { invoiceDate: "asc" },
    }),
    loadVendorBasketWeeks({ accountId, today }),
  ])

  // Fold on the vendor's IDENTITY key FIRST. Every figure below — the count,
  // the spend, the cadence, the reconcile tally — is wrong by four rows
  // otherwise on this account's ten invoice spellings.
  //
  // The key is `vendorMatchKey`, not `normalizeVendorName`. That module calls
  // the second one a DISPLAY normalizer and says why it is unsafe as an
  // identity: a supplier the alias table has never seen falls through with its
  // raw casing intact, so "BEAR STATE KITCHEN" and "Bear State Kitchen" are
  // two identities and split one supplier's spend across two rows. Case,
  // punctuation and spacing are noise in a vendor name; the alias table
  // carries the rest. `displayName` picks what the folded row is called.
  const folded = new Map<
    string,
    {
      /** Every raw `vendorName` that folded in, and how many invoices wore it. */
      spellings: Map<string, number>
      dates: Date[]
      spend: number
      invoices: number
      broken: number
      inReview: number
    }
  >()

  for (const inv of invoices) {
    const key = vendorMatchKey(inv.vendorName)
    const acc =
      folded.get(key) ??
      { spellings: new Map<string, number>(), dates: [], spend: 0, invoices: 0, broken: 0, inReview: 0 }
    acc.spellings.set(inv.vendorName, (acc.spellings.get(inv.vendorName) ?? 0) + 1)
    acc.invoices += 1
    acc.spend += inv.totalAmount
    if (inv.invoiceDate) acc.dates.push(inv.invoiceDate)
    if (inv.status === "REVIEW") acc.inReview += 1

    // The Invoices page's own check, and the same `isChargeRow` set: goods
    // against the printed subtotal, delivery surcharges taken off the goods
    // side. One definition, three pages.
    const goods = inv.lineItems.reduce(
      (t, l) => (isChargeRow(l.productName) ? t : t + l.extendedPrice),
      0,
    )
    const reference = inv.subtotal ?? inv.totalAmount
    if (Math.abs(goods - reference) > EPSILON) acc.broken += 1

    folded.set(key, acc)
  }

  // Weekly basket medians, indexed to each vendor's own first week — see
  // `trendOf` for why an absolute axis cannot work here, and
  // `@/lib/counter/vendor-basket` for the arithmetic, which the vendor DETAIL
  // page reads too. One figure, one function (CLAUDE.md's shared-figure rule).
  const { weekly: indexed, trend: trendOfVendor } = foldBasketTrends(weekly)

  const medianGap = (dates: Date[]): number | null => {
    if (dates.length < 2) return null
    const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime())
    const gaps: number[] = []
    for (let i = 1; i < sorted.length; i++) {
      gaps.push((sorted[i].getTime() - sorted[i - 1].getTime()) / 86_400_000)
    }
    gaps.sort((a, b) => a - b)
    const mid = Math.floor(gaps.length / 2)
    return gaps.length % 2 === 0 ? (gaps[mid - 1] + gaps[mid]) / 2 : gaps[mid]
  }

  const vendors: VendorRow[] = [...folded.values()]
    .map((a) => {
      const name = displayName(a.spellings)
      return {
        name,
        spellings: [...a.spellings.keys()],
        invoices: a.invoices,
        spend: a.spend,
        broken: a.broken,
        inReview: a.inReview,
        cadence: medianGap(a.dates),
        // `vendor-basket.ts` folds its weeks on the DISPLAY normalizer, so
        // this reads by display name. A vendor merged here only by casing can
        // therefore carry its basket weeks under its other casing and read as
        // "no prior" — the spend, cadence and reconcile columns are merged
        // either way, and this one is the honest "we do not know".
        trend: trendOfVendor.get(name) ?? null,
        firstSeen: a.dates.length > 0 ? a.dates[0] : null,
        lastSeen: a.dates.length > 0 ? a.dates[a.dates.length - 1] : null,
      }
    })
    .sort((a, b) => b.spend - a.spend)

  return {
    vendors,
    weekly: indexed,
    totalSpend: vendors.reduce((t, v) => t + v.spend, 0),
    activeInRange: vendors.filter((v) => v.invoices > 0).length,
    rangeLabel: rangeLabel(range, "custom"),
  }
}

/* -- helpers ---------------------------------------------------------- */

/**
 * The name a folded row wears: the normalized form of whichever raw spelling
 * appears on the most invoices, ties going to the one seen first.
 *
 * Every spelling the alias table knows normalizes to the same canonical, so on
 * this account's ten strings this decides nothing — "Sysco" and "Sysco Los
 * Angeles, Inc." both come back "Sysco" whichever wins. It decides the name
 * only for a supplier the alias table has never seen and whose invoices carry
 * more than one casing, where the majority casing is the closest thing to a
 * house style the documents offer.
 */
/**
 * The spelling a folded vendor is CALLED: whichever raw `vendorName` appears
 * on the most invoices, ties to whichever this account saw first. Exported so
 * `getVendorName` in `@/lib/counter/adapters/vendor` picks the SAME name for
 * the detail page's title and breadcrumb — sharing the function rather than
 * reimplementing the rule is what keeps the two pages agreeing on what a
 * multi-spelling vendor is called (CLAUDE.md's one-function-per-figure rule
 * applies to a name here as much as to a number).
 */
export function displayName(spellings: Map<string, number>): string {
  let best = ""
  let bestCount = -1
  for (const [raw, n] of spellings) {
    if (n > bestCount) {
      best = raw
      bestCount = n
    }
  }
  return normalizeVendorName(best)
}

/**
 * The vendors the price trend can actually draw: on this page's range AND in
 * the basket window, biggest by spend first.
 *
 * The two sets are not the same. `d.vendors` comes from the reader's range;
 * `d.weekly` comes from `vendor-basket.ts`'s own trailing `BASKET_WEEKS`,
 * which no control on this page moves. A range of last January against a
 * window ending today can overlap in nothing at all — which is a section with
 * no data, not a chart with no lines.
 */
function trendVendors(d: VendorData): VendorRow[] {
  return d.vendors.filter((v) => d.weekly.some((p) => p.vendor === v.name)).slice(0, SERIES)
}

const D = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })

const trendText = (t: number | null) =>
  t === null
    ? "no prior"
    : Math.abs(t) < FLAT_PCT
      ? "flat"
      : `${t > 0 ? "▲" : "▼"} ${Math.abs(t).toFixed(0)}%`

const cadenceText = (days: number | null) =>
  days === null ? "one delivery" : days < 1.5 ? "daily" : `every ${days.toFixed(1)} days`

/* -- sections --------------------------------------------------------- */

/**
 * The strip, and the two cells about time.
 *
 * `P.vendors` reads `Vendors / Spend / Median lead time / On time`. The last
 * two have no source on this account and one of them cannot have one:
 *
 *   - **`VendorLeadTime` holds 0 rows.** The table exists, the cron that fills
 *     it exists, and it is empty. There is no lead time for any vendor.
 *   - **"On time" needs a promised date, and no table in this schema carries
 *     one.** `Invoice` has `invoiceDate`, `dueDate` and `emailReceivedAt` —
 *     billed, owed, arrived. None of them is a promise.
 *
 * What IS computable is the median gap between consecutive deliveries, which
 * is CADENCE and not lead time: order-to-delivery against
 * delivery-to-delivery. Printing it under the prototype's label would be a
 * different number wearing the right word, so the cell is named for what it
 * measures. The fourth cell goes to reconciliation, which this account has an
 * answer for and which is the only vendor column on the page with teeth.
 */
function headlineOf(d: VendorData): VendorHeadline {
  const spellings = d.vendors.reduce((t, v) => t + v.spellings.length, 0)
  const broken = d.vendors.reduce((t, v) => t + v.broken, 0)
  const busiest = [...d.vendors]
    .filter((v) => v.cadence !== null)
    .sort((a, b) => (a.cadence ?? 0) - (b.cadence ?? 0))[0]

  const spendCell: FigureProps = {
    label: "Spend",
    value: money(d.totalSpend),
    delta: d.rangeLabel,
    deltaTone: "is-flat",
  }
  const brokenCell: FigureProps = {
    label: "Does not reconcile",
    value: count(broken),
    delta: (() => {
      if (broken === 0) return "every invoice ties out"
      const n = d.vendors.filter((v) => v.broken > 0).length
      return `across ${count(n)} ${n === 1 ? "vendor" : "vendors"}`
    })(),
    deltaTone: broken > 0 ? "is-down" : "is-flat",
  }

  return {
    cells: [
      {
        label: "Vendors",
        value: count(d.vendors.length),
        // The merge, stated. Ten strings and six vendors is the page's own
        // first fact, and a reader who does not know it will not trust the
        // spend column when it disagrees with a spreadsheet.
        delta:
          spellings > d.vendors.length
            ? `${count(spellings)} names on the invoices`
            : "one name each",
        deltaTone: "is-flat",
      },
      spendCell,
      {
        label: "Delivers every",
        value: busiest?.cadence === null || busiest === undefined
          ? "—"
          : `${busiest.cadence.toFixed(1)}d`,
        delta: busiest ? `${busiest.name} is the most frequent` : "no repeat deliveries",
        deltaTone: "is-flat",
      },
      brokenCell,
    ],
    phoneCells: [spendCell, brokenCell],
  }
}

/**
 * The table, one row per VENDOR rather than per spelling.
 *
 * `Sysco Los Angeles, Inc.` stops on 30 April and `Sysco` runs through August:
 * one supplier whose invoice template changed. Merged, Sysco is **$155,430**,
 * not the $104,038 a `GROUP BY vendorName` reports — the same figure the
 * Invoices page prints, here as a row.
 *
 * `Reconciles` is the prototype's own last column and the only one here with
 * teeth. It reports what OUR records do: every one of the seven that fail is
 * an extraction defect on our side, not a billing error on theirs, and the
 * note says so. A vendor page that let a reader read it as a supplier-quality
 * score would be accusing four suppliers of something they did not do.
 */
function tableOf(d: VendorData): VendorTable {
  const shown = d.vendors.slice(0, TABLE_ROWS)
  const merged = d.vendors.filter((v) => v.spellings.length > 1)
  const broken = d.vendors.reduce((t, v) => t + v.broken, 0)

  return {
    rows: shown.map((v) => ({
      key: v.name,
      href: `/dashboard/operations/vendors/${encodeURIComponent(v.name)}`,
      cells: {
        vendor: v.name,
        invoices: count(v.invoices),
        spend: money(v.spend),
        share: d.totalSpend > 0 ? pct((v.spend / d.totalSpend) * 100, { scaled: true }) : "—",
        cadence: cadenceText(v.cadence),
        trend:
          v.trend !== null && Math.abs(v.trend) >= FLAT_PCT
            ? { v: trendText(v.trend), cls: v.trend > 0 ? "hot" : "" }
            : trendText(v.trend),
        reconciles:
          v.broken === 0
            ? "Clean"
            : { v: `${count(v.broken)} short`, cls: "hot" },
      },
    })),
    meta: `${count(d.vendors.length)} · ${d.rangeLabel}`,
    note:
      (merged.length > 0
        ? `${merged.map((v) => `${v.name} bills under ${count(v.spellings.length)} names`).join("; ")} — ` +
          `folded onto one row each, so the spend column is the supplier's and not the ` +
          `spelling's. Casing, punctuation and spacing never separate two suppliers; beyond ` +
          `those, the fold follows a hand-kept list of the spellings this account's invoice ` +
          `templates use, which is a judgement and not a registry lookup. A supplier the list ` +
          `has not seen keeps its own row. `
        : "") +
      (broken === 0
        ? `Every invoice in the range ties out.`
        : broken === 1
          ? `The one that does not reconcile is OUR extraction failing to read a line, not a ` +
            `vendor billing wrong. The column reports the state of our records.`
          : `The ${count(broken)} that do not reconcile are OUR extraction failing to read a ` +
            `line, not a vendor billing wrong. The column reports the state of our records.`),
  }
}

/**
 * Price trend, INDEXED per vendor rather than plotted in dollars.
 *
 * The four biggest vendors' basket medians over eight weeks run $35–41,
 * $33–43, $88–119 and **$4.33–4.61**. The last is Premier Meats, the largest
 * vendor in the account, which bills by the pound where the others bill by the
 * case — on a shared dollar axis it is a flat rule along the bottom and a 6%
 * move in it is invisible.
 *
 * So each vendor is indexed to its own first week and the axis is percent,
 * which is also the question the section asks: not who is dearest — that is a
 * unit comparison nobody can make across pounds and cases — but who is
 * MOVING.
 */
function trendOf(d: VendorData): VendorTrend {
  const weeks = [...new Set(d.weekly.map((p) => p.week))].sort()
  // Never empty: the section resolves `empty` rather than calling this when
  // `trendVendors` finds no overlap — see `getVendorsSectionPromises`.
  const picked = trendVendors(d)

  const COLOURS = ["var(--bad)", "var(--signal)", "var(--good)", "var(--ink-3)"]
  const names = shortLabels(
    picked.map((v) => v.name),
    LEGEND_CHARS,
  )

  const build = (h: number, ticks: boolean): ChartSpec => ({
    type: "line",
    h,
    ticks,
    legend: true,
    labels: weeks.map(D),
    series: picked.map((v, i) => ({
      name: names[i],
      color: COLOURS[i % COLOURS.length],
      // A week this vendor did not deliver in is a gap, not a zero.
      data: weeks.map((w) => d.weekly.find((p) => p.week === w && p.vendor === v.name)?.index ?? null),
      fill: i === 0,
    })),
    alt: "Basket price change by week and vendor",
  })

  return {
    chart: build(142, true),
    phoneChart: build(112, false),
    meta: `${count(picked.length)} biggest · change from ${D(weeks[0])}`,
    note:
      `Each vendor is indexed to its own first week, because they do not bill in the same ` +
      `unit: Premier Meats prices by the pound and Vitco by the case, and on a shared dollar ` +
      `axis the largest vendor in the account is a flat line on the floor.`,
  }
}

/** Worth a call — from what the range actually shows, not a fixture. */
function workOf(d: VendorData): VendorWork {
  const items: QueueItem[] = []

  const rising = d.vendors
    .filter((v) => v.trend !== null && v.trend >= FLAT_PCT)
    .sort((a, b) => (b.trend ?? 0) - (a.trend ?? 0))[0]
  if (rising) {
    items.push({
      key: "rising",
      tone: "warn",
      lead: trendText(rising.trend).replace("▲ ", ""),
      unit: "basket",
      title: `${rising.name} is getting dearer`,
      body:
        `${rising.name}'s basket median is up ${trendText(rising.trend).replace("▲ ", "")} over ` +
        `${count(BASKET_WEEKS)} weeks, on ${money(rising.spend)} of spend in ${d.rangeLabel}. That is ` +
        `the vendor's whole basket rather than one line, so it is a conversation about the ` +
        `account and not about a product.`,
      act: "See what they sell",
      href: `/dashboard/operations/vendors/${encodeURIComponent(rising.name)}`,
    })
  }

  const worst = d.vendors.filter((v) => v.broken > 0).sort((a, b) => b.broken - a.broken)[0]
  const total = d.vendors.reduce((t, v) => t + v.broken, 0)
  if (worst) {
    items.push({
      key: "reconcile",
      tone: "bad",
      lead: count(total),
      unit: total === 1 ? "invoice" : "invoices",
      title: "Invoices we cannot read in full",
      body:
        `${worst.name} ${total === 1 ? "has it" : `leads them with ${count(worst.broken)}`}. ` +
        `${total === 1 ? "It is a line" : "These are lines"} our extraction dropped, duplicated ` +
        `or misread — the vendor billed correctly and we recorded it wrong, so the fix is on ` +
        `this side and the goods are already in the total.`,
      act: "Open the invoices",
      href: "/dashboard/invoices",
    })
  }

  return { items, meta: `${plural(items.length, "thing")} to do` }
}

/** The phone's list: biggest spend first. */
function listOf(d: VendorData): VendorList {
  return {
    rows: d.vendors.slice(0, PHONE_ROWS).map((v) => ({
      key: v.name,
      href: `/dashboard/operations/vendors/${encodeURIComponent(v.name)}`,
      title: v.name,
      detail: `${count(v.invoices)} ${v.invoices === 1 ? "invoice" : "invoices"} · ${cadenceText(v.cadence)}`,
      value: money(v.spend),
      note: trendText(v.trend),
      noteTone: (v.trend ?? 0) > FLAT_PCT ? "down" : "up",
    })),
    meta: d.rangeLabel,
  }
}

/* -- assembly --------------------------------------------------------- */

export function getVendorsSectionPromises(
  input: VendorsInput,
): StreamedSections<VendorsSections> {
  const dataP = classify(() => loadVendors(input), {
    retryAction: "retryVendors",
    isEmpty: (d) => d.vendors.length === 0,
    // These three pages are about what was BOUGHT, and buying happens every few
    // days — this page's own strip prints "delivers every 2.0d". Empty here is
    // a window shorter than the delivery cadence, not a filter that matched
    // nothing, and this page has no filters to widen. See `EmptyReason`.
    emptyReason: "no_delivery",
  })

  const s = <T,>(f: (d: VendorData) => T) =>
    guardSection(dataP.then((sd) => mapReady(sd, f)), "retryVendors")

  /**
   * A section that can be empty while the LOAD is full.
   *
   * `classify` above answers one question — did any invoice fall in the range
   * — and every section is mapped off that one answer. Two of them have a
   * second, narrower emptiness of their own, and before this they rendered it
   * as a ready section with nothing in it.
   */
  const sTo = <T,>(f: (d: VendorData) => SectionData<T>) =>
    guardSection(dataP.then((sd) => mapReadyTo(sd, f)), "retryVendors")

  return {
    headline: s(headlineOf),
    table: s(tableOf),
    trend: sTo<VendorTrend>((d) =>
      trendVendors(d).length > 0
        ? ready(trendOf(d))
        : // Which empty, because the next step differs. With no weeks at all,
          // nothing priced has reached the window this chart watches and no
          // control on the page can change that — `nothing_received` states
          // the window's result and instructs nothing. With weeks that belong
          // to other vendors, the range is what decided which vendors are on
          // this page, and widening it (or the store scope) genuinely changes
          // the answer — which is what `no_match` tells the reader to do.
          empty<VendorTrend>(d.weekly.length === 0 ? "nothing_received" : "no_match"),
    ),
    work: sTo<VendorWork>((d) => {
      const w = workOf(d)
      // Nothing rising and nothing short is not a worklist with no rows; it is
      // an empty worklist, which is good news and has to read as good news
      // (note 23). The COGS, labour and orders adapters resolve it the same way.
      return w.items.length === 0 ? empty<VendorWork>("all_clear") : ready(w)
    }),
    list: s(listOf),
  }
}

export async function getVendorsSections(input: VendorsInput): Promise<VendorsSections> {
  return awaitSections(getVendorsSectionPromises(input))
}
