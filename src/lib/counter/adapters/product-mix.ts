import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { count, pct } from "@/lib/counter/format"
import { comparisonRange, toQueryBounds, type DateRange } from "@/lib/counter/date-range"
import type { ChartSpec } from "@/lib/counter/chart-geometry"
import { shortLabels } from "@/lib/counter/short-labels"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
import { mapReady, type SectionData } from "@/lib/counter/section-data"
import type { FigureProps, MathRow, MListRow, Row } from "@/components/counter"

/**
 * Product mix — `P.productmix`
 * (`docs/counter/counter-prototype.html:6263`).
 *
 * "What sold, in what proportion, and how that mix moved the blended margin."
 *
 * ## This is NOT Menu profit, and the bridge is why
 *
 * Menu profit ranks items by margin against volume. This page asks a
 * different question: what SHARE of units each item took, how that share
 * moved, and — the part nothing else in the rebuild answers — how much of the
 * blended margin's change came from the mix shifting rather than from
 * anything getting cheaper or dearer.
 *
 * ## The bridge is a chained decomposition, and the order is load-bearing
 *
 * Blended margin is `1 - Σ(unit cost × qty) / Σ(unit price × qty)`. Three
 * things can move it, and they are separated by moving one at a time and
 * measuring after each:
 *
 *   1. **Mix** — hold both unit cost and unit price at the prior window's and
 *      swap the quantities to this window's.
 *   2. **Unit costs** — then move unit cost to this window's.
 *   3. **Menu prices** — then move unit price. What is left IS the margin.
 *
 * The three add to the total exactly, by construction, so there is no
 * residual line to explain away. But a chained decomposition depends on its
 * ORDER — attributing mix first and prices last is a choice, and a different
 * order would hand the interaction term to a different line. The section's
 * note says so, because a bridge that looks like an accounting identity and
 * is actually one of six orderings should not pretend otherwise.
 *
 * The prototype writes four lines: prior, ingredient prices, mix shift, now.
 * This writes five, because ingredient cost and menu price are two different
 * decisions by two different people and this schema can separate them.
 *
 * ## Packaging is excluded, as it is everywhere else
 *
 * `DailyCogsItem` carries `Packaging - *` pseudo-rows that hold cost against
 * $0 of revenue. Left in, they are the two BIGGEST shares on this page —
 * "Packaging - medium 6x6" alone is 19.1% of units — and the mix table becomes
 * a list of boxes. `getMenuEngineering` already excludes `category:
 * "Packaging"` for the same reason; this uses the same filter, and with it the
 * unit total (25,585) matches the POS rollup every other menu page reads,
 * exactly.
 */

export interface MixHeadline {
  cells: FigureProps[]
  phoneCells: FigureProps[]
}

export interface MixUnits {
  chart: ChartSpec
  phoneChart: ChartSpec
  meta: string
}

export interface MixTable {
  rows: Row[]
  phoneRows: MListRow[]
  meta: string
}

export interface MixBridge {
  rows: MathRow[]
  meta: string
  note: string
}

export interface ProductMixSections {
  headline: SectionData<MixHeadline>
  units: SectionData<MixUnits>
  table: SectionData<MixTable>
  bridge: SectionData<MixBridge>
}

export interface ProductMixInput {
  range: DateRange
  storeId: string | null
  accountId: string
}

/** Bars on the desk chart, and on the phone's. */
const DESK_BARS = 8
const PHONE_BARS = 5
/** Rows in the mix table, and on the phone's list. */
const TABLE_ROWS = 8
const PHONE_ROWS = 5
/** Bar labels are cut to this; see `shortLabels`. */
const LABEL_CHARS = 10

interface Unit {
  cost: number
  price: number
  qty: number
}

interface Window {
  units: Map<string, Unit>
  totalQty: number
  orders: number
}

interface MixData {
  now: Window
  prior: Window | null
  /** Every name in either window, so a term dropping to zero still counts. */
  names: string[]
}

async function loadWindow(
  storeIds: string[],
  range: DateRange,
): Promise<Window> {
  const { startDate, endDate } = toQueryBounds(range)
  const [rows, orders] = await Promise.all([
    prisma.dailyCogsItem.groupBy({
      by: ["itemName"],
      where: {
        storeId: { in: storeIds },
        date: { gte: startDate, lte: endDate },
        // See the docblock: these are boxes, and they are the biggest rows.
        category: { not: "Packaging" },
      },
      _sum: { lineCost: true, salesRevenue: true, qtySold: true },
    }),
    prisma.otterOrder.count({
      where: {
        storeId: { in: storeIds },
        referenceTimeLocal: { gte: startDate, lte: endDate },
      },
    }),
  ])

  const units = new Map<string, Unit>()
  let totalQty = 0
  for (const r of rows) {
    const qty = Number(r._sum.qtySold ?? 0)
    if (qty <= 0) continue
    units.set(r.itemName, {
      cost: Number(r._sum.lineCost ?? 0) / qty,
      price: Number(r._sum.salesRevenue ?? 0) / qty,
      qty,
    })
    totalQty += qty
  }
  return { units, totalQty, orders }
}

