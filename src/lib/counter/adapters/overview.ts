import { cache } from "react"
import { getStores } from "@/app/actions/store/crud-actions"
import { getInvoiceSummary } from "@/app/actions/invoice-actions"
import { getSplhSeries } from "@/app/actions/splh-actions"
import { getAlertInbox } from "@/app/actions/alerts/inbox-actions"
import { getRevenueForecast } from "@/app/actions/forecasts/revenue-forecast-actions"
import { getRatingsSummary } from "@/app/actions/ratings/ratings-actions"
import type { InvoiceKpis } from "@/types/invoice"
import type { LifecycleStage } from "@/generated/prisma/enums"
import { isOperational } from "@/lib/store-lifecycle"
import { foldSplhSeries } from "@/lib/dashboard/splh-fold"
import type { SplhPoint } from "@/lib/splh"
import { COGS_CODE, LABOR_CODE, TOTAL_SALES_CODE, type PnLRow } from "@/lib/pnl"
import { loadChannelMix, type ChannelReading } from "@/lib/counter/channel-mix"
import { loadStripTargets, type StripTargets, type Target } from "@/lib/counter/targets"
import { granularityFor, loadStatement, type Statement } from "@/lib/counter/statement"
import type { Reference } from "@/lib/counter/bullet-state"
import type { ChartSpec } from "@/lib/counter/chart-geometry"
import { count, delta, money, pct, points } from "@/lib/counter/format"
import {
  bucketFor,
  comparisonRange,
  dayCount,
  toQueryBounds,
  type Bucket,
  type ComparisonId,
  type DateRange,
} from "@/lib/counter/date-range"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
import {
  dataOf, empty, mapReady, mapReadyTo, notComputed, ready, type SectionData,
} from "@/lib/counter/section-data"
import {
  comparisonContext,
  comparisonPhrase,
  type ComparisonContext,
} from "@/lib/counter/comparison"
import type {
  ChannelRow,
  DeltaTone,
  FigureProps,
  MoneyLine,
  MovingCell,
  SwitchableStore,
  Tone,
} from "@/components/counter"

/**
 * Overview's data, classified.
 *
 * This is the ONLY new server code the Overview page needs — `npm run tokens`
 * fails a page that imports an action or Prisma directly, so every figure on
 * the page has to arrive through here already resolved into a `SectionData`,
 * shaped exactly the way the page's client island renders it. No mapping from
 * a library's own return type happens outside this file — `.status`
 * inspection is banned everywhere else, so the map from a `PnLRow` to a
 * `ChartSpec` has to live beside the classification, not in the page.
 *
 * Two entry points: `getOverviewStores` loads the account's stores for the
 * `StoreSwitcher` (not itself a `SectionData` — a page always needs SOME
 * store list to render the control, so it fails closed to `[]` the same way
 * `getStores` already does rather than becoming a sixth "control failed to
 * load" state). `getOverviewSections` loads the page's actual sections,
 * concurrently, so a slow P&L rollup does not hold up the alert inbox.
 *
 * ## One rollup per question
 *
 * Note 60 — the same figure reading two ways on two pages — is the defect this
 * file is most exposed to, because the Overview prints twenty-odd numbers that
 * three different rollups could each answer. The rule here:
 *
 * - **Every dollar printed as sales** — the headline, the chart's bars, each
 *   store card, and the denominator of every percent beside them — comes from
 *   ONE `getAllStoresPnL` call, which this file no longer makes itself:
 *   `src/lib/counter/statement.ts` owns it, because the P&L prints the same
 *   dollars and a second page loading them itself is how a BOUNDS difference
 *   gets in upstream of any formula. The headline is `Statement.grossSales`;
 *   the chart is that same statement's `TOTAL_SALES` row, bucket by bucket; a
 *   store card is that store's entry in `perStore`. So the bars sum to the
 *   headline and the cards sum to the headline, by construction rather than by
 *   luck (note 39: a total is the sum of the series drawn beside it).
 * - **Food cost, labour and prime** are the same statement's `cogsValue`,
 *   `laborValue` and `prime` — not `@/lib/cogs`, which reaches the same sales
 *   figure by its own path and would drift the moment either query's bounds
 *   changed.
 * - **Orders, avg ticket and the channel split** come from `loadChannelMix`,
 *   which reads net and orders off the SAME `OtterDailySummary` rows. Task 1's
 *   ruling: the ticket in that table has to be the net in that table over the
 *   orders in that table.
 * - **Sales per labour hour** is `getSplhSeries` and nothing else — the one
 *   function that owns SPLH.
 *
 * ## Where the two target sources meet — READ BEFORE "TIDYING" THIS
 *
 * Five of the six strip figures are judged against nothing, because the schema
 * publishes nothing to judge them against (`loadStripTargets` returns `null`
 * for orders, ticket, labour, prime and marketplace fees, and its module
 * comment says why at length). The sixth, food cost, gets `Store.targetCogsPct`.
 *
 * The prime cell is the exception, and it is deliberate. Its ceiling comes from
 * `primeCost()` in `src/lib/counter/prime-cost.ts`, which exports
 * `PRIME_CEILING_PCT = 60` — food plus labour under 60% of sales is a PUBLISHED
 * INDUSTRY BENCHMARK the trade holds every operator to, not a per-store setting
 * somebody invented for a mockup. That makes it categorically different from
 * the prototype's `$25.10–$26.40` ticket band, which exists nowhere but the
 * prototype. So the prime cell is judged, and its threshold has exactly one
 * owner.
 *
 * **Do not "unify" this by restating 60 in `targets.ts`, and do not delete it
 * from `prime-cost.ts`.** A figure judged against a threshold gets that
 * threshold from one place; for prime cost that place already exists, and
 * `targets.ts` returning `prime: null` means "this module publishes no
 * reference for prime", never "prime has no ceiling".
 *
 * ## Nothing is invented to fill a section
 *
 * A figure the database cannot produce is absent from the cell where it
 * belongs — it never becomes a grey box swallowing the section around it, and
 * it never becomes a zero. `ChannelReading.commission` stays `null` for
 * Grubhub (no rate column exists; `$0` would be the claim it works for free),
 * a channel with no orders keeps a `null` ticket, and a pre-open store card is
 * a DIFFERENT TYPE from a trading one so that it cannot be handed a null net
 * sales figure at all. Note 33 — the em-dash table — is what that type is for.
 */

/* ── The shapes the page's primitives render ──────────────────────────── */

/** One strip cell, exactly `Figure`'s props. `Strip` wraps these. */
export type StripCell = FigureProps

