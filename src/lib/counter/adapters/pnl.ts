import { getStores } from "@/app/actions/store/crud-actions"
import type { LifecycleStage } from "@/generated/prisma/enums"
import { isOperational } from "@/lib/store-lifecycle"
import { loadChannelMix, type ChannelReading } from "@/lib/counter/channel-mix"
import { loadStripTargets, type StripTargets, type Target } from "@/lib/counter/targets"
import {
  granularityFor,
  loadStatement,
  type Statement,
  type StoreStatement,
} from "@/lib/counter/statement"
import {
  comparisonContext,
  comparisonPhrase,
  type ComparisonContext,
} from "@/lib/counter/comparison"
import { PRIME_CEILING_PCT } from "@/lib/counter/prime-cost"
import { count, delta, money, pct, points } from "@/lib/counter/format"
import {
  comparisonRange,
  trailingWeeks,
  type ComparisonId,
  type DateRange,
  type WeekWindow,
} from "@/lib/counter/date-range"
import { classify } from "@/lib/counter/adapters/types"
import {
  dataOf,
  empty,
  mapReady,
  mapReadyTo,
  notComputed,
  ready,
  type EmptyReason,
  type SectionData,
} from "@/lib/counter/section-data"
import type { Reference } from "@/lib/counter/bullet-state"
import type {
  CascadeCut,
  CascadeEnd,
  CascadeStart,
  FigureProps,
  WeekRow,
} from "@/components/counter"

/**
 * The P&L's data, classified.
 *
 * The second page on the Counter data spine, and the page note 60 is ABOUT:
 * prime cost read 56.2% on the Overview and 57.9% here for the same range,
 * because one counted hourly wages and the other counted hourly plus salaried.
 * Two modules closed that, and this adapter's whole discipline is to use them
 * rather than to answer either question again:
 *
 * - `prime-cost.ts` owns the DEFINITION. **Nothing in this file adds food to
 *   labour and divides.** Every prime figure on the page — the strip cell, the
 *   statement line, each of the eight weeks, each store in the by-store table
 *   — is a `PrimeCost` this file received.
 * - `statement.ts` owns the LOADING. One `getAllStoresPnL` per window, and the
 *   single-store view is read OUT of the all-stores answer, so the two pages
 *   cannot differ in bounds or in which stores were counted either.
 *
 * `tests/lib/counter/note-60.test.ts` hands both adapters the same rollup and
 * asserts they print the same prime cost to the digit.
 *
 * ## The unit trap on this page, which is the same defect class
 *
 * `Statement.cogsPct` and `laborPct` are the rollup's RAW FRACTIONS (0.314).
 * `PrimeCost.cogsPct` / `laborPct` / `primePct` and `WeekRow.*Pct` are
 * PERCENTAGE POINTS (31.4). Reading a fraction into a points field prints
 * "0.3%" for a 31.4% week and sits comfortably under every target forever —
 * a page that looks healthy because its units are wrong. So the rule here is
 * blunt: **every percentage this file prints comes off `prime`**, which is one
 * scale with one owner, and `marginPct` — the one figure `prime` does not
 * carry — is scaled exactly once, in `marginPoints`.
 *
 * ## Two empty states, one `classify` (note 23)
 *
 * A store the account does not own is `no_match` — a dead end the reader backs
 * out of. An account where nothing has traded is `pre_open` — nothing is
 * wrong, and the next step is the store file, not a different filter. A range
 * with no sales at a store that HAS traded is `no_match` too: it is a filter
 * that matched nothing, and widening the range is the way out.
 * `SectionData.empty` carries one reason, so the decision is made here rather
 * than by widening `classify`, which four other adapters depend on.
 *
 * ## What this page does not print
 *
 * The trust panel (note 44) and the food-cause decomposition are
 * `not_computed`, each naming what is missing. Neither is a rendering gap: the
 * first needs a per-line provenance model and an "unposted food inside this
 * range" query, and the second needs a cause-attribution model that can say
 * how many POINTS of an overshoot one ingredient carries. Inventing either
 * would put a picture of an explanation on a page whose whole subject is
 * whether the figures can be trusted.
 *
 * The labour BAND is the third absence and the quietest. The prototype judges
 * labour against 23.9–26.2% plus salaried; that band exists nowhere but the
 * prototype (`targets.ts` explains at length why five of six figures publish
 * nothing). So the labour cell renders bare — a figure with no meter — and the
 * reading paragraph does not claim labour is inside anything.
 */

/* ── The shapes the page's primitives render ──────────────────────────── */

/** One strip cell, exactly `Figure`'s props — the same alias the Overview uses. */
export type StripCell = FigureProps

/**
 * A run of the reading paragraph under the strip (`.ans__lead`, whose `b` rule
 * is at `counter-components.css:451`).
 *
 * Prose, not markup, and not a single string: the sentence names whichever
 * line is actually over and bolds the figure that carries it, and WHICH figure
 * that is, is a judgement about the data. It belongs beside the classification
 * for the same reason the Overview's verdict does — a page composing it would
 * be a page deciding what the numbers mean. Segments keep the emphasis
 * serialisable across the RSC boundary without handing a page any HTML.
 */
