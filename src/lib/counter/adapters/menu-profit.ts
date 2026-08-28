import {
  getMenuEngineering,
  type MenuEngineeringData,
  type MenuEngineeringRow,
} from "@/app/actions/forecasts/menu-engineering-actions"
import { count, money, pct } from "@/lib/counter/format"
import { dayCount, type DateRange } from "@/lib/counter/date-range"
import { loadStatement } from "@/lib/counter/statement"
import { COGS_CODE } from "@/lib/pnl"
import { rowValues } from "@/lib/counter/statement"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
import { mapReady, type SectionData } from "@/lib/counter/section-data"
import type { ChartSpec } from "@/lib/counter/chart-geometry"
import type {
  FigureProps,
  MatrixPoint,
  MListRow,
  QueueItem,
  Row,
} from "@/components/counter"

/**
 * Menu profit — `P.menu` (`docs/counter/counter-prototype.html:5441`).
 *
 * Volume against margin, the four quadrants operators already name, and an
 * honest account of what the figures did not see.
 *
 * ## Most of this page was already built
 *
 * `getMenuEngineering` publishes `medianVelocity` and `medianUnitMargin` (the
 * two splits), `rows` with a `quadrant` on each, `counts` for the legend,
 * `totalContribution`, and a `coverage` block written for exactly the honesty
 * section below. Nothing here re-derives a quadrant.
 *
 * ## THE HONESTY SECTION CHANGES ITS SUBJECT, AND THE NEW ONE IS WORSE
 *
 * The prototype's "What these figures did not see" is about UNMAPPED items:
 * six of them, 7.1% of revenue, *"an unmapped item costs $0 until a recipe is
 * mapped to it, so every margin on this page is optimistic by some part of
 * that"*.
 *
 * Measured here over thirty days, that gap is **sixty-two dollars** — 0.02%.
 * Coverage is **99.8%**, not the prototype's 92.9%. An owner reading that would
 * conclude the page is trustworthy.
 *
 * But **$26,690 — 10.1% of costed revenue — walks a recipe that reported at
 * least one line uncosted** (`DailyCogsItem.partialCost`, surfaced here as
 * `coverage.partialCostRevenue`). Those items ARE in the quadrants and their
 * margins ARE optimistic, which is precisely the claim the prototype's section
 * makes — aimed at the wrong column.
 *
 * So the section keeps its shape and changes its subject. Unmapped and
 * missing-cost stay in the bars because they are real, just small; the
 * headline figure and the callout are about partial cost, because that is
 * where a dollar in ten actually goes unaccounted.
 *
 * Third time in this rebuild a prototype section has pointed at a gap this
 * account does not have while a bigger one sat beside it, after Labor's SPLH
 * floor and COGS' waste.
 *
 * ## Two figures come from the statement, and the prototype says so
 *
 * Its own comment: *"Revenue and food cost … are the same two figures every
 * other page reads, from the same place."* So Revenue is the statement's Total
 * Sales and Food cost is the statement's COGS line — ruling C-R1, which the
 * prototype arrived at independently. Blended margin stays on MENU revenue and
 * says so in its own delta, as the Menu hub's does.
 */

export interface MenuProfitHeadline {
  /** Four: Revenue · Food cost · Blended margin · Costed coverage. */
  cells: FigureProps[]
  /** Two: Blended margin · Costed coverage. */
  phoneCells: FigureProps[]
}

export interface MatrixSection {
  points: MatrixPoint[]
  /**
   * The phone's degradation of the same section: four rows, one per quadrant,
   * naming what is in it. `P.menu.phone()` draws exactly this — a scatter is
   * not a reading at 340px, but the four groups are the whole point of it.
   */
  phoneRows: MListRow[]
  medianUnits: number
  medianMargin: number
  axisLabel: string
  meta: string
  /** What the medians are and why the dots sit where they do. */
  note: string
}

export interface OpportunitySection {
  items: QueueItem[]
  phoneRows: MListRow[]
  meta: string
}

