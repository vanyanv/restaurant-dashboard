import { prisma } from "@/lib/prisma"
import { count, money, pct, unitCost } from "@/lib/counter/format"
import { COST_SPIKE_THRESHOLD } from "@/lib/invoice-line-shape"
import { loadPriceMoves, VOLUME_DAYS } from "@/lib/counter/price-move"
import { counterToday } from "@/lib/counter/today"
import type { ChartSpec } from "@/lib/counter/chart-geometry"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
import { mapReady, type SectionData } from "@/lib/counter/section-data"
import { median } from "@/lib/counter/median"
import type { FigureProps, MListRow, Row } from "@/components/counter"

/**
 * Price monitor — `P.prices` (`docs/counter/counter-prototype.html`).
 *
 * ## The prototype's idea is right; its numbers point the other way
 *
 * Its note — *"every price that moved, ranked by what the move actually costs
 * you"* — and its table header — *"ranked by what it costs you, not by
 * percentage"* — are the design, and this page keeps both. What it claims is
 * a basket up 9.4% and $1,284 of cost. Measured across the 44 ingredients
 * with at least three priced deliveries in 120 days, the basket is **down**:
 * net −$617 over thirty days at current volume.
 *
 * ## Which window you compare decides what you report
 *
 * The fry price oscillates between exactly $1.0370/lb and $1.7315/lb on an
 * identical 6 × 4.5 lb pack, across 37 deliveries. Comparing the last thirty
 * days against the thirty before straddles that step and reports **+67% and
 * $3,150 of cost** — at a moment when the price has come all the way back
 * down. Comparing the latest delivery against that ingredient's own trailing
 * median reports **−15.5% and −$860**, which is what is true today.
 *
 * So the move here is `latest vs trailing median of its own history`, not
 * window against window. "What does it cost me now" has a now in it.
 *
 * ## Ranking by percentage surfaces a parsing bug
 *
 * The biggest percentage move in the data is `keyston sanitizer multi quat
 * liq` at **+1,005%** — and it is not a price move. The same $96.69 case was
 * recorded once as `pack=1 size=21 GAL` and once as `pack=2 size=1 GAL`, so
 * one delivery costs $4.60/gal and the next $50.88/gal. `COST_SPIKE_THRESHOLD`
 * in `@/lib/invoice-line-shape` already catches it at 11× the median. The page
 * holds it out and says so, rather than dropping it silently or printing it.
 *
 * Nine of the 44 carry more than one pack shape against a single SKU. Those
 * are marked, not held out — a pack genuinely changes sometimes, and only the
 * ones that also breach the guard are excluded.
 *
 * See `docs/counter/measurements/2026-08-29-prices.md`.
 *
 * ## The move is not computed here
 *
 * It is `loadPriceMoves` (`@/lib/counter/price-move`), which every page that
 * prints a price move now reads. Two things changed when it moved there: the
 * latest price is spike-guarded the way booked costs are (a mis-parse is set
 * aside rather than compared), and the volume is in RECIPE units. It used to
 * be summed in the invoice's base unit and multiplied by a per-recipe-unit Δ,
 * which put an ingredient costed per ounce and billed by the pound 16× low.
 */

/** Rows the movers table prints. */
const TABLE_ROWS = 12
/** Ingredients drawn on the chart. */
const CHART_LINES = 3
/** Weeks the chart spans. */
const CHART_WEEKS = 12

interface Delivery {
  at: Date
  cost: number
  qty: number
}

export interface Mover {
  id: string
  name: string
  unit: string
  recipes: number
  /** The trailing median — `PriceMove.baseline`. */
  median: number
  /** The spike-guarded latest — `PriceMove.latest`. */
  latest: number
  latestAt: Date
  /** A fraction. */
  move: number
  /** Recipe units bought in the last 30 days. */
  volume: number
  costs: number
  deliveries: number
  packVaries: boolean
  /** Held: even the guarded latest is beyond the spike threshold. */
  spike: boolean
  /** The newest reading the guard set aside, when it set one aside. */
  setAside: number | null
  history: Delivery[]
}