export interface ReadingSegment {
  text: string
  strong?: boolean
}

/** The strip and the sentence under it. */
export interface PnlHeadline {
  cells: StripCell[]
  reading: ReadingSegment[]
}

/** Exactly `Cascade`'s props. The end carries no figure — `Cascade` derives it. */
export interface PnlCascade {
  start: CascadeStart
  cuts: CascadeCut[]
  end: CascadeEnd
}

/** The eight weeks, and the one published reference a week can be judged against. */
export interface PnlWeeks {
  rows: WeekRow[]
  /** `Store.targetCogsPct`. `null` leaves every food cell uncalled-out. */
  foodTargetPct: number | null
}

/**
 * One line of the statement table, pre-formatted.
 *
 * A domain shape rather than `Table`'s `columns`/`rows`, exactly as the
 * Overview's `ComparisonRow` is: a `Cell` may be a `ReactNode`, and a
 * `SectionData` has to survive the server/client boundary. The page turns
 * these into cells; nothing here knows what a `<td>` is.
 */
export interface StatementLine {
  key: string
  name: string
  /** The `.pt` note after the name — "target 29.0%", "rent, prorated". */
  sub?: string
  /** The prototype's `strong`: the three lines that are sums, not costs. */
  strong?: boolean
  /** Pre-formatted, carrying the minus a cost line is drawn with. */
  amount: string
  /** This line as a share of sales. */
  share: string
  /** The comparison window's share — or, for gross sales, its dollars. */
  comparison: string
  /** "▲ 1.6 pts", or the percentage change for the gross line. Em-dash with no comparison. */
  change: string
  /** The move is past what the trade acts on. The prototype's `hot`. */
  loud: boolean
  /** What that many points is worth at this range's volume. */
  worth: string
  /** A route this app serves, or absent. Never a guessed destination. */
  href?: string
}

export interface PnlStatement {
  lines: StatementLine[]
  /** What the comparison column is headed with. `null` when there is no comparison. */
  comparisonLabel: string | null
}

/**
 * One store in the by-store table.
 *
 * Every store on the account, whatever the page is scoped to — the reader's
 * question in this section is which stores are IN the statement above and
 * which are not, and a table filtered to the selection cannot answer it.
 *
 * Nullable figures rather than the Overview's trading/pre-open UNION, and the
 * difference is deliberate: a store card is a figure surface, so a pre-open one
 * is a different type that cannot be handed a null (note 33). This table's
 * PURPOSE is the comparison between a store that trades and stores that do
 * not, so the absence is the content, and `Stage` beside it says why the cell
 * is empty. `format.ts` prints null as an em-dash; nothing here prints a zero.
 */
export interface PnlStoreLine {
  id: string
  name: string
  stage: "trading" | "warming_up" | "pre_open"
  /**
   * `StoreStatement.grossSales` — the statement's own top line for this store,
   * named for the field it holds rather than for the word a column header
   * happens to use. `null` when the store took nothing in this range, never `0`.
   *
   * IT WAS CALLED `netSales`, AND THAT NAME WAS A TRAP. The value has always
   * been `grossSales`; the name invited the next page to print it under a
   * "Net" heading, which is note 60 with no arithmetic in it at all — one
   * number, two names, and a gate that cannot see the difference because both
   * are just strings.
   *
   * The prototype is the origin of the confusion and contradicts itself:
   * `pnl().gross = R.netTotal()` (line 5099), so its statement heads that
   * function's output "Gross sales" while its by-store column heads the same
   * output "Net". Ours follows the statement, because the by-store table sits
   * under it and says "every line above is …".
   */
  grossSales: number | null
  /** Points. `null` when there is no denominator, or no labour posted against it. */
  primePct: number | null
  /** Rent charged to this range by the rollup. `null` when the file carries no rent. */
  fixedOnFile: number | null
  /** The one field that keeps a store out of the statement above. */
  rentOnFile: boolean
}

export interface PnlSectionsInput {
  range: DateRange
  /** `null` = every store on the account. */
  storeId: string | null
  /**
   * The account the reader is on. `loadChannelMix` and `loadStripTargets`
   * scope their own queries by it and cannot fetch a session themselves —
   * importing `@/lib/auth` pulls `@/lib/prisma` in at MODULE LOAD, which
   * throws without a `DATABASE_URL` and takes the page's whole import graph
   * with it. `loadStatement` no longer takes one: it was forwarded nowhere.
   */
  accountId: string
  /** `"none"` prints no change column rather than a column of em-dashes it calls a comparison. */
  comparisonId?: ComparisonId
  /**
   * Today, for the eight anchored weeks (note 53). Injected rather than read
   * from the clock so a test can put the reader on a Wednesday, and so the
   * anchoring stays visible: the weeks do NOT come from the range.
   */
  today?: Date
}

export interface PnlSections {
  /** The strip, and the reading under it. */
  headline: SectionData<PnlHeadline>
  /** Note 52: a statement is a sequence of subtractions, so it is drawn as one. */
  cascade: SectionData<PnlCascade>
  /** Note 53: eight weeks, each of them this same statement over that window. */
  weeks: SectionData<PnlWeeks>
  statement: SectionData<PnlStatement>
  /** Every store on the account, including the ones that are not in the statement. */
  byStore: SectionData<PnlStoreLine[]>
  /** Note 44. Owed, and named. See the module comment. */
  trust: SectionData<never>
  /** The gap decomposition. Owed, and named. */
  foodCause: SectionData<never>
}

