import { getStores } from "@/app/actions/store/crud-actions"
import { getMenuEngineering } from "@/app/actions/forecasts/menu-engineering-actions"
import type { MenuEngineeringData } from "@/app/actions/forecasts/menu-engineering-actions"
import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { isOperational } from "@/lib/store-lifecycle"
import {
  buildPeriods,
  COGS_CODE,
  LABOR_CODE,
  TOTAL_SALES_CODE,
  type PnLRow,
} from "@/lib/pnl"
import { CHANNEL_FOR_PLATFORM } from "@/lib/counter/channel-mix"
import { bandVarFor } from "@/lib/counter/channels"
import {
  channelSeries,
  commissionDrift,
  marketplaceDrift,
  mixMove,
  type ChannelSeries,
  type Drift,
  type MixMove,
} from "@/lib/counter/channel-series"
import {
  dayOfWeekProfile,
  loadServiceProfile,
  type DayOfWeekProfile,
  type ServiceProfile,
} from "@/lib/counter/service-profile"
import {
  granularityFor,
  loadStatement,
  rowValues,
  type Granularity,
  type Statement,
  type StoreStatement,
} from "@/lib/counter/statement"
import { primeCost } from "@/lib/counter/prime-cost"
import {
  comparisonContext,
  comparisonPhrase,
  type ComparisonContext,
} from "@/lib/counter/comparison"
import { count, delta, money, pct, plural, points } from "@/lib/counter/format"
import {
  comparisonRange,
  dayCount,
  isoDay,
  rangeLabel,
  toQueryBounds,
  type ComparisonId,
  type DateRange,
} from "@/lib/counter/date-range"
import type { ChartSpec } from "@/lib/counter/chart-geometry"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
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
import type { FigureProps, MoneyLine } from "@/components/counter"

/**
 * Analytics, classified — for BOTH routes and BOTH surfaces.
 *
 * Four surfaces read this file and nothing beneath it: the group page on the
 * desk and on a phone, and one store's page on the desk and on a phone. That
 * is the whole point of it existing. `/dashboard/analytics` and
 * `/dashboard/analytics/[storeId]` print the same marketplace share for the
 * same window because there is one function that decides what a marketplace
 * share is, not because two pages were written carefully.
 *
 * ## A-R1 — one net, and it is the statement's
 *
 * ONE `loadStatement` call feeds every money section here. The strip's "Net
 * sales", the mix bands, the marketplace share, the commission and the
 * drill's cost sentence are all read off that one rollup, through
 * `channel-series.ts`, which takes the statement and nothing else.
 *
 * **This adapter does not call `loadChannelMix` for money.** That module
 * answers in Otter's NET and `Statement.grossSales` is a GROSS-based GL
 * construct: measured on 2026-08-20…26 the same window is $51,542 one way and
 * $48,425 the other. A page whose headline came from one and whose bands came
 * from the other would print two different "net sales" on one screen. It IS
 * used for one thing the rollup does not publish — an order count — and that
 * read is a per-day query in this file (`loadDailyOrders`) against the same
 * `OtterDailySummary` rows, filtered through the same `CHANNEL_FOR_PLATFORM`
 * map, so the store headline's orders and the day book's orders sum to each
 * other and agree with the P&L cascade's count for the same range.
 *
 * ## A-R13 — the statement is loaded DAILY and folded here
 *
 * The day-of-week panel needs one reading per calendar day, and
 * `granularityFor` buckets anything past a fortnight into weeks or months, so
 * at the display grain those days do not exist. A second `loadStatement` at
 * daily granularity would be a second rollup answering the same question —
 * the shape A-R1 forbids. So: one call at `granularity: "daily"`, and
 * `foldStatement` regroups it into the range's display grain in this file.
 *
 * **Measured before it was built on** (2026-08-27, live database, the widest
 * preset the date control offers — `ytd`, 239 days, 1,554 summary rows and
 * 11,596 COGS rows): the database query is IDENTICAL at either grain —
 * `getAllStoresPnL` fetches every row in the range and only then buckets — and
 * the fold itself is the whole difference: **9.8 ms of CPU at 239 daily
 * periods against 1.6 ms at 8 monthly ones**, on a request whose query alone
 * costs ~590 ms. Both arms returned the same gross to the cent
 * (`$1,589,817.29`). Daily is free; A-R13 stands.
 *
 * ## Two things this file does NOT do
 *
 * It does not derive a food cost. Every food, labour and prime figure in the
 * day book comes off the statement's own per-period `6100` / `6200` rows
 * through `prime-cost.ts` (A-R11) — the same module the P&L's prime cost comes
 * from, so one range cannot have two prime costs. And it does not derive an
 * item margin: `items` and `categories` are `getMenuEngineering`, the
 * menu-profit path, which reads the materialised `DailyCogsItem` rollup that
 * the statement's own COGS line is built from.
 *
 * ## Every caption that depends on data lives INSIDE its section
 *
 * `Section.meta` takes a string or a callback over the section's own data, and
 * under streaming every key of the returned record is a `Promise` — so a
 * caption sitting as a bare sibling string on the sections object is
 * unrenderable. Ruling N-R9, found the hard way. Every `meta`, `sentence`,
 * `note` and `subtitle` below is a field of the payload it describes.
 */

/* ── The shapes the pages' primitives render ──────────────────────────── */

/** One strip cell, exactly `Figure`'s props — the same alias the Overview and the P&L use. */
export type StripCell = FigureProps

/** A chart, as `chart-geometry` specifies it. `fmt` is the page's — a function cannot cross the RSC boundary. */
export type ChartData = ChartSpec

/**
 * The group strip, on both surfaces.
 *
 * `cells` is THREE, not four (A-R3): "Repeat guests" is dropped, because the
 * entire in-house channel carries no customer name at all (29,173 orders, zero
 * names) and the marketplace names that exist are a first name plus an
 * initial, which collide by construction. A repeat rate on that describes
 * marketplace orders only, on an identity that merges strangers.
 *
 * `phoneCells` is FOUR and is NOT a slice of `cells` — the phone's fourth is
 * Best day, and its commission cell prints DOLLARS where the desk's prints a
 * percentage. Same figures, same statement, different readings; a page slicing
 * the desk's array by position would hand the phone the wrong cell the moment
 * a cell is withheld.
 */
export interface AnalyticsHeadline {
  cells: StripCell[]
  phoneCells: StripCell[]
}

/** One row of the mix-move drill. Pre-formatted: the page turns these into cells. */
export interface MixDrillRow {
  key: string
  /** The channel's own name — "In-house", "DoorDash", "Uber Eats", "Grubhub". */
  channel: string
  /** The first third's share. */
  was: string
  /** The last third's share. */
  now: string
  /** "▲ 2.6 pts", or "flat". */
  change: string
  /** This channel's own rate off the statement, or an em-dash where none is published. */
  commission: string
  /**
   * The move went the expensive way. The prototype's `hot` class on the change
   * cell — a share that rose on a channel that charges, or fell on one that
   * does not. A channel with no published rate is never costly, whichever way
   * it moved, because it has no price to move.
   */
  costly: boolean
}