async function loadMix(input: ProductMixInput): Promise<MixData> {
  const { range, storeId, accountId } = input
  const stores = await getScopedStores(accountId, storeId ?? null)
  const storeIds = stores.map((s) => s.id)
  if (storeIds.length === 0) {
    return { now: { units: new Map(), totalQty: 0, orders: 0 }, prior: null, names: [] }
  }

  // The window immediately before this one, of the same length. `prior` is
  // what the strip's deltas and the whole bridge are measured against, so it
  // is not the page's comparison SETTING — a weekday-matched comparison would
  // make "share of units, prior" mean something else on every other visit.
  const priorRange = comparisonRange(range, "prev")

  const [now, prior] = await Promise.all([
    loadWindow(storeIds, range),
    priorRange ? loadWindow(storeIds, priorRange) : Promise.resolve(null),
  ])

  return {
    now,
    prior,
    names: [...new Set([...now.units.keys(), ...(prior ? prior.units.keys() : [])])],
  }
}

/**
 * `1 - Σ(cost × qty) / Σ(price × qty)`, with each term drawn from whichever
 * window the caller names. This is the whole bridge: every line is this
 * function with a different mixture of the two windows.
 */
function blendedMargin(
  names: string[],
  pick: (name: string) => Unit | null,
): number | null {
  let cost = 0
  let revenue = 0
  for (const name of names) {
    const u = pick(name)
    if (!u) continue
    cost += u.cost * u.qty
    revenue += u.price * u.qty
  }
  return revenue > 0 ? 100 - (cost / revenue) * 100 : null
}

const pts = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)} pts`

function headlineOf(d: MixData): MixHeadline {
  const { now, prior } = d
  const perOrder = now.orders > 0 ? now.totalQty / now.orders : null
  const priorPerOrder = prior && prior.orders > 0 ? prior.totalQty / prior.orders : null

  const ranked = [...now.units.entries()].sort((a, b) => b[1].qty - a[1].qty)
  const top = ranked[0]
  const topShare = top && now.totalQty > 0 ? (top[1].qty / now.totalQty) * 100 : null

  const margin = blendedMargin(d.names, (n) => now.units.get(n) ?? null)
  const priorMargin = prior
    ? blendedMargin(d.names, (n) => prior.units.get(n) ?? null)
    : null

  const perOrderCell: FigureProps = {
    label: "Items per order",
    value: perOrder === null ? "—" : perOrder.toFixed(2),
    delta:
      perOrder !== null && priorPerOrder !== null
        ? `${pts(perOrder - priorPerOrder).replace(" pts", "")} on the prior window`
        : "no prior window",
    deltaTone:
      perOrder !== null && priorPerOrder !== null && perOrder < priorPerOrder
        ? "is-down"
        : "is-flat",
  }
  const marginCell: FigureProps = {
    label: "Blended margin",
    value: margin === null ? "—" : pct(margin, { scaled: true }),
    delta:
      margin !== null && priorMargin !== null
        ? pts(margin - priorMargin)
        : "of menu revenue",
    deltaTone:
      margin !== null && priorMargin !== null && margin < priorMargin ? "is-down" : "is-flat",
  }

  return {
    cells: [
      {
        label: "Items sold",
        value: count(now.totalQty),
        delta: `across ${count(now.units.size)} items`,
        deltaTone: "is-flat",
      },
      perOrderCell,
      {
        label: "Top item share",
        value: topShare === null ? "—" : pct(topShare, { scaled: true }),
        delta: top ? top[0] : "nothing sold",
        deltaTone: "is-flat",
      },
      marginCell,
    ],
    phoneCells: [perOrderCell, marginCell],
  }
}

function unitsOf(d: MixData): MixUnits {
  const ranked = [...d.now.units.entries()].sort((a, b) => b[1].qty - a[1].qty)
  const build = (n: number, budget: number): ChartSpec => {
    const top = ranked.slice(0, n)
    return {
      type: "bars",
      h: n === DESK_BARS ? 158 : 124,
      zero: true,
      labels: shortLabels(top.map(([name]) => name), budget),
      series: [{ name: "Units", color: "var(--ink)", data: top.map(([, u]) => u.qty) }],
      alt: "Units by item",
    }
  }

  return {
    chart: build(DESK_BARS, LABEL_CHARS + 2),
    phoneChart: build(PHONE_BARS, LABEL_CHARS - 1),
    meta: `${count(d.now.totalQty)} units · hover a bar`,
  }
}

function tableOf(d: MixData): MixTable {
  const { now, prior } = d
  const ranked = [...now.units.entries()].sort((a, b) => b[1].qty - a[1].qty)
  const shown = ranked.slice(0, TABLE_ROWS)

  const shareOf = (w: Window | null, name: string) => {
    if (!w || w.totalQty <= 0) return null
    const u = w.units.get(name)
    return u ? (u.qty / w.totalQty) * 100 : 0
  }

  const built = shown.map(([name, u]) => {
    const share = (u.qty / now.totalQty) * 100
    const was = shareOf(prior, name)
    const change = was === null ? null : share - was
    // The item's OWN margin, which is what the prototype's own comment asks
    // for: "the margin column is the menu's, not this page's".
    const margin = u.price > 0 ? 100 - (u.cost / u.price) * 100 : null
    return { name, share, was, change, margin }
  })

  return {
    rows: built.map((r) => ({
      key: r.name,
      href: `/dashboard/menu/catalog/${r.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")}`,
      cells: {
        item: r.name,
        share: pct(r.share, { scaled: true }),
        prior: r.was === null ? "—" : pct(r.was, { scaled: true }),
        // `hot` via the prototype's own `{ v, cls }` cell form, on a share
        // that moved a full point or more. The prototype marks one row by
        // hand; this picks it from the data.
        change:
          r.change === null
            ? "—"
            : Math.abs(r.change) >= 1
              ? { v: pts(r.change).replace(" pts", ""), cls: "hot" }
              : pts(r.change).replace(" pts", ""),
        margin: r.margin === null ? "—" : pct(r.margin, { scaled: true }),
      },
    })),
    phoneRows: built.slice(0, PHONE_ROWS).map((r) => ({
      key: r.name,
      title: r.name,
      detail: r.was === null ? "no prior window" : `was ${pct(r.was, { scaled: true })}`,
      value: pct(r.share, { scaled: true }),
      note: r.change === null ? undefined : pts(r.change).replace(" pts", ""),
      noteTone: r.change !== null && r.change < 0 ? "down" : "up",
    })),
    meta: `${count(shown.length)} of ${count(now.units.size)} · share of units`,
  }
}