export interface CoverageBar {
  label: string
  value: string
  /** Share of revenue, 0..100. */
  share: number
  /** A `ct-` band token — never a literal. */
  tone: string
}

export interface CoverageAction {
  label: string
  href: string
  /** `.btn--primary` — one per row, the prototype's shape. */
  primary?: boolean
}

export interface CoverageSection {
  /** The lead figure — the share that is NOT understated. */
  headline: string
  bars: CoverageBar[]
  callout: string
  /** `.btnrow` — where the reader goes to close the gap. */
  actions: CoverageAction[]
  meta: string
}

export interface LedgerSection {
  rows: Row[]
  phoneRows: MListRow[]
  /** `P.menu.phone()`'s "Profit by item" — the top six by contribution. */
  phoneChart: ChartSpec
  meta: string
  note: string
}

export interface MenuProfitSections {
  headline: SectionData<MenuProfitHeadline>
  matrix: SectionData<MatrixSection>
  opportunities: SectionData<OpportunitySection>
  coverage: SectionData<CoverageSection>
  ledger: SectionData<LedgerSection>
}

export interface MenuProfitInput {
  range: DateRange
  storeId: string | null
  accountId: string
}

const LEDGER_ROWS = 12
const PHONE_ROWS = 5
/**
 * FOUR bars, where `P.menu.phone()` draws six.
 *
 * Its six fit because its fixture's item names are single short words
 * ("Truffle", "Salmon"). This menu's are "Signature Double Patty & Cheese
 * Slider (Chris' or Eddy's Way)". Six columns leave about fifty pixels of axis
 * each — six monospace characters — at which every label is both unreadable
 * and identical to its neighbour. Measured on the render at 390px: six touch,
 * four do not.
 */
const PHONE_CHART_ROWS = 4
/** Names shown per quadrant on the phone's group list before the "+N more". */
const GROUP_NAMES = 3
/**
 * How wide a bar label may be. Six bars share 390px minus the card inset, so
 * this is the budget at which two neighbouring labels stop touching — measured
 * on the render, not guessed.
 */
const LABEL_CHARS = 9

/** The prototype's own quadrant words, in the order its legend writes them. */
const QUADRANT_WORD: Record<MenuEngineeringRow["quadrant"], string> = {
  STAR: "Star",
  PLOWHORSE: "Plowhorse",
  PUZZLE: "Puzzle",
  DOG: "Dog",
}

/** The order `P.menu.phone()` lists the groups in. */
const QUADRANT_ORDER: MenuEngineeringRow["quadrant"][] = [
  "STAR",
  "PLOWHORSE",
  "PUZZLE",
  "DOG",
]

function headlineOf(
  data: MenuEngineeringData,
  totalSales: number,
  foodCost: number,
): MenuProfitHeadline {
  const revenue = data.rows.reduce((t, r) => t + r.revenue, 0)
  const cogs = data.rows.reduce((t, r) => t + r.cogs, 0)
  const margin = revenue > 0 ? 100 - (cogs / revenue) * 100 : null

  const marginCell: FigureProps = {
    label: "Blended margin",
    value: margin === null ? "—" : pct(margin, { scaled: true }),
    // The denominator, in the cell. The COGS page divides the same cost by the
    // statement's Total Sales and gets a different answer; both are right and
    // neither may go unnamed.
    delta: "of menu revenue",
    deltaTone: "is-flat",
  }
  const coverageCell: FigureProps = {
    label: "Costed coverage",
    value: pct(data.coverage.coveragePct, { scaled: true }),
    delta: "of revenue the classifier saw",
    deltaTone: "is-flat",
  }

  return {
    cells: [
      {
        label: "Revenue",
        value: money(totalSales),
        // The statement's, not the menu's — the prototype asks for exactly
        // this and names the reason itself.
        delta: "Total Sales, as the P&L reads it",
        deltaTone: "is-flat",
      },
      {
        label: "Food cost",
        value: money(foodCost),
        delta:
          totalSales > 0
            ? `${pct((foodCost / totalSales) * 100, { scaled: true })} of Total Sales`
            : "no sales in range",
        deltaTone: "is-flat",
      },
      marginCell,
      coverageCell,
    ],
    phoneCells: [marginCell, coverageCell],
  }
}