/** A chart, as `chart-geometry` specifies it. `fmt` is the page's — a function cannot cross the RSC boundary. */
export type ChartData = ChartSpec

/**
 * One item of "what needs you".
 *
 * NOT `QueueItem`: that type pairs `act` with an `onAct` HANDLER, and a
 * function is not serialisable across the server/client boundary. Same reason
 * and same shape as `SectionData.failed`'s `retryAction` — the server names
 * the destination, the client island turns the name into behaviour.
 */
export interface QueueEntry {
  key: string
  tone: Tone
  /** The prototype's `i.lead` — already formatted. */
  lead: string
  unit?: string
  title: string
  body: string
  /** Where the reader goes. A route this app actually serves, or absent. */
  href?: string
  actLabel?: string
}

/** The verdict sentence. `Say` renders it. */
export interface Verdict {
  tone: Tone
  headline: string
  body: string
  action?: { label: string; href: string }
}

/**
 * A store that is trading.
 *
 * The union below is the point of this type, not a convenience: a pre-open
 * store is a DIFFERENT SHAPE with no `grossSales`, no `orders`, no `ticket` and
 * no `series`, so no caller can hand one a null sales figure and no renderer
 * can print an em-dash where a figure belongs. Note 33 is precisely the table
 * that did, and a type is a stronger guarantee than a convention.
 */
export interface TradingStoreCard {
  kind: "trading"
  id: string
  name: string
  /**
   * `Store.lifecycleStage`, in the card's vocabulary. `isOperational` is
   * `stage !== "pre_open"`, so a `warming_up` store IS trading and gets this
   * arm — its figures are simply still settling, which the tag says.
   *
   * ONE mapping, in ONE place: `CARD_STAGE_FOR` below is the only translation
   * from `LifecycleStage` into what a Counter surface prints, and the store
   * switcher reads through the same map. Two vocabularies each translated at
   * its own call site is how note 60's two labour figures happened.
   */
  stage: "trading" | "warming_up"
  /**
   * The range's sales, from the same rollup as the page headline.
   *
   * Named `grossSales` because that is what `getAllStoresPnL` calls it and
   * what it holds — net of tax and discounts, GROSS of marketplace
   * commissions, which the cascade subtracts afterwards. It was called
   * `netSales` here while holding exactly that, in a file where
   * `SplhPoint.netSales` is a genuinely different figure. Two numbers, one
   * name, one file: note 60's mechanism precisely. The screen labels still
   * follow the prototype, which itself says "Net sales" on Overview and
   * "Gross sales" on the P&L for this same value (ruling P-R6).
   */
  grossSales: number
  /** The shape behind the figure — the same rollup, bucket by bucket. */
  series: number[]
  /** Pre-formatted: "▲ 4.1% vs the prior period", or "no comparison set". */
  comparison: string
  orders: number
  /** `null` when the store took no orders — never `0`, which claims every order was free. */
  ticket: number | null
  /** `null` when no labour hours were posted for the range. */
  salesPerHour: number | null
  /**
   * Where this store's money came from — one row per channel, for the panel
   * that opens under the card. `loadChannelMix` scoped to this store alone,
   * which is the same call the strip's orders and ticket come from, so a card
   * and the headline cannot disagree about how many orders there were.
   */
  channels: ChannelRow[]
}

/** A store that has not opened. It has no sales figures, so it is given none. */
export interface PreOpenStoreCard {
  kind: "pre_open"
  id: string
  name: string
  /** `Store.openedAt`. Null when nobody has set a date — not a guess. */
  opensOn: Date | null
  /**
   * Which fields of this store's file are still blank. The prototype's card
   * says "Rent is still missing from its store file"; this is that sentence's
   * evidence, and unlike its build-out percentage it is a fact the schema has.
   */
  missingFromFile: string[]
}

export type OverviewStoreCard = TradingStoreCard | PreOpenStoreCard

/**
 * One row of the comparison drill — the prototype's "Every figure against the
 * same 4 weekdays" table (line 4340), which opens under the net-sales chart.
 *
 * **It carries only the figures the comparison rollup actually answers.** The
 * prototype writes six rows; three of them (orders, avg ticket, sales per
 * labour hour) come from loaders this page only ever asks about the SELECTED
 * range — `loadChannelMix` and `getSplhSeries` are never given the comparison
 * window, and giving them one would be two more round trips per page load for
 * a drawer that starts closed. So the table holds net sales, food cost, labour
 * and prime cost, from the one rollup that was already loaded for the dashed
 * line. A row is ABSENT rather than dashed: a table with an em-dash in its
 * "Comparison" column is note 33 in four columns.
 */
export interface ComparisonRow {
  key: string
  figure: string
  /** Pre-formatted, both of them, by the same function. */
  now: string
  then: string
  /** "▲ 4.1%", "▼ 1.3 pts", "flat", or an em-dash when the base is zero. */
  change: string
  /** `true` when the change went the wrong way — the prototype's `cls:'hot'`. */
  bad: boolean
}

/**
 * The guest-ratings tile — the prototype's second box beside Invoices
 * (line 4351).
 *
 * It is NOT scoped to the page's range, and that is deliberate: a review
 * arrives days after the meal, so a one-day range would show an empty tile
 * about a restaurant with hundreds of reviews. `getRatingsSummary` reads its
 * own trailing window and says how long it is, which is what the prototype's
 * own "Last 30 days" caption says while the page above it shows a week.
 */
export interface RatingsTile {
  /**
   * The mean, pre-formatted to one decimal — `"4.6"`. A star average has no
   * formatter in `@/lib/counter/format`, and a page never formats a number, so
   * it is written here. The section is `empty` when nothing was rated, so
   * there is no null for a caller to render.
   */
  average: string
  count: number
  windowDays: number
  /** Reviews at 1–2 stars — the ones an owner has to answer. */
  lowCount: number
}

/** The model's forecast for one day. */
export interface ModelCall {
  date: Date
  predicted: number
  p10: number | null
  p90: number | null
  /** MAPE on the last reconciled window. Null until the pipeline has run. */
  recentMape: number | null
  source: "native" | "transfer"
}