export interface PriceData {
  movers: Mover[]
  held: Mover[]
  /** Canonicals that could not be priced at all, and why. */
  unpriceable: number
  totalCanonicals: number
}

/* ── Load ─────────────────────────────────────────────────────────────── */

/**
 * The movers, off `loadPriceMoves` — the one function every page that prints
 * a price move reads (`@/lib/counter/price-move`). Nothing about the move is
 * computed here any more; this only ranks and shapes it.
 */
export async function loadPrices(
  accountId: string,
  opts: { asOf?: Date; storeIds?: string[] | null } = {},
): Promise<PriceData> {
  const set = await loadPriceMoves({
    accountId,
    storeIds: opts.storeIds,
    asOf: opts.asOf ?? counterToday(),
  })

  const movers: Mover[] = [...set.moves.values()].map((m) => ({
    id: m.id,
    name: m.name,
    unit: m.recipeUnit,
    recipes: m.recipes,
    median: m.baseline,
    latest: m.latest,
    latestAt: m.latestAt,
    move: m.move,
    volume: m.volume30,
    costs: m.impact30,
    deliveries: m.readings.length,
    packVaries: m.packVaries,
    spike: m.held,
    setAside: m.setAside[0]?.cost ?? null,
    history: m.readings.map((r) => ({ at: r.at, cost: r.cost, qty: r.qty })),
  }))

  movers.sort((a, b) => Math.abs(b.costs) - Math.abs(a.costs))

  return {
    movers: movers.filter((m) => !m.spike),
    held: movers.filter((m) => m.spike),
    unpriceable: set.unpriceable,
    totalCanonicals: set.totalCanonicals,
  }
}

/* ── Shaping ──────────────────────────────────────────────────────────── */

export interface PriceHeadline {
  cells: FigureProps[]
  phoneCells: FigureProps[]
}

function headlineOf(d: PriceData): PriceHeadline {
  const net = d.movers.reduce((s, m) => s + m.costs, 0)
  const risen = d.movers.filter((m) => m.costs > 0)
  const fallen = d.movers.filter((m) => m.costs < 0)
  const worst = risen[0] ?? null
  const best = fallen[0] ?? null
  const packVaries = d.movers.filter((m) => m.packVaries).length

  const cells: FigureProps[] = [
    {
      label: net < 0 ? "The moves are saving" : "The moves are costing",
      value: money(Math.abs(net)),
      delta: `over ${count(VOLUME_DAYS)} days, at current volume`,
      deltaTone: net > 0 ? "is-down" : undefined,
    },
    {
      // The ingredient's NAME is the delta, not a `caption`. A caption opens
      // `.band`, and `P.prices`' own worst-mover cell is a four-tuple that
      // puts the name exactly here: `['Worst mover', '▲ 31%', 'chicken
      // thigh', 'is-down']`.
      label: "Costs you most",
      value: worst ? money(worst.costs) : "—",
      delta: worst ? `${pct(worst.move)} · ${worst.name}` : "nothing rose",
      deltaTone: "is-down",
    },
    {
      label: "Saves you most",
      value: best ? money(-best.costs) : "—",
      delta: best ? `${pct(best.move)} · ${best.name}` : "nothing fell",
    },
    {
      label: "Pack shape varies",
      value: count(packVaries),
      delta: `of ${count(d.movers.length)} · one SKU, two pack sizes`,
      deltaTone: "is-flat",
    },
  ]

  return { cells, phoneCells: cells.slice(0, 2) }
}

export interface PriceChart {
  chart: ChartSpec
  meta: string
  note: string
}