function matrixOf(data: MenuEngineeringData, days: number): MatrixSection {
  // `itemName` is NOT unique: `getMenuEngineering` returns a row per item per
  // category, and this menu sells seven items under two categories each (the
  // POS emits some with a category and some without — see the Menu hub's own
  // note). Keying a dot by name alone collided on all seven and React dropped
  // half of them silently, which is a chart quietly missing points rather than
  // an error anyone would see.
  const points: MatrixPoint[] = data.rows
    .filter((r) => r.marginPct !== null)
    .map((r) => ({
      key: `${r.itemName}::${r.category}`,
      label: r.itemName,
      units: r.soldQty,
      margin: r.marginPct as number,
      quadrant: r.quadrant,
      detail: [
        `${count(r.soldQty)} sold`,
        `${pct(r.marginPct as number, { scaled: true })} margin`,
        `${money(r.totalContribution)} contribution`,
        QUADRANT_WORD[r.quadrant],
      ],
    }))

  return {
    points,
    phoneRows: groupRowsOf(data),
    medianUnits: data.medianVelocity,
    medianMargin: data.medianUnitMargin,
    axisLabel: `Units sold, ${count(days)} days →`,
    meta: `${count(points.length)} items · hover a dot`,
    note:
      `The splits are the MEDIANS of what actually sold — ${count(Math.round(data.medianVelocity))} ` +
      `units and ${pct(data.medianUnitMargin, { scaled: true })} margin — not a fixed middle, ` +
      `because the medians are what define the four quadrants. Both axes scale to this menu's own ` +
      `range, so one runaway seller cannot flatten every other dot against the left edge.`,
  }
}

/**
 * The four quadrants as a list, for the phone.
 *
 * The prototype joins EVERY item name in a group — its fixture has twelve
 * items across four groups, so the longest line is three names. This menu has
 * fifty-one and the Dogs alone are fifteen; that line would be a paragraph
 * inside a list row. Three names and a count of the rest says the same thing
 * in the space a phone row has.
 */
function groupRowsOf(data: MenuEngineeringData): MListRow[] {
  return QUADRANT_ORDER.map((q) => {
    const rows = data.rows.filter((r) => r.quadrant === q)
    const named = rows.slice(0, GROUP_NAMES).map((r) => r.itemName)
    const rest = rows.length - named.length
    return {
      key: q,
      title: `${QUADRANT_WORD[q]}s`,
      detail:
        rows.length === 0
          ? "none in this window"
          : named.join(", ") + (rest > 0 ? ` +${count(rest)} more` : ""),
      value: count(rows.length),
    }
  })
}

/**
 * Short, DISTINCT bar labels.
 *
 * The prototype takes each name's first word cut to six characters. On this
 * menu that collides immediately — the two biggest sellers are "Signature
 * Double Patty & Cheese Slider" and "Signature Slider Fries & Drink Combo",
 * both of which become "Signat".
 *
 * Growing the label a word at a time until it is unique does not fix it
 * either, which is worth writing down because it is the obvious fix and it is
 * wrong twice: it makes uniqueness a property of the FULL label while the
 * reader only ever sees the truncated one ("Signature" and "Signature Slider"
 * both cut back to "Signature…"), and where the first word does happen to
 * differ it stops there, so "2 Slider Combo" and "1 Slider Combo" become "2"
 * and "1" — unique, and meaningless.
 *
 * So: cut every name to the budget FIRST, then repair whatever still collides
 * by dropping the words those names share at the front. Two names starting
 * "Signature" lose it and become "Double Patt…" and "Slider Frie…", which is
 * both distinct and readable. The shared prefix is the part carrying no
 * information in that group by definition.
 */
