import { cache } from "react"
import { getStores } from "@/app/actions/store/crud-actions"
import { getInvoiceSummary } from "@/app/actions/invoice-actions"
import { getSplhSeries } from "@/app/actions/splh-actions"
import { getAlertInbox } from "@/app/actions/alerts/inbox-actions"
import { getRatingsSummary } from "@/app/actions/ratings/ratings-actions"
import type { InvoiceKpis } from "@/types/invoice"
import type { LifecycleStage } from "@/generated/prisma/enums"
import { isOperational } from "@/lib/store-lifecycle"
import { foldSplhSeries } from "@/lib/dashboard/splh-fold"
import { businessQueryDate } from "@/lib/counter/business-date"
import type { SplhPoint } from "@/lib/splh"
import { COGS_CODE, LABOR_CODE, TOTAL_SALES_CODE, type PnLRow } from "@/lib/pnl"
import {
  loadChannelMix,
  loadChannelMixByStore,
  type ChannelReading,
} from "@/lib/counter/channel-mix"
import { addCommission } from "@/lib/counter/commission-core"
import { loadStripTargets, type StripTargets, type Target } from "@/lib/counter/targets"
import {
  granularityFor,
  loadComparisonStatement,
  loadStatement,
  rowValues,
  type Statement,
} from "@/lib/counter/statement"
import { loadLaborWeek, type LaborDay } from "@/lib/counter/labor-week"
import { splhLead, type SplhLead } from "@/lib/counter/splh-lead"
import { hoursText } from "@/lib/counter/schedule-hold"
import { getFeedHealth } from "@/lib/counter/adapters/feed-health"
import type { Reference } from "@/lib/counter/bullet-state"
import type { ChartSpec } from "@/lib/counter/chart-geometry"
import { count, delta, money, pct, plural, points } from "@/lib/counter/format"
import {
  bucketFor,
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
  dataOf, empty, mapReady, mapReadyTo, ready, type SectionData,
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
 *   `laborValue` and `prime` — not recomputed via a separate path.
 *   `src/lib/cogs.ts` used to reach the same sales figure that way; it was
 *   dead code and got deleted, which is exactly the drift this rule guards
 *   against.
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

/**
 * The head figure's reading, built once and read by two sections.
 *
 * `sales` renders it and `verdict` writes a sentence about it, and both used
 * to be free to call `comparisonPhrase` themselves — which is the mechanism
 * behind note 60, in miniature: two callers, one figure, two chances to word
 * a comparison differently. It is derived once in
 * `getOverviewSectionPromises` and handed to both.
 */
export interface SalesReading {
  grossSales: number
  series: number[]
  note: string | null
  comparison: string
  comparisonTone?: DeltaTone
}

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
   * What this store kept after marketplace commission, in dollars.
   *
   * Over the channels that publish a rate and NO OTHERS — the same subset the
   * strip's "Kept after fees" cell is taken on, so the card and the strip
   * cannot disagree. `null` when no channel on this store publishes one, which
   * is a store whose fees are unknown rather than a store that paid none.
   */
  kept: number | null
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
  /**
   * The same mean, unformatted, for the star fill. `average` is a string
   * because a page never formats a number; `Stars` needs the value to clip its
   * fill against, and deriving it back out of the string on the page would be
   * the page doing arithmetic on a figure. Both come off one `r.average`, so
   * the printed mean and the drawn mean cannot disagree.
   */
  averageValue: number
  count: number
  windowDays: number
  /** Reviews at 1–2 stars — the ones an owner has to answer. */
  lowCount: number
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
  /**
   * The page's own clock, from `counterToday()`. Only the alert queue reads
   * it, and only to say how long an alert has been open.
   *
   * It has to come in rather than be taken here. `Alert.occurredOn` is a
   * `@db.Date` holding the LA BUSINESS date; flooring a raw `new Date()` to
   * UTC midnight compares that against the UTC day, and between 00:00 and
   * 08:00 UTC — 4pm to midnight in Los Angeles, dinner service — the UTC day
   * is one ahead. Every alert aged a day early through every evening. Taking
   * the clock from the page also means `COUNTER_TODAY` pins this section for a
   * fidelity run, which it could not before.
   */
  today?: Date
}