/**
 * The drill under the mix chart.
 *
 * A-R10: below three buckets there is no first third and no last third, so
 * `enough` is false, `rows` is EMPTY and `note` carries the whole body — the
 * page draws the paragraph and no table. A four-column table of zeroes would
 * be a fabricated drift presented as a measurement.
 */
export interface MixDrill {
  enough: boolean
  rows: MixDrillRow[]
  /** The sentence under the table — or, when `enough` is false, the whole body. */
  note: string
}

export interface MixSection {
  /** The desk's stacked share chart, with the band names written on the bands. */
  chart: ChartData
  /** The phone's: shorter, no axis, a legend instead of direct labels (a label on a 20px band at 340px is a label nobody can read). */
  phoneChart: ChartData
  /** Names the denominator (A-R2): the four channels, not all platform sales. */
  subtitle: string
  drill: MixDrill
  /** One line the phone prints under its chart, where there is no room for the drill. */
  sentence: string
}

export interface WeekdaySection {
  chart: ChartData
  /** Seven single-letter labels and a shorter plot. */
  phoneChart: ChartData
  /** "Sunday is the best day at $9,018 …" */
  sentence: string
  /**
   * The prototype's own caveat, printed when every weekday the range holds is
   * a SINGLE day's reading rather than an average. Null when there is nothing
   * to caveat.
   */
  note: string | null
  /**
   * Whether ANY weekday bucket holds more than one day — that is, whether the
   * bars are averages at all.
   *
   * Published rather than left inside the builder because the SECTION's meta
   * is composed by the page ("7 days, averaged by weekday") and was making the
   * claim this card's own caveat spends two lines withdrawing. One fact, read
   * by the heading, the sentence, the legend and the caveat, so the four
   * cannot disagree.
   */
  averaged: boolean
  /** What the phone's fourth strip cell prints. Null when the range holds no day at all. */
  best: { name: string; short: string; average: number } | null
}

export interface ServiceSection {
  chart: ChartData
  /** The measured peak block and what to do about it (A-R6). */
  sentence: string
  /**
   * A-R5: this counts orders **from the hourly table**, and says so. The
   * hourly rollup and the daily summaries disagree by 1.5% for the same window
   * (2,636 against 2,598) — two syncs, two answers — so this caption is never
   * read against a figure another section on the page printed.
   */
  meta: string
}

export interface AnalyticsSectionsInput {
  range: DateRange
  /** `null` = every store on the account. */
  storeId: string | null
  /**
   * The account the reader is on. `loadServiceProfile` and `loadDailyOrders`
   * scope their own queries by it and cannot fetch a session themselves —
   * importing `@/lib/auth` pulls `@/lib/prisma` in at MODULE LOAD, which
   * throws without a `DATABASE_URL` and takes the page's whole import graph
   * with it. `loadStatement` does not take one: it was forwarded nowhere.
   */
  accountId: string
  /** `"none"` prints no comparison rather than a tag of em-dashes it calls one. */
  comparisonId?: ComparisonId
}

/** The group page — `/dashboard/analytics` and `/m/analytics`. */
export interface AnalyticsSections {
  headline: SectionData<AnalyticsHeadline>
  mix: SectionData<MixSection>
  weekday: SectionData<WeekdaySection>
  /** `not_computed` where the hourly table cannot answer — see `buildService`. */
  service: SectionData<ServiceSection>
}

/* ── The store page's own shapes ──────────────────────────────────────── */

export interface StoreHeadline {
  /** Four cells: Net sales · Orders · Avg ticket · Food cost. */
  cells: StripCell[]
  /** Two: Net sales · Food cost. */
  phoneCells: StripCell[]
  /** The prototype's `storeNote()` — what this page is, and what it adds to the group page. */
  note: string
}

export interface SalesSection {
  chart: ChartData
  /** Shorter, no axis. */
  phoneChart: ChartData
}

/** One day of the day book. Pre-formatted; a figure the rollup has none of is an em-dash, never a zero. */
export interface DayBookRow {
  /** `YYYY-MM-DD`, from the range's own calendar rather than from a bucket label. */
  key: string
  /** "Wed Aug 26". */
  date: string
  net: string
  orders: string
  /**
   * "353 orders" — what the phone's `mlist` row puts under the date, or `null`
   * on a day with no order count at all. Written here rather than composed by
   * the page from `orders`, because a page appending the word to an em-dash
   * would print "— orders" on exactly the day it matters.
   */
  ordersNote: string | null
  ticket: string
  food: string
  labor: string
  prime: string
  /** Prime cost past the trade's published ceiling. The one cell that is painted. */
  over: boolean
}

export interface DayBook {
  /** Every day in range, newest first. */
  rows: DayBookRow[]
  /**
   * The four the phone lists. A slice made HERE rather than by the page: the
   * page taking `rows.slice(0, 4)` is a page deciding how much of a table is
   * the whole story, and every surface that did it would have to agree.
   */
  phoneRows: DayBookRow[]
  meta: string
}

export interface StoreStatementLines {
  rows: MoneyLine[]
  meta: string
}

export interface CategoryRow {
  key: string
  name: string
  net: string
  /** This category's share of the costed menu revenue below. */
  share: string
  /** Food cost as a percentage of this category's own revenue. */
  food: string
}

export interface CategoryTable {
  rows: CategoryRow[]
  meta: string
}

export interface TopItemRow {
  key: string
  name: string
  category: string
  qty: string
  net: string
  /** Contribution over revenue, on this item's own rows. */
  margin: string
  /** Revenue less cost — what the item actually put in the till. */
  contribution: string
}

export interface TopItems {
  rows: TopItemRow[]
  meta: string
}

/** The store page — `/dashboard/analytics/[storeId]` and `/m/analytics/[storeId]`. */
export interface StoreAnalyticsSections {
  headline: SectionData<StoreHeadline>
  sales: SectionData<SalesSection>
  service: SectionData<ServiceSection>
  mix: SectionData<MixSection>
  items: SectionData<TopItems>
  /** The day book, the statement and the categories are this route's own argument for existing. */
  dayBook: SectionData<DayBook>
  statement: SectionData<StoreStatementLines>
  categories: SectionData<CategoryTable>
}

/* ── Constants ────────────────────────────────────────────────────────── */

const DASH = "—"

/** Monday-first, matching `dayOfWeekProfile`'s own index. */
const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
/** The phone's axis. Seven letters, and two of them repeat — that is the convention. */
const WEEKDAY_LETTER = ["M", "T", "W", "T", "F", "S", "S"]

/** How many of the day book the phone lists (`P.analyticsstore.phone()`). */
const PHONE_DAYS = 4

/** How many items the "Top items" table holds before it stops being a top. */
const TOP_ITEMS = 8

/**
 * The grain a caption names. `Granularity` is the rollup's word for it and
 * reads badly in a sentence ("7 days · daily buckets" is fine; "7 days ·
 * monthly buckets" for a year is what we want to say).
 */
const GRAIN_WORD: Record<Granularity, string> = {
  daily: "daily",
  weekly: "weekly",
  monthly: "monthly",
}

/* ── A-R13: the fold ──────────────────────────────────────────────────── */

