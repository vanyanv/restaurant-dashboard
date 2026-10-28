import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { isOperational } from "@/lib/store-lifecycle"
import { count, pct } from "@/lib/counter/format"
import { blendedMargin } from "@/lib/counter/blended-margin"
import { getItemEconomics, menuMargin, type MenuMargin } from "@/lib/counter/item-economics"
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
/**
 * The DESK axis budget, which is not `LABEL_CHARS + 2`.
 *
 * `.axis` is a `space-between` flex row of 9px mono. Across the desk chart's
 * ~1160px, eight labels at the old twelve characters drew ~570px of text and
 * ~590px of gap — half the row spent on nothing, while the names were cut
 * hard enough that "2 Slider Combo", "1 Slider Combo" and "2 Sliders and
 * Fries" all arrived as "…Co…"/"…a…" strings differing by a character or two.
 * `shortLabels` could not repair that: it groups on a PREFIX, and those three
 * differ at the front and agree after it, which is the one shape a prefix
 * group can never catch.
 *
 * Eighteen draws ~850px and leaves ~44px between labels. Four of the eight
 * names stop being cut at all.
 */
const DESK_LABEL_CHARS = 18

/**
 * One item in one window. `qty` is EVERY unit sold — the mix is a share of
 * units and an uncosted item still takes its share. The margin terms are
 * per COSTED unit, on what was collected after discounts (`item-economics.ts`),
 * so `cost × costedQty` and `price × costedQty` reconstitute the booked cost
 * and the collected revenue exactly.
 */
interface Unit {
  qty: number
  /** Units on COSTED rows; 0 when nothing costed it. */
  costedQty: number
  /** Booked cost on the costed rows. */
  costTotal: number
  /** Collected (after discounts) on the costed rows. */
  collectedTotal: number
  /**
   * In the blend exactly when `menuMargin` counts it — a booked cost above $0
   * over something collected. The bridge and the Blended margin cell use one
   * test, so the bridge's "Now" line is the cell.
   */
  inBlend: boolean
}

/** Per costed unit, or `null` when there is no unit to divide by. */
const perUnit = (u: Unit) =>
  u.costedQty > 0 ? { cost: u.costTotal / u.costedQty, price: u.collectedTotal / u.costedQty } : null

interface Window {
  units: Map<string, Unit>
  totalQty: number
  orders: number
  /** `menuMargin` — the Blended margin cell, the same figure on every menu page. */
  menu: MenuMargin
}

interface MixData {
  now: Window
  prior: Window | null
  /** Every name in either window, so a term dropping to zero still counts. */
  names: string[]
  /**
   * Why this page can be empty, decided where the scope is known.
   *
   * `null` means the window simply caught nothing and widening it is a real
   * way out. The other two are not: an account with no store has nowhere for a
   * mix to come from, and a scope whose every store is pre-open will read
   * empty at any range a reader can pick.
   *
   * Analytics, the P&L, COGS and Labor have all resolved `pre_open` for that
   * last case since they were built. This page did not, so one account was
   * told "Not trading yet" on four pages and "No rows fall inside the current
   * filters and date range. Widen either to see figures." on this one —
   * measured 2026-09-04, on a page that draws no filter row at all.
   */
  emptyBecause: "no_stores" | "pre_open" | null
}

async function loadWindow(
  accountId: string,
  storeIds: string[],
  range: DateRange,
): Promise<Window> {
  const { startDate, endDate } = toQueryBounds(range)
  const [economics, orders] = await Promise.all([
    // Packaging is already out (see the docblock: these are boxes, and they
    // are the biggest rows) — `item-economics.ts` never counts it as an item.
    getItemEconomics({ accountId, storeIds, startDate, endDate }),
    prisma.otterOrder.count({
      where: {
        storeId: { in: storeIds },
        referenceTimeLocal: { gte: startDate, lte: endDate },
      },
    }),
  ])

  const units = new Map<string, Unit>()
  let totalQty = 0
  for (const i of economics.items.values()) {
    const c = i.costed
    const inBlend = c !== null && c.cost > 0 && c.collected > 0
    // Kept when it sold OR when the blend counts it: dropping a zero-unit
    // item that carries booked cost made the bridge disagree with the cell.
    if (i.units <= 0 && !inBlend) continue
    units.set(i.itemName, {
      qty: Math.max(0, i.units),
      costedQty: c && c.units > 0 ? c.units : 0,
      costTotal: c?.cost ?? 0,
      collectedTotal: c?.collected ?? 0,
      inBlend,
    })
    totalQty += Math.max(0, i.units)
  }
  return { units, totalQty, orders, menu: economics.menu }
}

async function loadMix(input: ProductMixInput): Promise<MixData> {
  const { range, storeId, accountId } = input
  const stores = await getScopedStores(accountId, storeId ?? null)
  const storeIds = stores.map((s) => s.id)
  if (storeIds.length === 0) {
    return {
      now: { units: new Map(), totalQty: 0, orders: 0, menu: menuMargin([]) },
      prior: null,
      names: [],
      emptyBecause: "no_stores",
    }
  }

  // The window immediately before this one, of the same length. `prior` is
  // what the strip's deltas and the whole bridge are measured against, so it
  // is not the page's comparison SETTING — a weekday-matched comparison would
  // make "share of units, prior" mean something else on every other visit.
  const priorRange = comparisonRange(range, "prev")

  const [now, prior] = await Promise.all([
    loadWindow(accountId, storeIds, range),
    priorRange ? loadWindow(accountId, storeIds, priorRange) : Promise.resolve(null),
  ])

  return {
    now,
    prior,
    // The same test Analytics, the P&L, COGS and Labor make, on whole `Store`
    // rows this call already has — `getScopedStores` returns them, so this
    // costs no query.
    emptyBecause: stores.some(isOperational) ? null : "pre_open",
    names: [...new Set([...now.units.keys(), ...(prior ? prior.units.keys() : [])])],
  }
}