function chartOf(d: PriceData): PriceChart {
  const drawn = d.movers.slice(0, CHART_LINES)
  const weekStart = (at: Date) => {
    const t = new Date(at)
    t.setUTCHours(0, 0, 0, 0)
    t.setUTCDate(t.getUTCDate() - t.getUTCDay())
    return t.toISOString().slice(0, 10)
  }

  const weeks: string[] = []
  const cursor = new Date()
  cursor.setUTCHours(0, 0, 0, 0)
  cursor.setUTCDate(cursor.getUTCDate() - cursor.getUTCDay())
  for (let i = CHART_WEEKS - 1; i >= 0; i--) {
    const w = new Date(cursor)
    w.setUTCDate(w.getUTCDate() - i * 7)
    weeks.push(w.toISOString().slice(0, 10))
  }

  const colors = ["var(--ct-accent)", "var(--ct-ink)", "var(--ct-ink-3)"]

  return {
    chart: {
      type: "line",
      h: 158,
      labels: weeks.map((w) => w.slice(5)),
      legend: true,
      alt: "Price per recipe unit by week, for the three ingredients whose moves cost the most",
      series: drawn.map((m, i) => {
        const byWeek = new Map<string, number[]>()
        for (const h of m.history) {
          const w = weekStart(h.at)
          byWeek.set(w, [...(byWeek.get(w) ?? []), h.cost])
        }
        // `null` is a gap: a week with no delivery is not a price of zero.
        const raw = weeks.map((w) => median(byWeek.get(w) ?? []) ?? null)
        // Indexed to the first week that has a price. Three ingredients priced
        // in $/lb, $/each and $/ml share no axis — plotted raw, the one in
        // millilitres is a flat line on the floor and the step this chart
        // exists to show is invisible. An index compares shape, which is the
        // only thing comparable across units.
        const first = raw.find((v) => v !== null) ?? null
        return {
          name: m.name.slice(0, 26),
          color: colors[i] ?? "var(--ct-ink-3)",
          data:
            first === null || first === 0
              ? raw
              : raw.map((v) => (v === null ? null : (100 * v) / first)),
          w: i === 0 ? 1.9 : 1.4,
        }
      }),
    },
    meta: `${count(CHART_WEEKS)} weeks · each indexed to 100 at its first delivery`,
    note:
      `Indexed to 100, because these are priced per pound, per each and per millilitre and ` +
      `share no axis. A week with no delivery is a gap, not a zero. The step in the fry line ` +
      `is the ` +
      `reason this page compares the latest price against a trailing median rather than ` +
      `one month against the last: the price moved up, sat there for three weeks and came ` +
      `back down, and a month-against-month reading taken mid-step reports a 67% rise that ` +
      `nobody is paying.`,
  }
}

export interface PriceMovers {
  rows: Row[]
  /** Every mover, not cut to the table's twelve. */
  allRows: Row[]
  phoneRows: MListRow[]
  meta: string
  note: string
}