function shortLabels(names: string[]): string[] {
  const cut = (text: string) =>
    text.length > LABEL_CHARS ? `${text.slice(0, LABEL_CHARS - 1)}\u2026` : text

  const out = names.map(cut)

  // A group is the set of positions sharing one truncated label. Only those
  // need repairing; everything else is already distinct and stays untouched.
  const groups = new Map<string, number[]>()
  out.forEach((label, i) => groups.set(label, [...(groups.get(label) ?? []), i]))

  for (const members of groups.values()) {
    if (members.length < 2) continue
    const words = members.map((i) => names[i].split(/\s+/))
    let shared = 0
    while (
      words.every((w) => w.length > shared + 1) &&
      words.every((w) => w[shared] === words[0][shared])
    ) {
      shared += 1
    }
    if (shared === 0) continue
    members.forEach((i, n) => {
      out[i] = cut(words[n].slice(shared).join(" "))
    })
  }

  // Anything still identical after that (the same item under two categories)
  // takes a prime rather than printing two bars a reader cannot tell apart.
  const seen = new Set<string>()
  return out.map((label) => {
    let unique = label
    while (seen.has(unique)) unique += "\u2032"
    seen.add(unique)
    return unique
  })
}

/**
 * The three cards, DERIVED. The prototype's are hand-written about items this
 * menu does not have (a milkshake feature, a 2 Slider Combo, jalapeño
 * poppers), so none of them can be ported — only the shape can.
 *
 * Each card is the extreme of one quadrant that carries an action:
 *  - the DOG with the most volume, because that is the one costing real money;
 *  - the PUZZLE with the highest margin, because that is the one worth pushing;
 *  - the PLOWHORSE with the thinnest margin, because that is the one a small
 *    recipe change pays back fastest.
 *
 * A quadrant with no rows contributes no card rather than an empty one.
 */
function opportunitiesOf(data: MenuEngineeringData): OpportunitySection {
  const best = (
    quadrant: MenuEngineeringRow["quadrant"],
    by: (r: MenuEngineeringRow) => number,
  ): MenuEngineeringRow | null => {
    const rows = data.rows.filter((r) => r.quadrant === quadrant && r.marginPct !== null)
    if (rows.length === 0) return null
    return rows.reduce((a, b) => (by(b) > by(a) ? b : a))
  }

  const worstDog = best("DOG", (r) => r.soldQty)
  const bestPuzzle = best("PUZZLE", (r) => r.marginPct ?? 0)
  const thinPlowhorse = best("PLOWHORSE", (r) => -(r.marginPct ?? 100))

  const items: QueueItem[] = []
  const phoneRows: MListRow[] = []

  if (worstDog) {
    items.push({
      key: `dog-${worstDog.itemName}`,
      tone: "bad",
      lead: pct(worstDog.marginPct as number, { scaled: true }),
      title: `${worstDog.itemName} sells and does not pay`,
      body:
        `${count(worstDog.soldQty)} sold at ${pct(worstDog.marginPct as number, { scaled: true })}, ` +
        `below the median margin on a menu where it is also below median volume. ` +
        `It contributed ${money(worstDog.totalContribution)} across the window.`,
      act: "See the recipe",
      href: "/dashboard/recipes",
    })
    phoneRows.push({
      key: `dog-${worstDog.itemName}`,
      title: worstDog.itemName,
      detail: `${count(worstDog.soldQty)} sold · does not pay`,
      value: pct(worstDog.marginPct as number, { scaled: true }),
      noteTone: "down",
    })
  }

  if (bestPuzzle) {
    items.push({
      key: `puzzle-${bestPuzzle.itemName}`,
      tone: "good",
      lead: pct(bestPuzzle.marginPct as number, { scaled: true }),
      title: `${bestPuzzle.itemName} earns well and nobody orders it`,
      body:
        `The highest margin among items selling below the median — ` +
        `${count(bestPuzzle.soldQty)} sold. A puzzle is a menu placement problem, not a recipe one.`,
      act: "Open the catalog",
      href: "/dashboard/menu/catalog",
    })
    phoneRows.push({
      key: `puzzle-${bestPuzzle.itemName}`,
      title: bestPuzzle.itemName,
      detail: `${count(bestPuzzle.soldQty)} sold · earns well`,
      value: pct(bestPuzzle.marginPct as number, { scaled: true }),
      noteTone: "up",
    })
  }

  if (thinPlowhorse) {
    items.push({
      key: `plow-${thinPlowhorse.itemName}`,
      tone: "warn",
      lead: count(thinPlowhorse.soldQty),
      title: `${thinPlowhorse.itemName} is the thinnest of the volume sellers`,
      body:
        `${count(thinPlowhorse.soldQty)} sold at ` +
        `${pct(thinPlowhorse.marginPct as number, { scaled: true })}, the lowest margin above ` +
        `median volume. A point recovered here is worth more than a point anywhere else on the menu.`,
      act: "See the recipe",
      href: "/dashboard/recipes",
    })
    phoneRows.push({
      key: `plow-${thinPlowhorse.itemName}`,
      title: thinPlowhorse.itemName,
      detail: `${count(thinPlowhorse.soldQty)} sold · thinnest seller`,
      value: pct(thinPlowhorse.marginPct as number, { scaled: true }),
      noteTone: "down",
    })
  }

  return {
    items,
    phoneRows,
    meta: items.length > 0 ? `${count(items.length)} worth acting on` : "nothing to act on",
  }
}

