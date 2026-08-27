import { getStores } from "@/app/actions/store/crud-actions"
import { isOperational } from "@/lib/store-lifecycle"
import { buildPeriods, TOTAL_SALES_CODE } from "@/lib/pnl"
import {
  granularityFor,
  loadStatement,
  rowValues,
  type Granularity,
  type Statement,
} from "@/lib/counter/statement"
import {
  laborWeek,
  loadLaborTrend,
  loadLaborWeek,
  type LaborDay,
  type LaborRole,
  type LaborTrendWeek,
  type LaborWeek,
} from "@/lib/counter/labor-week"
import { loadLeakLedger, type LeakLedger } from "@/lib/counter/labor-leaks"
import { loadScheduleGap, loadStaffingCurve, type StaffingCurve } from "@/lib/counter/staffing-curve"
import { count, money, pct, points } from "@/lib/counter/format"
import {
  dayCount,
  isoDay,
  rangeLabel,
  toQueryBounds,
  trailingWeeks,
  type DateRange,
  type WeekWindow,
} from "@/lib/counter/date-range"
import type { ChartSeries, ChartSpec } from "@/lib/counter/chart-geometry"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
import type { QueueEntry } from "@/lib/counter/adapters/overview"
import type { ReadingSegment } from "@/lib/counter/adapters/pnl"
import {
  dataOf,
  empty,
  hasData,
  mapReady,
  mapReadyTo,
  notComputed,
  ready,
  stale,
  type EmptyReason,
  type SectionData,
} from "@/lib/counter/section-data"
import type { DeltaTone, FigureProps, MListRow, TagTone, Tone } from "@/components/counter"

/**
 * Labour, classified — for BOTH routes and BOTH surfaces.
 *
 * Four surfaces read this file and nothing beneath it: `/dashboard/labor` and
 * `/m/labor`, `/dashboard/labor/[storeId]` and `/m/labor/[storeId]`. That is
 * the whole point of it existing. The group page and the store page print the
 * same labour percentage for the same week because there is ONE function that
 * decides what a labour percentage is, not because two pages were written
 * carefully. It is the same shape `adapters/analytics.ts` established one
 * page-pair earlier, and it follows that file wherever the two pages ask the
 * same structural question.
 *
 * ## L-R2 / L-R17 — TWO sales figures, and they never converge
 *
 * This is the single easiest thing on this page to get wrong, and getting it
 * "right" by making the two agree is the wrong fix. Measured over
 * 2026-08-20 … 26 at Hollywood, $8,825 of labour on 432.1 hours:
 *
 * | figure | denominator | reads |
 * |---|---|---|
 * | Hourly labour % | the statement's **Total Sales** ($49,389) | **17.9%** |
 * | Sales per labour hour | `OtterHourlySummary.netSales` ($52,550) | **$121.60** |
 *
 * The percent is the P&L's own line: `getAllStoresPnL` computes `laborPct` on
 * `grossSales`, which IS Total Sales, and the Overview's comparison table
 * prints that number. SPLH is `splh-actions.ts`' figure — the one the Overview
 * already prints — and it divides platform net sales by the same Harri hours.
 * Forcing one denominator on both produces either a **12.9%** that contradicts
 * the P&L or a **$114.30** that contradicts the Overview. Two ratios, two
 * questions, two owners; `labor-week.ts` already does the right thing with
 * each and this file's only job is to feed it the right inputs and to NAME the
 * denominator in every caption that carries one.
 *
 * A third appearance of a sales figure USED to be a second, wrong, split: the
 * twelve-week trend's `laborPct` was computed over `OtterHourlySummary` —
 * net sales, `splh`'s figure — because that table is the only per-day
 * sales figure that reaches back twelve weeks without a second rollup over 84
 * days. It read ~12–16% under a 17.9% headline, on the same page, and the
 * mitigation shipped for it was a sentence (`TrendSection.note`) rather than a
 * fix. Task 4b closed it: the trend's `laborPct` is now on the identical Total
 * Sales the headline reads — `loadEverything`'s `trendLoadP` loads a DAILY
 * statement over the trend's own twelve-week span (the same `rowValues`
 * construct `salesByDayOf` uses below) and folds it into `trailingWeeks`' own
 * Monday-start weeks, then hands `loadLaborTrend` the finished per-week map —
 * on the identical contract `salesByDay` already is for `loadLaborWeek`.
 * `splh` is unaffected: it still reads net sales on both the week and
 * the trend, because that split was never the defect.
 *
 * ## L-R1 — there is no floor and there is no band
 *
 * `adapters/overview.ts:343` ruled this already: nothing in this schema
 * publishes an SPLH floor or a labour target, the prototype's `SPLH_FLOOR =
 * 68.00` is its own invention, and `SplhPoint.targetSplh` is the median of the
 * store's own history — the figure judging itself. So: no hit/miss on the week
 * strip, no verdict tag comparing a day to a floor, no rule line on the
 * twelve-week chart, and no sentence claiming a day was good or bad against
 * one.
 *
 * What IS judged, everywhere a judgement appears here, is the schedule the
 * store published for itself. `HarriShift` is the manager's own plan for the
 * day, and reading the hours actually worked against it is not a borrowed
 * target — it is the store's stated intent. That is what the headline's
 * verdict, the schedule section's sentence and the store week table's verdict
 * column all read against, and each of them says which.
 *
 * ## Rule 1 — ONE `loadStatement`, at daily granularity, folded here
 *
 * Ruling A-R13 from the Analytics plan, measured and confirmed there: the
 * database query is identical at either grain (`getAllStoresPnL` fetches every
 * row in the range and only then buckets) and the fold costs ~10 ms on a
 * request whose query alone costs ~590 ms. The statement is loaded ONCE, and
 * its per-day Total Sales is handed to `loadLaborWeek` as `salesByDay` —
 * which is why that loader deliberately does not query sales itself. The
 * display-grain fold happens on the LABOUR DAYS (`foldHours`), not on the
 * statement, because the only section here drawn at the display grain is
 * scheduled-against-actual hours, and hours are not on the statement.
 *
 * ## A-R12 / L-R12 — a reasoned refusal, never an empty shell
 *
 * Van Nuys and Glendale are `pre_open` and carry NO Harri rows at all: not a
 * shift, not an alert, not a position row. Every section resolves either
 * `empty("pre_open")` — whose copy is "Not trading yet · this store has no
 * sales because it has no customers yet", which is exactly the fact and
 * exactly the next step (none) — or, where an OPERATIONAL store is simply
 * missing the rows a section needs, `not_computed` **in that section's own
 * words**. A heading over a blank white panel is the defect this rule exists
 * to prevent, and a previous plan shipped one.
 *
 * `not_computed` is deliberately NOT used for the pre-open case: `Owed`'s copy
 * reads "designed, not yet built", which is a lie about a store that simply has
 * not opened.
 *
 * ## Every caption that depends on data lives INSIDE its section
 *
 * `Section.meta` takes a string or a callback over the section's own data, and
 * under streaming every key of the returned record is a `Promise` — so a
 * caption sitting as a bare sibling string on the sections object is
 * unrenderable. Ruling N-R9, found the hard way. Every `meta`, `sentence` and
 * `note` below is a field of the payload it describes.
 */

/* ── The shapes the pages' primitives render ──────────────────────────── */

/** One strip cell, exactly `Figure`'s props — the same alias every Counter adapter uses. */
export type StripCell = FigureProps

/** A chart, as `chart-geometry` specifies it. `fmt` is the page's — a function cannot cross the RSC boundary. */
export type ChartData = ChartSpec

/**
 * The verdict beside the lead figure — `Say`'s three props.
 *
 * `body` is segments rather than one string for the reason
 * `adapters/pnl.ts`'s `ReadingSegment` gives: the sentence bolds the figure
 * that carries it, WHICH figure that is is a judgement about the data, and an
 * adapter is a server module that writes prose and never markup.
 */
export interface LaborVerdict {
  tone: Tone
  headline: string
  body: ReadingSegment[]
}

/**
 * The head block and the strip, on both surfaces and both routes.
 *
 * `phoneCells` is TWO and is NOT a slice of `cells`: the group phone prints
 * Hourly labour and SPLH, the store phone prints Labour % and Leak, and
 * `cells` itself loses a cell whenever the ledger it depends on fails to load.
 * A page slicing by position would hand the phone the wrong cell on exactly
 * the request where something went wrong.
 */