export interface OverviewSectionsInput {
  range: DateRange
  /**
   * Which comparison the reader chose. `"none"` (the default here) draws no
   * dashed line and prints no delta — note 19 cuts both ways, and a delta
   * printed beside "with no comparison" is two lies.
   */
  comparisonId?: ComparisonId
  /** null = every store on the account. */
  storeId: string | null
  /**
   * `loadChannelMix` and `loadStripTargets` need an account, not a store, for
   * the all-stores view — and the adapter cannot fetch its own session.
   * Fetching one here would import `@/lib/auth`, which imports `@/lib/prisma`,
   * which throws at MODULE LOAD without `DATABASE_URL` — that turns "one
   * section is slow" into "the whole page's module fails to import", for every
   * caller, tests included. The page already has this from its own session
   * lookup, the same way `src/app/dashboard/cogs/page.tsx` does.
   */
  accountId: string
}

export interface OverviewSections {
  /** Note 30: net sales says whether the day happened. */
  sales: SectionData<{
    /** See `TradingStoreCard.grossSales` — same figure, same reason for the name. */
    grossSales: number
    comparison: string
    /**
     * How `comparison` should read. Both surfaces put this string in a `.d`
     * that paints `var(--good)` unless it is classed, so an unclassed fall is
     * a fall painted as good news — see `comparisonPhrase`.
     */
    comparisonTone?: DeltaTone
  }>
  /**
   * Note 30's second number — sales per labour hour, which says whether the
   * day was worth having.
   *
   * `getSplhSeries` takes an optional `{ startDate, endDate }` as of Task 1,
   * so this IS scoped to Counter's selected range and is no longer owed. The
   * `floor` is a different matter: no column publishes one. The prototype's
   * `SPLH_FLOOR = 68.00` is its own invention, and `SplhPoint.targetSplh` is
   * the median of the store's own weekday history — the figure judging itself,
   * which is the same defect as the prototype's `ords * 0.92` orders band. So
   * `floor` is `null` until a store file carries one, and `FloorMeter` draws
   * nothing rather than a meter against a number nobody set.
   */
  splh: SectionData<{ value: number; floor: number | null; series: number[] }>
  /** Six cells. Five of them carry no reference at all — see the module note. */
  strip: SectionData<StripCell[]>
  /** The one thing that is wrong, named, with somewhere to go. Derived, never hardcoded. */
  verdict: SectionData<Verdict>
  /** What is still open and therefore not in the figures above. */
  moving: SectionData<MovingCell[]>
  /** From `getAlertInbox`. This was never owed work — the action has been in the tree since F21. */
  needsYou: SectionData<QueueEntry[]>
  salesChart: SectionData<ChartData>
  splhChart: SectionData<ChartData>
  /** Trading and pre-open are different shapes. See `OverviewStoreCard`. */
  stores: SectionData<OverviewStoreCard[]>
  /**
   * The drill under the net-sales chart. `empty` when the reader turned the
   * comparison off — there is nothing to compare, which is a state and not a
   * failure. The page also declines to MOUNT the drill in that case, exactly
   * as `P.overview.desk()`'s own `cmpOn &&` does.
   */
  comparison: SectionData<ComparisonRow[]>
  channels: SectionData<ChannelReading[]>
  /** Money lines, not figures: received, in review, posted. */
  invoices: SectionData<MoneyLine[]>
  /** From `src/app/actions/forecasts/`. Also never owed. */
  modelCall: SectionData<ModelCall>
  /** The prototype's second tile beside Invoices, from `getRatingsSummary`. */
  ratings: SectionData<RatingsTile>
}

/**
 * The ONE place `Store.lifecycleStage` becomes something a Counter surface
 * prints.
 *
 * Two vocabularies existed after Phase B — `StoreSwitcher` took
 * `trading | warming_up | pre_open` and `StoreCards` took
 * `trading | fit_out | pre_open` — and the Overview holds both on one page.
 * `fit_out` turned out to be distinguishable from `pre_open` ONLY by a
 * build-out percentage nothing in this schema measures, so the second
 * vocabulary was removed rather than mapped (see `PreOpenStore`). What is left
 * is this map, which both the switcher and the store cards read.
 */
const CARD_STAGE_FOR: Record<LifecycleStage, SwitchableStore["stage"]> = {
  pre_open: "pre_open",
  warming_up: "warming_up",
  ready: "trading",
}

/**
 * The account's stores, for the `StoreSwitcher`. Fails closed to `[]`, same as
 * `getStores` itself.
 *
 * `cache()`d because it is now asked for TWICE in one request: once by
 * `src/app/dashboard/(counter)/layout.tsx` for the rail's switcher, and again
 * by any page that needs the same list for its own content (the per-store
 * ledger, the orders list's store column). React dedupes the two calls within
 * a request, so hoisting the chrome did not add a query.
 */
export const getOverviewStores = cache(async function getOverviewStores(): Promise<
  SwitchableStore[]
> {
  const stores = await getStores()
  return stores.map((s) => ({ id: s.id, name: s.name, stage: CARD_STAGE_FOR[s.lifecycleStage] }))
})

/* ── Plumbing ─────────────────────────────────────────────────────────── */

const BUCKET_WORD: Record<Bucket, string> = { day: "daily", week: "weekly", month: "monthly" }

/** One P&L row's per-bucket values, as positive magnitudes. Expense rows are stored negative. */
function rowValues(rows: PnLRow[], code: string): number[] | null {
  const row = rows.find((r) => r.code === code)
  return row ? row.values.map((v) => Math.abs(v)) : null
}

/** One P&L row's per-bucket share of sales, as a percent. Expense percents are stored negative. */
function rowPercents(rows: PnLRow[], code: string): number[] | null {
  const row = rows.find((r) => r.code === code)
  return row ? row.percents.map((v) => Math.abs(v) * 100) : null
}

/* ── Sections ─────────────────────────────────────────────────────────── */

/**
 * The six strip cells.
 *
 * A cell is only built when its figure is KNOWN. An unknown figure is left out
 * rather than printed as an em-dash inside a bordered box that looks like a
 * reading — `Strip` sizes itself from `cells.length`, so a five-cell strip is a
 * strip, while a sixth cell reading "—" is note 33 in miniature.
 */