function bridgeOf(d: MixData): MixBridge {
  const { now, prior } = d
  if (!prior) {
    return {
      rows: [],
      meta: "no prior window",
      note: "A bridge needs two windows. This range has no window before it in the data.",
    }
  }

  const at = (
    costFrom: Window,
    priceFrom: Window,
    qtyFrom: Window,
  ): number | null =>
    blendedMargin(d.names, (n) => {
      const q = qtyFrom.units.get(n)
      if (!q) return null
      // A term with no reading in the window a factor is taken from falls back
      // to the other window's, rather than to zero: a missing prior cost is
      // "we have no earlier reading", not "it used to be free".
      const c = costFrom.units.get(n) ?? q
      const p = priceFrom.units.get(n) ?? q
      return { cost: c.cost, price: p.price, qty: q.qty }
    })

  const m0 = at(prior, prior, prior)
  const mMix = at(prior, prior, now)
  const mCost = at(now, prior, now)
  const m1 = at(now, now, now)

  if (m0 === null || mMix === null || mCost === null || m1 === null) {
    return {
      rows: [],
      meta: "not computable",
      note: "One of the two windows has no costed revenue, so there is no margin to bridge.",
    }
  }

  return {
    rows: [
      { key: "prior", label: "Blended margin, prior window", value: pct(m0, { scaled: true }) },
      { key: "mix", label: "Mix shift", op: true, value: pts(mMix - m0) },
      { key: "cost", label: "Ingredient costs", op: true, value: pts(mCost - mMix) },
      { key: "price", label: "Menu prices", op: true, value: pts(m1 - mCost) },
      {
        key: "now",
        label: "Now",
        value: pct(m1, { scaled: true }),
        strong: true,
        rule: true,
        noBorder: true,
      },
    ],
    meta: `${pts(m1 - m0)} in all`,
    note:
      `Each line moves ONE factor and re-measures: quantities first, then cost per ` +
      `unit, then price per unit. The three add to the total exactly because the last ` +
      `one is defined as what is left — but a chained bridge depends on its ORDER, and ` +
      `attributing mix first hands the interaction between mix and price to the price ` +
      `line. A different order would split the same change differently.`,
  }
}

export function getProductMixSectionPromises(
  input: ProductMixInput,
): StreamedSections<ProductMixSections> {
  const dataP = classify(() => loadMix(input), {
    retryAction: "retryProductMix",
    isEmpty: (d) => d.now.units.size === 0,
    emptyReason: "no_match",
  })

  return {
    headline: guardSection(dataP.then((sd) => mapReady(sd, headlineOf)), "retryProductMix"),
    units: guardSection(dataP.then((sd) => mapReady(sd, unitsOf)), "retryProductMix"),
    table: guardSection(dataP.then((sd) => mapReady(sd, tableOf)), "retryProductMix"),
    bridge: guardSection(dataP.then((sd) => mapReady(sd, bridgeOf)), "retryProductMix"),
  }
}

export async function getProductMixSections(
  input: ProductMixInput,
): Promise<ProductMixSections> {
  return awaitSections(getProductMixSectionPromises(input))
}