/* ── Constants the page prints ────────────────────────────────────────── */

/** Note 53's cadence: eight of them, anchored on today. */
const WEEKS_SHOWN = 8

/**
 * What the trade acts on, in points of sales — the prototype's `act` at line
 * 5183, and the rule its own footnote states out loud under the table.
 *
 * These are NOT targets and no meter is drawn against them: no figure is
 * called good or bad by this number. It decides only which of nine changes is
 * worth a reader's eye, and the page says so in the words the prototype uses:
 * "a line is called out when it moves more than the trade acts on: one point
 * on food, two on labour, three on prime." A page that emphasises every row
 * emphasises nothing.
 */
const ACT_PTS = { food: 1, labor: 2, prime: 3 } as const

/** `Store.lifecycleStage` in the table's vocabulary — the same map the Overview's cards use. */
const STAGE_FOR: Record<LifecycleStage, PnlStoreLine["stage"]> = {
  pre_open: "pre_open",
  warming_up: "warming_up",
  ready: "trading",
}

const DASH = "—"

/* ── Reading the statement ────────────────────────────────────────────── */

/**
 * Whether labour is a READING on this range, or an absence.
 *
 * Zero labour against sales is not something a restaurant produces; it is a
 * store whose labour is neither clocked in Harri nor budgeted in its file, and
 * "0.0%" is the same lie as a $0 Grubhub commission. Same gate the Overview
 * puts on its labour and prime cells — a decision about a CELL, which is why
 * it lives at the surface and not inside `statement.ts`.
 */
function laborKnown(s: Statement | StoreStatement): boolean {
  return s.grossSales > 0 && s.laborValue > 0
}

/** The margin in POINTS. `Statement.marginPct` is the rollup's raw fraction. */
function marginPoints(s: Statement | StoreStatement): number | null {
  return s.marginPct === null ? null : s.marginPct * 100
}

/**
 * A `Reference` carrying whatever this schema actually publishes about a
 * figure: a target or a band when one exists, a trajectory when the eight
 * weeks loaded, or nothing at all.
 *
 * The two halves are INDEPENDENT and that is the whole point. `isJudged`
 * (`bullet-state.ts`) is `lo != null || target != null`, so a reference with
 * only a series draws the sparkline and NO bullet — which is exactly the
 * labour cell's true state: a trajectory this schema can plot, against a band
 * it does not publish. Returning `undefined` for an unjudged figure, as this
 * did, threw the trajectory away with the band.
 *
 * Still never a band this schema does not have: `target === null` puts no
 * `lo`/`hi`/`target` on the reference, so nothing is drawn against nothing.
 */
function referenceFor(
  v: number,
  target: Target,
  better: "low" | "high",
  label: string,
  series?: number[],
): Reference | undefined {
  const trail = series && series.length >= 2 ? { series } : {}
  if (target === null) {
    // No published number to judge it against. A bare reference is only worth
    // making when it carries the trajectory; otherwise it is an empty object
    // that would open a `.band` this figure has not earned.
    return series && series.length >= 2 ? { v, better, ...trail } : undefined
  }
  if (target.kind === "band") {
    return { v, lo: target.lo, hi: target.hi, better: target.better, label, ...trail }
  }
  return { v, target: target.value, better: target.better, label, ...trail }
}

/**
 * One rate across the eight weeks, oldest first — the trajectory behind a
 * strip figure.
 *
 * `null` weeks are DROPPED rather than plotted as zero: a week with no labour
 * posted has no labour rate, and a 0 in the middle of the line would draw a
 * collapse that did not happen. Fewer than two readings returns nothing, which
 * is `sparkGeometry`'s own floor.
 *
 * The weeks are a SEPARATE load from the statement this strip is drawn from,
 * and they fail independently. A sparkline is decoration on a figure that
 * stands without it, so `weeks` is nullable here and a null simply draws no
 * spark — the strip must never inherit the week table's failure.
 */
function weeklyRates(
  weeks: Statement[] | null,
  pick: (s: Statement) => number | null,
): number[] | undefined {
  if (weeks === null) return undefined
  const out: number[] = []
  for (const w of weeks) {
    const v = pick(w)
    if (v !== null && Number.isFinite(v)) out.push(v)
  }
  return out.length >= 2 ? out : undefined
}

/** The comparison window's figure for one period — the divisor applied once. */
function perPeriod(value: number | null | undefined, cmp: ComparisonContext): number | null {
  return value == null ? null : value / cmp.divisor
}

/** A percentage-point move against the comparison, or null when there is nothing to compare. */
function moveVs(now: number | null, then: number | null | undefined, cmp: ComparisonContext) {
  if (!cmp.on || now === null || then == null) return null
  // Percentages are NOT divided: a ratio over four weekdays is already a ratio.
  return now - then
}

/* ── The strip ────────────────────────────────────────────────────────── */