function coverageOf(data: MenuEngineeringData): CoverageSection {
  const c = data.coverage
  const costed = c.costedRevenue
  const total = costed + c.unmappedRevenue + c.missingCostRevenue
  const firm = costed - c.partialCostRevenue
  const share = (n: number) => (total > 0 ? (n / total) * 100 : 0)

  return {
    // NOT `coveragePct`. That figure is 99.8% here and reads as "the page is
    // trustworthy"; the share whose cost is fully walked is what the reader
    // actually wants, and it is lower.
    headline: pct(share(firm), { scaled: true }),
    bars: [
      { label: `Fully costed`, value: money(firm), share: share(firm), tone: "mx-2" },
      {
        label: `Partly costed`,
        value: money(c.partialCostRevenue),
        share: share(c.partialCostRevenue),
        tone: "gp-2",
      },
      {
        // NOT "Unmapped". This bar is `unmappedRevenue + missingCostRevenue`
        // and only the first of those is unmapped — $62 against $428 measured,
        // where the $428 IS mapped to a recipe that priced nothing. Calling the
        // pair "Unmapped" put a figure eight times the real one under that word,
        // directly beside a meta line reading "99.8% mapped" — the section
        // contradicting itself. What the two share is that neither carries any
        // cost, which is what the callout already calls them.
        label: `Not costed at all`,
        value: money(c.unmappedRevenue + c.missingCostRevenue),
        share: share(c.unmappedRevenue + c.missingCostRevenue),
        tone: "gp-1",
      },
    ],
    callout:
      `${money(c.partialCostRevenue)} of revenue sits on recipes that walked but did not price ` +
      `every line, so those margins are OPTIMISTIC by whatever the missing lines cost. That is ` +
      `${pct(share(c.partialCostRevenue), { scaled: true })} of the menu, against ` +
      `${money(c.unmappedRevenue + c.missingCostRevenue)} that carries no cost at all — ` +
      `of which ${money(c.unmappedRevenue)} is genuinely unmapped, the gap the header ` +
      `figure measures and the small one here.`,
    // The prototype's two, aimed at this section's subject rather than its
    // own: its primary is "Map the six", because unmapped items are its gap.
    // Ours is the partial-cost one, and a recipe with an unpriced line is
    // fixed in the same place — but the two buttons cannot name a count the
    // way the prototype's does, because `MenuEngineeringCoverage` publishes
    // four revenue figures and no item counts.
    actions: [
      { label: "Price the missing lines", href: "/dashboard/recipes", primary: true },
      { label: "See which items", href: "/dashboard/menu/catalog" },
    ],
    meta: `${pct(c.coveragePct, { scaled: true })} mapped · the gap is elsewhere`,
  }
}