export interface LaborHeadline {
  /** The one lead figure. `LeadFigure`'s props, narrowed to strings so it crosses the RSC boundary. */
  figure: { label: string; value: string; detail: string; detailTone?: DeltaTone }
  verdict: LaborVerdict
  /** Five on the group desk (L-R3), four on the store desk. */
  cells: StripCell[]
  /** Two. */
  phoneCells: StripCell[]
  /** The store page's own note — what this route adds. `null` on the group page. */
  note: string | null
}

/**
 * One cell of the week strip.
 *
 * `bar` is a WIDTH, 0..100, and it is the day's SPLH over the range's own best
 * hour (L-R13). A bar needs a scale to be drawn at all; a scale is not a
 * verdict, and there is no `hit`/`miss` here because there is nothing published
 * to hit (L-R1).
 */
export interface WeekStripDay {
  key: string
  /** "Wed Aug 26". */
  label: string
  /** "Wed 26" — what the cell prints. */
  short: string
  hours: string
  /** "$121.10 / h", or an em-dash on a day with no hours or no net sales. */
  splh: string
  bar: number
  /**
   * `.wkd.is-today` — TRUE only on the cell that is the real calendar day the
   * page was rendered for, and only when that day is inside the strip.
   *
   * It used to be `i === shown.length - 1`, the last day of the RANGE, which
   * painted `Wed 26` as today on a page rendered on the 27th. `is-today` is not
   * a "here is where the range ends" marker — the strip's own `meta` already
   * names the window — and a reader who trusts it is reading the wrong day's
   * hours as the ones still running. A range entirely in the past marks
   * nothing.
   */
  isToday: boolean
}

export interface LaborWeekStrip {
  days: WeekStripDay[]
  sentence: string
  meta: string
}

/** One row of the store page's week table. Pre-formatted; a figure the rollup has none of is an em-dash. */
export interface WeekTableRow {
  key: string
  /** "Wed Aug 26". */
  day: string
  /** This day's Total Sales — the denominator of the `laborPct` beside it. */
  sales: string
  hours: string
  splh: string
  laborPct: string
  /**
   * What the day COST against the schedule this store published for it, never
   * whether it passed a floor (L-R1). "$223 over the schedule" / "$45 under
   * the schedule" / "on the published schedule" / "no schedule published".
   */
  verdict: string
  verdictTone?: TagTone
}

export interface LaborWeekTable {
  rows: WeekTableRow[]
  meta: string
  /** Says out loud what the verdict column is read against, and what it is not. */
  note: string
}

export interface ScheduleSection {
  chart: ChartData
  /** Shorter, no axis, a legend instead. */
  phoneChart: ChartData
  sentence: string
  meta: string
}

export interface CurveSection {
  chart: ChartData
  /** `staffingCurve`'s own computed sentence (L-R9). Every number in it is ours. */
  sentence: string
  meta: string
}

export interface RoleRow {
  key: string
  role: string
  payType: "HOURLY" | "SALARIED"
  hours: string
  cost: string
  share: string
}

export interface RolesSection {
  rows: RoleRow[]
  /** The table's own last line. `share` is "100.0%" by construction. */
  total: { hours: string; cost: string; share: string }
  /** The phone's `.mlist`, built HERE so the two surfaces cannot format one role two ways. */
  phoneRows: MListRow[]
  meta: string
  /** The salaried line, when it carries nothing. `null` when there is nothing to say. */
  note: string | null
}

/** One row of the leak ledger. `hours`/`cost` are em-dashes on an uncostable code — never "$0" (L-R5). */
export interface LeakRowView {
  key: string
  leak: string
  kind: "leak" | "saving" | "uncostable"
  alerts: string
  hours: string
  cost: string
  people: string
}

export interface LeaksSection {
  /** Leaks first, then savings, then the uncostable codes. */
  rows: LeakRowView[]
  total: { hours: string; cost: string }
  /** The LEAK rows only, as the store desk's queue. Savings are not leaks and are not in it. */
  items: QueueEntry[]
  meta: string
  /** What the dollar total does not include, and why. */
  note: string
}

export interface DecisionSection {
  /** Always at most ONE: the gap is one decision, published in one action (L-R8). */
  items: QueueEntry[]
  meta: string
  note: string
}

export interface TrendSection {
  chart: ChartData
  phoneChart: ChartData
  sentence: string
  meta: string
  /**
   * Used to carry the denominator mismatch disclaimer; that defect is fixed
   * (task 4b) and the note now confirms parity with the headline instead.
   * See `buildTrend`.
   */
  note: string
}

/** The group page — `/dashboard/labor` and `/m/labor`. */
export interface LaborSections {
  headline: SectionData<LaborHeadline>
  week: SectionData<LaborWeekStrip>
  schedule: SectionData<ScheduleSection>
  curve: SectionData<CurveSection>
  roles: SectionData<RolesSection>
  leaks: SectionData<LeaksSection>
  decision: SectionData<DecisionSection>
  trend: SectionData<TrendSection>
}

/** The store page — `/dashboard/labor/[storeId]` and `/m/labor/[storeId]`. */
export interface StoreLaborSections {
  headline: SectionData<LaborHeadline>
  schedule: SectionData<ScheduleSection>
  roles: SectionData<RolesSection>
  leaks: SectionData<LeaksSection>
  /** A TABLE here, with a verdict column — not the group page's strip. */
  week: SectionData<LaborWeekTable>
  trend: SectionData<TrendSection>
}

export interface LaborSectionsInput {
  range: DateRange
  /** `null` = every store on the account. */
  storeId: string | null
  /**
   * The account the reader is on. Every Harri loader scopes its own query by
   * it and none of them can fetch a session itself — importing `@/lib/auth`
   * pulls `@/lib/prisma` in at MODULE LOAD, which throws without a
   * `DATABASE_URL` and takes the page's whole import graph with it.
   * `loadStatement` does not take one: it was forwarded nowhere.
   */
  accountId: string
  /**
   * The calendar day the page is being rendered on, resolved ONCE in
   * `page.tsx` and passed down. Only the week strip's `is-today` reads it.
   *
   * This file still has no clock of its own — `loadEverything` derives the
   * curve's day from the range's end, not from `new Date()`, so the same URL
   * still renders the same figures. `is-today` is the one thing on the page
   * that is genuinely a statement about the reader's day rather than about the
   * window, and it takes the day as an input rather than reading one, because a
   * moving `new Date()` evaluated in two places can disagree about which
   * calendar day it is.
   */
  today: Date
}

/* ── Constants ────────────────────────────────────────────────────────── */

const DASH = "—"

/**
 * How many days the week STRIP holds.
 *
 * The strip is a week — `.wk` is a seven-track grid and the prototype writes
 * seven `.wkd` cells. A ninety-day range folded into ninety cells is not a
 * strip, so the strip takes the range's LAST seven days and its own `meta`
 * says so. The store page's week TABLE is a table and takes every day.
 */
const WEEK_DAYS = 7

/** The trend is twelve weeks on both pages. Note 53: weekly is the cadence the trade runs on. */
const TREND_WEEKS = 12

/**
 * ONE tolerance for "did the schedule hold", decided here and used by every
 * sentence on this page that asks the question.
 *
 * It used to be two. The head block allowed 2% of the published hours, the
 * schedule section allowed a flat 0.25 h, and on the measured window
 * (2026-08-20…26) that put two contradictory sentences 300px apart on the same
 * screen off the same two numbers: 437.0 h published against 432.1 h worked is
 * 1.12% — inside one tolerance, eleven times outside the other. A reader could
 * find the disagreement without leaving the page.
 *
 * The share is the rule that survives, because the flat-hours one is not a
 * tolerance at all at week scale: 0.25 h is a rounding error on a 437-hour week,
 * so "the schedule held" could never be said about a real week and the sentence
 * would be dead copy. 2% is the grain a labour schedule is actually written to —
 * a single person clocking in fifteen minutes early on four shifts of a
 * seven-day week is inside it, and that is a rounding of the roster rather than
 * a schedule that failed.
 *
 * `SCHEDULE_FLAT_FLOOR` exists only so the rule stays sane at the OTHER end of
 * the scale, where the share is applied to a single day (`buildWeekTable`) or a
 * near-empty range: 2% of a 4-hour day is 4.8 minutes, which is below the grain
 * `HarriPositionDaily` even records. Whichever of the two is larger is the
 * allowance.
 */
const SCHEDULE_FLAT_SHARE = 0.02

/** The floor under the share, in hours — see `SCHEDULE_FLAT_SHARE`. */
const SCHEDULE_FLAT_FLOOR = 0.25

/**
 * Did the hours worked hold to the hours published?
 *
 * The ONE predicate behind the head verdict, the schedule section's sentence
 * and the store page's per-day verdict column — so those three can disagree
 * about what a week COST but never about whether it held.
 */