/**
 * Five cells, in the prototype's order.
 *
 * Two of them carry a reference and three do not, and that is the true state
 * of this schema rather than an omission: prime cost is judged against
 * `PRIME_CEILING_PCT`, the trade's published benchmark that `prime-cost.ts`
 * owns; food against `Store.targetCogsPct` when the store has set one. Labour,
 * the bottom line and gross sales are judged against nothing, because nothing
 * publishes a number for them.
 */
function buildStrip(
  p: Statement,
  cmp: ComparisonContext,
  targets: StripTargets | null,
  weeks: Statement[] | null,
): StripCell[] {
  const cells: StripCell[] = []
  const c = cmp.on ? cmp.scope : null

  // The three sparked cells, and only those three — the prototype sparks prime,
  // food and labour and leaves the bottom line and gross sales bare. Every rate
  // is read off that week's own `prime`, the same scale the cell above it
  // prints, so the line and the figure cannot be in different units.
  const primeTrail = weeklyRates(weeks, (w) => (laborKnown(w) ? w.prime.primePct : null))
  const foodTrail = weeklyRates(weeks, (w) => w.prime.cogsPct)
  const laborTrail = weeklyRates(weeks, (w) => (laborKnown(w) ? w.prime.laborPct : null))

  const margin = marginPoints(p)
  cells.push({
    label: "Bottom line",
    value: money(p.bottomLine),
    delta: margin === null ? undefined : `${pct(margin, { scaled: true })} of sales`,
    // The prototype compares the two bottom lines RAW (line 5266), which reads
    // a four-occurrence weekday window as four times the money. The divisor
    // belongs on every comparison of dollars, including this one.
    deltaTone:
      c && p.bottomLine < (perPeriod(c.bottomLine, cmp) ?? 0) ? "is-down" : undefined,
  })

  // `p.prime` is `primeCost()` already applied by `statement.ts`, on this
  // statement's own denominator. Nothing here re-derives it (note 60).
  const prime = laborKnown(p) ? p.prime : null
  if (prime?.primePct != null) {
    const move = moveVs(prime.primePct, c?.prime.primePct, cmp)
    cells.push({
      label: "Prime cost",
      value: pct(prime.primePct, { scaled: true }),
      delta: move === null ? undefined : `${points(move)} vs ${cmp.short}`,
      deltaTone: move !== null && move > 0 ? "is-down" : undefined,
      caption: `Ceiling ${pct(prime.ceilingPct, { scaled: true })}`,
      reference: {
        v: prime.primePct,
        target: prime.ceilingPct,
        better: "low",
        label:
          `Prime cost ${pct(prime.primePct, { scaled: true })} against a ` +
          `${pct(prime.ceilingPct, { scaled: true })} ceiling`,
        ...(primeTrail ? { series: primeTrail } : {}),
      },
    })
  }

  const foodPlan = targets?.foodCost ?? null
  if (p.prime.cogsPct !== null) {
    const value = pct(p.prime.cogsPct, { scaled: true })
    const move = moveVs(p.prime.cogsPct, c?.prime.cogsPct, cmp)
    cells.push({
      label: "Food",
      value,
      delta: move === null ? undefined : `${points(move)} vs ${cmp.short}`,
      deltaTone: move !== null && move > 0 ? "is-down" : undefined,
      caption:
        foodPlan?.kind === "target" ? `Target ${pct(foodPlan.value, { scaled: true })}` : undefined,
      reference: referenceFor(p.prime.cogsPct, foodPlan, "low", `Food cost ${value}`, foodTrail),
    })
  }

  if (prime?.laborPct != null) {
    const move = moveVs(prime.laborPct, c?.prime.laborPct, cmp)
    cells.push({
      label: "Labor",
      value: pct(prime.laborPct, { scaled: true }),
      delta: move === null ? undefined : `${points(move)} vs ${cmp.short}`,
      deltaTone: move !== null && move > 0 ? "is-down" : undefined,
      // The dollars, not a band: the prototype's 23.9–26.2% "plus salaried"
      // exists nowhere in this schema, and `targets.labor` is null. If a
      // column ever publishes one, `referenceFor` picks it up here.
      caption: money(p.laborValue),
      // A trajectory with no band under it. `targets.labor` is null and nothing
      // in this schema publishes a labour band, so `isJudged` is false and no
      // bullet is drawn — but the eight weeks CAN be plotted, and throwing the
      // line away because there is no band to judge it against was this cell
      // reporting a data gap it does not have.
      reference: referenceFor(
        prime.laborPct,
        targets?.labor ?? null,
        "low",
        `Labor ${pct(prime.laborPct, { scaled: true })}`,
        laborTrail,
      ),
    })
  }

  const sales = comparisonPhrase(p.grossSales, cmp, cmp.scope?.grossSales ?? null)
  cells.push({
    label: "Gross sales",
    value: money(p.grossSales),
    delta: sales.text,
    deltaTone: sales.tone,
  })

  return cells
}

/* ── The reading ──────────────────────────────────────────────────────── */

/**
 * The sentence an owner would say out loud, derived.
 *
 * It names whichever half of prime cost is actually over — not one chosen when
 * the page was written — because prime can sit under its ceiling while a half
 * of it is over its own, and that is the case most worth saying. It also never
 * says a figure is inside a target that does not exist: with nothing published
 * for either half, it says exactly that instead.
 */