const LEDGER_COLUMNS_NOTE =
  "Each item's margin is its own cost over its own revenue, so these rows do not sum to the " +
  "blended figure above and are not meant to. Contribution is what the item put in across the " +
  "window, which is why a thin margin on a big seller can outrank a fat one nobody orders."

function ledgerOf(data: MenuEngineeringData): LedgerSection {
  const ranked = [...data.rows].sort((a, b) => b.totalContribution - a.totalContribution)
  const shown = ranked.slice(0, LEDGER_ROWS)

  return {
    rows: shown.map((r) => ({
      key: `${r.itemName}::${r.category}`,
      cells: {
        item: r.itemName,
        quadrant: QUADRANT_WORD[r.quadrant],
        sold: count(r.soldQty),
        margin: r.marginPct === null ? "—" : pct(r.marginPct, { scaled: true }),
        contribution: money(r.totalContribution),
      },
    })),
    phoneRows: shown.slice(0, PHONE_ROWS).map((r) => ({
      key: `${r.itemName}::${r.category}`,
      title: r.itemName,
      detail: `${count(r.soldQty)} sold · ${QUADRANT_WORD[r.quadrant]}`,
      value: money(r.totalContribution),
      note: r.marginPct === null ? undefined : pct(r.marginPct, { scaled: true }),
    })),
    phoneChart: (() => {
      const top = ranked.slice(0, PHONE_CHART_ROWS)
      return {
        type: "bars",
        h: 128,
        zero: true,
        labels: shortLabels(top.map((r) => r.itemName)),
        series: [
          {
            name: "Contribution",
            color: "var(--ink)",
            data: top.map((r) => r.totalContribution),
          },
        ],
        // No `fmt`: `Chart`'s default IS money, and passing a function
        // through a section would put a non-serialisable value on a promise
        // that crosses the RSC boundary.
        alt: "Contribution by item",
      } satisfies ChartSpec
    })(),
    meta: `${count(shown.length)} of ${count(data.rows.length)} · by contribution`,
    note: LEDGER_COLUMNS_NOTE,
  }
}

export function getMenuProfitSectionPromises(
  input: MenuProfitInput,
): StreamedSections<MenuProfitSections> {
  const { range, storeId } = input
  const days = dayCount(range)

  const dataP = classify(
    async () => {
      const [me, statement] = await Promise.all([
        getMenuEngineering({
          ...(storeId ? { storeId } : {}),
          lookbackDays: days,
          asOf: range.end,
        }),
        loadStatement({ range, storeId, granularity: "daily" }),
      ])
      if (!me || !me.ok) throw new Error("menu engineering unavailable")
      const cogsRow = rowValues(statement.rows, COGS_CODE) ?? []
      return {
        me: me.data,
        totalSales: statement.grossSales,
        // Stored NEGATIVE by `computeStorePnL`; flipped once, here.
        foodCost: -cogsRow.reduce((t, v) => t + v, 0),
      }
    },
    { retryAction: "retryMenuProfit", isEmpty: (d) => d.me.rows.length === 0, emptyReason: "no_match" },
  )

  return {
    headline: guardSection(
      dataP.then((sd) => mapReady(sd, (d) => headlineOf(d.me, d.totalSales, d.foodCost))),
      "retryMenuProfit",
    ),
    matrix: guardSection(
      dataP.then((sd) => mapReady(sd, (d) => matrixOf(d.me, days))),
      "retryMenuProfit",
    ),
    opportunities: guardSection(
      dataP.then((sd) => mapReady(sd, (d) => opportunitiesOf(d.me))),
      "retryMenuProfit",
    ),
    coverage: guardSection(
      dataP.then((sd) => mapReady(sd, (d) => coverageOf(d.me))),
      "retryMenuProfit",
    ),
    ledger: guardSection(
      dataP.then((sd) => mapReady(sd, (d) => ledgerOf(d.me))),
      "retryMenuProfit",
    ),
  }
}

export async function getMenuProfitSections(
  input: MenuProfitInput,
): Promise<MenuProfitSections> {
  return awaitSections(getMenuProfitSectionPromises(input))
}
