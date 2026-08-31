import { prisma } from "@/lib/prisma"
import { count, money, pct, unitCost } from "@/lib/counter/format"
import {
  COST_SPIKE_THRESHOLD,
  deriveCostFromLineItem,
  getLineItemBaseQty,
} from "@/lib/invoice-line-shape"
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
 */

/** How far back a price history is read. */
const HISTORY_DAYS = 120
/** The window the volume figure — and so the money — is taken over. */
const VOLUME_DAYS = 30
/** Below this many priced deliveries an ingredient has no trailing median worth having. */
const MIN_DELIVERIES = 3
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

interface Mover {
  id: string
  name: string
  unit: string
  recipes: number
  median: number
  latest: number
  latestAt: Date
  move: number
  volume: number
  costs: number
  deliveries: number
  packVaries: boolean
  spike: boolean
  history: Delivery[]
}

interface PriceData {
  movers: Mover[]
  held: Mover[]
  /** Canonicals that could not be priced at all, and why. */
  unpriceable: number
  totalCanonicals: number
}

/* ── Load ─────────────────────────────────────────────────────────────── */

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

async function loadPrices(): Promise<PriceData> {
  const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000)
  const volumeSince = new Date(Date.now() - VOLUME_DAYS * 86_400_000)

  const [canonicals, lines] = await Promise.all([
    prisma.canonicalIngredient.findMany({
      select: {
        id: true,
        name: true,
        recipeUnit: true,
        _count: { select: { recipeIngredients: true } },
      },
    }),
    prisma.invoiceLineItem.findMany({
      where: {
        canonicalIngredientId: { not: null },
        invoice: { invoiceDate: { gte: since } },
      },
      orderBy: { invoice: { invoiceDate: "asc" } },
      select: {
        canonicalIngredientId: true,
        sku: true,
        productName: true,
        quantity: true,
        unit: true,
        packSize: true,
        unitSize: true,
        unitSizeUom: true,
        unitPrice: true,
        extendedPrice: true,
        invoice: { select: { invoiceDate: true } },
      },
    }),
  ])

  const byCanonical = new Map<string, typeof lines>()
  for (const line of lines) {
    const id = line.canonicalIngredientId
    if (id === null) continue
    const bucket = byCanonical.get(id) ?? []
    bucket.push(line)
    byCanonical.set(id, bucket)
  }

  const movers: Mover[] = []
  let unpriceable = 0

  for (const canonical of canonicals) {
    const bucket = byCanonical.get(canonical.id)
    const recipeUnit = canonical.recipeUnit
    if (!bucket || !recipeUnit) {
      if (bucket) unpriceable++
      continue
    }

    const priced = bucket
      .map((line) => {
        const cost = deriveCostFromLineItem(line, recipeUnit)
        const base = getLineItemBaseQty(line)
        // `invoiceDate` is nullable in the schema; an undated line has no
        // place on a time series, so it is dropped rather than dated today.
        const at = line.invoice.invoiceDate
        return cost === null || base === null || at === null
          ? null
          : {
              at,
              cost,
              qty: Math.abs(base.totalBaseQty),
              // A SKU's pack shape is packSize × unitSize; more than one of
              // those for one SKU is what produces a fictional price move.
              key: line.sku ?? line.productName.toLowerCase(),
              shape: (line.packSize ?? 1) * (line.unitSize ?? 1),
            }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    if (priced.length < MIN_DELIVERIES) {
      if (priced.length === 0) unpriceable++
      continue
    }

    const shapes = new Map<string, Set<number>>()
    for (const p of priced) {
      const set = shapes.get(p.key) ?? new Set<number>()
      set.add(p.shape)
      shapes.set(p.key, set)
    }

    const latest = priced[priced.length - 1]
    const trailing = median(priced.slice(0, -1).map((p) => p.cost))
    if (trailing === null || trailing <= 0) continue

    const volume = priced
      .filter((p) => p.at >= volumeSince)
      .reduce((sum, p) => sum + p.qty, 0)

    movers.push({
      id: canonical.id,
      name: canonical.name,
      unit: recipeUnit,
      recipes: canonical._count.recipeIngredients,
      median: trailing,
      latest: latest.cost,
      latestAt: latest.at,
      move: (latest.cost - trailing) / trailing,
      volume,
      costs: (latest.cost - trailing) * volume,
      deliveries: priced.length,
      packVaries: [...shapes.values()].some((s) => s.size > 1),
      spike:
        latest.cost > trailing * COST_SPIKE_THRESHOLD ||
        trailing > latest.cost * COST_SPIKE_THRESHOLD,
      history: priced.map((p) => ({ at: p.at, cost: p.cost, qty: p.qty })),
    })
  }

  movers.sort((a, b) => Math.abs(b.costs) - Math.abs(a.costs))

  return {
    movers: movers.filter((m) => !m.spike),
    held: movers.filter((m) => m.spike),
    unpriceable,
    totalCanonicals: canonicals.length,
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
  phoneRows: MListRow[]
  meta: string
  note: string
}

function moversOf(d: PriceData): PriceMovers {
  const shown = d.movers.slice(0, TABLE_ROWS)

  return {
    rows: shown.map((m) => ({
      key: m.id,
      cells: {
        ingredient: m.packVaries ? { v: m.name, cls: "hot" } : m.name,
        median: unitCost(m.median),
        latest: unitCost(m.latest),
        move: pct(m.move),
        volume: `${count(Math.round(m.volume))} ${m.unit}`,
        costs: m.costs > 0 ? { v: money(m.costs), cls: "hot" } : money(m.costs),
        recipes: m.recipes === 0 ? "none" : count(m.recipes),
      },
    })),
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

export function getPriceSectionPromises(): StreamedSections<PriceSections> {
  const dataP = classify(() => loadPrices(), {
    retryAction: "retryPrices",
    isEmpty: (d) => d.movers.length === 0 && d.held.length === 0,
    emptyReason: "no_match",
  })
  const s = <T,>(f: (d: PriceData) => T) =>
    guardSection(dataP.then((sd) => mapReady(sd, f)), "retryPrices")
  return {
    headline: s(headlineOf),
    chart: s(chartOf),
    movers: s(moversOf),
  }
}

export async function getPriceSections(): Promise<PriceSections> {
  return awaitSections(getPriceSectionPromises())
}