function buildReading(p: Statement, targets: StripTargets | null): ReadingSegment[] {
  const out: ReadingSegment[] = []
  const say = (text: string) => out.push({ text })
  const strong = (text: string) => out.push({ text, strong: true })

  const kept = p.bottomLine >= 0
  strong(`You ${kept ? "kept" : "lost"} ${money(Math.abs(p.bottomLine))}`)
  say(` of ${money(p.grossSales)} over ${p.days} day${p.days === 1 ? "" : "s"} — a margin of `)
  strong(pct(marginPoints(p), { scaled: true }))
  say(".")

  const prime = laborKnown(p) ? p.prime : null
  if (prime?.primePct == null || prime.roomPp == null) {
    // No labour posted against these sales: prime cost has no reading, and the
    // strip has no prime cell either. Saying so is the point.
    say(" Prime cost has no reading for this range, because no labour is posted against these sales.")
    return out
  }

  say(" Prime cost is ")
  strong(pct(prime.primePct, { scaled: true }))
  say(`, ${Math.abs(prime.roomPp).toFixed(1)} points `)
  if (prime.roomPp >= 0) say("under")
  else strong("over")
  say(` the ${PRIME_CEILING_PCT}% ceiling.`)

  const foodPlan = targets?.foodCost ?? null
  const laborPlan = targets?.labor ?? null
  const overs: Array<{ name: string; over: number; against: string }> = []
  let judged = 0

  if (foodPlan?.kind === "target" && prime.cogsPct != null) {
    judged += 1
    if (prime.cogsPct > foodPlan.value) {
      overs.push({
        name: "food",
        over: prime.cogsPct - foodPlan.value,
        against: `its ${pct(foodPlan.value, { scaled: true })} target`,
      })
    }
  }
  if (laborPlan !== null && prime.laborPct != null) {
    judged += 1
    const edge = laborPlan.kind === "band" ? laborPlan.hi : laborPlan.value
    if (prime.laborPct > edge) {
      overs.push({
        name: "labour",
        over: prime.laborPct - edge,
        against: laborPlan.kind === "band" ? "the top of its band" : "its target",
      })
    }
  }

  if (overs.length === 0) {
    say(
      judged === 0
        ? " Neither half of it is judged here: this schema publishes a food-cost target per store and nothing at all for labour."
        : " Every half of it with a published number is inside it.",
    )
    return out
  }

  overs.sort((a, b) => b.over - a.over)
  say(" Inside it, ")
  overs.forEach((o, i) => {
    if (i > 0) say(", and ")
    say(`${o.name} is `)
    strong(`${o.over.toFixed(1)} points over ${o.against}`)
    // Only the worst line is priced: two dollar figures in one sentence and
    // the reader has to work out that they do not add up to the shortfall.
    if (i === 0) say(`, worth ${money((o.over / 100) * p.grossSales)} of this range's margin`)
  })
  say(".")
  return out
}

/* ── The cascade ──────────────────────────────────────────────────────── */

/**
 * Six subtractions, in the statement's own order.
 *
 * The end carries no figure: `Cascade` computes it as `start − Σ cuts`, and
 * `statement.ts` guarantees that IS `bottomLine` because the rollup subtracts
 * exactly these five lines. A cascade that does not reconcile is worse than no
 * cascade, so neither end of it is a caller's to state.
 */
function buildCascade(
  p: Statement,
  targets: StripTargets | null,
  channels: ChannelReading[] | null,
): PnlCascade {
  const orders = channels ? channels.reduce((t, c) => t + c.orders, 0) : null
  const marketplaces = channels ? channels.filter((c) => c.channel !== "house").length : null
  const foodPlan = targets?.foodCost ?? null
  const margin = marginPoints(p)

  return {
    start: {
      name: "Gross sales",
      sub: orders === null ? undefined : `${count(orders)} orders`,
      amount: p.grossSales,
    },
    cuts: [
      {
        name: "Marketplace commissions",
        // The prototype names three platforms and their rates. `Store` carries
        // a rate column for two of them (note the null Grubhub commission in
        // `channel-mix.ts`), so the honest sub is how many marketplaces took a
        // share, not a list of rates two of which would be invented.
        sub:
          marketplaces === null
            ? undefined
            : `${count(marketplaces)} marketplace${marketplaces === 1 ? "" : "s"}`,
        amount: p.commissions,
      },
      {
        name: "Food",
        sub:
          foodPlan?.kind === "target"
            ? `against a ${pct(foodPlan.value, { scaled: true })} target`
            : "no target on file",
        amount: p.cogsValue,
        // The ONE thing that is red, and only when a number was published to
        // be over. `over` on a cut with no target would be colour with no claim.
        over:
          foodPlan?.kind === "target" && p.prime.cogsPct != null
            ? p.prime.cogsPct > foodPlan.value
            : false,
      },
      {
        name: "Labor",
        // Not the prototype's "hourly plus salaried": `computeStorePnL` BLENDS
        // — Harri actuals for the days Harri covers, the store file prorated
        // for the days it does not. It is a substitution, not a sum, and
        // `prime-cost.ts` says so at length.
        sub: "clock-ins where Harri covers, the store file where it does not",
        amount: p.laborValue,
      },
      {
        name: "Occupancy",
        sub: `rent, prorated across ${p.days} day${p.days === 1 ? "" : "s"}`,
        amount: p.occupancy,
      },
      {
        name: "Other operating",
        // The prototype adds packaging at a per-order rate it invented. This
        // line is the rollup's REMAINDER — fixed costs less labour and rent —
        // which is towels, cleaning and any custom fixed line, and no more.
        sub: "towels, cleaning and custom fixed lines",
        amount: p.otherOperating,
      },
    ],
    end: {
      name: "Bottom line",
      sub: margin === null ? undefined : `${pct(margin, { scaled: true })} of sales`,
    },
  }
}