function scheduleHeld(gap: number, scheduled: number): boolean {
  const allowance = Math.max(SCHEDULE_FLAT_FLOOR, Math.abs(scheduled) * SCHEDULE_FLAT_SHARE)
  return Math.abs(gap) <= allowance
}

/** The grain a caption names. `Granularity` reads badly in a sentence. */
const GRAIN_WORD: Record<Granularity, string> = {
  daily: "daily",
  weekly: "weekly",
  monthly: "monthly",
}

/* ── Small formatters ─────────────────────────────────────────────────── */

/** "432.1 h", or an em-dash. Hours are a measurement; absence is not zero hours. */
function hoursText(v: number | null, digits = 1): string {
  if (v === null || !Number.isFinite(v)) return DASH
  return `${v.toFixed(digits)} h`
}

/** "$121.60 / h". */
function rateText(v: number | null): string {
  return v === null || !Number.isFinite(v) ? DASH : `${money(v, { cents: true })} / h`
}

/**
 * An hour on the axis. The same vocabulary `adapters/analytics.ts` writes its
 * hourly axis in — `12a` and `12p` rather than "midnight" and "noon", because
 * those two words are four times the width of every other tick. Copied rather
 * than imported for the reason `dbDay` is copied across the three labour
 * loaders: it is a three-line read, not a shared abstraction, and the module
 * that owns it keeps it private.
 */
function hourLabel(hour: number): string {
  if (hour === 0) return "12a"
  if (hour === 12) return "12p"
  return hour < 12 ? `${hour}a` : `${hour - 12}p`
}

/**
 * "Mon Aug 31", off a `YYYY-MM-DD` key.
 *
 * `scheduleGap` answers in ISO keys because it compares them to a set of
 * them; a reader reads days. The parts are fed to a LOCAL `Date` rather than
 * `new Date(iso)`, which parses as UTC and prints the previous day west of
 * Greenwich.
 */
function isoDayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number)
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(y, (m ?? 1) - 1, d ?? 1))
}

/** "Wed 26", off `LaborDay`'s own "Wed Aug 26" and its ISO key. */
function shortDayLabel(day: LaborDay): string {
  const dow = day.label.split(" ")[0] ?? ""
  return `${dow} ${Number(day.key.slice(8, 10))}`
}

/* ── Streaming plumbing ───────────────────────────────────────────────── */

/**
 * `mapReadyTo`'s asynchronous sibling: run a LOADER on a section that already
 * has data, and carry every other status through untouched.
 *
 * This is what sequences the leak ledger behind the labour week. The ledger
 * costs its hours at `LaborWeek.blendedRate` and cannot be started before that
 * rate exists — racing the two would mean either a second rate computed here
 * (the defect `labor-leaks.ts`' own module comment describes) or a ledger
 * costed at zero.
 */
async function chainReady<T, U>(
  sd: SectionData<T>,
  load: (value: T) => Promise<SectionData<U>>,
): Promise<SectionData<U>> {
  if (sd.status === "ready") return load(sd.data)
  if (sd.status === "stale") {
    const next = await load(sd.data)
    return next.status === "ready" ? stale(next.data, sd.lastGoodAt) : next
  }
  return carry(sd)
}

/** A non-data status, carried across a change of payload type. */
function carry<T, U>(sd: SectionData<T>): SectionData<U> {
  return mapReady(sd, () => undefined as never)
}

/**
 * One decision about what this page is looking at, applied to a section that
 * does its own loading.
 *
 * The staffing curve, the schedule gap and the twelve-week trend are all
 * independent of the statement and start in the same tick as it does — but a
 * `pre_open` store must not report them as owed work when the real answer is
 * that the store has not opened. So they load eagerly and are GATED on the
 * scope afterwards, which costs one query on a pre-open store and keeps every
 * section on a trading store streaming in parallel.
 */
function gate<S, T>(scope: SectionData<S>, sd: SectionData<T>): SectionData<T> {
  return hasData(scope) ? sd : carry(scope)
}

/* ── Scope ────────────────────────────────────────────────────────────── */

type StoreFile = Awaited<ReturnType<typeof getStores>>[number]

/**
 * Note 23's outcomes, in note 23's order — with ONE deliberate difference from
 * `adapters/analytics.ts`' copy of this rule.
 *
 * A store the account does not own is `no_match` before anything else is
 * asked. An account whose stores have all not opened is `pre_open`, which is a
 * fact about the store rather than a filter problem and has no back-out.
 *
 * **What is NOT here is a `grossSales <= 0` test.** Analytics refuses a range
 * that caught no trade, because every section on that page is a reading of
 * sales. This page's subject is HOURS: a day can carry a shift and no sale
 * (a prep day, a closure, a sync that has not landed), and refusing the whole
 * page for it would hide the labour that was actually paid for. Each section
 * decides for itself whether the rows it needs exist, and says so in its own
 * words.
 */
function scopeReason(
  s: Statement,
  files: StoreFile[],
  storeId: string | null,
): EmptyReason | null {
  if (s.storeNotFound) return "no_match"
  const scope = storeId === null ? files : files.filter((f) => f.id === storeId)
  if (scope.length > 0 && !scope.some(isOperational)) return "pre_open"
  return null
}

/**
 * The statement's Total Sales, one reading per calendar day, keyed
 * `YYYY-MM-DD`.
 *
 * This is L-R2's whole mechanism: `loadLaborWeek` takes this map and computes
 * `laborPct` on it, so the labour percentage on this page and the labour line
 * on the P&L are the same division of the same two numbers.
 *
 * The key comes from the RANGE's own calendar (`range.start + i`), not from a
 * bucket's label: `buildPeriods` formats its daily labels in the server's local
 * time off a UTC-floored cursor, and a reader's day is the restaurant's day.
 */
function salesByDayOf(daily: Statement, range: DateRange): Map<string, number> {
  const net = rowValues(daily.rows, TOTAL_SALES_CODE) ?? []
  const out = new Map<string, number>()
  for (let i = 0; i < dayCount(range); i++) {
    const d = new Date(
      range.start.getFullYear(),
      range.start.getMonth(),
      range.start.getDate() + i,
    )
    out.set(isoDay(d), net[i] ?? 0)
  }
  return out
}

/**
 * `salesByDayOf`'s per-day map, summed into the TREND's own Monday-start
 * weeks — task 4b, `loadLaborTrend`'s `weeklyTotalSales`.
 *
 * Windows come from `trailingWeeks` (note 53), never re-derived by hand: a
 * hand-rolled "start + 7 days" walk is exactly the class of bug `toQueryBounds`
 * and `buildPeriods` were fixed for this week (a DST transition silently
 * shifting a boundary by a day). Keyed by `isoDay(window.start)`, the same
 * string `LaborTrendWeek.key` already is, so `loadLaborTrend` can look a
 * week's Total Sales up by the same key it labels its own bar with.
 */
function weeklySalesOf(salesByDay: Map<string, number>, windows: WeekWindow[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const w of windows) {
    let total = 0
    for (let i = 0; i < w.days; i++) {
      const d = new Date(w.start.getFullYear(), w.start.getMonth(), w.start.getDate() + i)
      total += salesByDay.get(isoDay(d)) ?? 0
    }
    out.set(isoDay(w.start), total)
  }
  return out
}

/** What every section below is built from: one labour load, folded three ways. */
interface LaborData {
  days: LaborDay[]
  roles: LaborRole[]
  week: LaborWeek
  salesByDay: Map<string, number>
}

/** True when Harri has nothing at all for this range — no hours, no cost, no schedule. */
function noHarriRows(d: LaborData): boolean {
  return (
    d.week.actualHours === 0 && d.week.cost === 0 && d.week.scheduledHours === null
  )
}

/** The words every labour section uses when an operational store simply has no rows. */
const NO_HARRI_OWED =
  "hours for this range — HarriPositionDaily and HarriShift carry no row inside it, " +
  "so there is nothing worked and nothing published to read"

/* ── The head block ───────────────────────────────────────────────────── */

/**
 * The verdict, derived — never the prototype's "On plan, with one short
 * shift", which is a fixture.
 *
 * What it reads against is the schedule this store published for itself, which
 * is the only plan this schema carries (L-R1). A range with no published shift
 * at all is not judged: it says so and stops, because there is nothing to be
 * on or off.
 */