function buildStrip(
  p: Statement,
  channels: ChannelReading[] | null,
  targets: StripTargets | null,
): StripCell[] {
  const cells: StripCell[] = []

  const orders = channels ? channels.reduce((t, c) => t + c.orders, 0) : null
  const channelNet = channels ? channels.reduce((t, c) => t + c.net, 0) : null

  if (orders !== null) {
    cells.push({
      label: "Orders",
      value: count(orders),
      reference: referenceFor(orders, targets?.orders ?? null, "high", `Orders ${count(orders)}`),
    })
  }

  // The ticket in this table over the orders in this table — never the page
  // headline over these orders, which would be two rollups in one quotient.
  if (orders !== null && channelNet !== null) {
    const ticket = orders > 0 ? channelNet / orders : null
    if (ticket !== null) {
      cells.push({
        label: "Avg ticket",
        value: money(ticket, { cents: true }),
        reference: referenceFor(
          ticket,
          targets?.ticket ?? null,
          "high",
          `Avg ticket ${money(ticket, { cents: true })}`,
        ),
      })
    }
  }

  const foodPct = p.grossSales > 0 ? p.cogsPct * 100 : null
  if (foodPct !== null) {
    const plan = targets?.foodCost ?? null
    cells.push({
      label: "Food cost",
      value: pct(foodPct, { scaled: true }),
      caption: plan?.kind === "target" ? `Plan ${pct(plan.value, { scaled: true })}` : undefined,
      delta:
        plan?.kind === "target"
          ? `${(foodPct - plan.value).toFixed(1)} pts vs plan`
          : undefined,
      // `DeltaTone` is `"is-down" | "is-flat"` — there is no "is-up", because
      // the prototype leaves a good delta unclassed and lets it read as ink.
      deltaTone:
        plan?.kind === "target" && foodPct > plan.value ? "is-down" : undefined,
      reference: {
        ...(referenceFor(foodPct, plan, "low", `Food cost ${pct(foodPct, { scaled: true })}`) ?? {
          v: foodPct,
          better: "low" as const,
        }),
        series: rowPercents(p.rows, COGS_CODE) ?? undefined,
      },
    })
  }

  // Zero labour over a range with sales is not something a restaurant
  // produces; it is a store whose labour is neither posted nor configured, and
  // "0.0%" would be the same lie as a $0 Grubhub commission.
  const laborKnown = p.grossSales > 0 && p.laborValue > 0
  const laborPct = laborKnown ? p.laborPct * 100 : null
  if (laborPct !== null) {
    cells.push({
      label: "Labor",
      value: pct(laborPct, { scaled: true }),
      caption: money(p.laborValue),
      reference: {
        ...(referenceFor(laborPct, targets?.labor ?? null, "low", `Labor ${pct(laborPct, { scaled: true })}`) ?? {
          v: laborPct,
          better: "low" as const,
        }),
        series: rowPercents(p.rows, LABOR_CODE) ?? undefined,
      },
    })
  }

  // The one figure judged against a threshold that is NOT in `targets.ts`.
  // See the module note — do not move `PRIME_CEILING_PCT` here or restate it.
  //
  // `p.prime` is `primeCost()` already applied by `statement.ts`, on this same
  // statement's own denominator. `laborKnown` is a decision about the CELL —
  // whether this figure is fit to print — not about the statement, which is
  // why the gate stays here and the arithmetic does not.
  const prime = laborKnown ? p.prime : null
  if (prime?.primePct != null) {
    const cogsSeries = rowPercents(p.rows, COGS_CODE)
    const laborSeries = rowPercents(p.rows, LABOR_CODE)
    cells.push({
      label: "Prime cost",
      value: pct(prime.primePct, { scaled: true }),
      caption: `Ceiling ${pct(prime.ceilingPct, { scaled: true })}`,
      delta: prime.roomPp != null ? `${prime.roomPp.toFixed(1)} pts of room` : undefined,
      reference: {
        v: prime.primePct,
        target: prime.ceilingPct,
        better: "low",
        label:
          `Prime cost ${pct(prime.primePct, { scaled: true })} against a ` +
          `${pct(prime.ceilingPct, { scaled: true })} ceiling`,
        series:
          cogsSeries && laborSeries && cogsSeries.length === laborSeries.length
            ? cogsSeries.map((c, i) => c + laborSeries[i])
            : undefined,
      },
    })
  }

  if (channels) {
    const withRate = channels.filter((c) => c.commission !== null)
    const withoutRate = channels.filter((c) => c.commission === null)
    if (withRate.length > 0) {
      const fees = withRate.reduce((t, c) => t + (c.commission ?? 0), 0)
      cells.push({
        label: "Marketplace fees",
        value: money(fees),
        // Naming what the figure excludes is the honest alternative to
        // folding a channel with no published rate in at zero.
        //
        // SHORT ON PURPOSE. `.strip .band` is a 9px mono line with
        // `white-space:nowrap` (counter-components.css:375), and a strip cell
        // at six tracks is ~168px of content — about 31 characters. The
        // longer form this used to carry, "excludes grubhub — no published
        // rate", is 36 and overflowed the cell's right border. The reason a
        // channel is excluded is on that channel's own row in the store
        // panel ("no commission · keeps $X"); what this figure needs to say
        // is WHAT it left out.
        caption:
          withoutRate.length > 0
            ? `excludes ${withoutRate.map((c) => c.channel).join(", ")}`
            : undefined,
        reference: referenceFor(
          fees,
          targets?.marketplaceFees ?? null,
          "low",
          `Marketplace fees ${money(fees)}`,
        ),
      })
    }
  }

  return cells
}

/** A `Reference` from a published target, or `undefined` when nothing publishes one. */
function referenceFor(
  v: number,
  target: Target,
  better: "low" | "high",
  label: string,
): Reference | undefined {
  if (target === null) return undefined
  if (target.kind === "band") {
    return { v, lo: target.lo, hi: target.hi, better: target.better, label }
  }
  return { v, target: target.value, better: target.better, label }
}

/**
 * The verdict, derived.
 *
 * It compares every figure that HAS a published reference against it, takes the
 * worst breach, and writes the sentence around that one figure. It never
 * hardcodes the prototype's "Ahead, with one problem" — that sentence asserts
 * both that sales are ahead and that exactly one thing is wrong, and neither is
 * knowable in advance.
 *
 * When nothing on the page has a published reference there is no verdict to
 * write, and this returns `not_computed` naming what is missing rather than a
 * cheerful sentence with no evidence behind it.
 */
function buildVerdict(cells: StripCell[]): SectionData<Verdict> {
  const judged = cells.filter(
    (c): c is StripCell & { reference: Reference } =>
      c.reference != null && (c.reference.lo != null || c.reference.target != null),
  )

  if (judged.length === 0) {
    return notComputed(
      "a published target for any headline figure — the schema publishes only Store.targetCogsPct",
    )
  }

  const scored = judged.map((c) => ({ cell: c, over: breachAmount(c.reference) }))
  const breached = scored.filter((s) => s.over > 0).sort((a, b) => b.over - a.over)

  if (breached.length === 0) {
    return ready({
      tone: "good",
      headline: "Everything with a plan is inside it",
      body: `${judged.length} of the figures above are judged against a published number, and every one of them clears it.`,
    })
  }

  const worst = breached[0].cell
  const isFood = worst.label === "Food cost"
  return ready({
    tone: "bad",
    headline: breached.length === 1 ? "One figure is over" : `${breached.length} figures are over`,
    body:
      `${worst.label} is ${worst.value}` +
      (worst.caption ? ` against ${worst.caption.toLowerCase()}` : "") +
      (breached.length === 1
        ? ". Nothing else with a published number is outside it."
        : `, and ${breached.length - 1} more ${breached.length === 2 ? "figure is" : "figures are"} over too.`),
    action: isFood ? { label: "Show me which items", href: "/dashboard/cogs" } : undefined,
  })
}