/* ── The statement table ──────────────────────────────────────────────── */

function buildStatement(
  p: Statement,
  cmp: ComparisonContext,
  targets: StripTargets | null,
  channels: ChannelReading[] | null,
): PnlStatement {
  const c = cmp.on ? cmp.scope : null
  const orders = channels ? channels.reduce((t, c2) => t + c2.orders, 0) : null
  const foodPlan = targets?.foodCost ?? null

  /** One cost or subtotal line, against the same line in the comparison window. */
  const line = (
    key: string,
    name: string,
    value: number,
    share: number | null,
    thenShare: number | null | undefined,
    opts: { sub?: string; strong?: boolean; negative?: boolean; act?: number; href?: string } = {},
  ): StatementLine => {
    const move = moveVs(share, thenShare, cmp)
    return {
      key,
      name,
      sub: opts.sub,
      strong: opts.strong,
      // The minus is the drawing's, not `money`'s: `money` brackets a NEGATIVE
      // figure, and these values are positive costs being subtracted.
      amount: `${opts.negative ? "−" : ""}${money(value)}`,
      share: pct(share, { scaled: true }),
      comparison: thenShare == null || !cmp.on ? DASH : pct(thenShare, { scaled: true }),
      change: move === null ? DASH : points(move),
      loud: move !== null && opts.act !== undefined && Math.abs(move) >= opts.act,
      // What that many points is worth at THIS range's volume — the reason the
      // change column is readable at all. A point of a small week is not a
      // point of a big one.
      worth:
        move === null
          ? DASH
          : `${move >= 0 ? "+" : "−"}${money((Math.abs(move) / 100) * p.grossSales)}`,
      href: opts.href,
    }
  }

  const thenGross = perPeriod(c?.grossSales, cmp)
  // Derived here rather than lifted out of `comparisonPhrase`'s sentence: this
  // is a table cell, and a cell reading "no the prior period to compare" is
  // the sentence's words in the wrong place.
  const grossMove =
    thenGross === null || thenGross === 0 ? null : (p.grossSales - thenGross) / thenGross
  const lines: StatementLine[] = [
    {
      key: "gross",
      name: "Gross sales",
      sub: orders === null ? undefined : `${count(orders)} orders`,
      strong: true,
      amount: money(p.grossSales),
      // The denominator of every other row, so it is 100% by definition.
      share: pct(100, { scaled: true }),
      // Gross is the one line whose comparison is DOLLARS: it has no share of
      // itself to move, and the prototype compares it the same way (line 5196).
      comparison: thenGross === null || !cmp.on ? DASH : money(thenGross),
      change: grossMove === null ? DASH : delta(grossMove),
      loud: thenGross !== null && cmp.on && p.grossSales < thenGross,
      worth:
        thenGross === null || !cmp.on
          ? DASH
          : `${p.grossSales >= thenGross ? "+" : "−"}${money(Math.abs(p.grossSales - thenGross))}`,
    },
    line("commissions", "Marketplace commissions", p.commissions, sharePct(p.commissions, p), sharePct(c?.commissions, c), {
      negative: true,
      sub: "what the marketplaces kept",
      href: "/dashboard/analytics",
    }),
    line("net", "Net revenue", p.grossSales - p.commissions, sharePct(p.grossSales - p.commissions, p), c ? sharePct(c.grossSales - c.commissions, c) : null, {
      strong: true,
    }),
    line("food", "Food", p.cogsValue, p.prime.cogsPct, c?.prime.cogsPct, {
      negative: true,
      act: ACT_PTS.food,
      sub: foodPlan?.kind === "target" ? `target ${pct(foodPlan.value, { scaled: true })}` : undefined,
      href: "/dashboard/cogs",
    }),
    line("labor", "Labor", p.laborValue, laborKnown(p) ? p.prime.laborPct : null, c && laborKnown(c) ? c.prime.laborPct : null, {
      negative: true,
      act: ACT_PTS.labor,
      sub: "clock-ins plus the store file",
      href: "/dashboard/labor",
    }),
    line("prime", "Prime cost", p.prime.primeValue, laborKnown(p) ? p.prime.primePct : null, c && laborKnown(c) ? c.prime.primePct : null, {
      strong: true,
      act: ACT_PTS.prime,
      sub: `ceiling ${pct(PRIME_CEILING_PCT, { scaled: true })}`,
    }),
    line("occupancy", "Occupancy", p.occupancy, sharePct(p.occupancy, p), sharePct(c?.occupancy, c), {
      negative: true,
      sub: "rent, prorated",
      href: "/dashboard/stores",
    }),
    line("other", "Other operating", p.otherOperating, sharePct(p.otherOperating, p), sharePct(c?.otherOperating, c), {
      negative: true,
      sub: "towels, cleaning and custom fixed lines",
      href: "/dashboard/stores",
    }),
    line("bottom", "Bottom line", p.bottomLine, marginPoints(p), c ? marginPoints(c) : null, {
      strong: true,
    }),
  ]

  return { lines, comparisonLabel: cmp.on ? cmp.label : null }
}