function buildVerdict(week: LaborWeek, ledger: LeakLedger | null): LaborVerdict {
  const body: ReadingSegment[] = []
  const say = (text: string) => body.push({ text })
  const strong = (text: string) => body.push({ text, strong: true })

  strong(hoursText(week.actualHours))
  say(" cost ")
  strong(money(week.cost))
  if (week.laborPct !== null) {
    say(" — ")
    strong(pct(week.laborPct, { scaled: true }))
    say(" of Total Sales")
  }
  if (week.splh !== null) {
    say(`${week.laborPct === null ? " — " : ", and "}`)
    strong(money(week.splh, { cents: true }))
    say(" of net sales for every hour worked")
  }
  say(".")

  const scheduled = week.scheduledHours
  const rate = week.blendedRate
  let tone: Tone = "good"
  let headline = "On the published schedule"

  if (scheduled === null) {
    tone = "warn"
    headline = "No published schedule"
    say(
      " No shift is published for this range, so the hours above are not read against a plan — " +
        "the only plan this schema carries is the schedule the store publishes for itself, and " +
        "none was published here.",
    )
  } else {
    const gap = week.actualHours - scheduled
    if (scheduleHeld(gap, scheduled)) {
      say(` That is ${hoursText(scheduled)} published and ${hoursText(week.actualHours)} worked — the schedule held.`)
    } else {
      tone = gap > 0 ? "warn" : "good"
      headline = gap > 0 ? "Over the published schedule" : "Under the published schedule"
      say(" That is ")
      strong(`${hoursText(Math.abs(gap))} ${gap > 0 ? "over" : "under"}`)
      say(` the ${hoursText(scheduled)} published`)
      say(rate === null ? "." : `, about ${money(Math.abs(gap) * rate)} of labour.`)
    }
  }

  if (ledger !== null && ledger.leakedHours > 0) {
    say(` ${hoursText(ledger.leakedHours)} went to clock-ins and clock-outs the schedule did not ask for — `)
    strong(money(ledger.leakedCost))
    say(".")
  }

  return { tone, headline, body }
}

/**
 * The group strip — FIVE cells, not the prototype's six (L-R3).
 *
 * "With salaried" is dropped: `Store.fixedMonthlyLabor` is 0 for Hollywood and
 * `HarriPositionDaily`'s SALARIED rows carry $0 and 0 seconds, so the cell
 * would print the identical percentage to the one beside it. A figure repeated
 * is not a second figure.
 *
 * EVERY qualifier here goes in the DELTA slot with `is-flat`, and that is not
 * decoration. `.strip .d` with no tone class is `var(--good)`, so a delta slot
 * holding a QUALIFIER rather than a movement — a denominator, an hours total,
 * a dollar figure — comes out painted green for having moved nowhere. The two
 * cells that ARE a cost carry `is-down`. Nothing here carries a `caption`:
 * `MCell` opens its band only inside `reference ? … : ''`, so a caption with no
 * reference is invisible on the phone and an extra landmark on the desk
 * (A-R22).
 */
function buildStrip(
  week: LaborWeek,
  ledger: LeakLedger | null,
  totalSales: number,
): StripCell[] {
  const cells: StripCell[] = [
    {
      label: "Hourly labor",
      value: pct(week.laborPct, { scaled: true }),
      delta: `${money(week.cost)} of ${money(totalSales)} Total Sales`,
      deltaTone: "is-flat",
    },
    {
      label: "Hours",
      value: hoursText(week.actualHours, 0),
      delta:
        week.scheduledHours === null
          ? "no schedule published"
          : `${hoursText(week.scheduledHours, 0)} published`,
      deltaTone: "is-flat",
    },
    {
      label: "Sales / labor hour",
      value: money(week.splh, { cents: true }),
      // Names the OTHER denominator, out loud, right beside the cell that
      // carries the first one. See the module comment.
      delta: "net sales over hours worked",
      deltaTone: "is-flat",
    },
    {
      label: "Overtime",
      // L-R4: `HarriPositionDaily.overtimeAmount` is USD and no
      // overtime-hours column exists anywhere in this schema. The prototype's
      // "3.5 h · one person" cannot be answered, so the cell prints dollars
      // and its qualifier says what it is.
      value: money(week.overtimeCost),
      delta: "premium pay · no hours column exists",
      deltaTone: week.overtimeCost > 0 ? "is-down" : "is-flat",
    },
  ]

  // A ledger that failed to load takes its own cell with it rather than
  // printing a zero — no alerts and no answer are different sentences.
  if (ledger !== null) {
    cells.push({
      label: "Leaked hours",
      value: hoursText(ledger.leakedHours),
      delta:
        week.blendedRate === null
          ? money(ledger.leakedCost)
          : `${money(ledger.leakedCost)} at ${rateText(week.blendedRate)}`,
      deltaTone: ledger.leakedHours > 0 ? "is-down" : "is-flat",
    })
  }

  return cells
}

/** The store desk's four (`P.laborstore.desk()`): the group's, without Overtime, and with the leak as one cell. */
function buildStoreStrip(
  week: LaborWeek,
  ledger: LeakLedger | null,
  totalSales: number,
): StripCell[] {
  const group = buildStrip(week, ledger, totalSales)
  const cells: StripCell[] = [group[0], group[1], group[2]]
  if (ledger !== null) {
    cells.push({
      label: "Leak",
      value: hoursText(ledger.leakedHours),
      delta: `${money(ledger.leakedCost)} · clock-in and clock-out`,
      deltaTone: ledger.leakedHours > 0 ? "is-down" : "is-flat",
    })
  }
  return cells
}

function buildHeadline(input: {
  week: LaborWeek
  ledger: LeakLedger | null
  totalSales: number
  store: boolean
}): LaborHeadline {
  const { week, ledger, totalSales, store } = input

  const cells = store
    ? buildStoreStrip(week, ledger, totalSales)
    : buildStrip(week, ledger, totalSales)

  const laborCell: StripCell = {
    label: store ? "Labor" : "Hourly labor",
    value: pct(week.laborPct, { scaled: true }),
    delta: "of Total Sales",
    deltaTone: "is-flat",
  }
  const phoneCells: StripCell[] = [laborCell]
  if (store && ledger !== null) {
    phoneCells.push({
      label: "Leak",
      value: hoursText(ledger.leakedHours),
      delta: money(ledger.leakedCost),
      deltaTone: ledger.leakedHours > 0 ? "is-down" : "is-flat",
    })
  } else {
    phoneCells.push({
      label: "SPLH",
      value: money(week.splh, { cents: true }),
      delta: "net sales an hour",
      deltaTone: "is-flat",
    })
  }

  return {
    figure: {
      label: "Hourly labor",
      value: pct(week.laborPct, { scaled: true }),
      detail: "of Total Sales · the P&L's own denominator",
      detailTone: "is-flat",
    },
    verdict: buildVerdict(week, ledger),
    cells,
    phoneCells,
    note: store
      ? "The group page answers for every store at once. This one answers for the store " +
        "whose schedule you are about to change — the week day by day, the role split and " +
        "the leak ledger for this floor and no other."
      : null,
  }
}

/* ── The week, day by day ─────────────────────────────────────────────── */

/**
 * The strip (L-R13).
 *
 * The bar is the day's SPLH over the range's own best hour — a proportional
 * bar off a real zero, rather than the prototype's `(splh − 55) / 25`, which
 * is a window drawn around a floor that does not exist. Nothing is coloured by
 * a verdict, because nothing here is judged (L-R1); a day with no reading gets
 * no bar rather than a bar of zero length painted as a failure.
 */
function buildWeekStrip(days: LaborDay[], range: DateRange, today: Date): LaborWeekStrip {
  const shown = days.slice(-WEEK_DAYS)
  const best = shown.reduce<number>(
    (m, d) => (d.splh !== null && d.splh > m ? d.splh : m),
    0,
  )

  // The one calendar day the page was rendered for, as the same `YYYY-MM-DD`
  // key `LaborDay` carries. `isoDay` reads LOCAL getters, which is what makes
  // this comparable to a `HarriPositionDaily` day key at all; `today` itself is
  // resolved ONCE in `page.tsx` and handed down, so nothing here can evaluate a
  // second `new Date()` that disagrees about which day it is.
  const todayKey = isoDay(today)

  const cells: WeekStripDay[] = shown.map((d) => ({
    key: d.key,
    label: d.label,
    short: shortDayLabel(d),
    hours: hoursText(d.actualHours),
    splh: rateText(d.splh),
    bar: d.splh === null || best <= 0 ? 0 : Math.max(0, Math.min(100, (d.splh / best) * 100)),
    isToday: d.key === todayKey,
  }))

  const withSplh = shown.filter((d) => d.splh !== null)
  const top = withSplh.reduce<LaborDay | null>(
    (acc, d) => (acc === null || (d.splh as number) > (acc.splh as number) ? d : acc),
    null,
  )
  const bottom = withSplh.reduce<LaborDay | null>(
    (acc, d) => (acc === null || (d.splh as number) < (acc.splh as number) ? d : acc),
    null,
  )

  const sentence =
    top === null || bottom === null
      ? "No day in this range has both hours worked and net sales, so no day has a rate to read."
      : top.key === bottom.key
        ? `Only ${top.label} carries both hours and sales in this range, at ${rateText(top.splh)}.`
        : `${top.label} bought the most for its hours at ${rateText(top.splh)}; ` +
          `${bottom.label} the least at ${rateText(bottom.splh)} — a spread of ` +
          `${money((top.splh as number) - (bottom.splh as number), { cents: true })} an hour.`

  return {
    days: cells,
    sentence,
    // Says what the bar is scaled to, which is the whole of L-R13: a scale is
    // not a verdict, and a reader must not read the longest bar as a pass.
    meta:
      `${count(cells.length)} days · ` +
      (days.length > cells.length ? `the last ${count(cells.length)} of ${rangeLabel(range, "custom")} · ` : "") +
      "each bar is that day's sales an hour against the range's own best, not against a floor",
  }
}