/** How far past its reference a figure sits, in the direction that is bad. 0 when inside. */
function breachAmount(r: Reference): number {
  const edge = r.target ?? (r.better === "low" ? r.hi : r.lo)
  if (edge == null) return 0
  return r.better === "low" ? Math.max(0, r.v - edge) : Math.max(0, edge - r.v)
}

/** The three "still moving" cells: what the range is, and what is not in the figures yet. */
function buildMoving(
  range: DateRange,
  bucket: Bucket,
  cmp: ComparisonContext,
  p: Statement,
  invoices: InvoiceKpis | null,
  hours: number | null,
): MovingCell[] {
  const cells: MovingCell[] = [
    {
      label: "Range",
      value: `${dayCount(range)} days`,
      note: `${p.periods.length} ${BUCKET_WORD[bucket]} buckets · ${cmp.on ? `vs ${cmp.label}` : "no comparison"}`,
    },
  ]

  if (invoices) {
    cells.push({
      label: "Not in the figures",
      value: money(invoices.pendingReviewTotal),
      note:
        invoices.pendingReviewCount === 0
          ? "Everything received has posted to COGS"
          : `${count(invoices.pendingReviewCount)} invoices in review · COGS understated by this much`,
    })
  }

  if (p.laborValue > 0) {
    cells.push({
      label: "Labor posted",
      value: money(p.laborValue),
      note: hours != null ? `${count(Math.round(hours))} hours bought` : "hours not posted",
    })
  }

  return cells
}

/**
 * The comparison drill's table.
 *
 * Every row comes from the two `getAllStoresPnL` rollups this page already
 * loaded — the selected range's and the comparison's — so the "This range"
 * column is the SAME number as the headline above it, by construction.
 *
 * `divisor` matters here: the `weekday` comparison returns a window CONTAINING
 * four occurrences, so its money has to be divided before it can be read
 * against one period. Its percentages do not — a ratio over four days is
 * already a ratio.
 */
function buildComparison(
  now: Statement,
  then: Statement,
  cmp: ComparisonContext,
): ComparisonRow[] {
  const rows: ComparisonRow[] = []

  const thenSales = then.grossSales / cmp.divisor
  rows.push({
    key: "net",
    figure: "Net sales",
    now: money(now.grossSales),
    then: money(thenSales),
    change: thenSales === 0 ? DASH : delta((now.grossSales - thenSales) / thenSales),
    bad: thenSales > 0 && now.grossSales < thenSales,
  })

  if (now.grossSales > 0 && then.grossSales > 0) {
    rows.push(pointsRow("food", "Food cost", now.cogsPct * 100, then.cogsPct * 100))
  }

  // Same guard as the strip's: zero labour over a range with sales is a store
  // whose labour is not posted, not a store that spent nothing.
  if (now.laborValue > 0 && then.laborValue > 0) {
    rows.push(pointsRow("labor", "Labor", now.laborPct * 100, then.laborPct * 100))

    // Both sides' prime cost came from `statement.ts`, on their own
    // denominators — the same figures the strip above prints.
    if (now.prime.primePct != null && then.prime.primePct != null) {
      rows.push(pointsRow("prime", "Prime cost", now.prime.primePct, then.prime.primePct))
    }
  }

  return rows
}

/** A cost percentage against its own past. Up is the bad direction for all three. */
function pointsRow(key: string, figure: string, now: number, then: number): ComparisonRow {
  const diff = now - then
  return {
    key,
    figure,
    now: pct(now, { scaled: true }),
    then: pct(then, { scaled: true }),
    // `points()` owns both the wording and the flat window — the P&L's change
    // column prints the same movement, and two thresholds is one page calling
    // flat what the other calls a move.
    change: points(diff),
    bad: diff > 0.05,
  }
}

/** The same em-dash `@/lib/counter/format` writes, so this page has one. */
const DASH = "\u2014"

const TONE_FOR_SEVERITY: Record<string, Tone> = {
  CRITICAL: "bad",
  WATCH: "warn",
  INFO: "good",
}

/** How many items of the inbox the Overview shows. The prototype's queue is three. */
const QUEUE_LIMIT = 3

/**
 * `getAlertInbox` → the queue.
 *
 * An `Alert` has no figure of its own — `metadata` holds one for some sources
 * but `getAlertInbox` does not select it — so the lead is the one number every
 * alert genuinely has: how long it has been sitting open. Inventing a
 * percentage to fill the prototype's `18% per lb` slot is exactly what this
 * plan exists to stop.
 */
function buildQueue(
  alerts: Array<{
    id: string
    severity: string
    title: string
    body: string | null
    explanation: string | null
    occurredOn: Date
    storeName: string
  }>,
  today: Date,
): QueueEntry[] {
  return alerts.slice(0, QUEUE_LIMIT).map((a) => {
    const days = Math.max(
      0,
      Math.round((startOfDayUtc(today) - startOfDayUtc(a.occurredOn)) / 86_400_000),
    )
    return {
      key: a.id,
      tone: TONE_FOR_SEVERITY[a.severity] ?? "warn",
      lead: days === 0 ? "today" : String(days),
      unit: days === 0 ? undefined : days === 1 ? "day open" : "days open",
      title: a.title,
      body: a.explanation ?? a.body ?? `${a.storeName} · ${a.severity.toLowerCase()}`,
      // The prototype gives each item its own destination (an invoice, six
      // recipes, the menu). `getAlertInbox` publishes no destination per
      // alert, and guessing one from the title would be a button that opens
      // the wrong page. What every alert DOES have is the inbox it came from,
      // and `/dashboard/alerts` is a route this app serves — one honest
      // destination rather than three invented ones.
      href: "/dashboard/alerts",
      actLabel: "Open in the queue",
    }
  })
}