function moversOf(d: PriceData): PriceMovers {
  const shown = d.movers.slice(0, TABLE_ROWS)
  const rowOf = (m: (typeof d.movers)[number]): Row => ({
      key: m.id,
      // The ingredient page is the deep dive: every delivery, every vendor,
      // every recipe the move reaches.
      href: `/dashboard/ingredients/${m.id}`,
      cells: {
        ingredient: m.packVaries ? { v: m.name, cls: "hot" } : m.name,
        median: unitCost(m.median),
        latest: unitCost(m.latest),
        move: pct(m.move),
        volume: `${count(Math.round(m.volume))} ${m.unit}`,
        costs: m.costs > 0 ? { v: money(m.costs), cls: "hot" } : money(m.costs),
        recipes: m.recipes === 0 ? "none" : count(m.recipes),
      },
    })

  return {
    rows: shown.map(rowOf),
    // Every mover, uncut, for Invoices → Prices: it is the page the Needs you
    // box's "Every price that moved" link promises, so it cannot stop at 12.
    allRows: d.movers.map(rowOf),
    phoneRows: shown.slice(0, 6).map((m) => ({
      key: m.id,
      title: m.name,
      detail: `${unitCost(m.median)} → ${unitCost(m.latest)} · ${count(Math.round(m.volume))} ${m.unit}`,
      value: money(m.costs),
      note: pct(m.move),
      tone: m.costs > 0 ? "down" : "up",
    })),
    meta: `${count(shown.length)} of ${count(d.movers.length)} · ${count(VOLUME_DAYS)}-day volume`,
    note:
      `Ranked by money, which reorders it: the patty paper moved ` +
      `${(() => {
        const paper = d.movers.find((m) => m.name.includes("paper patty"))
        return paper ? `${pct(paper.move)} and costs ${money(paper.costs)}` : "more"
      })()}, while the ground beef moved ` +
      `${(() => {
        const beef = d.movers.find((m) => m.name.includes("ground beef"))
        return beef
          ? `${pct(beef.move)} and costs ${money(beef.costs)}, because it is ` +
              `${count(Math.round(beef.volume))} ${beef.unit}`
          : "less but on far more volume"
      })()}. A percentage ranking puts those the other way round and buries the one that ` +
      `matters. A name in red carries more than one pack shape for a single SKU, which is ` +
      `where a fictional move comes from.` +
      /*
       * The held-out rows were a SECOND TABLE until this page was measured
       * against `P.prices`, which has exactly one. They are a sentence now,
       * and nothing is lost: the table had one row on this account and its
       * whole content was the reason it was held out, which is prose.
       */
      (() => {
        const guarded = d.movers.filter((m) => m.setAside !== null)
        return guarded.length === 0
          ? ``
          : ` ${count(guarded.length)} latest price${guarded.length === 1 ? " is" : "s are"} ` +
              `the one recipes are booked at rather than the newest reading: the cost guard set ` +
              `aside ${guarded
                .slice(0, 3)
                .map((m) => `${m.name}'s ${unitCost(m.setAside!)}`)
                .join(", ")} as a pack read wrong.`
      })() +
      (d.held.length === 0
        ? ` Nothing moved by more than ${count(COST_SPIKE_THRESHOLD)}× its trailing median, ` +
          `so nothing is being kept off this table.`
        : ` ${count(d.held.length)} ingredient${d.held.length === 1 ? " is" : "s are"} held ` +
          `off it entirely: ${d.held
            .slice(0, 3)
            .map((m) => `${m.name} at ${pct(m.move)}`)
            .join(", ")}. A move above ${count(COST_SPIKE_THRESHOLD)}× the trailing median is ` +
          `a pack read wrong rather than a price — the sanitizer's case cost $96.69 on one ` +
          `delivery and $101.75 on the next, but its pack was recorded once as 21 gallons and ` +
          `once as 2, so the derived cost per gallon went from $4.60 to $50.88. The row that ` +
          `needs fixing is the invoice line.`),
  }
}

export interface PriceSections {
  headline: SectionData<PriceHeadline>
  chart: SectionData<PriceChart>
  movers: SectionData<PriceMovers>
}

export function getPriceSectionPromises(accountId: string): StreamedSections<PriceSections> {
  const dataP = classify(() => loadPrices(accountId), {
    retryAction: "retryPrices",
    isEmpty: (d) => d.movers.length === 0 && d.held.length === 0,
    /*
     * Two causes, two answers — and `no_match` was neither.
     *
     * `loadPrices()` takes the account and nothing else: not the reader's
     * range, not the store scope. Its window is a fixed `HISTORY_DAYS`  (`@/lib/counter/price-move`)
     * trailing one. So "Widen either to see figures" pointed at two controls
     * that cannot reach this section, on the page whose whole subject is what
     * things cost.
     *
     * With no catalogue there is nothing to price and the answer is about
     * invoices. With a catalogue but nothing priced, the catalogue is fine and
     * the answer is about the window.
     */
    emptyReason: (d) => (d.totalCanonicals === 0 ? "no_ingredients" : "nothing_received"),
  })
  const s = <T,>(f: (d: PriceData) => T) =>
    guardSection(dataP.then((sd) => mapReady(sd, f)), "retryPrices")
  return {
    headline: s(headlineOf),
    chart: s(chartOf),
    movers: s(moversOf),
  }
}

export async function getPriceSections(accountId: string): Promise<PriceSections> {
  return awaitSections(getPriceSectionPromises(accountId))
}