/**
 * The store page's week TABLE, newest first.
 *
 * The verdict column says what the day COST against the schedule the store
 * published for it — never whether it cleared a floor (L-R1). Measured:
 * 2026-08-25 worked 59.4 hours against 48.5 published, which at that range's
 * blended rate is about $223 of labour nobody planned for. That is a figure an
 * owner can act on; "under the floor" is a figure this schema cannot produce.
 */
function buildWeekTable(
  days: LaborDay[],
  week: LaborWeek,
  salesByDay: Map<string, number>,
): LaborWeekTable {
  const rate = week.blendedRate

  const rows: WeekTableRow[] = days
    .map((d) => {
      const sales = salesByDay.get(d.key) ?? null
      let verdict = "no schedule published"
      let verdictTone: TagTone | undefined

      if (d.scheduledHours !== null) {
        const gap = d.actualHours - d.scheduledHours
        if (scheduleHeld(gap, d.scheduledHours)) {
          verdict = "on the published schedule"
        } else if (rate === null) {
          verdict = `${hoursText(Math.abs(gap))} ${gap > 0 ? "over" : "under"} the schedule`
          verdictTone = gap > 0 ? "warn" : "good"
        } else {
          verdict = `${money(Math.abs(gap) * rate)} ${gap > 0 ? "over" : "under"} the schedule`
          verdictTone = gap > 0 ? "warn" : "good"
        }
      }

      return {
        key: d.key,
        day: d.label,
        sales: sales === null ? DASH : money(sales),
        hours: hoursText(d.actualHours),
        splh: rateText(d.splh),
        laborPct: pct(d.laborPct, { scaled: true }),
        verdict,
        verdictTone,
      }
    })
    .reverse()

  return {
    rows,
    meta: `${count(rows.length)} days · newest first`,
    note:
      "The verdict reads each day against the shifts this store published for it — its own " +
      "plan, priced at the range's blended rate. Nothing here is measured against a " +
      "sales-per-labour-hour floor: this schema publishes none, and a floor invented for the " +
      "page would be the page judging itself. Sales and Labor % are the statement's Total " +
      "Sales; SPLH divides net sales instead, which is what the figure has always meant " +
      "elsewhere in the product — so SPLH times hours will not equal the Sales column, and " +
      "is not meant to.",
  }
}

/* ── Scheduled against actual ─────────────────────────────────────────── */

/**
 * The labour days, regrouped into the range's display grain.
 *
 * `buildPeriods` with the SAME bounds the statement was loaded with and the
 * display granularity, so these buckets are exactly the ones `getAllStoresPnL`
 * would have returned had it been asked for them — one labeller, not a second
 * vocabulary for the same weeks. It is the analogue of `analytics.ts`'s
 * `foldStatement`, applied to hours instead of dollars, because hours are not
 * on the statement.
 *
 * A bucket's `scheduled` is `null` only when EVERY day inside it published no
 * shift at all. One published day in a week makes the week a schedule, not an
 * absence — the same rule `foldStatement` applies to an unknown period.
 */
function foldHours(
  days: LaborDay[],
  range: DateRange,
  granularity: Granularity,
): { labels: string[]; actual: number[]; scheduled: (number | null)[] } {
  if (granularity === "daily") {
    return {
      labels: days.map((d) => d.label),
      actual: days.map((d) => d.actualHours),
      scheduled: days.map((d) => d.scheduledHours),
    }
  }

  const { startDate, endDate } = toQueryBounds(range)
  const display = buildPeriods(startDate, endDate, granularity)
  if (display.length === 0) {
    return {
      labels: days.map((d) => d.label),
      actual: days.map((d) => d.actualHours),
      scheduled: days.map((d) => d.scheduledHours),
    }
  }

  const actual = new Array<number>(display.length).fill(0)
  const scheduled = new Array<number | null>(display.length).fill(null)

  days.forEach((d, i) => {
    const t = Date.UTC(
      range.start.getFullYear(),
      range.start.getMonth(),
      range.start.getDate() + i,
    )
    let b = display.findIndex(
      (p) => t >= p.startDate.getTime() && t <= p.endDate.getTime(),
    )
    if (b === -1) b = display.length - 1
    actual[b] += d.actualHours
    if (d.scheduledHours !== null) scheduled[b] = (scheduled[b] ?? 0) + d.scheduledHours
  })

  return { labels: display.map((p) => p.label), actual, scheduled }
}

function buildSchedule(
  days: LaborDay[],
  week: LaborWeek,
  range: DateRange,
  granularity: Granularity,
): ScheduleSection {
  const folded = foldHours(days, range, granularity)

  const series: ChartSeries[] = [
    { name: "Actual", color: "var(--ink)", data: folded.actual, fill: true },
  ]
  // A range with no published shift anywhere draws ONE series, not a second
  // one of nulls: a dashed line along the axis would claim a schedule of zero
  // hours, which is a different thing from no schedule.
  if (week.scheduledHours !== null) {
    series.unshift({
      name: "Scheduled",
      color: "var(--ink-3)",
      // A bucket with no published shift is a GAP in the reference line, not
      // a zero: `ChartSeries.data` carries nulls for exactly this.
      data: folded.scheduled,
      dash: true,
      w: 1.5,
    })
  }

  const chart: ChartData = {
    type: "line",
    h: 158,
    zero: true,
    labels: folded.labels,
    series,
    legend: true,
    alt: "Scheduled against actual hours",
  }

  const scheduled = week.scheduledHours
  const rate = week.blendedRate
  let sentence: string
  if (scheduled === null) {
    sentence =
      `${hoursText(week.actualHours)} were worked in this range and no shift was published ` +
      "against them, so there is nothing to read the hours against."
  } else {
    const gap = week.actualHours - scheduled
    // The SAME predicate the head block's verdict asks (`scheduleHeld`), so the
    // two sentences cannot reach opposite readings of the same two numbers.
    sentence = scheduleHeld(gap, scheduled)
      ? `${hoursText(scheduled)} published, ${hoursText(week.actualHours)} worked — the schedule held.`
      : `${hoursText(scheduled)} published, ${hoursText(week.actualHours)} worked — ` +
        `${hoursText(Math.abs(gap))} ${gap > 0 ? "over" : "under"}` +
        (rate === null ? "." : `, about ${money(Math.abs(gap) * rate)} of labour.`)
  }

  return {
    chart,
    phoneChart: { ...chart, h: 116, ticks: false, legend: true },
    sentence,
    meta: `${rangeLabel(range, "custom")} · ${GRAIN_WORD[granularity]} buckets`,
  }
}

/* ── The staffing curve ───────────────────────────────────────────────── */

/**
 * The curve, as two shapes rather than two levels — and this is a departure
 * from the prototype that the data forces.
 *
 * The prototype draws "Scheduled" and "Needed by demand" as two series of
 * PEOPLE, which works because both are invented. We have people on one side
 * (`HarriShift`) and ORDERS on the other (`ForecastHourlyOrders`), and nothing
 * in this schema converts between them: turning forecast orders into "people
 * needed" requires an orders-per-person rate, which would be this page
 * inventing a productivity standard and then grading the schedule against it —
 * the same defect as the SPLH floor (L-R1).
 *
 * A shared linear axis is not an option either: 3–6 people against 5–39 orders
 * draws the schedule as a flat line on the floor and implies the two are
 * comparable quantities. `ChartSpec` carries ONE formatter for the whole
 * chart, which settles it — one chart, one unit.
 *
 * So both series are drawn against THEIR OWN peak, as a percentage of it, and
 * `meta` says so. That is exactly the claim the section makes — L-R9's
 * measured finding is that **staffing steps up an hour after demand peaks**,
 * which is a statement about shape and not about level — and the absolute
 * figures for every hour are in that column's own note, where the tooltip
 * prints them.
 */