/**
 * One line as a share of ITS OWN statement's sales, in points.
 *
 * Every ratio on this page divides by the sales in the same statement — the
 * rule note 39 is about. `null` with no denominator, never `0`: a range with
 * no sales has no shares, and `0.0%` for one is a measurement that was not
 * taken.
 */
function sharePct(value: number | null | undefined, of: Statement | null | undefined): number | null {
  if (value == null || of == null || of.grossSales <= 0) return null
  return (value / of.grossSales) * 100
}

/* ── The eight weeks ──────────────────────────────────────────────────── */

/**
 * Each row is the SAME statement over that week — the promise pressing a row
 * keeps.
 *
 * Every percentage comes off that week's own `prime`, which is points, except
 * the margin, which `marginPoints` scales exactly once. Handing `WeekRow` a
 * fraction prints "0.3%" for a 31.4% week; the row types say so and this is
 * the caller they were written for.
 */
function buildWeeks(windows: WeekWindow[], weeks: Statement[]): WeekRow[] {
  return windows.map((window, i) => {
    const s = weeks[i]
    const known = laborKnown(s)
    return {
      window,
      grossSales: s.grossSales,
      cogsPct: s.prime.cogsPct,
      laborPct: known ? s.prime.laborPct : null,
      primePct: known ? s.prime.primePct : null,
      bottomLine: s.bottomLine,
      marginPct: marginPoints(s),
    }
  })
}

/* ── By store ─────────────────────────────────────────────────────────── */

type StoreFile = Awaited<ReturnType<typeof getStores>>[number]

/**
 * Every store, whichever one the page is scoped to.
 *
 * Driven by the store FILES rather than by the rollup, so a store the rollup
 * returned no row for still appears — with no figures, which is the honest
 * reading of "we have no P&L for it" rather than a store silently missing from
 * a table titled "By store". Trading stores first, in the Overview's own order,
 * because `getStores` sorts by name and would otherwise put the stores with no
 * figures above the one with customers.
 */
function buildByStore(files: StoreFile[], rollup: StoreStatement[]): PnlStoreLine[] {
  const byId = new Map(rollup.map((s) => [s.storeId, s]))
  const ordered = [...files].sort((a, b) => {
    const rank = (f: StoreFile) => (isOperational(f) ? 0 : 1)
    return rank(a) - rank(b) || a.name.localeCompare(b.name)
  })

  return ordered.map((f) => {
    const s = byId.get(f.id) ?? null
    const traded = s !== null && s.grossSales > 0
    return {
      id: f.id,
      name: f.name,
      stage: STAGE_FOR[f.lifecycleStage],
      grossSales: traded ? s.grossSales : null,
      primePct: s && laborKnown(s) ? s.prime.primePct : null,
      // The rollup's own prorated rent for this range. Absent when the file
      // carries no rent at all — which is a different thing from $0 of rent,
      // and is the single field that keeps a store out of the statement above.
      fixedOnFile: f.fixedMonthlyRent == null ? null : (s?.occupancy ?? null),
      rentOnFile: f.fixedMonthlyRent != null,
    }
  })
}

/* ── Which empty ──────────────────────────────────────────────────────── */

/**
 * Note 23, decided here rather than by widening `classify`.
 *
 * Three outcomes, and the order matters: a store the account does not own is
 * `no_match` before anything else is asked about it; an account whose stores
 * have all not opened is `pre_open`, which is not a filter problem and has no
 * back-out; a range that simply caught no trade at a store that HAS opened is
 * `no_match`, and widening the range is the way out of it.
 *
 * With the store list unavailable, the lifecycle question cannot be asked at
 * all, so a silent range falls to `no_match` — the reason with a next step the
 * reader can act on either way.
 */
function emptyReasonFor(
  s: Statement,
  files: StoreFile[],
  storeId: string | null,
): EmptyReason | null {
  if (s.storeNotFound) return "no_match"
  const scope = storeId === null ? files : files.filter((f) => f.id === storeId)
  if (scope.length > 0 && !scope.some(isOperational)) return "pre_open"
  if (s.grossSales <= 0) return "no_match"
  return null
}

/* ── The entry point ──────────────────────────────────────────────────── */