export interface OverviewSections {
  /** Note 30: net sales says whether the day happened. */
  /**
   * Note 30: net sales says whether the day happened.
   *
   * `SalesReading` above carries the shape, because the verdict is written
   * from the same object — see its doc comment.
   */
  sales: SectionData<SalesReading>
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
  splh: SectionData<{
    /** Net sales over hours worked, for the range. */
    value: number
    /** "▼ $20.30 vs a usual Sunday", or what to say when there is no usual. */
    detail: string
    detailTone?: DeltaTone
    /**
     * The usual range, drawn as a band at lead scale.
     *
     * A BAND, never a target, and the word over it is always "usual" — see the
     * two-references note in `src/lib/counter/splh-lead.ts`. `null` when no day
     * in the range has enough weekday history behind it, in which case the
     * figure is printed with nothing drawn against it rather than against a
     * number nobody set.
     */
    reference: Reference | null
    /** "74.0 h worked · 4.0 h over the 70.0 h published · $82 of labor". */
    caption: string
    series: number[]
  }>
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
  /** The prototype's second tile beside Invoices, from `getRatingsSummary`. */
  ratings: SectionData<RatingsTile>
  /**
   * What feeds the figures above, and how fresh each one is.
   *
   * Every number on this page is a quotient of two syncs on different
   * schedules, and when one stops the page does not go blank — it goes subtly
   * wrong. See `adapters/feed-health.ts` for why an Overview carries this.
   */
  feeds: SectionData<MoneyLine[]>
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
 *
 * ## The order is the owner's, not the ledger's
 *
 * Orders, ticket, LABOR, food, prime, kept. Labour sits third rather than
 * fourth because the second lead figure above it is sales per labor hour, and
 * the two figures a reader is being asked to hold together should not have the
 * food cost between them.
 *
 * ## Why the last cell is what is KEPT and not what was PAID
 *
 * It used to print "Marketplace fees · $1,600", which is a number an owner can
 * do nothing with on its own — $1,600 of fees is fine on $40,000 and ruinous
 * on $6,000. The share kept is the same fact with its denominator attached,
 * and the dollars are still printed, in the delta slot, where they now qualify
 * a ratio instead of standing alone.
 *
 * It is computed over the channels that publish a rate and NO OTHERS, so the
 * percentage is exact for what it covers rather than approximately right for
 * everything. The caption names what was left out — a `$0` commission for
 * Grubhub would be the claim that it works for free.
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
      arrive: { value: orders, as: "count" },
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
        arrive: { value: ticket, as: "moneyCents" },
        reference: referenceFor(
          ticket,
          targets?.ticket ?? null,
          "high",
          `Avg ticket ${money(ticket, { cents: true })}`,
        ),
      })
    }
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
      arrive: { value: laborPct, as: "pct" },
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

  /*
   * Zero COGS over a range with sales is not a kitchen that bought nothing.
   * It is a range whose `DailyCogsItem` rows have not materialised — a state
   * `getAllStoresPnL` already logs a warning for, on exactly this test
   * (`rowCountPerPeriod[i] === 0 && totalSales[i] > 0`) — and "0.0%" for it is
   * the same lie as a $0 Grubhub commission.
   *
   * The labour cell below has guarded this since it was written; food never
   * did. So a range with no COGS posted printed a perfect 0.0% food cost with
   * a green bullet against the store's plan, and a prime cost of labour alone
   * — roughly 25% where the truth is nearer 55% — sitting comfortably under
   * the 60% ceiling with "5.0 pts of room". Both readings are wrong in the
   * flattering direction, which is the direction nobody investigates.
   *
   * Rounded once, at the figure — the delta beside a printed 28.4 must be
   * derivable from 28.4, the same rule primeCost() applies to roomPp.
   */
  const foodKnown = p.grossSales > 0 && p.cogsValue > 0
  const foodPct = foodKnown ? Math.round(p.cogsPct * 1000) / 10 : null
  if (foodPct !== null) {
    const plan = targets?.foodCost ?? null
    cells.push({
      label: "Food cost",
      value: pct(foodPct, { scaled: true }),
      arrive: { value: foodPct, as: "pct" },
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

  // The one figure judged against a threshold that is NOT in `targets.ts`.
  // See the module note — do not move `PRIME_CEILING_PCT` here or restate it.
  //
  // `p.prime` is `primeCost()` already applied by `statement.ts`, on this same
  // statement's own denominator. `laborKnown` is a decision about the CELL —
  // whether this figure is fit to print — not about the statement, which is
  // why the gate stays here and the arithmetic does not.
  // Prime is food PLUS labour, so it needs both halves to be real. It was
  // gated on labour alone, which let a missing COGS line through as a zero and
  // printed the sum of one of its two terms as though it were the sum.
  const prime = laborKnown && foodKnown ? p.prime : null
  if (prime?.primePct != null) {
    const cogsSeries = rowPercents(p.rows, COGS_CODE)
    const laborSeries = rowPercents(p.rows, LABOR_CODE)
    cells.push({
      label: "Prime cost",
      value: pct(prime.primePct, { scaled: true }),
      arrive: { value: prime.primePct, as: "pct" },
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
    // MARKETPLACE channels only. In-house carries a commission of 0, and
    // counting it diluted the ratio with sales no marketplace touched: a store
    // half in-house read "89% kept" when the marketplaces were keeping 25%.
    const market = channels.filter((c) => c.channel !== "house")
    const withRate = market.filter((c) => c.commission !== null)
    const withoutRate = market.filter((c) => c.commission === null)
    const rated = withRate.reduce((t, c) => t + c.net, 0)
    if (withRate.length > 0 && rated > 0) {
      const fees = withRate.reduce((t, c) => t + (c.commission ?? 0), 0)
      const keptPct = ((rated - fees) / rated) * 100
      const basis = addCommission(
        withRate.flatMap((c) => (c.commissionBasis ? [c.commissionBasis] : [])),
      )
      const estPct = basis.orders > 0 ? Math.round((basis.ordersEstimated / basis.orders) * 100) : 0
      cells.push({
        label: "Kept after fees",
        value: pct(keptPct, { scaled: true }),
        arrive: { value: keptPct, as: "pct" },
        // The dollars, in the slot that qualifies the ratio. `is-flat`
        // because it is a denominator, not a movement — `.strip .d` with no
        // tone class paints `var(--good)`, which would report the money
        // leaving as good news.
        delta: `${money(fees)} to marketplaces`,
        deltaTone: "is-flat",
        // SHORT ON PURPOSE. `.strip .band` is a 9px mono line with
        // `white-space:nowrap` (counter-components.css:382), and a strip cell
        // at six tracks is ~168px of content — about 31 characters. The
        // reason a channel is excluded is on that channel's own row in the
        // store panel ("no commission · keeps $X"); what this figure needs to
        // say is WHAT it left out.
        caption:
          withoutRate.length > 0
            ? `excludes ${withoutRate.map((c) => c.channel).join(", ")}`
            : estPct > 0
              ? `of 3P sales · ${estPct}% est.`
              : "of marketplace sales",
        /*
         * NO REFERENCE, deliberately, and `targets.marketplaceFees` is not
         * quietly reused here.
         *
         * That target — which `targets.ts` publishes as `null` anyway — would
         * be a ceiling on DOLLARS PAID, carrying `better: "low"`. This cell is
         * a share KEPT, where low is the bad direction. Handing one to the
         * other would draw a meter that calls a good week a breach, which is
         * worse than drawing none.
         */
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
 * The verdict, derived — and it reads the SCHEDULE first.
 *
 * ## Why the schedule leads
 *
 * This page has two kinds of reference and they are not equal. A published
 * schedule (`HarriShift`) is a PLAN: the store wrote down, before the week
 * happened, how many hours it intended to buy. Everything else on the page is
 * either a trade benchmark (prime cost's ceiling), a store setting
 * (`Store.targetCogsPct`) or a description of the store's own history. Only
 * the first is a promise somebody made, so only the first can be broken — and
 * "over the published schedule" is the sentence an owner can act on this
 * afternoon, which is the whole job of a verdict.
 *
 * So the order is: the schedule if there is one, then the worst breach among
 * the figures that carry a published reference, then nothing.
 *
 * It never hardcodes the prototype's "Ahead, with one problem" — that sentence
 * asserts both that sales are ahead and that exactly one thing is wrong, and
 * neither is knowable in advance.
 *
 * When there is neither a schedule nor a published reference there is no
 * verdict to write, and this returns `not_computed` naming what is missing
 * rather than a cheerful sentence with no evidence behind it.
 */
function buildVerdict(
  cells: StripCell[],
  lead: SplhLead | null,
  /**
   * The head figure's own reading, so that a range with no labour and no
   * published target still has a sentence to write. Same object the `sales`
   * section is built from — not a second `comparisonPhrase` call, so the
   * verdict and the figure above it cannot word one comparison two ways.
   */
  sales: SalesReading,
): SectionData<Verdict> {
  const judged = cells.filter(
    (c): c is StripCell & { reference: Reference } =>
      c.reference != null && (c.reference.lo != null || c.reference.target != null),
  )
  const scored = judged.map((c) => ({ cell: c, over: breachAmount(c.reference) }))
  const breached = scored.filter((s) => s.over > 0).sort((a, b) => b.over - a.over)

  /*
   * The second sentence, and it is the same one whichever headline is above
   * it: what the hours returned, against what these weekdays usually return.
   * Absent when there is no usual to compare with, rather than padded.
   */
  const returned =
    lead === null
      ? ""
      : lead.usual === null
        ? ` An hour of labor returned ${money(lead.value, { cents: true })}.`
        : ` An hour of labor returned ${money(lead.value, { cents: true })}, where these ` +
          `weekdays usually return ${money(lead.usual, { cents: true })}.`

  /* The worst breach, worded once and appended to whichever headline won. */
  const worstSentence = (() => {
    if (breached.length === 0) return ""
    const worst = breached[0].cell
    return (
      ` ${worst.label} is ${worst.value}` +
      (worst.caption ? ` against ${worst.caption.toLowerCase()}` : "") +
      (breached.length === 1
        ? "."
        : `, and ${breached.length - 1} more ${breached.length === 2 ? "figure is" : "figures are"} over too.`)
    )
  })()

  const toLabor = { label: "Open the week in Labor", href: "/dashboard/labor" }
  const toCogs = { label: "Show me which items", href: "/dashboard/cogs" }
  const worstIsFood = breached.length > 0 && breached[0].cell.label === "Food cost"

  /*
   * The schedule's own reading, computed whether or not it ends up leading.
   *
   * The tones are the LABOR PAGE's tones, taken deliberately: an overrun
   * schedule is `warn` and an unpublished one is `warn` there, and two pages
   * painting one fact different colours is note 60 in the palette. What this
   * page decides for itself is only which sentence goes FIRST.
   */
  const schedule: { tone: Tone; headline: string; sentence: string } | null = (() => {
    if (lead === null) return null
    if (lead.scheduled === null || lead.gap === null) {
      return {
        tone: "warn",
        headline: "No published schedule",
        sentence:
          `${hoursText(lead.hours)} were worked over this range and no shift is published for ` +
          `it, so the hours are not read against a plan — the only plan there is to read them ` +
          `against is the schedule the store publishes for itself.`,
      }
    }
    if (lead.held) {
      return {
        tone: "good",
        headline: "On the published schedule",
        sentence:
          `${hoursText(lead.hours)} worked against ${hoursText(lead.scheduled)} published — ` +
          `the schedule held.`,
      }
    }
    const over = lead.gap > 0
    const priced = lead.gapCost === null ? "" : `, about ${money(lead.gapCost)} of labor`
    return {
      tone: over ? "warn" : "good",
      headline: over ? "Over the published schedule" : "Under the published schedule",
      sentence:
        `${hoursText(lead.hours)} worked against ${hoursText(lead.scheduled)} published — ` +
        `${hoursText(Math.abs(lead.gap))} ${over ? "over" : "under"}${priced}.`,
    }
  })()

  const breachHeadline =
    breached.length === 1 ? "One figure is over" : `${breached.length} figures are over`

  /*
   * WHICH SENTENCE LEADS.
   *
   * A breached figure is `bad` — it is over a number somebody published, and
   * `Say` paints the headline in the tone. A schedule that ran over is `warn`.
   * So the breach takes the headline when there is one, and the schedule takes
   * it otherwise; the body carries BOTH either way, in the order the reader
   * would ask about them. A `warn` headline over a `bad` tone would be `Say`
   * saying two things at once, which is the one thing a verdict may not do.
   */
  if (schedule !== null) {
    const led = breached.length > 0
    return ready({
      tone: led ? "bad" : schedule.tone,
      headline: led ? breachHeadline : schedule.headline,
      body: led
        ? `${worstSentence.trimStart()} ${schedule.sentence}${returned}`
        : `${schedule.sentence}${returned}${worstSentence}`,
      // A food breach has a page of its own that answers "which items"; the
      // schedule's destination is the week it was published for.
      action: led && worstIsFood ? toCogs : toLabor,
    })
  }

  /*
   * Past the schedule block, `lead` is null — no hours are posted for this
   * range — because `schedule` is built whenever `lead` is not. So everything
   * below answers one question: what can be said about a range whose labour
   * half has not arrived?
   */
  if (judged.length === 0) {
    /*
     * Nothing to judge: no hours, so no schedule to read them against, and no
     * figure carrying a published reference either.
     *
     * TWO THINGS THIS IS NOT, and both were tried.
     *
     * It is not `notComputed("a published target for any headline figure —
     * the schema publishes only Store.targetCogsPct…")`. `Owed` renders
     * "designed, not yet built", and this verdict IS built — it is unfed; and
     * the sentence named a Prisma column to a restaurant owner.
     *
     * It is not `empty("no_labor_synced")` either, and that one is worth
     * recording because it LOOKED right. The sales-per-labor-hour figure two
     * columns to the left is already in that state, and `Empty` writes one
     * paragraph per reason — so the head block printed the identical
     * "Labor has not synced. Sales are here, but the hours to divide them
     * by…" twice, side by side, in a block whose whole job is to say ONE
     * thing.
     *
     * What is left when the labour half is missing is still a real verdict:
     * sales happened, and the comparison says whether they were good. So the
     * sentence is about sales, and it closes by naming the half that is
     * absent — once.
     */
    const down = sales.comparisonTone === "is-down"
    const noComparison = sales.comparisonTone === "is-flat"
    const missing =
      lead === null
        ? " No hours are posted for this range, so nothing here is read against a plan — " +
          "sales and labor arrive on separate syncs, and the labor one has not run."
        : ""
    return ready({
      tone: down ? "warn" : noComparison ? "warn" : "good",
      headline: noComparison
        ? "Sales, with nothing to read them against"
        : down
          ? "Sales are down on the comparison"
          : "Sales are up on the comparison",
      body: `${money(sales.grossSales)}, ${sales.comparison}.${missing}`,
    })
  }

  if (breached.length === 0) {
    return ready({
      tone: "good",
      headline: "Everything with a plan is inside it",
      body: `${judged.length} of the figures above are judged against a published number, and every one of them clears it.`,
    })
  }

  return ready({
    tone: "bad",
    headline: breachHeadline,
    body: worstSentence.trimStart(),
    action: worstIsFood ? toCogs : undefined,
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
  /*
   * NO "Range" CELL, and its absence is the point.
   *
   * It printed "7 days · 7 daily buckets · vs the same 4 weekdays" — which the
   * page title says, the sub-line under the title says, the date control on
   * the right says, and the net-sales chart's own meta says. Four statements
   * of one fact, and the fourth was inside the loudest element on the page:
   * `.moving` is a signal-coloured band, and the design's own note is that it
   * is for what is STILL MOVING and therefore not in the figures above. A
   * range is not moving.
   */
  const cells: MovingCell[] = []

  if (invoices && invoices.pendingReviewCount > 0) {
    // Only when something is actually held. "$0 · everything received has
    // posted to COGS" is good news drawn in the colour of a warning, in a band
    // that exists to say what is missing from the figures.
    cells.push({
      label: "Not in the figures",
      value: money(invoices.pendingReviewTotal),
      note: `${plural(invoices.pendingReviewCount, "invoice")} in review · COGS understated by this much`,
    })
  }

  if (p.laborValue > 0) {
    cells.push({
      label: "Labor posted",
      value: money(p.laborValue),
      note: hours != null ? `${plural(Math.round(hours), "hour")} bought` : "hours not posted",
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
    // `<= 0`: a comparison window below zero inverts the sign, so a rise
    // prints as a fall. Same guard as `comparisonPhrase` and the P&L's cell.
    change: thenSales <= 0 ? DASH : delta((now.grossSales - thenSales) / thenSales),
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
 * The queue: what needs the reader, derived and ingested, in that order of
 * urgency and not in that order of source.
 *
 * ## Two labour items the page can derive for itself
 *
 * `getAlertInbox` is an INGESTED list — a nightly job writes rows and this
 * reads them. Two of the things most worth a reader's afternoon are not in it
 * and never will be, because they are not events: hours running past the
 * schedule the store published, and an hour of labour returning less than
 * these weekdays usually return. Both are already computed for the head block
 * above, both are priced, and both point at a page this app serves. Deriving
 * them here costs nothing and no cron has to remember to.
 *
 * They are DERIVED, not invented: every figure in them comes from `splhLead`,
 * which comes from the same two loads the lead figure is drawn from, so a
 * queue item and the figure above it cannot disagree.
 *
 * ## The order, and why it is not simply "derived first"
 *
 * A `CRITICAL` alert is somebody's explicit judgement that this needs a person
 * now; a derived labour item is this page noticing something. So criticals
 * lead, the two derived items come next, and the rest of the inbox follows.
 * The list is then cut to `QUEUE_LIMIT`, which is where a genuinely quiet
 * `WATCH` row is the thing that falls off — the right one to lose.
 *
 * An `Alert` has no figure of its own — `metadata` holds one for some sources
 * but `getAlertInbox` does not select it — so its lead is the one number every
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
  lead: SplhLead | null,
): QueueEntry[] {
  const fromAlert = (a: (typeof alerts)[number]): QueueEntry => {
    // Both sides in the @db.Date encoding: UTC midnight of an LA business
    // date. `occurredOn` already is one; `today` becomes one here.
    const days = Math.max(
      0,
      Math.round((businessQueryDate(today).getTime() - a.occurredOn.getTime()) / 86_400_000),
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
  }

  const critical = alerts.filter((a) => a.severity === "CRITICAL").map(fromAlert)
  const rest = alerts.filter((a) => a.severity !== "CRITICAL").map(fromAlert)

  return [...critical, ...laborQueue(lead), ...rest].slice(0, QUEUE_LIMIT)
}

/**
 * The two items the head block's own figures already prove.
 *
 * Each one is emitted only when the reading it is about is genuinely outside
 * where it should be — `scheduleHeld` decides the first (the same predicate
 * the Labor page's verdict uses, so the two pages cannot call the same week
 * different things) and the published `SPLH_TOLERANCE` band decides the
 * second. A queue that fills up every day with "the schedule was 20 minutes
 * out" is a queue nobody opens.
 */
function laborQueue(lead: SplhLead | null): QueueEntry[] {
  if (lead === null) return []
  const items: QueueEntry[] = []

  if (lead.gap !== null && lead.scheduled !== null && lead.held === false && lead.gap > 0) {
    const priced = lead.gapCost === null ? "" : `, about ${money(lead.gapCost)} at the blended rate`
    items.push({
      key: "labor-over-schedule",
      tone: "warn",
      lead: hoursText(lead.gap),
      unit: "over schedule",
      title: "Hours ran past the schedule the store published",
      body:
        `${hoursText(lead.hours)} worked against ${hoursText(lead.scheduled)} published${priced}. ` +
        `The schedule is the only plan these hours are read against, and this range did not hold it.`,
      href: "/dashboard/labor",
      actLabel: "Open the week in Labor",
    })
  }

  if (lead.outsideUsual && lead.vsUsual !== null && lead.vsUsual < 0 && lead.usual !== null) {
    items.push({
      key: "splh-under-usual",
      tone: "warn",
      lead: money(lead.value, { cents: true }),
      unit: "per hour",
      title: "Sales per labor hour is under what these weekdays usually return",
      body:
        `${money(lead.value, { cents: true })} against a usual ${money(lead.usual, { cents: true })} — ` +
        `${money(Math.abs(lead.vsUsual), { cents: true })} less for every hour worked. ` +
        `The staffing curve is where the hours that did it are.`,
      href: "/dashboard/labor",
      actLabel: "See the staffing curve",
    })
  }

  return items
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
  const today = input.today ?? new Date()
  const comparisonId: ComparisonId = input.comparisonId ?? "none"
  const bounds = toQueryBounds(range)
  const bucket = bucketFor(range)
  // Worked out ONCE, from the SELECTED range, and passed to both loads below.
  // A `weekday` comparison window contains four occurrences and would derive
  // "weekly" from itself; a weekly series drawn as the dashed reference under
  // daily bars is a chart comparing two different things.
  const granularity = granularityFor(range)

  /* ── The loads. Every one of them starts here; none is awaited here. ── */

  const storeFilesP = classify(() => getStores(), { retryAction: "retryStores" })

  const stmtP = classify(() => loadStatement({ range, storeId, granularity }), {
    retryAction: "retrySales",
  })

  // `loadComparisonStatement`, not `loadStatement(comparisonRange(...))`: a
  // `weekday` comparison is FOUR windows, and loading their contiguous hull as
  // one window read a single day against five and a half days of trade.
  const cmpStmtP = classify<Statement | null>(
    () => loadComparisonStatement({ range, mode: comparisonId, storeId, granularity }),
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
    /*
     * NO SERIES AT ALL means the labour sync has not written a row for this
     * scope — `getSplhSeries` returns one series per store that has ANY hours,
     * so an empty array is "nobody's hours are in this database", never "the
     * reader picked a quiet range".
     *
     * The reason matters because `Empty` renders one sentence per reason and
     * `no_match`'s is "widen the filters and date range" — unfollowable advice
     * on a range that is already right, and the exact defect `no_delivery` was
     * split off `no_match` to stop. `isEmpty` fires ahead of every derivation
     * below, so the reason has to be right HERE; naming it downstream is too
     * late.
     */
    isEmpty: (series) => series.length === 0,
    emptyReason: "no_labor_synced",
  })

  /*
   * The published schedule, and the hours actually worked against it.
   *
   * `loadLaborWeek` is the Labor page's own loader, not a second reading of
   * the same tables — the rule CLAUDE.md states as judgment the linter cannot
   * check. It takes any `DateRange`, not only a week, and it is `cached` under
   * its own key with `harri` and the range's otter tags, so the Labor page and
   * this one share the fold rather than each folding it.
   *
   * `salesByDay` is only used for its per-day labour PERCENTAGE, which this
   * page reads off the statement instead; an empty map leaves `LaborDay
   * .laborPct` null and costs nothing. Threading the statement in would make
   * this load wait on the P&L rollup, which is the slowest thing on the page
   * and the whole reason Task 3 unpicked the awaits.
   */
  const laborP = classify(
    () => loadLaborWeek({ range, storeId, accountId, salesByDay: new Map<string, number>() }),
    { retryAction: "retryLabor", isEmpty: (d) => d.days.every((x) => x.actualHours === 0) },
  )

  /*
   * What feeds the figures, and how fresh each one is. One grouped query,
   * cached a minute alongside the shell's own status — it sits under the fold
   * on a page that already makes a dozen round trips.
   */
  const feedsP = storeFilesP.then((storeFilesSd) =>
    classify(
      () =>
        getFeedHealth({
          accountId,
          storeIds: (dataOf(storeFilesSd) ?? []).map((f) => f.id),
        }),
      { retryAction: "retryFeeds" },
    ),
  )

  const invoicesP = classify<InvoiceKpis>(
    () =>
      getInvoiceSummary({
        storeId: storeId ?? undefined,
        startDate: isoDate(bounds.startDate),
        endDate: isoDate(bounds.endDate),
      }),
    {
      retryAction: "retryInvoices",
      /*
       * Three lines all reading "0 · $0" is not a reconciliation; it is an
       * empty state drawn as a statement. `nothing_received` is the reason
       * written for exactly this — nothing has arrived in the window this
       * section watches — and it is the one the Invoices page itself uses.
       */
      isEmpty: (k) => k.invoiceCount === 0,
      emptyReason: "nothing_received",
    },
  )

  // NOT owed. `getAlertInbox` has been in the tree since F21 — the previous
  // adapter reported it as unbuilt work against code that already existed.
  const queueP = classify(
    async () => {
      const result = await getAlertInbox({ storeId })
      if (!result.ok) throw new Error("You do not have access to the alert inbox")
      return result.data
    },
    {
      retryAction: "retryNeedsYou",
      /*
       * An empty inbox is ALL CLEAR, not "nothing matched". `no_match`'s copy
       * is "widen the filters and date range", and this section has no date
       * range to widen — the inbox is not scoped to one. `all_clear` says the
       * true thing: every line here is accounted for.
       *
       * The section can still come out non-empty after this: the page derives
       * two labour items of its own, and the combined list is what actually
       * decides. See `buildQueue`.
       */
      isEmpty: (d) => d.alerts.length === 0,
      emptyReason: "all_clear",
    },
  )

  const ratingsP = classify(
    async () => {
      const summary = await getRatingsSummary({ storeId })
      // Never throws by contract — it returns null for "not signed in" and
      // for a query that failed, and this page must not print an empty tile
      // over a dead ratings sync. It no longer returns null for an account
      // with no reviews, which is why `isEmpty` below is now reachable: that
      // case used to arrive here as a failure and put a red `!` and "Guest
      // ratings did not load" on the Overview of every restaurant nobody had
      // reviewed yet, on every load.
      if (summary === null) throw new Error("Guest ratings could not be read")
      return summary
    },
    { retryAction: "retryRatings", isEmpty: (r) => r.count === 0, emptyReason: "no_reviews" },
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
        /*
         * ONE query for every store, not one per store.
         *
         * This used to map `loadChannelMix` over `operationalIds` — 2 queries
         * each, uncached, 2N for the section — on the stated grounds that
         * "loadChannelMix aggregates rather than grouping". Half true: the SQL
         * always ended `GROUP BY "storeId", "platform"`; only the JS fold threw
         * the store away. `loadChannelMixByStore` keeps the rows partitioned
         * and folds each store separately, through the same `foldToChannels`
         * the account-wide reading uses, so the figures are identical by
         * construction rather than by two implementations agreeing.
         *
         * A selected store narrows this the same way it narrows everything
         * else; `storeId` is already applied to `operationalIds` above, so
         * passing null here would widen the section past the page's scope.
         */
        const all = await loadChannelMixByStore({ range, storeId, accountId })
        return new Map<string, ChannelReading[]>(
          operationalIds.map((id) => [id, all.get(id) ?? []]),
        )
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

  /*
   * The second lead figure, derived ONCE and read by four sections — the lead
   * itself, the verdict, the queue and the SPLH chart's caption.
   *
   * `splhLead` returns `null` when no hours were posted, which is the case
   * this page is in whenever the labour sync has not run: the sections that
   * depend on it then render the designed `no_labor_synced` state instead of a
   * quotient with no denominator.
   */
  const leadP = Promise.all([splhPointsP, laborP]).then(([splhPoints, laborSd]) =>
    splhLead({
      points: dataOf(splhPoints) ?? [],
      days: dataOf(laborSd)?.days ?? [],
    }),
  )

  /*
   * The head figure's reading, derived ONCE. `sales` renders it and the
   * verdict writes a sentence about it — two callers of `comparisonPhrase`
   * over one figure is how a page ends up wording one comparison two ways.
   */
  const salesP = Promise.all([scopeP, cmpP, channelsP]).then(([scopeSd, cmp, channelsSd]) =>
    mapReady(scopeSd, (p): SalesReading => {
      const reading = comparisonPhrase(p.grossSales, cmp, cmp.scope?.grossSales ?? null)
      const mix = dataOf(channelsSd)
      const orders = mix ? mix.reduce((t, c) => t + c.orders, 0) : null
      const channelNet = mix ? mix.reduce((t, c) => t + c.net, 0) : null
      return {
        grossSales: p.grossSales,
        // The same array the chart below is drawn from, so the sparkline in
        // the lead figure and the bars under it cannot describe two different
        // weeks.
        series: rowValues(p.rows, TOTAL_SALES_CODE) ?? [],
        /*
         * What the figure is made of — the two numbers that multiply into it.
         * Both come from `loadChannelMix`, which reads net and orders off the
         * SAME rows, so the ticket printed here is the net in that table over
         * the orders in that table (Task 1's ruling) and never the page
         * headline divided by these orders.
         */
        note:
          orders !== null && orders > 0 && channelNet !== null
            ? `${count(orders)} orders · ${money(channelNet / orders, { cents: true })} ticket`
            : null,
        comparison: reading.text,
        comparisonTone: reading.tone,
      }
    }),
  )

  const stripP = Promise.all([scopeP, channelsP, targetsP]).then(
    ([scopeSd, channelsSd, targetsSd]) =>
      mapReady(scopeSd, (p) => buildStrip(p, dataOf(channelsSd), dataOf(targetsSd))),
  )

  return {
    sales: guardSection(salesP, "retrySales"),

    splh: guardSection(
      Promise.all([splhPointsP, leadP]).then(([splhPoints, lead]) =>
        mapReadyTo(splhPoints, (points) => {
          /*
           * NOT `no_match`. The hours are missing because a sync has not run,
           * not because the reader picked a range with nothing in it, and
           * "widen the filters and date range" is unfollowable advice on a
           * range that is already right. See `no_labor_synced` in
           * `section-data.ts`.
           */
          if (lead === null) return empty("no_labor_synced")

          const usual = lead.usual
          const detail =
            lead.vsUsual === null || usual === null
              ? "no weekday history to compare with yet"
              : `${lead.vsUsual < 0 ? "\u25bc" : "\u25b2"} ` +
                `${money(Math.abs(lead.vsUsual), { cents: true })} vs a usual ` +
                `${money(usual, { cents: true })}`

          /*
           * The caption, in the order an owner asks the questions: how many
           * hours, how that compares with what was published, and what the
           * difference cost. Each clause is dropped rather than guessed when
           * its input is missing, so a range with no schedule reads
           * "74.0 h worked" and stops.
           */
          const parts = [`${hoursText(lead.hours)} worked`]
          if (lead.scheduled !== null && lead.gap !== null) {
            parts.push(
              lead.held
                ? `on the ${hoursText(lead.scheduled)} published`
                : `${hoursText(Math.abs(lead.gap))} ${lead.gap > 0 ? "over" : "under"} the ` +
                  `${hoursText(lead.scheduled)} published`,
            )
            if (!lead.held && lead.gapCost !== null) parts.push(`${money(lead.gapCost)} of labor`)
          } else {
            parts.push("no schedule published for this range")
          }

          return ready({
            value: lead.value,
            detail,
            // SENTIMENT, NOT DIRECTION. A fall in sales per labor hour is bad
            // news; `is-flat` is for the reading that has nothing to compare
            // with, which is a statement of fact rather than a movement.
            detailTone:
              lead.vsUsual === null ? "is-flat" : lead.vsUsual < 0 ? "is-down" : undefined,
            /*
             * The usual range, as a BAND. `better: "high"` because a low
             * sales-per-hour is the bad one, and the band's edges are the
             * published `SPLH_TOLERANCE` rather than a width chosen here —
             * see `src/lib/counter/splh-lead.ts` on why this is drawn as a
             * usual and never as a floor.
             */
            reference:
              lead.band === null
                ? null
                : {
                    v: lead.value,
                    lo: lead.band.lo,
                    hi: lead.band.hi,
                    better: "high",
                    label:
                      `Sales per labor hour ${money(lead.value, { cents: true })} against a usual ` +
                      `${money(lead.band.lo, { cents: true })} to ` +
                      `${money(lead.band.hi, { cents: true })}`,
                  },
            caption: parts.join(" \u00b7 "),
            // A `Spark` cannot draw a gap, so a day with no reading is dropped
            // from the sparkline rather than flattened to zero. The chart below
            // keeps the gap, because a chart can draw one.
            series: points.map((x) => x.splh).filter((v): v is number => v != null),
          })
        }),
      ),
      "retrySplh",
    ),

    strip: guardSection(stripP, "retrySales"),

    verdict: guardSection(
      Promise.all([stripP, leadP, salesP]).then(([strip, lead, salesSd]) =>
        mapReadyTo(strip, (cells) => {
          const sales = dataOf(salesSd)
          // The strip loaded, so the statement did, so this cannot be absent
          // — they are the same `scopeP`. Guarded rather than asserted,
          // because a `!` here would be a crash on the head block.
          if (!sales) return empty<Verdict>("no_match")
          return buildVerdict(cells, lead, sales)
        }),
      ),
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

    /*
     * `queueP` classifies an EMPTY INBOX as empty, and that verdict is now
     * wrong on its own: this page derives two labour items of its own, so a
     * range with no ingested alert but an overrun schedule has something to
     * show. `mapReadyTo` re-decides it over the combined list — the derived
     * items and the inbox together — and only then calls it all clear.
     */
    needsYou: guardSection(
      Promise.all([queueP, leadP]).then(([queueSd, lead]) => {
        const items = buildQueue(dataOf(queueSd)?.alerts ?? [], today, lead)
        if (items.length > 0) return ready(items)
        return mapReadyTo(queueSd, () => empty<QueueEntry[]>("all_clear"))
      }),
      "retryNeedsYou",
    ),

    salesChart: guardSection(
      Promise.all([scopeP, cmpP]).then(([scopeSd, cmp]) =>
        mapReady(scopeSd, (p) => buildSalesChart(p, cmp, range)),
      ),
      "retrySales",
    ),

    splhChart: guardSection(
      splhPointsP.then((splhPoints) =>
        mapReadyTo(splhPoints, (points) => {
          // The same gate as the lead figure above it, for the same reason: a
          // chart of nulls is not a chart of a quiet week.
          if (points.every((x) => x.splh === null)) return empty<ChartData>("no_labor_synced")
          return ready(buildSplhChart(points))
        }),
      ),
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

    feeds: guardSection(
      feedsP.then((feedsSd) =>
        mapReady(feedsSd, (lines): MoneyLine[] =>
          lines.map((f) => ({
            label: f.label,
            value: f.reading,
            // Only a feed that has actually gone wrong takes a colour. A fresh
            // one and a feed that has never run here are both simply facts,
            // and a block where every line is coloured says nothing.
            tone: f.tone === "warn" ? ("warn" as const) : undefined,
          })),
        ),
      ),
      "retryFeeds",
    ),

    ratings: guardSection(
      ratingsP.then((ratingsSd) =>
        mapReadyTo(ratingsSd, (r) => {
          // `isEmpty` already caught a window with no reviews; a null average
          // that survives it means the rows carried no rating at all.
          if (r.average === null) return empty<RatingsTile>("no_match")
          return ready({
            average: r.average.toFixed(1),
            averageValue: r.average,
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
    // The comparison window's OWN dates. At a single-bucket range `Chart`
    // degrades to two read-out cells, and without this the prior cell was
    // captioned with the selected day's date — see `ChartSpec.vsLabels`.
    vsLabels: cmp.scope ? cmp.scope.periods.map((x) => x.label) : undefined,
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

/**
 * SPLH over the range, against what these same weekdays usually return.
 *
 * NO `rule`, because no column publishes a floor to rule against — a rule is a
 * line somebody drew, and `SPLH_FLOOR = 68.00` is the prototype's invention.
 * What IS drawn is a dashed USUAL: `SplhPoint.targetSplh` is the median of the
 * store's own trailing history for that weekday, which is a description of the
 * past and not a target for the future. The legend says "usual" for exactly
 * that reason, and `src/lib/counter/splh-lead.ts` carries the long form of the
 * distinction.
 *
 * The dashed series is dropped entirely when no day in the range has enough
 * weekday history behind it — a dashed line drawn through two of seven points
 * is a shape a reader will read as a trend.
 */
function buildSplhChart(points: SplhPoint[]): ChartData {
  const usual = points.map((p) => p.targetSplh)
  const scored = usual.filter((v) => v != null).length
  const drawUsual = scored >= 2 && scored >= Math.ceil(points.length / 2)

  return {
    type: "line",
    h: 150,
    labels: points.map((p) => p.label),
    legend: drawUsual,
    alt: "Sales per labor hour",
    series: [
      { name: "Sales per labor hour", color: "var(--ink)", data: points.map((p) => p.splh), fill: true },
      ...(drawUsual
        ? [
            {
              name: "usual for this weekday",
              color: "var(--ink-3)",
              data: usual,
              as: "line" as const,
              dash: true,
              w: 1.5,
            },
          ]
        : []),
    ],
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
      kept: (() => {
        const rated = mix.filter((c) => c.commission !== null)
        if (rated.length === 0) return null
        return rated.reduce((t, c) => t + c.net - (c.commission as number), 0)
      })(),
      // Passed through from loadChannelMix, whose commission is the one
      // commission function's (recorded fees + store-rate estimate, null
      // where nothing could be priced). `kept` above is DOLLARS, so in-house
      // belongs in it — it is the ratio that must not count it.
      channels: mix.map((c) => ({
        id: c.channel, net: c.net, orders: c.orders,
        commission: c.commission, ticket: c.ticket,
      })),
    }
  })
}

/** Which fields of a store's file are still blank. Facts, not a build-out percentage. */
function missingFromFile(f: StoreFile): string[] {
  const missing: string[] = []
  if (f.fixedMonthlyRent == null) missing.push("Rent")
  if (f.fixedMonthlyLabor == null) missing.push("Labor budget")
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