function buildCurve(curve: StaffingCurve, label: string): CurveSection {
  const peakPeople = curve.hours.reduce((m, h) => Math.max(m, h.scheduled), 0)
  const peakDemand = curve.hours.reduce(
    (m, h) => (h.demand !== null && h.demand > m ? h.demand : m),
    0,
  )

  const share = (v: number | null, peak: number): number | null =>
    v === null || peak <= 0 ? null : (v / peak) * 100

  const chart: ChartData = {
    type: "line",
    h: 152,
    zero: true,
    labels: curve.hours.map((h) => hourLabel(h.hour)),
    series: [
      {
        name: "Scheduled people",
        color: "var(--ink-3)",
        data: curve.hours.map((h) => share(h.scheduled, peakPeople)),
        w: 1.5,
      },
      {
        name: "Forecast orders",
        color: "var(--ink)",
        data: curve.hours.map((h) => share(h.demand, peakDemand)),
        fill: true,
      },
    ],
    notes: curve.hours.map((h) =>
      h.demand === null
        ? `${count(h.scheduled)} scheduled · no forecast`
        : `${count(h.scheduled)} scheduled · ${h.demand.toFixed(1)} forecast orders`,
    ),
    legend: true,
    alt: `Scheduled people against forecast orders on ${label}`,
  }

  return {
    chart,
    sentence: curve.sentence,
    meta:
      `the schedule for ${label} · each series against its own peak — people and orders ` +
      "share no unit, and the counts are in each hour's own tooltip",
  }
}

/* ── By role ──────────────────────────────────────────────────────────── */

/**
 * Hours, cost and share by position.
 *
 * A SALARIED position carrying $0 and no hours is KEPT (measured: Operator).
 * `laborRole` gives it `share: 0` rather than dropping it, because an empty
 * salaried line is an answer and a missing row says nothing at all — `note`
 * is what turns that from a puzzling zero into the fact it is.
 */
function buildRoles(roles: LaborRole[], week: LaborWeek): RolesSection {
  const rows: RoleRow[] = roles.map((r) => ({
    key: `${r.position}|${r.payType}`,
    role: r.position,
    payType: r.payType,
    hours: hoursText(r.hours),
    cost: money(r.cost),
    share: pct(r.share, { scaled: true }),
  }))

  const empties = roles.filter((r) => r.payType === "SALARIED" && r.cost === 0 && r.hours === 0)

  return {
    rows,
    total: {
      hours: hoursText(week.actualHours),
      cost: money(week.cost),
      // Not recomputed from the rows: the shares are a partition of this same
      // cost by construction, and a second sum is a second answer.
      share: roles.length > 0 ? pct(100, { scaled: true }) : DASH,
    },
    phoneRows: roles.map((r) => ({
      key: `${r.position}|${r.payType}`,
      title: r.position,
      detail: `${hoursText(r.hours)} · ${pct(r.share, { scaled: true })}`,
      value: money(r.cost),
    })),
    meta: `${count(rows.length)} positions · ${hoursText(week.actualHours)} · ${money(week.cost)}`,
    note:
      empties.length === 0
        ? null
        : `${empties.map((r) => r.position).join(", ")} ${empties.length === 1 ? "is" : "are"} ` +
          "salaried and post no hours and no cost against this range. The row is kept because " +
          "an empty salaried line is an answer; dropping it would say nothing at all.",
  }
}

/* ── Where the hours leaked ───────────────────────────────────────────── */

/** Leaks first, then savings, then the codes nobody can cost. */
const LEAK_ORDER: Record<"leak" | "saving" | "uncostable", number> = {
  leak: 0,
  saving: 1,
  uncostable: 2,
}

/**
 * The ledger, as a table for the group desk and a queue for the store desk.
 *
 * BOTH are built here, off one `LeakLedger`, and the queue holds the LEAK rows
 * only. L-R5 is the whole reason: `LATE_CLOCK_IN` and `EARLY_CLOCK_OUT` are
 * the store paying for LESS time than it scheduled, and a "where the hours
 * leaked" queue listing them would report a saving as a cost. Measured, a
 * sign-blind sum reads 24.94 hours against the true 13.47.
 *
 * The three codes with a null `timeDiffSec` keep em-dashes for hours and cost.
 * `$0` would be the claim that a missed clock-out cost nothing; the truth is
 * that nobody measured what it cost.
 */
function buildLeaks(ledger: LeakLedger, week: LaborWeek): LeaksSection {
  const sorted = [...ledger.rows].sort((a, b) => {
    const k = LEAK_ORDER[a.kind] - LEAK_ORDER[b.kind]
    if (k !== 0) return k
    return (b.hours ?? 0) - (a.hours ?? 0) || b.alerts - a.alerts
  })

  const rows: LeakRowView[] = sorted.map((r) => ({
    key: r.code,
    leak: r.label,
    kind: r.kind,
    alerts: count(r.alerts),
    hours: r.hours === null ? DASH : hoursText(r.hours),
    cost: r.cost === null ? DASH : money(r.cost),
    people: count(r.people),
  }))

  const items: QueueEntry[] = sorted
    .filter((r) => r.kind === "leak" && (r.hours ?? 0) > 0)
    .map((r) => ({
      key: r.code,
      tone: "warn" as Tone,
      lead: (r.hours as number).toFixed(1),
      unit: "h",
      title: r.label,
      body:
        `${count(r.alerts)} alert${r.alerts === 1 ? "" : "s"} across ${count(r.people)} ` +
        `${r.people === 1 ? "person" : "people"}, ${money(r.cost)} at the range's blended rate ` +
        `of ${rateText(week.blendedRate)}. It is time the store paid for and the schedule did not ask for.`,
    }))

  const savings = ledger.rows.filter((r) => r.kind === "saving")
  const savedHours = savings.reduce((t, r) => t + (r.hours ?? 0), 0)

  return {
    rows,
    total: { hours: hoursText(ledger.leakedHours), cost: money(ledger.leakedCost) },
    items,
    meta: `${hoursText(ledger.leakedHours)} · ${money(ledger.leakedCost)} at ${rateText(week.blendedRate)}`,
    note:
      `The total is the two LEAK codes only — time paid for that the schedule did not ask for. ` +
      (savings.length > 0
        ? `Clocking in late and out early ran the other way, ${hoursText(savedHours)} of it, and ` +
          "adding those in would report a saving as a cost. "
        : "") +
      (ledger.uncostableAlerts > 0
        ? `${count(ledger.uncostableAlerts)} further alerts — the missed and unscheduled clock-ins — ` +
          "carry no duration at all in Harri, so they are counted and named and never given a dollar figure."
        : "Every alert in this range carries a duration."),
  }
}

/* ── Needs a decision ─────────────────────────────────────────────────── */

/**
 * L-R8: the decision is derived, and it is NOT the prototype's hardcoded
 * "Saturday 2–6pm is short".
 *
 * Measured, the real open decision is that the published schedule runs out
 * before the demand forecast does — from 2026-08-27 the schedule reaches
 * 2026-08-30 and the forecast reaches 2026-09-09.
 *
 * It is ONE item and not one per day, deliberately. Publishing a schedule for
 * an uncovered stretch is a single action a manager takes once; a queue of ten
 * near-identical cards is the same decision printed ten times, and `.qitem` is
 * a fidelity landmark the prototype writes exactly one of. The whole stretch —
 * how many days, the nearest, the furthest, and what the nearest carries — is
 * in the body.
 */
function buildDecision(gap: Array<{ date: string; forecastOrders: number }>): DecisionSection {
  const first = gap[0]
  const last = gap[gap.length - 1]
  const orders = gap.reduce((t, g) => t + g.forecastOrders, 0)

  return {
    items: [
      {
        key: "schedule-gap",
        tone: "warn",
        lead: count(gap.length),
        unit: gap.length === 1 ? "day" : "days",
        title: "The schedule runs out before the forecast does",
        body:
          `The demand forecast covers ${count(gap.length)} day${gap.length === 1 ? "" : "s"} ` +
          `that carry no published shift at all. The nearest is ${isoDayLabel(first.date)}, with ` +
          `${count(Math.round(first.forecastOrders))} forecast orders; the furthest is ` +
          `${isoDayLabel(last.date)}. ` +
          `Together they are ${count(Math.round(orders))} orders with nobody rostered against them.`,
      },
    ],
    meta: `${count(gap.length)} open`,
    note:
      "Counted against the newest generation of the forecast only. ForecastHourlyOrders keeps " +
      "every model generation, and summing it raw over one week is thirteen times the real " +
      "figure.",
  }
}