export async function getPnlSections(input: PnlSectionsInput): Promise<PnlSections> {
  const { range, storeId, accountId } = input
  const comparisonId: ComparisonId = input.comparisonId ?? "none"
  const today = input.today ?? new Date()
  // Worked out ONCE from the SELECTED range and passed to the comparison load
  // too: a `weekday` window contains four occurrences and would derive
  // "weekly" from itself, which is a comparison of two different things.
  const granularity = granularityFor(range)
  const cmpRange = comparisonId === "none" ? null : comparisonRange(range, comparisonId)
  const windows = trailingWeeks(today, WEEKS_SHOWN)

  const [stmtSd, cmpSd, weeksSd, targetsSd, filesSd, channelsSd] = await Promise.all([
    classify(() => loadStatement({ range, storeId, granularity }), {
      retryAction: "retryStatement",
    }),

    classify<Statement | null>(
      () => (cmpRange ? loadStatement({ range: cmpRange, storeId, granularity }) : Promise.resolve(null)),
      { retryAction: "retryComparison" },
    ),

    /*
     * One statement per week, and deliberately NOT one wide query bucketed
     * weekly. Two reasons, and the second is the one that matters: the
     * rollup's weekly buckets start on SUNDAY while `trailingWeeks` runs
     * Monday to Sunday, so a bucketed read would label a row with one week and
     * fill it with another; and each of these loads uses the same bounds and
     * the same granularity the page will use when that row is PRESSED, which
     * is the same 10-minute cache entry. The row's promise — "these are the
     * figures you will see" — is then true by construction rather than by
     * arithmetic that happens to agree.
     */
    classify(
      () =>
        Promise.all(
          windows.map((w) => loadStatement({ range: { start: w.start, end: w.end }, storeId })),
        ),
      { retryAction: "retryWeeks" },
    ),

    classify(() => loadStripTargets(storeId, accountId), { retryAction: "retryTargets" }),

    classify(() => getStores(), { retryAction: "retryStores" }),

    // Orders, and only orders: the rollup publishes no order count, and the
    // cascade's first line and the statement's first row both name one. Read
    // off the same `OtterDailySummary` rows the Overview's orders come from,
    // so the two pages cannot report different order counts for one range.
    classify(() => loadChannelMix({ range, storeId, accountId }), {
      retryAction: "retryOrders",
    }),
  ])

  const files = dataOf(filesSd) ?? []
  const targets = dataOf(targetsSd)
  const channels = dataOf(channelsSd)

  // ONE decision about what this page is looking at, applied to every section
  // that reads the statement. A section is never left to work out for itself
  // whether zeroes are a reading.
  const scopeSd = mapReadyTo(stmtSd, (s) => {
    const reason = emptyReasonFor(s, files, storeId)
    return reason === null ? ready(s) : empty<Statement>(reason)
  })

  const cmpStatement = dataOf(cmpSd)
  const cmp = comparisonContext(
    comparisonId,
    cmpStatement && !cmpStatement.storeNotFound ? cmpStatement : null,
  )

  return {
    headline: mapReady(scopeSd, (p) => ({
      // `dataOf(weeksSd)`, not the section: the weeks are their own load and
      // fail on their own, and a strip that went blank because its sparklines
      // could not be drawn would be a worse page than one whose three figures
      // are simply bare for a render. Decoration degrades; the figure does not.
      cells: buildStrip(p, cmp, targets, dataOf(weeksSd)),
      reading: buildReading(p, targets),
    })),

    cascade: mapReady(scopeSd, (p) => buildCascade(p, targets, channels)),

    // The weeks are their own load, so they keep their own failure — but they
    // are still this page's statement over eight windows, so an account with
    // nothing to state has nothing to state weekly either.
    weeks: mapReadyTo(scopeSd, () =>
      mapReady(weeksSd, (weeks) => ({
        rows: buildWeeks(windows, weeks),
        foodTargetPct: targets?.foodCost?.kind === "target" ? targets.foodCost.value : null,
      })),
    ),

    statement: mapReady(scopeSd, (p) => buildStatement(p, cmp, targets, channels)),

    // NOT scoped: this section is the one that says which stores exist, so it
    // answers even when the selected store is not one of them. `allStores` is
    // the unfiltered half of the SAME rollup call — see `statement.ts`.
    byStore: mapReady(filesSd, (f) => buildByStore(f, dataOf(stmtSd)?.allStores ?? [])),

    // Note 44. The panel splits every line into measured / prorated / a rate /
    // not yet posted, and that needs a per-line provenance model this schema
    // has nothing for: the rollup reports a labour figure without saying which
    // days Harri covered, and `getInvoiceSummary` reports invoices IN REVIEW,
    // which is not the same set as invoices whose food falls inside this range.
    // Half an answer drawn as a whole panel is exactly what note 44 is about.
    trust: notComputed(
      "a per-line provenance model (which days of labour are clocked and which are prorated) " +
        "and an unposted-food-inside-this-range query — neither exists",
    ),

    // The gap bar names the causes of a food overshoot in POINTS. Nothing in
    // this schema attributes points of a food line to one ingredient: that
    // needs each ingredient's share of food spend over the range against its
    // own price move, and the price monitor publishes the moves without the
    // shares. The plan-versus-actual half is already on the page, in the strip's
    // food cell; a bar whose only segment is "everything else" would add a
    // picture of an explanation to it and no explanation.
    foodCause: notComputed(
      "a cause-attribution model — points of the food gap per ingredient, which needs each " +
        "ingredient's share of spend over the range beside its price move",
    ),
  }
}