/**
 * The daily statement, regrouped into the range's display grain.
 *
 * `buildPeriods` with the SAME bounds `loadStatement` passed and the display
 * granularity, so the buckets are exactly the ones `getAllStoresPnL` would
 * have returned had it been asked for them — one labeller, not a second
 * vocabulary for the same weeks.
 *
 * Every `PnLRow` in the statement is folded, including the ones inside
 * `allStores`, and `perStore` is re-filtered out of the folded `allStores` so
 * a figure read off one and the same figure read off the other stay the same
 * object. The scalar lines (`grossSales`, `cogsValue`, …) are range TOTALS and
 * regrouping cannot change them, so they are carried through untouched — a
 * fold that recomputed them would be a second answer to a question the rollup
 * already answered.
 *
 * `percents` is recomputed the way `consolidateRows` computes it — the value
 * over that bucket's own Total Sales, as a FRACTION — because a percentage of
 * a day carried onto a week is simply a wrong number.
 */
function foldStatement(
  daily: Statement,
  range: DateRange,
  granularity: Granularity,
): Statement {
  if (granularity === "daily") return daily

  const { startDate, endDate } = toQueryBounds(range)
  const display = buildPeriods(startDate, endDate, granularity)
  if (display.length === 0) return daily

  // Which display bucket each daily period lands in. A period that lands
  // nowhere (impossible for buckets built from the same bounds, but the
  // arithmetic must not produce a NaN if it ever is) falls into the last one.
  const bucketOf = daily.periods.map((p) => {
    const t = p.startDate.getTime()
    const i = display.findIndex(
      (d) => t >= d.startDate.getTime() && t <= d.endDate.getTime(),
    )
    return i === -1 ? display.length - 1 : i
  })

  const foldValues = (values: number[]): number[] => {
    const out = new Array(display.length).fill(0) as number[]
    values.forEach((v, i) => {
      out[bucketOf[i]] += v
    })
    return out
  }

  const foldRows = (rows: PnLRow[]): PnLRow[] => {
    const gross = foldValues(rowValues(rows, TOTAL_SALES_CODE) ?? [])
    return rows.map((r) => {
      const values = foldValues(r.values)
      // A bucket is unknown only when EVERY day inside it was — one posted day
      // in a week makes the week a reading, not an absence.
      const unknown = r.isUnknown
      let isUnknown: boolean[] | undefined
      if (unknown) {
        const all = new Array(display.length).fill(true) as boolean[]
        unknown.forEach((u, i) => {
          if (!u) all[bucketOf[i]] = false
        })
        isUnknown = all
      }
      return {
        code: r.code,
        label: r.label,
        values,
        percents: values.map((v, i) => (gross[i] === 0 ? 0 : v / gross[i])),
        isSubtotal: r.isSubtotal,
        isFixed: r.isFixed,
        isUnknown,
      }
    })
  }

  const allStores: StoreStatement[] = daily.allStores.map((s) => ({
    ...s,
    rows: foldRows(s.rows),
  }))

  return {
    ...daily,
    periods: display,
    rows: foldRows(daily.rows),
    allStores,
    // Filtered out of the list already folded, rather than folded a second
    // time: one `StoreStatement` per store, so a figure read off `perStore` and
    // the same figure read off `allStores` are the same object.
    perStore: allStores.filter((s) =>
      daily.perStore.some((p) => p.storeId === s.storeId),
    ),
  }
}

/* ── Orders, per calendar day ─────────────────────────────────────────── */

/**
 * Orders per calendar day, keyed `YYYY-MM-DD`.
 *
 * The rollup publishes no order count at all — `getAllStoresPnL` returns
 * money — and the store page needs one three times: the headline's Orders
 * cell, its average ticket, and every row of the day book. One query answers
 * all three, so the ticket in a row is the net in that row over the orders in
 * that row rather than three numbers that were never true together.
 *
 * Filtered through `CHANNEL_FOR_PLATFORM`, exactly as `loadChannelMix` filters
 * it, so this count and the P&L cascade's count for the same range are the
 * same number. Caviar and chownow are excluded here for the same reason they
 * are excluded from the mix (A-R2): they are not one of the four channels, and
 * the four channels are what every figure on this page is a share of.
 *
 * Resolves stores through `accountId` FIRST, the same reason
 * `loadServiceProfile` does: without it, `storeId: null` would mean "every
 * store in the database", and a `storeId` not on the account would silently
 * fall back to the whole account rather than returning nothing.
 */
async function loadDailyOrders(input: {
  range: DateRange
  storeId: string | null
  accountId: string
}): Promise<Map<string, number>> {
  const { range, storeId, accountId } = input
  const { startDate, endDate } = toQueryBounds(range)

  const stores = await getScopedStores(accountId, storeId ?? null)
  if (stores.length === 0) return new Map()

  const rows = await prisma.otterDailySummary.groupBy({
    by: ["date"],
    where: {
      storeId: { in: stores.map((s) => s.id) },
      date: { gte: startDate, lte: endDate },
      platform: { in: Object.keys(CHANNEL_FOR_PLATFORM) },
    },
    _sum: { fpOrderCount: true, tpOrderCount: true },
  })

  const out = new Map<string, number>()
  for (const r of rows) {
    // `@db.Date`, so the Date carries no time-of-day to be shifted and UTC
    // fields read the business date back unchanged — the same key
    // `service-profile.ts` uses for the same column type.
    out.set(
      r.date.toISOString().slice(0, 10),
      (r._sum.fpOrderCount ?? 0) + (r._sum.tpOrderCount ?? 0),
    )
  }
  return out
}

/* ── Reading the statement ────────────────────────────────────────────── */

type StoreFile = Awaited<ReturnType<typeof getStores>>[number]

/**
 * Note 23, the same three outcomes the P&L decides and in the same order: a
 * store the account does not own is `no_match` before anything else is asked;
 * an account whose stores have all not opened is `pre_open`, which is not a
 * filter problem and has no back-out; a range that caught no trade at a store
 * that HAS opened is `no_match`, and widening the range is the way out.
 *
 * A second copy of `adapters/pnl.ts`'s `emptyReasonFor`, and it is a copy
 * rather than an import because that one is private to the page it was written
 * for. If a fourth page needs this rule it should move to `section-data.ts`
 * beside `EmptyReason` rather than be copied again.
 */