/* ── Twelve weeks ─────────────────────────────────────────────────────── */

/**
 * The trend, with NO rule and NO band (L-R10).
 *
 * The prototype draws a 23.9–26.2% band and a `26.2` rule; the Overview's own
 * note already records `targets.labor` as `null`, because nothing in this
 * schema publishes a labour target. A rule drawn here would be a line this
 * page invented and then graded twelve weeks against.
 *
 * `laborPct` here is over TOTAL SALES — the identical denominator the
 * headline above it uses (task 4b). `note` no longer carries a denominator
 * disclaimer: there is nothing left to disclaim, because the two figures are
 * now the same division of the same two numbers for the same week.
 */
function buildTrend(weeks: LaborTrendWeek[]): TrendSection {
  const chart: ChartData = {
    type: "bars",
    h: 140,
    labels: weeks.map((w) => w.label),
    series: [
      {
        name: "Labor % of Total Sales",
        color: "var(--ink)",
        data: weeks.map((w) => w.laborPct),
      },
    ],
    notes: weeks.map(
      (w) =>
        `${money(w.cost)} · ${hoursText(w.hours, 0)}${w.isPartial ? " · part week" : ""}`,
    ),
    alt: "Labour as a share of Total Sales, twelve weeks",
  }

  const full = weeks.filter((w) => !w.isPartial && w.laborPct !== null)
  const newest = full[full.length - 1] ?? null
  const oldest = full[0] ?? null

  let sentence: string
  if (newest === null || oldest === null) {
    sentence = "No full week in this window carries both labour and sales, so there is no trend to read."
  } else if (newest.key === oldest.key) {
    sentence =
      `One full week in this window has a reading: ${newest.label}, at ` +
      `${pct(newest.laborPct, { scaled: true })} of Total Sales. Twelve of them is what makes a trend.`
  } else {
    sentence =
      `Labour ran ${pct(newest.laborPct, { scaled: true })} of Total Sales in the week of ` +
      `${newest.label}, against ${pct(oldest.laborPct, { scaled: true })} in the week of ` +
      `${oldest.label} — ${points((newest.laborPct as number) - (oldest.laborPct as number))} ` +
      "across the window."
  }

  // L-R11: a part week is labelled, never averaged in silently and never
  // scaled up to a notional seven days.
  const partial = weeks.find((w) => w.isPartial) ?? null
  if (partial !== null && full.length > 0) {
    const norm = full.reduce((t, w) => t + w.hours, 0) / full.length
    sentence +=
      ` The last column is a part week — ${hoursText(partial.hours, 0)} against a ` +
      `${hoursText(norm, 0)} norm — drawn short rather than scaled up.`
  }

  return {
    chart,
    phoneChart: { ...chart, h: 116, ticks: false },
    sentence,
    meta: `${count(weeks.length)} weeks · Monday to Sunday · share of Total Sales`,
    // The denominator disclaimer this note used to carry described a defect
    // that no longer exists (task 4b) and nothing else was in it worth
    // keeping, so it now states the fact that replaced the disclaimer: this
    // chart and the headline above it read the same denominator.
    note: "Same denominator as the headline above — Total Sales, off the same statement.",
  }
}

/* ── The loads, shared by both routes ─────────────────────────────────── */

/**
 * Everything both pages load, started in one tick.
 *
 * The only sequencing here is the one the pre-flight scan found and that
 * `labor-leaks.ts` requires: statement → labour week → leak ledger. The
 * ledger costs its hours at `LaborWeek.blendedRate`, so it cannot be raced
 * with the load that produces that rate. Everything else — the staffing curve,
 * the schedule gap, the twelve-week trend, the store list — starts immediately
 * and is gated on the scope afterwards.
 */
function loadEverything(input: LaborSectionsInput) {
  const { range, storeId, accountId } = input

  /*
   * The day the curve and the schedule gap look at: the day AFTER the range
   * ends. Both sections are about the schedule that has not been worked yet,
   * and the range is behind them; deriving the day from the range rather than
   * from `new Date()` keeps this file free of a clock, so the same URL renders
   * the same page. On the measured window (2026-08-20…26) that is 2026-08-27,
   * and on the trailing `d7` the fidelity gate runs it is 2026-08-28 — the day
   * L-R9's curve was measured on.
   */
  const nextDay = new Date(
    range.end.getFullYear(),
    range.end.getMonth(),
    range.end.getDate() + 1,
  )

  // Rule 1 / A-R13: DAILY, once, whatever the display grain is.
  const dailyP = classify(() => loadStatement({ range, storeId, granularity: "daily" }), {
    retryAction: "retryStatement",
  })

  const filesP = classify(() => getStores(), { retryAction: "retryStores" })

  const curveLoadP = classify(
    () => loadStaffingCurve({ date: nextDay, storeId, accountId }),
    { retryAction: "retryCurve" },
  )

  const gapP = classify(() => loadScheduleGap({ storeId, accountId, from: nextDay }), {
    retryAction: "retryScheduleGap",
  })

  /*
   * The trend's own per-week Total Sales (L-R2 / task 4b). Loaded off the
   * SAME `loadStatement` + `rowValues(TOTAL_SALES_CODE)` construct
   * `salesByDayOf` above already reads for the headline — DAILY granularity,
   * not `loadStatement`'s "weekly" one: `buildPeriods`'s weekly buckets start
   * on SUNDAY (`src/lib/pnl.ts`), while the trend's own weeks
   * (`trailingWeeks`, note 53) start on MONDAY. Asking for "weekly" here would
   * fold this page's Monday weeks against the rollup's Sunday ones and
   * mislabel every bar — the exact hazard this module's own comment on
   * `loadLaborTrend` already flags. Daily sidesteps it: it is the identical
   * per-day figure the headline reads, summed into the trend's own windows
   * (`weeklySalesOf`) instead of the rollup's.
   *
   * This is a DIFFERENT range asking a different question than `dailyP`
   * above, not a second rollup of the SAME range (A-R13's one-rollup rule is
   * about the latter) — `getAllStoresPnL` is cached 600s per (account, range,
   * granularity), so this is one more cheap call, exactly as the Analytics
   * adapter already makes one for its comparison window.
   */
  const trendLoadP = classify(
    async () => {
      const trendWindows = trailingWeeks(range.end, TREND_WEEKS)
      let weeklyTotalSales = new Map<string, number>()
      if (trendWindows.length > 0) {
        const trendRange: DateRange = {
          start: trendWindows[0].start,
          end: trendWindows[trendWindows.length - 1].end,
        }
        const trendDaily = await loadStatement({ range: trendRange, storeId, granularity: "daily" })
        weeklyTotalSales = weeklySalesOf(salesByDayOf(trendDaily, trendRange), trendWindows)
      }
      return loadLaborTrend({ storeId, accountId, weeks: TREND_WEEKS, endingOn: range.end, weeklyTotalSales })
    },
    { retryAction: "retryTrend" },
  )

  // ONE decision about what this page is looking at, applied to every section,
  // so no section works out for itself whether a pre-open store is an error.
  const scopeP = Promise.all([dailyP, filesP]).then(([dailySd, filesSd]) => {
    const files = dataOf(filesSd) ?? []
    return mapReadyTo(dailySd, (s) => {
      const reason = scopeReason(s, files, storeId)
      return reason === null ? ready(s) : empty<Statement>(reason)
    })
  })

  const laborP = scopeP.then((scopeSd) =>
    chainReady(scopeSd, async (statement) => {
      const map = salesByDayOf(statement, range)
      const sd = await classify(
        () => loadLaborWeek({ range, storeId, accountId, salesByDay: map }),
        { retryAction: "retryLabor" },
      )
      return mapReady(sd, (raw) => ({
        days: raw.days,
        roles: raw.roles,
        week: laborWeek(raw.days, raw.overtimeCost),
        salesByDay: map,
      }))
    }),
  )

  const leaksP = laborP.then((laborSd) =>
    chainReady<LaborData, LeakLedger>(laborSd, (d): Promise<SectionData<LeakLedger>> => {
      const rate = d.week.blendedRate
      // No hours worked means no rate to cost an alert at, and a ledger costed
      // at zero would report every leak as free. That is a refusal, not a
      // ledger of nothing.
      if (rate === null) {
        return Promise.resolve(
          notComputed<LeakLedger>(
            "a leak ledger for this range — no hours were worked inside it, so there is no " +
              "blended rate to cost a clock-in against",
          ),
        )
      }
      return classify(() => loadLeakLedger({ range, storeId, accountId, blendedRate: rate }), {
        retryAction: "retryLeaks",
      })
    }),
  )

  return { nextDay, scopeP, laborP, leaksP, curveLoadP, gapP, trendLoadP }
}