/**
 * `1 - Σ(cost × qty) / Σ(price × qty)`, with each term drawn from whichever
 * window the caller names. This is the whole bridge: every line is this
 * function with a different mixture of the two windows.
 *
 * Over COSTED units only, and `Unit.price` is COLLECTED per costed unit, so
 * with all three factors from one window `price × costedQty` reconstitutes
 * collected revenue exactly and this IS `menuMargin` — the "Now" line of the
 * bridge equals the Blended margin cell on this page, the Menu hub and Menu
 * profit. An uncosted item has no term (it used to enter at $0 cost and pull
 * the blend toward 100%).
 */
function bridgeMargin(
  names: string[],
  pick: (name: string) => { cost: number; revenue: number } | null,
): number | null {
  let cost = 0
  let revenue = 0
  for (const name of names) {
    const t = pick(name)
    if (!t) continue
    cost += t.cost
    revenue += t.revenue
  }
  return blendedMargin(cost, revenue)
}

const pts = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)} pts`

function headlineOf(d: MixData): MixHeadline {
  const { now, prior } = d
  const perOrder = now.orders > 0 ? now.totalQty / now.orders : null
  const priorPerOrder = prior && prior.orders > 0 ? prior.totalQty / prior.orders : null

  const ranked = [...now.units.entries()].filter(([, u]) => u.qty > 0).sort((a, b) => b[1].qty - a[1].qty)
  const top = ranked[0]
  const topShare = top && now.totalQty > 0 ? (top[1].qty / now.totalQty) * 100 : null

  // `menuMargin`, read — not re-derived — so this cell is the same number as
  // the Menu hub's and Menu profit's.
  const margin = now.menu.marginPct
  const priorMargin = prior ? prior.menu.marginPct : null

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
        : "of menu revenue, after discounts",
    deltaTone:
      margin !== null && priorMargin !== null && margin < priorMargin ? "is-down" : "is-flat",
  }

  return {
    cells: [
      {
        label: "Items sold",
        value: count(now.totalQty),
        delta: `across ${count(ranked.length)} items`,
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
  const ranked = [...d.now.units.entries()].filter(([, u]) => u.qty > 0).sort((a, b) => b[1].qty - a[1].qty)
  const build = (n: number, budget: number): ChartSpec => {
    const top = ranked.slice(0, n)
    return {
      type: "bars",
      h: n === DESK_BARS ? 158 : 124,
      zero: true,
      labels: shortLabels(top.map(([name]) => name), budget),
      fullLabels: top.map(([name]) => name),
      series: [{ name: "Units", color: "var(--ink)", data: top.map(([, u]) => u.qty) }],
      alt: "Units by item",
    }
  }

  return {
    chart: build(DESK_BARS, DESK_LABEL_CHARS),
    phoneChart: build(PHONE_BARS, LABEL_CHARS - 1),
    meta: `${count(d.now.totalQty)} units · hover a bar`,
  }
}

function tableOf(d: MixData): MixTable {
  const { now, prior } = d
  const ranked = [...now.units.entries()].filter(([, u]) => u.qty > 0).sort((a, b) => b[1].qty - a[1].qty)
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
    // for: "the margin column is the menu's, not this page's" — so it is the
    // menu's figure, after discounts, and an em dash when nothing costed it.
    const margin = u.inBlend ? 100 - (u.costTotal / u.collectedTotal) * 100 : null
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
      // KEEPS ITS UNIT, unlike the desk's column. A phone row has no header
      // above it to carry the word, so a bare "+1.20" beside a value reading
      // "34.3%" is a number with no stated kind — and points of share against
      // per-cent of share is exactly the confusion `points()` exists to stop.
      note: r.change === null ? undefined : pts(r.change),
      noteTone: r.change !== null && r.change < 0 ? "down" : "up",
    })),
    /*
     * THE UNIT OF THE CHANGE COLUMN LIVES HERE.
     *
     * `pts()` writes "+1.20 pts" and both table call sites strip the word to
     * hold the column narrow, which left "+1.20" sitting between "34.3%" and
     * "33.1%" with nothing on the page saying it is POINTS of share rather
     * than per cent of it. Those read as +1.2 points and +3.6 per cent of the
     * same movement, and only one of them is what the column holds.
     *
     * The head is where it goes rather than the header cell: the column stays
     * the width the figures need, and this is the same place the reader
     * already looks to be told the section is share of units. `/dashboard/pnl`
     * states the identical rule under its cascade for the identical reason.
     */
    meta: `${count(shown.length)} of ${count(ranked.length)} · share of units · change in pts`,
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
    bridgeMargin(d.names, (n) => {
      const q = qtyFrom.units.get(n)
      // The same membership test as `menuMargin`, on the window the
      // quantities come from.
      if (!q || !q.inBlend) return null
      const own = perUnit(q)
      // No costed unit to re-price: the term enters at its own totals.
      if (!own) return { cost: q.costTotal, revenue: q.collectedTotal }
      // A term with no reading in the window a factor is taken from falls back
      // to the other window's, rather than to zero: a missing prior cost is
      // "we have no earlier reading", not "it used to be free".
      const reading = (u: Unit | undefined) => (u && u.inBlend ? perUnit(u) : null)
      const c = reading(costFrom.units.get(n)) ?? own
      const p = reading(priceFrom.units.get(n)) ?? own
      return { cost: c.cost * q.costedQty, revenue: p.price * q.costedQty }
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
    emptyReason: (d) => d.emptyBecause ?? "no_match",
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