function startOfDayUtc(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/**
 * Received / in review / posted.
 *
 * The prototype writes a fourth line, "Does not reconcile". `Invoice` does
 * carry `reviewReasons` (the `ReviewReason[]` written by
 * `src/lib/invoice-sanity.ts`, which is where a header-total mismatch is
 * recorded), but `getInvoiceSummary` does not select or aggregate it, and no
 * other existing function does either. So that line is genuinely absent —
 * three real lines, not four with one guessed.
 */
function buildInvoiceLines(k: InvoiceKpis): MoneyLine[] {
  const postedCount = k.invoiceCount - k.pendingReviewCount
  const postedTotal = k.totalSpend - k.pendingReviewTotal
  /*
   * The prototype's order, and the prototype's tones: received, then what
   * reached COGS, then what is still held up. `total` is on NONE of them —
   * `.moneyline.total` is the heavy closing line, and the prototype's is
   * "Does not reconcile", the one figure of the four this schema cannot
   * answer. Promoting "Posted to COGS" into that slot would put a bold
   * closing rule under a line that is not the statement's bottom line.
   */
  return [
    { label: "Received", value: `${count(k.invoiceCount)} · ${money(k.totalSpend)}` },
    { label: "Posted to COGS", value: `${count(postedCount)} · ${money(postedTotal)}` },
    {
      label: "In review",
      value: `${count(k.pendingReviewCount)} · ${money(k.pendingReviewTotal)}`,
      tone: k.pendingReviewCount > 0 ? "warn" : undefined,
    },
  ]
}

/* ── The entry point ──────────────────────────────────────────────────── */

/**
 * The Overview's fifteen sections, as fifteen promises.
 *
 * Task 3 of the streaming-architecture plan, and the page this matters most
 * on: the head figure, the strip, the chart and the store cards all come off
 * one slow P&L rollup, while the alert inbox, the invoice summary, the guest
 * ratings and the model's call are four unrelated queries that used to sit
 * behind it for no reason other than a single `await`.
 *
 * Nothing about WHAT a section holds changed here. What changed is where the
 * awaits are: the loads still all start at once, but each section is now its
 * own promise over only the loads it actually reads, so `Guest ratings` paints
 * when `getRatingsSummary` answers rather than when the statement does.
 *
 * Sections that share a load still share it — `sales`, `strip`, `verdict`,
 * `moving`, `salesChart` and `comparison` are all one `loadStatement`, because
 * a figure shown twice must come from one query or the two will disagree.
 *
 * `getOverviewSections` below is `awaitSections` over this, so there is one
 * implementation and not two.
 */
export function getOverviewSectionPromises(
  input: OverviewSectionsInput,
): StreamedSections<OverviewSections> {
  const { range, storeId, accountId } = input
  const comparisonId: ComparisonId = input.comparisonId ?? "none"
  const bounds = toQueryBounds(range)
  const bucket = bucketFor(range)
  // Worked out ONCE, from the SELECTED range, and passed to both loads below.
  // A `weekday` comparison window contains four occurrences and would derive
  // "weekly" from itself; a weekly series drawn as the dashed reference under
  // daily bars is a chart comparing two different things.
  const granularity = granularityFor(range)
  const cmpRange = comparisonId === "none" ? null : comparisonRange(range, comparisonId)

  /* ── The loads. Every one of them starts here; none is awaited here. ── */

  const storeFilesP = classify(() => getStores(), { retryAction: "retryStores" })

  const stmtP = classify(() => loadStatement({ range, storeId, granularity }), {
    retryAction: "retrySales",
  })

  const cmpStmtP = classify<Statement | null>(
    () =>
      cmpRange ? loadStatement({ range: cmpRange, storeId, granularity }) : Promise.resolve(null),
    { retryAction: "retryComparison" },
  )

  const channelsP = classify(() => loadChannelMix({ range, storeId, accountId }), {
    retryAction: "retryChannels",
    isEmpty: (rows) => rows.length === 0,
  })

  const targetsP = classify(() => loadStripTargets(storeId, accountId), {
    retryAction: "retryTargets",
  })

  const splhP = classify(() => getSplhSeries(bucket === "day" ? "day" : "week", bounds), {
    retryAction: "retrySplh",
    isEmpty: (series) => series.length === 0,
  })

  const invoicesP = classify<InvoiceKpis>(
    () =>
      getInvoiceSummary({
        storeId: storeId ?? undefined,
        startDate: isoDate(bounds.startDate),
        endDate: isoDate(bounds.endDate),
      }),
    { retryAction: "retryInvoices" },
  )

  // NOT owed. `getAlertInbox` has been in the tree since F21 — the previous
  // adapter reported it as unbuilt work against code that already existed.
  const queueP = classify(
    async () => {
      const result = await getAlertInbox({ storeId })
      if (!result.ok) throw new Error("You do not have access to the alert inbox")
      return result.data
    },
    { retryAction: "retryNeedsYou", isEmpty: (d) => d.alerts.length === 0 },
  )

  // Also not owed — `src/app/actions/forecasts/` has shipped for months.
  const forecastP = classify(
    async () => {
      const result = await getRevenueForecast({ storeId: storeId ?? undefined })
      if (result === null) throw new Error("Not signed in")
      if (!result.ok) throw new Error("That store is not on this account")
      return result.data
    },
    { retryAction: "retryModelCall" },
  )

  const ratingsP = classify(
    async () => {
      const summary = await getRatingsSummary({ storeId })
      // Never throws by contract — it returns null for "not signed in" and
      // for a query that failed, and this page must not print an empty tile
      // over a dead ratings sync.
      if (summary === null) throw new Error("Guest ratings could not be read")
      return summary
    },
    { retryAction: "retryRatings", isEmpty: (r) => r.count === 0 },
  )

  /*
   * The one loader that takes another loader's answer as an INPUT: a store
   * card needs that store's own orders, and `loadChannelMix` aggregates rather
   * than grouping, so per-store readings are per-store calls. The store list
   * is a single indexed query on one table — the cheapest thing on the page —
   * and this is now the only thing waiting behind it. Before Task 3 every
   * other load on this page did too.
   */
  const perStoreMixP = storeFilesP.then((storeFilesSd) => {
    const operationalIds = (dataOf(storeFilesSd) ?? [])
      .filter(isOperational)
      .map((s) => s.id)
      .filter((id) => storeId === null || id === storeId)

    return classify(
      async () => {
        const lists = await Promise.all(
          operationalIds.map(async (id) =>
            [id, await loadChannelMix({ range, storeId: id, accountId })] as const,
          ),
        )
        return new Map<string, ChannelReading[]>(lists)
      },
      { retryAction: "retryStoreChannels" },
    )
  })

  /* ── The derivations, each over only the loads it reads. ── */

  // A selected store the rollup has no row for is "loaded, and there is
  // nothing here" — never a silent fall back to the whole account, which is a
  // page answering a question nobody asked. `loadStatement` reports it rather
  // than the adapter re-deriving it from `perStore`.
  const scopeP = stmtP.then((stmtSd) =>
    mapReadyTo(stmtSd, (s) => (s.storeNotFound ? empty<Statement>("no_match") : ready(s))),
  )

  const cmpP = cmpStmtP.then((cmpStmtSd) => {
    const cmpStatement = dataOf(cmpStmtSd)
    return comparisonContext(
      comparisonId,
      cmpStatement && !cmpStatement.storeNotFound ? cmpStatement : null,
    )
  })

  // SPLH is a RATIO, so the account-wide series is total net over total hours
  // per day, not the mean of the per-store ratios. `foldSplhSeries` is the one
  // function that does that; the raw per-store series stays for the cards.
  const splhPointsP = splhP.then((splhSd) => mapReady(splhSd, (series) => foldSplhSeries(series)))

  const stripP = Promise.all([scopeP, channelsP, targetsP]).then(
    ([scopeSd, channelsSd, targetsSd]) =>
      mapReady(scopeSd, (p) => buildStrip(p, dataOf(channelsSd), dataOf(targetsSd))),
  )

  return {
    sales: guardSection(
      Promise.all([scopeP, cmpP]).then(([scopeSd, cmp]) =>
        mapReady(scopeSd, (p) => {
          const reading = comparisonPhrase(p.grossSales, cmp, cmp.scope?.grossSales ?? null)
          return {
            grossSales: p.grossSales,
            comparison: reading.text,
            comparisonTone: reading.tone,
          }
        }),
      ),
      "retrySales",
    ),

    splh: guardSection(
      splhPointsP.then((splhPoints) =>
        mapReadyTo(splhPoints, (points) => {
          const net = points.reduce((t, p) => t + p.netSales, 0)
          const hours = points.reduce((t, p) => t + p.laborHours, 0)
          if (hours <= 0) return empty("no_match")
          return ready({
            value: net / hours,
            // No column publishes a floor. See the doc comment on `splh` above.
            floor: null,
            // A `Spark` cannot draw a gap, so a day with no reading is dropped
            // from the sparkline rather than flattened to zero. The chart below
            // keeps the gap, because a chart can draw one.
            series: points.map((p) => p.splh).filter((v): v is number => v != null),
          })
        }),
      ),
      "retrySplh",
    ),

    strip: guardSection(stripP, "retrySales"),

    verdict: guardSection(
      stripP.then((strip) => mapReadyTo(strip, (cells) => buildVerdict(cells))),
      "retrySales",
    ),

    moving: guardSection(
      Promise.all([scopeP, cmpP, invoicesP, splhPointsP]).then(
        ([scopeSd, cmp, invoicesSd, splhPoints]) => {
          const foldedPoints = dataOf(splhPoints) ?? []
          const hoursTotal =
            foldedPoints.length > 0 ? foldedPoints.reduce((t, p) => t + p.laborHours, 0) : null
          return mapReady(scopeSd, (p) =>
            buildMoving(range, bucket, cmp, p, dataOf(invoicesSd), hoursTotal),
          )
        },
      ),
      "retrySales",
    ),

    needsYou: guardSection(
      queueP.then((queueSd) => mapReady(queueSd, (d) => buildQueue(d.alerts, new Date()))),
      "retryNeedsYou",
    ),

    salesChart: guardSection(
      Promise.all([scopeP, cmpP]).then(([scopeSd, cmp]) =>
        mapReady(scopeSd, (p) => buildSalesChart(p, cmp, range)),
      ),
      "retrySales",
    ),

    splhChart: guardSection(
      splhPointsP.then((splhPoints) => mapReady(splhPoints, (points) => buildSplhChart(points))),
      "retrySplh",
    ),

    stores: guardSection(
      Promise.all([storeFilesP, stmtP, cmpStmtP, cmpP, perStoreMixP, splhP]).then(
        ([storeFilesSd, stmtSd, cmpStmtSd, cmp, perStoreMixSd, splhSd]) =>
          mapReady(storeFilesSd, (files) =>
            buildStoreCards({
              files,
              statement: dataOf(stmtSd),
              cmpStatement: dataOf(cmpStmtSd),
              cmp,
              mixByStore: dataOf(perStoreMixSd) ?? new Map(),
              splhByStore: new Map<string, SplhPoint[]>(
                (dataOf(splhSd) ?? []).map((s) => [s.storeId, s.points]),
              ),
              storeId,
            }),
          ),
      ),
      "retryStores",
    ),

    comparison: guardSection(
      Promise.all([scopeP, cmpP]).then(([scopeSd, cmp]) =>
        mapReadyTo(scopeSd, (p) => {
          // Switched off, or the comparison rollup did not load: nothing to
          // compare, which is a state rather than a failure.
          if (!cmp.on || cmp.scope === null) return empty<ComparisonRow[]>("no_match")
          return ready(buildComparison(p, cmp.scope, cmp))
        }),
      ),
      "retryComparison",
    ),

    channels: guardSection(channelsP, "retryChannels"),

    invoices: guardSection(
      invoicesP.then((invoicesSd) => mapReady(invoicesSd, buildInvoiceLines)),
      "retryInvoices",
    ),

    modelCall: guardSection(
      forecastP.then((forecastSd) =>
        mapReadyTo(forecastSd, (d) => {
          const wanted = isoDate(range.end)
          const day = d.days.find((x) => isoDate(x.date) === wanted)
          // The model writes calls forward, not backward: a range that ended
          // before today has no call to show, and narrowing to a day it does
          // have one for is the way back out.
          if (!day) return empty("no_match")
          return ready({
            date: day.date,
            predicted: day.predictedRevenue,
            p10: day.p10,
            p90: day.p90,
            recentMape: d.recentMape,
            source: day.forecastSource,
          })
        }),
      ),
      "retryModelCall",
    ),

    ratings: guardSection(
      ratingsP.then((ratingsSd) =>
        mapReadyTo(ratingsSd, (r) => {
          // `isEmpty` already caught a window with no reviews; a null average
          // that survives it means the rows carried no rating at all.
          if (r.average === null) return empty<RatingsTile>("no_match")
          return ready({
            average: r.average.toFixed(1),
            count: r.count,
            windowDays: r.windowDays,
            lowCount: r.lowCount,
          })
        }),
      ),
      "retryRatings",
    ),
  }
}

/**
 * The same fifteen sections, awaited.
 *
 * `awaitSections` over the streaming variant rather than a second body: two
 * implementations of "what is in the strip" is how one restaurant ends up with
 * two answers for one day.
 */
export async function getOverviewSections(
  input: OverviewSectionsInput,
): Promise<OverviewSections> {
  return awaitSections(getOverviewSectionPromises(input))
}

/** The net-sales chart: the same rollup as the headline, bucket by bucket. */
function buildSalesChart(p: Statement, cmp: ComparisonContext, range: DateRange): ChartData {
  const values = rowValues(p.rows, TOTAL_SALES_CODE) ?? []
  const cmpValues = cmp.scope ? rowValues(cmp.scope.rows, TOTAL_SALES_CODE) : null
  // A dashed reference only means anything drawn against the same number of
  // buckets. `weekday` returns a window of four occurrences, not an equivalent
  // period, so it gets no line — its comparison is the headline's delta.
  const aligned =
    cmp.on && cmpValues && cmpValues.length === values.length ? cmpValues : null
  const short = dayCount(range) <= 14

  return {
    type: short ? "bars" : "line",
    h: 150,
    labels: p.periods.map((x) => x.label),
    zero: short,
    legend: aligned !== null,
    vs: aligned !== null ? 1 : null,
    vsLabel: `against ${cmp.label}`,
    alt: "Net sales",
    series: [
      { name: "Net sales", color: "var(--ink)", data: values, fill: true, w: 1.9 },
      ...(aligned
        ? [
            {
              name: cmp.short,
              color: "var(--ink-3)",
              data: aligned,
              as: "line" as const,
              dash: true,
              w: 1.5,
            },
          ]
        : []),
    ],
  }
}

/** SPLH over the range. No `rule`, because no column publishes a floor to rule against. */
function buildSplhChart(points: SplhPoint[]): ChartData {
  return {
    type: "line",
    h: 150,
    labels: points.map((p) => p.label),
    alt: "Sales per labour hour",
    series: [{ name: "SPLH", color: "var(--ink)", data: points.map((p) => p.splh), fill: true }],
  }
}

type StoreFile = Awaited<ReturnType<typeof getStores>>[number]

/**
 * The store cards.
 *
 * A store that has opened gets a trading card built from the same rollup as
 * the headline. A store that has not gets a card of a DIFFERENT TYPE, holding
 * the only facts it has: when it is expected to open, and what its store file
 * is still missing. It is given no sales fields at all, so nothing downstream
 * can print an em-dash where a figure belongs.
 */
function buildStoreCards(input: {
  files: StoreFile[]
  /** The page's ONE statement. A card is that store's entry in `perStore`. */
  statement: Statement | null
  cmpStatement: Statement | null
  cmp: ComparisonContext
  /** One reading list per store — `loadChannelMix` scoped to that store alone. */
  mixByStore: Map<string, ChannelReading[]>
  /** `getSplhSeries`' own per-store series, unfolded. */
  splhByStore: Map<string, SplhPoint[]>
  storeId: string | null
}): OverviewStoreCard[] {
  const { files, statement, cmpStatement, cmp, mixByStore, splhByStore, storeId } = input
  const inScope = storeId ? files.filter((f) => f.id === storeId) : files
  /*
   * Trading stores first, in the prototype's own order (Hollywood, then the
   * two in build-out). `getStores` sorts by name, which on this account puts
   * both pre-open stores above the only one with customers — so the first
   * card a reader's eye lands on is the one with no figures on it, and the
   * sparkline that marks the trading card sits third instead of first.
   * Sorting here rather than at the call site keeps it one decision.
   */
  const ordered = [...inScope].sort((a, b) => {
    const rank = (f: StoreFile) => (isOperational(f) ? 0 : 1)
    return rank(a) - rank(b) || a.name.localeCompare(b.name)
  })

  return ordered.map((f): OverviewStoreCard => {
    if (!isOperational(f)) {
      return {
        kind: "pre_open",
        id: f.id,
        name: f.name,
        opensOn: f.openedAt ?? null,
        missingFromFile: missingFromFile(f),
      }
    }

    const row = statement?.perStore.find((s) => s.storeId === f.id) ?? null
    const grossSales = row?.grossSales ?? 0
    const mix = mixByStore.get(f.id) ?? []
    // `CARD_STAGE_FOR` maps `pre_open` too; it cannot reach here, because
    // `isOperational` returned true above.
    const stage =
      CARD_STAGE_FOR[f.lifecycleStage] === "warming_up" ? "warming_up" : "trading"
    const orders = mix.reduce((t, c) => t + c.orders, 0)
    const channelNet = mix.reduce((t, c) => t + c.net, 0)
    const points = splhByStore.get(f.id) ?? []
    const hours = points.reduce((t, p) => t + p.laborHours, 0)
    const splhNet = points.reduce((t, p) => t + p.netSales, 0)

    return {
      kind: "trading",
      id: f.id,
      name: f.name,
      stage,
      grossSales,
      series: row ? rowValues(row.rows, TOTAL_SALES_CODE) ?? [] : [],
      // `.stcard .d` and `.prow` print this one in `var(--ink-2)` with no tone
      // rule of their own, so a store card takes the words and not the class.
      comparison: comparisonPhrase(
        grossSales,
        cmp,
        cmpStatement?.perStore.find((s) => s.storeId === f.id)?.grossSales ?? null,
      ).text,
      orders,
      // Same rule as the strip and as `loadChannelMix` itself: no orders means
      // no average ticket. Zero would claim every order on this store was free.
      ticket: orders > 0 ? channelNet / orders : null,
      salesPerHour: hours > 0 ? splhNet / hours : null,
      // Passed through, not summed: `ChannelRows` wants the net and the order
      // count per channel and works the commission out from the contract rate
      // itself.
      channels: mix.map((c) => ({ id: c.channel, net: c.net, orders: c.orders })),
    }
  })
}

/** Which fields of a store's file are still blank. Facts, not a build-out percentage. */
function missingFromFile(f: StoreFile): string[] {
  const missing: string[] = []
  if (f.fixedMonthlyRent == null) missing.push("Rent")
  if (f.fixedMonthlyLabor == null) missing.push("Labour budget")
  if (f.targetCogsPct == null) missing.push("Food-cost target")
  if (f.openedAt == null) missing.push("Opening date")
  return missing
}

/** `getInvoiceSummary` takes calendar-date strings, not `Date` objects. */
function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}