/** The labour data a section needs, or the reasoned refusal that replaces it. */
function laborSection<T>(
  sd: SectionData<LaborData>,
  owed: string,
  build: (d: LaborData) => T,
): SectionData<T> {
  return mapReadyTo(sd, (d) => (noHarriRows(d) ? notComputed<T>(owed) : ready(build(d))))
}

/** The headline, on either route: the same figures, a different strip. */
function headlineSection(
  laborSd: SectionData<LaborData>,
  leakSd: SectionData<LeakLedger>,
  store: boolean,
): SectionData<LaborHeadline> {
  return laborSection(laborSd, NO_HARRI_OWED, (d) =>
    buildHeadline({
      week: d.week,
      // A ledger that has not loaded, failed, or could not be costed leaves the
      // headline one cell shorter and one clause shorter — never a zero.
      ledger: dataOf(leakSd),
      totalSales: Array.from(d.salesByDay.values()).reduce((t, n) => t + n, 0),
      store,
    }),
  )
}

/** The leak section, on either route. */
function leaksSection(
  laborSd: SectionData<LaborData>,
  leakSd: SectionData<LeakLedger>,
): SectionData<LeaksSection> {
  const week = dataOf(laborSd)?.week ?? null
  return mapReadyTo(leakSd, (ledger) => {
    if (week === null) return carry<LaborData, LeaksSection>(laborSd)
    if (ledger.rows.length === 0) {
      return notComputed<LeaksSection>(
        "a leak ledger for this range — HarriTimekeepingAlert raised no alert inside it, " +
          "which is an empty ledger rather than a clean one",
      )
    }
    return ready(buildLeaks(ledger, week))
  })
}

/** The schedule section, on either route. */
function scheduleSection(
  laborSd: SectionData<LaborData>,
  range: DateRange,
  granularity: Granularity,
): SectionData<ScheduleSection> {
  return laborSection(laborSd, NO_HARRI_OWED, (d) =>
    buildSchedule(d.days, d.week, range, granularity),
  )
}

/** The role section, on either route. */
function rolesSection(laborSd: SectionData<LaborData>): SectionData<RolesSection> {
  return mapReadyTo(laborSd, (d) =>
    d.roles.length === 0
      ? notComputed<RolesSection>(
          "a role split for this range — HarriPositionDaily carries no position row inside it",
        )
      : ready(buildRoles(d.roles, d.week)),
  )
}

/** The trend section, on either route. */
function trendSection(sd: SectionData<LaborTrendWeek[]>): SectionData<TrendSection> {
  return mapReadyTo(sd, (weeks) =>
    weeks.length === 0 || weeks.every((w) => w.cost === 0 && w.hours === 0)
      ? notComputed<TrendSection>(
          `${TREND_WEEKS} weeks of labour history — HarriPositionDaily carries no row in any ` +
            "of them, so there is no trend to draw",
        )
      : ready(buildTrend(weeks)),
  )
}

/* ── The group page ───────────────────────────────────────────────────── */

/**
 * The group page's eight sections, as eight promises.
 *
 * Every load starts in `loadEverything` and none is awaited here. The staffing
 * curve is its own query and its own failure, so a slow forecast table holds up
 * the strip and the role table for exactly as long as it holds up nothing.
 */
export function getLaborSectionPromises(
  input: LaborSectionsInput,
): StreamedSections<LaborSections> {
  const { range, today } = input
  const granularity = granularityFor(range)
  const { nextDay, scopeP, laborP, leaksP, curveLoadP, gapP, trendLoadP } =
    loadEverything(input)

  const curveLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(nextDay)

  return {
    headline: guardSection(
      Promise.all([laborP, leaksP]).then(([laborSd, leakSd]) =>
        headlineSection(laborSd, leakSd, false),
      ),
      "retryLabor",
    ),

    week: guardSection(
      laborP.then((laborSd) =>
        laborSection(laborSd, NO_HARRI_OWED, (d) => buildWeekStrip(d.days, range, today)),
      ),
      "retryLabor",
    ),

    schedule: guardSection(
      laborP.then((laborSd) => scheduleSection(laborSd, range, granularity)),
      "retryLabor",
    ),

    curve: guardSection(
      Promise.all([scopeP, curveLoadP]).then(([scopeSd, curveSd]) =>
        mapReadyTo(gate(scopeSd, curveSd), (curve) =>
          // `loadStaffingCurve` returns null when the day carries neither a
          // published shift nor a forecast row. Nothing to draw is a named
          // absence, not an empty chart (A-R12).
          curve === null
            ? notComputed<CurveSection>(
                `a staffing curve for ${curveLabel} — neither a published shift nor a demand ` +
                  "forecast covers that day",
              )
            : ready(buildCurve(curve, curveLabel)),
        ),
      ),
      "retryCurve",
    ),

    roles: guardSection(laborP.then(rolesSection), "retryLabor"),

    leaks: guardSection(
      Promise.all([laborP, leaksP]).then(([laborSd, leakSd]) => leaksSection(laborSd, leakSd)),
      "retryLeaks",
    ),

    decision: guardSection(
      Promise.all([scopeP, gapP]).then(([scopeSd, gapSd]) =>
        mapReadyTo(gate(scopeSd, gapSd), (gap) =>
          // L-R8's other half: full coverage is not owed work and it is not a
          // card about nothing — it is an empty worklist, which is GOOD NEWS
          // and has to read as good news. That is what `all_clear` is for.
          gap.length === 0
            ? empty<DecisionSection>("all_clear")
            : ready(buildDecision(gap)),
        ),
      ),
      "retryScheduleGap",
    ),

    trend: guardSection(
      Promise.all([scopeP, trendLoadP]).then(([scopeSd, trendSd]) =>
        trendSection(gate(scopeSd, trendSd)),
      ),
      "retryTrend",
    ),
  }
}

/**
 * The same eight sections, awaited. `awaitSections` over the streaming variant
 * rather than a second body — two implementations of "what is in the strip" is
 * how two surfaces come to print two different numbers for one day.
 */
export async function getLaborSections(input: LaborSectionsInput): Promise<LaborSections> {
  return awaitSections(getLaborSectionPromises(input))
}

/* ── The store page ───────────────────────────────────────────────────── */

/**
 * One store's six sections.
 *
 * Five of them are the group page's own builders, called with a `storeId` — so
 * `/dashboard/labor` filtered to Hollywood and `/dashboard/labor/hollywood`
 * cannot print two labour percentages for one week. What this route adds is
 * the week TABLE with its verdict column, which the group page has no room to
 * draw once per store.
 */
export function getStoreLaborSectionPromises(
  input: LaborSectionsInput,
): StreamedSections<StoreLaborSections> {
  const { range } = input
  const granularity = granularityFor(range)
  const { laborP, leaksP, trendLoadP, scopeP } = loadEverything(input)

  return {
    headline: guardSection(
      Promise.all([laborP, leaksP]).then(([laborSd, leakSd]) =>
        headlineSection(laborSd, leakSd, true),
      ),
      "retryLabor",
    ),

    schedule: guardSection(
      laborP.then((laborSd) => scheduleSection(laborSd, range, granularity)),
      "retryLabor",
    ),

    roles: guardSection(laborP.then(rolesSection), "retryLabor"),

    leaks: guardSection(
      Promise.all([laborP, leaksP]).then(([laborSd, leakSd]) => leaksSection(laborSd, leakSd)),
      "retryLeaks",
    ),

    week: guardSection(
      laborP.then((laborSd) =>
        laborSection(laborSd, NO_HARRI_OWED, (d) =>
          buildWeekTable(d.days, d.week, d.salesByDay),
        ),
      ),
      "retryLabor",
    ),

    trend: guardSection(
      Promise.all([scopeP, trendLoadP]).then(([scopeSd, trendSd]) =>
        trendSection(gate(scopeSd, trendSd)),
      ),
      "retryTrend",
    ),
  }
}

export async function getStoreLaborSections(
  input: LaborSectionsInput,
): Promise<StoreLaborSections> {
  return awaitSections(getStoreLaborSectionPromises(input))
}