function scopeEmptyReason(
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

/**
 * One GL row's per-bucket values as POSITIVE dollars.
 *
 * `6100` and `6200` are stored NEGATIVE by `computeStorePnL`, the same as the
 * commission rows `channel-series.ts` flips. The sign is flipped exactly once,
 * here, and only for a code known to be a cost — never generically in
 * `rowValues`, which is why that helper stopped applying `Math.abs()`.
 */
function costValues(rows: PnLRow[], code: string): number[] | null {
  const values = rowValues(rows, code)
  return values ? values.map((v) => -v) : null
}

/** The margin in POINTS. `Statement.marginPct` is the rollup's raw fraction. */
function marginPoints(s: Statement): number | null {
  return s.marginPct === null ? null : s.marginPct * 100
}

/* ── The group strip ──────────────────────────────────────────────────── */

/**
 * Three cells, and every one of them a reading of the SAME series.
 *
 * Cell 3's caption says "of channel sales", not the prototype's "of net",
 * because A-R1 makes the denominator the four-channel total while cell 1
 * prints `Statement.grossSales` — a different figure — under the word "Net".
 * One page, one name for one number.
 */
function buildStrip(
  p: Statement,
  series: ChannelSeries,
  market: Drift,
  commission: Drift,
  cmp: ComparisonContext,
  granularity: Granularity,
): StripCell[] {
  const sales = comparisonPhrase(p.grossSales, cmp, cmp.scope?.grossSales ?? null)
  // The prototype's `R.mktPct()` (line 3491): the marketplace share bucket by
  // bucket is the house band's own share, inverted. One series, read off the
  // shares the chart below already draws, rather than a second computation of
  // the same quantity.
  const houseBand = series.bands.find((b) => b.channel === "house")
  const marketplaceSeries = houseBand ? houseBand.shares.map((v) => 100 - v) : undefined

  const cells: StripCell[] = [
    {
      label: "Net sales",
      value: money(p.grossSales),
      delta: sales.text,
      deltaTone: sales.tone,
      caption: `${plural(p.days, "day")} · ${GRAIN_WORD[granularity]} buckets`,
    },
    {
      label: "Through marketplaces",
      value: pct(series.marketplaceShare, { scaled: true }),
      // A RISING marketplace share is the expensive direction, so a positive
      // drift is the down tone. The arrow and the judgement disagree on
      // purpose — `comparisonPhrase` is written for figures where they agree,
      // and this is not one of them.
      delta: market.enough ? `${points(market.points)} across the range` : undefined,
      deltaTone: market.enough && market.points > 0 ? "is-down" : undefined,
      caption: market.enough
        ? `started at ${pct(market.was, { scaled: true })}`
        : undefined,
      // A quiet meter: it draws where the range started and where it is now,
      // and says nothing about whether that is good. Nothing in this schema
      // publishes a marketplace-share target, so a verdict here would be one
      // this page invented.
      reference: market.enough
        ? {
            v: series.marketplaceShare,
            target: market.was,
            better: "low",
            quiet: true,
            series: marketplaceSeries,
            label:
              `Marketplace share ${pct(series.marketplaceShare, { scaled: true })}, ` +
              `from ${pct(market.was, { scaled: true })} at the start of the range`,
          }
        : undefined,
    },
    {
      label: "Commission",
      value: pct(series.commissionPct, { scaled: true }),
      delta: commission.enough
        ? `${points(commission.points)} on mix alone`
        : undefined,
      deltaTone: commission.enough && commission.points > 0 ? "is-down" : undefined,
      caption:
        series.blendedPct === null
          ? "of channel sales"
          : `of channel sales · ${pct(series.blendedPct, { scaled: true })} off marketplace sales`,
      // The same quiet meter the cell above carries, for the same reason: the
      // range's own opening rate is the only line this schema publishes to
      // judge commission against, so the meter draws where it started and
      // where it is now and says nothing about whether that is good. The
      // trajectory is `ChannelSeries.commissionShares`, which is the prototype's
      // `R.feeNetPct()`. When the range is too short to hold thirds there is no
      // line to draw, so the reference keeps only the series and is unjudged —
      // a sparkline with no bullet, exactly as the prototype's `{ s: … }`.
      reference: commission.enough
        ? {
            v: series.commissionPct,
            target: commission.was,
            better: "low",
            quiet: true,
            series: series.commissionShares,
            label:
              `Commission ${pct(series.commissionPct, { scaled: true })} of channel sales, ` +
              `from ${pct(commission.was, { scaled: true })} at the start of the range`,
          }
        : {
            v: series.commissionPct,
            better: "low",
            quiet: true,
            series: series.commissionShares,
          },
    },
  ]

  return cells
}

/**
 * The phone's four (`P.analytics.phone()`).
 *
 * Two departures from the desk, both the prototype's: the commission cell
 * prints DOLLARS with the percentage demoted to its caption, and the fourth
 * cell is Best day — which is why A-R3 removes nothing here. The phone strip
 * draws no sparkline (`MStrip` renders no `.sp` at all), but it DOES open the
 * marketplace meter: the prototype's phone Marketplaces cell carries the same
 * quiet reference its desk cell does, and the caption under it only exists
 * because the reference does.
 */
function buildPhoneStrip(
  p: Statement,
  series: ChannelSeries,
  market: Drift,
  week: DayOfWeekProfile,
  cmp: ComparisonContext,
): StripCell[] {
  const sales = comparisonPhrase(p.grossSales, cmp, cmp.scope?.grossSales ?? null)
  const best = week.best === null ? null : week.readings[week.best]

  const cells: StripCell[] = [
    {
      label: "Net sales",
      value: money(p.grossSales),
      delta: sales.text,
      deltaTone: sales.tone,
    },
    {
      label: "Marketplaces",
      value: pct(series.marketplaceShare, { scaled: true }),
      // The DRIFT when the range is wide enough to hold one, the qualifier
      // when it is not. Never a caption: `MCell` opens its band inside
      // `reference ? … : ''`, transcribed from `mstrip()`, so a caption with
      // no reference draws NOTHING. The prototype puts this text in the delta
      // slot for exactly that reason and so does this.
      delta: market.enough ? points(market.points) : "of channel sales",
      deltaTone: market.enough && market.points > 0 ? "is-down" : undefined,
      // The desk's quiet meter, on the phone too (`P.analytics.phone()`, line
      // 4991). `MCell` opens its band inside `reference ? … : ''`, so the
      // caption below is invisible until this reference exists — which is why
      // the phone had neither the meter nor the sentence under it. No `series`:
      // `MStrip` draws no sparkline at all, by design.
      caption: market.enough
        ? `started at ${pct(market.was, { scaled: true })}`
        : undefined,
      reference: market.enough
        ? {
            v: series.marketplaceShare,
            target: market.was,
            better: "low",
            quiet: true,
            label:
              `Marketplace share ${pct(series.marketplaceShare, { scaled: true })}, ` +
              `from ${pct(market.was, { scaled: true })} at the start of the range`,
          }
        : undefined,
    },
    {
      label: "Commission",
      value: money(series.commission),
      delta: `${pct(series.commissionPct, { scaled: true })} of channel sales`,
      // NO tone. The prototype hardcodes `is-down` here, which paints a
      // permanent red flag on a figure that is not a movement at all — it is
      // what commission always costs. A warning that is always on is not a
      // warning.
    },
  ]

  // No day in the range means no best day — and a cell reading "—" under a
  // heading that promises one is worse than three cells.
  if (best !== null && best.average !== null) {
    cells.push({
      label: "Best day",
      value: WEEKDAY_SHORT[best.day],
      delta: `${money(best.average)} average`,
    })
  }

  return cells
}

/* ── The mix ──────────────────────────────────────────────────────────── */

/**
 * The stacked share chart and the drill under it.
 *
 * `stack: "pct"` and the SHARES, not the dollars: the section's subject is
 * where the money came from, not how much of it there was, and the chart above
 * the drill has to be the thing the drill explains. The bands are fixed to the
 * channel through `bandVarFor` — a range where DoorDash outsells in-house must
 * not repaint the chart (notes 36 and 41).
 */
function buildMix(
  series: ChannelSeries,
  market: Drift,
  commission: Drift,
  move: MixMove,
  range: DateRange,
): MixSection {
  const bands = series.bands.map((b) => ({
    name: b.name,
    color: bandVarFor(b.channel),
    data: b.shares,
  }))

  const chart: ChartData = {
    type: "bars",
    h: 168,
    labels: series.labels,
    series: bands,
    stack: "pct",
    direct: true,
    legend: false,
    alt: "Channel mix",
  }

  const rows: MixDrillRow[] = move.rows.map((r) => ({
    key: r.channel,
    channel: r.name,
    was: pct(r.was, { scaled: true }),
    now: pct(r.now, { scaled: true }),
    change: points(r.points),
    commission: r.rate === null ? DASH : pct(r.rate, { scaled: true }),
    costly: r.costly,
  }))

  const note = move.enough
    ? `Marketplace share went ${pct(market.was, { scaled: true })} → ` +
      `${pct(market.now, { scaled: true })}, ${points(market.points)}. The blended rate ` +
      `off the top moved ${pct(commission.was, { scaled: true })} → ` +
      `${pct(commission.now, { scaled: true })}, which on ${money(series.total)} of ` +
      `channel sales is ${money(Math.abs(move.cost))} ` +
      `${move.cost >= 0 ? "of extra commission" : "less commission"} on the mix alone.`
    : // A-R10, and the prototype's own words for it.
      "A range this short has no first and last third to compare. Widen it to read the drift."

  return {
    chart,
    phoneChart: {
      ...chart,
      h: 130,
      ticks: false,
      direct: false,
      legend: true,
    },
    // A-R2 names the denominator out loud: caviar and chownow are 0.08% of
    // this window and have no CVD-safe band, so they are outside both the
    // bands and the total they are a share of.
    subtitle: `${rangeLabel(range, "custom")} · share of the four channels, not dollars`,
    drill: { enough: move.enough, rows: move.enough ? rows : [], note },
    // "of X of channel sales" said "of" twice about two different things and
    // read as a typo. The share and the base are one clause now, and the
    // commission is the sentence's point rather than a trailing fragment.
    sentence:
      `Marketplaces carried ${pct(series.marketplaceShare, { scaled: true })} of ` +
      `${money(series.total)} in channel sales, and kept ` +
      `${money(series.commission)} of it — ` +
      `${pct(series.commissionPct, { scaled: true })}.`,
  }
}

/* ── The day of the week ──────────────────────────────────────────────── */

/**
 * Seven readings, Monday first, off the DAILY statement.
 *
 * A weekday the range never held is `null` in the series, not `0` — the chart
 * draws a gap, because a day that did not happen is not a day that sold
 * nothing. `dayOfWeekProfile` already makes that distinction; this only has to
 * carry it through instead of flattening it with a `?? 0`.
 */
function buildWeekday(week: DayOfWeekProfile, days: number): WeekdaySection {
  const data = week.readings.map((r) => r.average)
  /** See the block below `chart` — every string on this card reads from it. */
  const held = week.readings.filter((r) => r.days > 0)
  const averaged = held.length > 0 && held.some((r) => r.days > 1)

  const chart: ChartData = {
    type: "bars",
    h: 150,
    zero: true,
    labels: WEEKDAY_SHORT,
    // Named for what it holds — see `averaged` above. Calling seven single
    // readings "Average net" in the legend is the same claim the sentence
    // stopped making.
    series: [{ name: averaged ? "Average net" : "Net sales", color: "var(--ink)", data }],
    alt: "Net sales by day of week",
  }

  /*
   * WHETHER THESE ARE AVERAGES AT ALL — decided once, and then obeyed by every
   * string on the card.
   *
   * Over a range of a week or less every weekday bucket holds exactly one day,
   * so what the bars show is seven readings, not seven averages. The card knew
   * that: it has printed the caveat below since it was built. What it did not
   * do was tell the two lines ABOVE the caveat, so at the two ranges anybody
   * actually opens this page at, one card said all three of these at once:
   *
   *     7 days, averaged by weekday          (the section meta)
   *     Saturday is the best day at $8,247 on average
   *     Each weekday in this 7-day range is a single day's reading,
   *     not an average.
   *
   * A reader cannot act on a card that contradicts itself twice in four lines,
   * and the one they will believe is the confident one at the top. So the
   * qualifier is computed here and the whole card reads from it.
   */
  const best = week.best === null ? null : week.readings[week.best]
  const sentence =
    best === null || best.average === null
      ? "No day in this range has a reading yet."
      : `${best.name} is the best day at ${money(best.average)}` +
        `${averaged ? " on average" : ""}, ` +
        `${delta((best.average - week.mean) / (week.mean || 1))} against the ` +
        `${money(week.mean)} mean across the range.`

  // The prototype prints this caveat and so do we, rather than quietly
  // presenting one reading as a trend.
  const note = averaged
    ? null
    : // An ATTRIBUTIVE "7-day range", which is already invariant — the noun in
      // front of "range" does not take a plural, so `plural` would be wrong
      // here in the opposite direction ("this 7 days range").
      `Each weekday in this ${count(days)}-day range is a single day's reading, ` +
      "not an average. Widen the range to read a shape."

  return {
    chart,
    phoneChart: { ...chart, h: 116, labels: WEEKDAY_LETTER, ticks: true },
    sentence,
    note,
    averaged,
    best:
      best === null || best.average === null
        ? null
        : { name: best.name, short: WEEKDAY_SHORT[best.day], average: best.average },
  }
}

/* ── When the orders come ─────────────────────────────────────────────── */

/**
 * An hour on the axis. The same vocabulary `service-profile.ts`'s peak label
 * uses, with one deliberate difference: `12a` and `12p` rather than "midnight"
 * and "noon", because those two words are four times the width of every other
 * tick and this axis is seventeen ticks wide (A-R15).
 */
function hourLabel(hour: number): string {
  if (hour === 0) return "12a"
  if (hour === 12) return "12p"
  return hour < 12 ? `${hour}a` : `${hour - 12}p`
}

/**
 * The hourly shape, in SERVICE-DAY order — `10a … 11p, 12a, 1a` — which is the
 * order `serviceProfile` already put it in (A-R15). The hours after midnight
 * belong to the evening that produced them, and a chart that cut them off
 * would cut off this restaurant's busiest hour.
 */
function buildService(profile: ServiceProfile): ServiceSection {
  return {
    chart: {
      type: "bars",
      h: 150,
      zero: true,
      labels: profile.hours.map((h) => hourLabel(h.hour)),
      series: [
        {
          name: "Orders an hour",
          color: "var(--ink)",
          data: profile.hours.map((h) => h.orders),
        },
      ],
      alt: "Orders by hour of the service day",
    },
    sentence:
      `The busiest hour is ${hourLabel(profile.busiest)}, and the best five run ` +
      `${profile.peak.label} — ${pct(profile.peak.share, { scaled: true })} of the ` +
      "day's orders. Staff to that block, not to the clock.",
    meta:
      `${count(Math.round(profile.perDay))} orders a day over ${count(profile.coveredDays)} ` +
      "days, counted in the hourly table",
  }
}

/* ── The store strip ──────────────────────────────────────────────────── */

/**
 * EVERY qualifier here goes in the DELTA slot, not the caption.
 *
 * `P.analyticsstore.desk()` (prototype line 7593) writes all four of this
 * strip's cells as `[label, value, qualifier, tone]` — the qualifier is `c[2]`,
 * and `c[4]`, the caption, is empty on all four. None of these cells is judged
 * against anything, so none of them carries a reference; `Figure` opens a
 * `.band` on `caption || reference`, so a caption here draws a band the
 * prototype does not have. (The phone strip has the mirror-image defect: `MCell`
 * opens its band only inside `reference ? … : ''`, so the same caption draws
 * NOTHING there — the qualifier was invisible on the phone and an extra
 * landmark on the desk, one slot fixing both.)
 */
function buildStoreStrip(
  p: Statement,
  orders: number | null,
  cmp: ComparisonContext,
  range: DateRange,
): Pick<StoreHeadline, "cells" | "phoneCells"> {
  const sales = comparisonPhrase(p.grossSales, cmp, cmp.scope?.grossSales ?? null)
  const netCell: StripCell = {
    label: "Net sales",
    value: money(p.grossSales),
    delta: sales.text,
    deltaTone: sales.tone,
  }
  const foodCell: StripCell = {
    label: "Food cost",
    value: pct(p.prime.cogsPct, { scaled: true }),
    delta: money(p.cogsValue),
    // `is-flat` on all three qualifiers below, and it is not decoration.
    // `.strip .d` with no tone class is `var(--good)` (counter-components.css
    // line 180), so a delta slot holding a QUALIFIER rather than a movement —
    // a range label, an order count, a dollar total — comes out painted green
    // for having moved nowhere. `is-flat` is `var(--ink-3)`, which is the tone
    // these words carried as captions and the tone the prototype gives its own
    // non-movement qualifier on this strip's first cell.
    deltaTone: "is-flat",
  }

  const cells: StripCell[] = [netCell]
  // No order count is an absence, not a zero — and an average ticket derived
  // from one would be a division by nothing dressed up as a figure.
  if (orders !== null && orders > 0) {
    cells.push({
      label: "Orders",
      value: count(orders),
      delta: rangeLabel(range, "custom"),
      deltaTone: "is-flat",
    })
    cells.push({
      label: "Avg ticket",
      value: money(p.grossSales / orders, { cents: true }),
      delta: `${count(orders)} orders`,
      deltaTone: "is-flat",
    })
  }
  cells.push(foodCell)

  return { cells, phoneCells: [netCell, foodCell] }
}

/* ── The store's own three ────────────────────────────────────────────── */

/**
 * Net sales through the range, at the display grain.
 *
 * Bars up to a fortnight and a line beyond it, the same rule
 * `adapters/overview.ts` draws its sales chart by — one shape decision for one
 * kind of series, rather than two pages disagreeing about when a series
 * becomes a line.
 */
function buildSales(p: Statement, range: DateRange): SalesSection {
  const values = rowValues(p.rows, TOTAL_SALES_CODE) ?? []
  const short = dayCount(range) <= 14

  const chart: ChartData = {
    type: short ? "bars" : "line",
    h: 150,
    zero: short,
    labels: p.periods.map((x) => x.label),
    series: [{ name: "Net sales", color: "var(--ink)", data: values, fill: true, w: 1.9 }],
    alt: "Net sales",
  }

  return { chart, phoneChart: { ...chart, h: 116, ticks: false } }
}

/**
 * Every day in the range, newest first.
 *
 * A-R11: food, labour and prime come off THIS statement's own per-period `6100`
 * and `6200` rows through `prime-cost.ts`. Nothing here adds food to labour and
 * divides — the day book's prime cost and the P&L's prime cost are the same
 * function applied to the same rows, which is the whole of note 60's
 * resolution. With A-R13 the statement is already daily, so this needs no
 * extra load at all.
 *
 * The date comes from the RANGE's own calendar (`range.start + i`), not from a
 * bucket's label: `buildPeriods` formats its daily labels in the server's local
 * time off a UTC-floored cursor, and a reader's day is the restaurant's day.
 */
function buildDayBook(
  p: Statement,
  range: DateRange,
  ordersByDay: Map<string, number>,
): DayBook {
  const net = rowValues(p.rows, TOTAL_SALES_CODE) ?? []
  const food = costValues(p.rows, COGS_CODE)
  const labor = costValues(p.rows, LABOR_CODE)

  const rows: DayBookRow[] = p.periods.map((period, i) => {
    const day = new Date(
      range.start.getFullYear(),
      range.start.getMonth(),
      range.start.getDate() + i,
    )
    const key = isoDay(day)
    const dayNet = net[i] ?? 0
    const dayFood = food?.[i] ?? null
    const dayLabor = labor?.[i] ?? null
    const orders = ordersByDay.get(key) ?? null

    // One `primeCost` per day, on that day's own denominator. A day with no
    // COGS posted has no food percentage and no prime cost, and reads as an
    // em-dash rather than as a restaurant that spent nothing on food.
    const prime =
      dayFood === null && dayLabor === null
        ? null
        : primeCost({
            grossSales: dayNet,
            cogsValue: dayFood ?? 0,
            laborValue: dayLabor ?? 0,
          })

    return {
      key,
      date: period.label,
      net: money(dayNet),
      orders: orders === null ? DASH : count(orders),
      ordersNote: orders === null ? null : `${count(orders)} orders`,
      ticket: orders === null || orders === 0 ? DASH : money(dayNet / orders, { cents: true }),
      food: dayFood === null ? DASH : pct(prime?.cogsPct ?? null, { scaled: true }),
      labor: dayLabor === null ? DASH : pct(prime?.laborPct ?? null, { scaled: true }),
      prime: pct(prime?.primePct ?? null, { scaled: true }),
      over: prime?.overCeiling ?? false,
    }
  })

  rows.reverse()

  return {
    rows,
    phoneRows: rows.slice(0, PHONE_DAYS),
    meta: `${plural(rows.length, "day")} · newest first`,
  }
}

/**
 * The statement, as the six lines an owner reads.
 *
 * Every figure is a line the rollup already stated. The prototype's `0.248`
 * labour rate and its `425.42` daily fixed cost are its own fixtures and are
 * not reproduced: `Fixed, prorated` is `occupancy + otherOperating`, both
 * already charged to this range by `getAllStoresPnL`.
 */
function buildStoreStatement(p: Statement): StoreStatementLines {
  const margin = marginPoints(p)

  const rows: MoneyLine[] = [
    { label: "Net sales", value: money(p.grossSales) },
    { label: "Food", value: `−${money(p.cogsValue)}` },
    { label: "Labor", value: `−${money(p.laborValue)}` },
    { label: "Marketplace fees", value: `−${money(p.commissions)}` },
    { label: "Fixed, prorated", value: `−${money(p.occupancy + p.otherOperating)}` },
    {
      label: "EBITDA",
      value: money(p.bottomLine),
      total: true,
    },
  ]

  return {
    rows,
    meta:
      margin === null
        ? `${count(p.days)} days`
        : `${plural(p.days, "day")} · ${pct(margin, { scaled: true })} margin`,
  }
}

/* ── The menu-profit path ─────────────────────────────────────────────── */

/**
 * The items that put the most in the till, with the margin that says so.
 *
 * `getMenuEngineering` is the menu-profit path and this file writes no second
 * COGS derivation to stand in for it. It reads the materialised
 * `DailyCogsItem` rollup — the SAME rows `getAllStoresPnL` sums into the
 * statement's food line — so an item's margin here and the food cost in the
 * strip above it are two readings of one set of numbers rather than two
 * numbers.
 *
 * Sorted by CONTRIBUTION, not by revenue: the question the section answers is
 * which items are worth the most, and the biggest seller is not always the
 * biggest earner.
 */
function buildItems(data: MenuEngineeringData): TopItems {
  const rows: TopItemRow[] = data.rows.slice(0, TOP_ITEMS).map((r) => ({
    key: `${r.category}:::${r.itemName}`,
    name: r.itemName,
    category: r.category,
    qty: count(r.soldQty),
    net: money(r.revenue),
    margin: pct(r.marginPct, { scaled: true }),
    contribution: money(r.totalContribution),
  }))

  return {
    rows,
    // The coverage is part of the reading, not a footnote: the classifier only
    // sees items with a costed recipe, and a table that did not say so would
    // present a partial menu as the menu.
    meta: `${count(rows.length)} of ${count(data.rows.length)} · ${pct(
      data.coverage.coveragePct,
      { scaled: true },
    )} of menu revenue costed`,
  }
}

/**
 * Net, share and food cost by category — off the same load `items` reads.
 *
 * One `getMenuEngineering` call answers both sections, so the categories a
 * reader totals up and the items inside them cannot come from two different
 * windows or two different cost walks.
 */
function buildCategories(data: MenuEngineeringData): CategoryTable {
  const acc = new Map<string, { net: number; cogs: number }>()
  for (const r of data.rows) {
    const bucket = acc.get(r.category) ?? { net: 0, cogs: 0 }
    bucket.net += r.revenue
    bucket.cogs += r.cogs
    acc.set(r.category, bucket)
  }

  const total = Array.from(acc.values()).reduce((t, b) => t + b.net, 0)
  const rows: CategoryRow[] = Array.from(acc.entries())
    .sort((a, b) => b[1].net - a[1].net)
    .map(([name, b]) => ({
      key: name,
      name,
      net: money(b.net),
      share: total === 0 ? DASH : pct((b.net / total) * 100, { scaled: true }),
      food: b.net === 0 ? DASH : pct((b.cogs / b.net) * 100, { scaled: true }),
    }))

  return {
    rows,
    meta: `${count(rows.length)} categories · ${money(total)} costed`,
  }
}

/* ── The group page ───────────────────────────────────────────────────── */

/**
 * The group page's four sections, as four promises.
 *
 * Every load starts here and none is awaited here. The statement feeds three
 * of the four; the hourly profile is its own query and its own failure, so a
 * slow hourly table holds up the strip and the mix for exactly as long as it
 * holds up nothing.
 */
export function getAnalyticsSectionPromises(
  input: AnalyticsSectionsInput,
): StreamedSections<AnalyticsSections> {
  const { range, storeId, accountId } = input
  const comparisonId: ComparisonId = input.comparisonId ?? "none"
  // Worked out ONCE from the SELECTED range and used for the fold and for the
  // comparison alike: a `weekday` window contains four occurrences and would
  // derive its own, coarser grain from itself.
  const granularity = granularityFor(range)
  const cmpRange = comparisonId === "none" ? null : comparisonRange(range, comparisonId)

  /* ── The loads. ── */

  // A-R13: DAILY, once, whatever the display grain is.
  const dailyP = classify(
    () => loadStatement({ range, storeId, granularity: "daily" }),
    { retryAction: "retryStatement" },
  )

  const cmpP = classify<Statement | null>(
    () =>
      cmpRange
        ? loadStatement({ range: cmpRange, storeId, granularity: "daily" })
        : Promise.resolve(null),
    { retryAction: "retryComparison" },
  )

  const filesP = classify(() => getStores(), { retryAction: "retryStores" })

  const serviceP = classify(() => loadServiceProfile({ range, storeId, accountId }), {
    retryAction: "retryService",
  })

  /* ── The derivations. ── */

  // ONE decision about what this page is looking at, applied to every section
  // that reads the statement, so no section works out for itself whether
  // zeroes are a reading.
  const scopeP = Promise.all([dailyP, filesP]).then(([dailySd, filesSd]) => {
    const files = dataOf(filesSd) ?? []
    return mapReadyTo(dailySd, (s) => {
      const reason = scopeEmptyReason(s, files, storeId)
      return reason === null ? ready(s) : empty<Statement>(reason)
    })
  })

  // The folded statement and everything `channel-series.ts` reads off it, once
  // — three sections read this and it is derived a single time.
  const seriesP = scopeP.then((scopeSd) =>
    mapReady(scopeSd, (daily) => {
      const folded = foldStatement(daily, range, granularity)
      const series = channelSeries(folded)
      return {
        daily,
        series,
        market: marketplaceDrift(series),
        commission: commissionDrift(series),
        move: mixMove(series),
      }
    }),
  )

  const cmpCtxP = cmpP.then((cmpSd) => {
    const cmpStatement = dataOf(cmpSd)
    return comparisonContext(
      comparisonId,
      cmpStatement && !cmpStatement.storeNotFound ? cmpStatement : null,
    )
  })

  return {
    headline: guardSection(
      Promise.all([seriesP, cmpCtxP]).then(([seriesSd, cmp]) =>
        mapReady(seriesSd, (s) => ({
          cells: buildStrip(s.daily, s.series, s.market, s.commission, cmp, granularity),
          // The phone's Best day cell and the weekday panel below it are the
          // same `dayOfWeekProfile` over the same days — one function, two
          // callers, so a phone and a desk cannot name two different best days.
          phoneCells: buildPhoneStrip(s.daily, s.series, s.market, weekdaysOf(s.daily, range), cmp),
        })),
      ),
      "retryStatement",
    ),

    mix: guardSection(
      seriesP.then((seriesSd) =>
        mapReadyTo(seriesSd, (s) =>
          // A-R12: no shell over zero rows. A range in which none of the four
          // channels traded has no mix, and a stacked chart of four empty
          // bands is a picture of one.
          s.series.total <= 0
            ? empty<MixSection>("no_match")
            : ready(buildMix(s.series, s.market, s.commission, s.move, range)),
        ),
      ),
      "retryStatement",
    ),

    weekday: guardSection(
      scopeP.then((scopeSd) =>
        mapReady(scopeSd, (daily) =>
          buildWeekday(weekdaysOf(daily, range), dayCount(range)),
        ),
      ),
      "retryStatement",
    ),

    service: guardSection(serviceP.then(serviceSection), "retryService"),
  }
}

/**
 * The same four sections, awaited. `awaitSections` over the streaming variant
 * rather than a second body — two implementations of "what is in the strip" is
 * how two surfaces come to print two different numbers for one day.
 */
export async function getAnalyticsSections(
  input: AnalyticsSectionsInput,
): Promise<AnalyticsSections> {
  return awaitSections(getAnalyticsSectionPromises(input))
}

/* ── The store page ───────────────────────────────────────────────────── */

export function getStoreAnalyticsSectionPromises(
  input: AnalyticsSectionsInput,
): StreamedSections<StoreAnalyticsSections> {
  const { range, storeId, accountId } = input
  const comparisonId: ComparisonId = input.comparisonId ?? "none"
  const granularity = granularityFor(range)
  const cmpRange = comparisonId === "none" ? null : comparisonRange(range, comparisonId)
  const days = dayCount(range)

  /* ── The loads. ── */

  const dailyP = classify(
    () => loadStatement({ range, storeId, granularity: "daily" }),
    { retryAction: "retryStatement" },
  )

  const cmpP = classify<Statement | null>(
    () =>
      cmpRange
        ? loadStatement({ range: cmpRange, storeId, granularity: "daily" })
        : Promise.resolve(null),
    { retryAction: "retryComparison" },
  )

  const filesP = classify(() => getStores(), { retryAction: "retryStores" })

  const serviceP = classify(() => loadServiceProfile({ range, storeId, accountId }), {
    retryAction: "retryService",
  })

  const ordersP = classify(() => loadDailyOrders({ range, storeId, accountId }), {
    retryAction: "retryOrders",
  })

  /*
   * The menu-profit path, once, for `items` AND `categories`.
   *
   * `lookbackDays` is INCLUSIVE of both ends here — the loader's window is
   * `[startOfDayUTC(asOf) − lookbackDays, startOfDayUTC(asOf)]` with `gte`/`lte`
   * bounds — so a 7-day range is `asOf = range.end, lookbackDays = 6`.
   *
   * `minSoldQty: 1` rather than the loader's default of 5: the default exists
   * to keep the quadrant classifier's median split out of the long tail, and
   * this page draws no quadrants. It does draw a CATEGORY table, and a
   * category total missing every item that sold four of itself is a total that
   * does not add up to anything a reader can check.
   */
  const menuP = classify(
    () =>
      getMenuEngineering({
        ...(storeId ? { storeId } : {}),
        lookbackDays: Math.max(0, days - 1),
        asOf: range.end,
        minSoldQty: 1,
      }),
    { retryAction: "retryMenu" },
  )

  /* ── The derivations. ── */

  const scopeP = Promise.all([dailyP, filesP]).then(([dailySd, filesSd]) => {
    const files = dataOf(filesSd) ?? []
    return mapReadyTo(dailySd, (s) => {
      // A-R7 / rule 7: a `storeId` the rollup has no row for zeroes the lines
      // and empties `perStore`. `scopeEmptyReason` reads `storeNotFound`
      // FIRST, so this page refuses rather than silently answering for the
      // whole account.
      const reason = scopeEmptyReason(s, files, storeId)
      return reason === null ? ready(s) : empty<Statement>(reason)
    })
  })

  const foldedP = scopeP.then((scopeSd) =>
    mapReady(scopeSd, (daily) => foldStatement(daily, range, granularity)),
  )

  const cmpCtxP = cmpP.then((cmpSd) => {
    const cmpStatement = dataOf(cmpSd)
    return comparisonContext(
      comparisonId,
      cmpStatement && !cmpStatement.storeNotFound ? cmpStatement : null,
    )
  })

  const menuDataP = menuP.then((menuSd) =>
    mapReadyTo(menuSd, (result) => {
      // `null` is no session at all and `{ ok: false }` is a store this
      // account does not own — both are the same answer to the reader: there
      // is nothing here for this selection.
      if (result === null || !result.ok) return empty<MenuEngineeringData>("no_match")
      if (result.data.rows.length === 0) return empty<MenuEngineeringData>("no_match")
      return ready(result.data)
    }),
  )

  return {
    headline: guardSection(
      Promise.all([scopeP, ordersP, cmpCtxP]).then(([scopeSd, ordersSd, cmp]) =>
        mapReady(scopeSd, (p) => {
          const byDay = dataOf(ordersSd)
          const orders =
            byDay === null
              ? null
              : Array.from(byDay.values()).reduce((t, n) => t + n, 0)
          return {
            ...buildStoreStrip(p, orders, cmp, range),
            note:
              "Everything above is the group page filtered to this store. The day " +
              "book, the statement and the category table below it are this page's " +
              "own — the group page does not draw them.",
          }
        }),
      ),
      "retryStatement",
    ),

    sales: guardSection(
      foldedP.then((foldedSd) => mapReady(foldedSd, (p) => buildSales(p, range))),
      "retryStatement",
    ),

    service: guardSection(serviceP.then(serviceSection), "retryService"),

    mix: guardSection(
      foldedP.then((foldedSd) =>
        mapReadyTo(foldedSd, (p) => {
          const series = channelSeries(p)
          if (series.total <= 0) return empty<MixSection>("no_match")
          return ready(
            buildMix(
              series,
              marketplaceDrift(series),
              commissionDrift(series),
              mixMove(series),
              range,
            ),
          )
        }),
      ),
      "retryStatement",
    ),

    items: guardSection(
      menuDataP.then((menuSd) => mapReady(menuSd, buildItems)),
      "retryMenu",
    ),

    dayBook: guardSection(
      Promise.all([scopeP, ordersP]).then(([scopeSd, ordersSd]) =>
        mapReady(scopeSd, (p) => buildDayBook(p, range, dataOf(ordersSd) ?? new Map())),
      ),
      "retryStatement",
    ),

    statement: guardSection(
      scopeP.then((scopeSd) => mapReady(scopeSd, buildStoreStatement)),
      "retryStatement",
    ),

    categories: guardSection(
      menuDataP.then((menuSd) => mapReady(menuSd, buildCategories)),
      "retryMenu",
    ),
  }
}

export async function getStoreAnalyticsSections(
  input: AnalyticsSectionsInput,
): Promise<StoreAnalyticsSections> {
  return awaitSections(getStoreAnalyticsSectionPromises(input))
}

/* ── Shared plumbing ──────────────────────────────────────────────────── */

/**
 * The daily statement as one reading per calendar day, keyed by the RANGE's own
 * calendar rather than by a bucket's parsed label.
 *
 * Both pages' weekday readings come through here, so `getDay()` is applied to
 * the reader's day and not to a UTC instant that may sit on the other side of
 * a midnight.
 */
function weekdaysOf(daily: Statement, range: DateRange): DayOfWeekProfile {
  const net = rowValues(daily.rows, TOTAL_SALES_CODE) ?? []
  return dayOfWeekProfile(
    daily.periods.map((_, i) => ({
      date: new Date(
        range.start.getFullYear(),
        range.start.getMonth(),
        range.start.getDate() + i,
      ),
      net: net[i] ?? 0,
    })),
  )
}

/**
 * The hourly section, or the honest absence of one.
 *
 * `loadServiceProfile` returns `null` when the range starts before the hourly
 * table begins (coverage starts 2026-02-25) or when fewer than three days are
 * covered — Glendale carries exactly ONE stray hourly row, and a chart drawn
 * from a single hour is not a shape, it is a sample. `not_computed` names what
 * is missing; an empty chart would claim the restaurant took no orders (A-R5,
 * A-R7, A-R12).
 */
function serviceSection(sd: SectionData<ServiceProfile | null>): SectionData<ServiceSection> {
  return mapReadyTo(sd, (profile) =>
    profile === null
      ? notComputed<ServiceSection>(
          "an hourly shape for this range — OtterHourlySummary starts on 2026-02-25 " +
            "and needs at least three covered days before an average hour means anything",
        )
      : ready(buildService(profile)),
  )
}
