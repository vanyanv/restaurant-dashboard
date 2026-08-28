import { getStores } from "@/app/actions/store/crud-actions"
import { getIngredientPriceMonitoringData } from "@/app/actions/ingredient-price-monitoring-actions"
import type {
  IngredientPriceMonitoringData,
  IngredientPriceMonitorRow,
} from "@/types/ingredient-price-monitor"
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
  loadCogs,
  loadUnpostedInvoices,
  rankByLoss,
  type CogsDay,
  type CogsItem,
  type CogsWindow,
  type UnpostedInvoices,
} from "@/lib/counter/cogs"
import { count, delta, deltaSign, money, moneyCompact, pct, points } from "@/lib/counter/format"
import {
  dayCount,
  isoDay,
  rangeLabel,
  toQueryBounds,
  type DateRange,
} from "@/lib/counter/date-range"
import type { ChartSeries, ChartSpec } from "@/lib/counter/chart-geometry"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
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
import type { DonutSlice } from "@/lib/counter/donut-geometry"
import type { DeltaTone, FigureProps, MListRow, TagTone, Tone } from "@/components/counter"

/**
 * Cost of goods, classified — for BOTH routes and BOTH surfaces.
 *
 * Four surfaces read this file and nothing beneath it: `/dashboard/cogs` and
 * `/m/cogs`, `/dashboard/cogs/[storeId]` and `/m/cogs/[storeId]`. That is the
 * whole point of it existing, and it is the same shape
 * `adapters/analytics.ts` established and `adapters/labor.ts` refined one
 * page-pair earlier.
 *
 * ## C-R1 — THE FOOD COST IS THE STATEMENT'S NUMBER, NOT THE TABLE'S
 *
 * **This is the single most likely thing on this page for a future edit to
 * undo, so read it before touching the headline.**
 *
 * `DailyCogsItem` carries a `salesRevenue` column sitting immediately beside
 * `lineCost`. Dividing one by the other is the obvious move and it is WRONG.
 * Measured on the live database, 2026-08-20 … 26, Hollywood, with $14,008 of
 * cost either way:
 *
 * | denominator | value | food cost |
 * |---|---:|---:|
 * | `DailyCogsItem.salesRevenue` summed (menu revenue) | $66,985 | **20.91%** |
 * | the statement's Total Sales (what the P&L divides by) | $49,389 | **28.36%** |
 *
 * The Analytics store page already ships **27.8%** for that same week off the
 * statement's own COGS rollup line. A COGS page built on the obvious column
 * would print 20.9% while a page three clicks away prints 27.8% — seven and a
 * half points apart, both labelled "food cost".
 *
 * So `loadCogs` takes `sales` as a PARAMETER and this file supplies it, from
 * the Total Sales row of the statement it loaded for the chart anyway.
 * `DailyCogsItem.salesRevenue` is never a denominator for the window's
 * percentage anywhere on this page. `cogs.ts`'s own test names 20.91
 * explicitly as the forbidden number.
 *
 * The one place an item's own `salesRevenue` IS the denominator is the item
 * ranking — `CogsItem.foodPct`, in `items` and `worst` — because there is no
 * statement-level Total Sales for one menu item to divide by. Those two
 * sections say so in their own `note`, because a reader who tries to roll
 * them up into the headline will not get it and deserves to be told why.
 *
 * ## C-R2 — the restaurant is UNDER plan, and every sentence is derived
 *
 * `Store.targetCogsPct` is 30 for Hollywood and the measured statement-basis
 * food cost is 28.36%: `againstPlan` is **−1.64**, inside plan. The prototype
 * this page is modelled on is built entirely around an overshoot — "the red
 * is the overshoot, not the measure", a strip cell reading "N pts over plan",
 * a table headed "the items costing the most against plan". Not one of those
 * sentences is ported. Every verdict, sentence and note below is derived from
 * the sign of `againstPlan`, and a page that told a restaurant inside plan it
 * was over would be worse than a page that said nothing.
 *
 * `fillFrom: plan` still does the right thing: it paints only the part of the
 * line ABOVE the plan, so a range spent inside plan paints nothing and a
 * single day that overshoots still shows.
 *
 * ## C-R4 — SETTLED BY MEASUREMENT: one series, no theoretical
 *
 * The plan chart draws ONE line. There is no "Theoretical" strip cell and no
 * second series, and this is not an omission waiting to be filled in.
 *
 * `DailyCogsItem.lineCost` **IS** the theoretical cost — recipes valued at
 * invoice prices, times units sold, and the recipe walk is 99.96% of the
 * dollar (327 of 334 lines `COSTED` in the measured window). The prototype
 * draws that against a separate ACTUAL. Ours would have to come from
 * purchasing, and purchasing is not consumption without an inventory bridge:
 *
 * | month | theoretical | invoiced | gap |
 * |---|---:|---:|---:|
 * | 2026-03 | $54,078 | $67,633 | +25% |
 * | 2026-04 | $49,908 | $68,646 | +38% |
 * | 2026-05 | $57,171 | $49,177 | −14% |
 * | 2026-06 | $58,010 | $71,170 | +23% |
 * | 2026-07 | $65,067 | $41,168 | **−37%** |
 * | 2026-08 | $52,922 | $67,266 | +27% |
 *
 * The gap swings −37% to +38% inside six months on invoice cadence alone (7
 * invoices in the measured week, 34 in the month), and `StockCount` holds 4
 * rows in the whole table, so there is no opening/closing stock to bridge it
 * with. Drawn as a second line it would invite an owner to read July as a
 * saving and April as a leak, when neither happened. `PlanSection.note`
 * publishes that absence to the reader rather than leaving a silent gap.
 *
 * ## C-R3 / C-R5 / C-R6 — what else is dropped, and what is re-aimed
 *
 * **Waste is dropped.** `InventoryAdjustment` has 0 rows in the whole table
 * and `StockCount` has 4. There is no waste series and no honest way to
 * invent one, so the desk strip is THREE cells on the group route (not the
 * prototype's four) and four on the store route.
 *
 * **The donut draws MENU categories and is titled for what it shows.**
 * `DailyCogsItem.category` holds menu categories (On The Side, NFL Promo,
 * Combos…), not the prototype's ingredient categories (Proteins, Produce,
 * Dry goods). Those are two different questions and ingredient-category spend
 * would come from the invoice line → canonical ingredient path — a second
 * query and a second plan. Relabelling menu data with an ingredient word is
 * the one thing this section must not do.
 *
 * **Unposted invoices is real and bigger than the fixture**: 13 invoices in
 * `REVIEW` worth $19,627, against the prototype's invented "3 · $2,140".
 *
 * ## Rule 1 / A-R13 — ONE `loadStatement`, at daily granularity, folded here
 *
 * The ruling the Analytics plan measured: the database query is identical at
 * either grain (`getAllStoresPnL` fetches every row in the range and only
 * then buckets) and the fold costs ~10 ms on a request whose query alone
 * costs ~590 ms. The statement is loaded ONCE, its Total Sales row gives the
 * headline's denominator AND the plan chart's per-bucket denominator, and the
 * fold to the display grain happens in `foldPlan` below.
 *
 * ## A-R12 / C-R8 — a reasoned refusal, never an empty shell
 *
 * Van Nuys and Glendale are `pre_open` and carry no `DailyCogsItem` row at
 * all. Every section resolves either `empty("pre_open")` or, where an
 * OPERATIONAL store is simply missing the rows a section needs,
 * `not_computed` **in that section's own words**. A heading over a blank
 * white panel is the defect this rule exists to prevent.
 *
 * ## Every caption that depends on data lives INSIDE its section
 *
 * `Section.meta` takes a string or a callback over the section's own data,
 * and under streaming every key of the returned record is a `Promise` — so a
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
 * that carries it, which figure that is is a judgement about the data, and an
 * adapter is a server module that writes prose and never markup.
 */
export interface CogsVerdict {
  tone: Tone
  headline: string
  body: ReadingSegment[]
}

/**
 * The head block and the strip, on both surfaces and both routes.
 *
 * `cells` is THREE on the group desk (C-R3 — Waste has no source and
 * Theoretical is not a second measure) and FOUR on the store desk, which adds
 * the dollar cost. `phoneCells` is TWO and is NOT a slice of `cells`: the
 * "Unposted invoices" cell disappears entirely on a request where that
 * aggregate failed to load, so a page slicing by position would hand the
 * phone whatever happened to shift into the slot.
 */
export interface CogsHeadline {
  /** The one lead figure. `LeadFigure`'s props, narrowed to strings so it crosses the RSC boundary. */
  figure: { label: string; value: string; detail: string; detailTone?: DeltaTone }
  verdict: CogsVerdict
  /** Three on the group desk, four on the store desk — minus any cell whose loader failed. */
  cells: StripCell[]
  /** Two. */
  phoneCells: StripCell[]
  /** The store page's own note — what this route adds. `null` on the group page. */
  note: string | null
}

/** Food cost against the published plan, one series (C-R4). */
export interface PlanSection {
  chart: ChartData
  /** Shorter, no axis. */
  phoneChart: ChartData
  sentence: string
  meta: string
  /** Why there is one line and not two. See the module comment's C-R4 table. */
  note: string
}

/** One row of "What moved". Pre-formatted; an ingredient with no priced history is not in the list at all. */
export interface MovedRow {
  key: string
  ingredient: string
  /** The normalized price per recipe unit thirty days ago. */
  then: string
  /** The latest normalized price per recipe unit. */
  now: string
  /** `delta()` — "▲ 31.0%". */
  change: string
  /** A price RISE is bad news for a cost page; a fall is good news. */
  changeTone?: TagTone
  /** How many recipes carry it, or an em-dash for an ingredient in none. */
  recipes: string
}

export interface MovedSection {
  rows: MovedRow[]
  /** The phone's `.mlist`, built HERE so the two surfaces cannot format one movement two ways. */
  phoneRows: MListRow[]
  sentence: string
  meta: string
  /** What a "movement" is measured between, and why its window is not the page's. */
  note: string
}

/** The donut and the words beside it (C-R5). */
export interface CategoriesSection {
  slices: DonutSlice[]
  /** The ring's centre text — the window's whole cost, compact. */
  center: string
  sentence: string
  meta: string
  /** Says out loud that these are MENU categories, not ingredient categories. */
  note: string
}

/** One row of the group page's item table, ranked by what it loses against plan. */
export interface ItemRow {
  key: string
  item: string
  /** This item's cost over ITS OWN menu revenue — never the statement's Total Sales. */
  foodPct: string
  sold: string
  /** `points()` — "▲ 4.2 pts". */
  againstPlan: string
  againstPlanTone?: TagTone
  lost: string
}

export interface ItemsSection {
  rows: ItemRow[]
  phoneRows: MListRow[]
  meta: string
  /** Why these percentages do not roll up into the headline. */
  note: string
}

/** One row of the store page's worst-margin table. Ranked by the item's own food cost, highest first. */
export interface WorstRow {
  key: string
  item: string
  foodPct: string
  units: string
  /** What the overshoot costs in dollars of this item's own revenue, or an em-dash inside plan. */
  lost: string
  lostTone?: TagTone
}

export interface WorstSection {
  rows: WorstRow[]
  phoneRows: MListRow[]
  meta: string
  note: string
}

/** The group page — `/dashboard/cogs` and `/m/cogs`. */
export interface CogsSections {
  headline: SectionData<CogsHeadline>
  plan: SectionData<PlanSection>
  moved: SectionData<MovedSection>
  categories: SectionData<CategoriesSection>
  items: SectionData<ItemsSection>
}

/** The store page — `/dashboard/cogs/[storeId]` and `/m/cogs/[storeId]`. */
export interface StoreCogsSections {
  headline: SectionData<CogsHeadline>
  plan: SectionData<PlanSection>
  moved: SectionData<MovedSection>
  /** A worst-margin table here, ranked by the item's own food cost — not the group page's loss ranking. */
  worst: SectionData<WorstSection>
}

export interface CogsSectionsInput {
  range: DateRange
  /** `null` = every store on the account. */
  storeId: string | null
  /**
   * The account the reader is on. Every loader scopes its own query by it and
   * none of them can fetch a session itself — importing `@/lib/auth` pulls
   * `@/lib/prisma` in at MODULE LOAD, which throws without a `DATABASE_URL`
   * and takes the page's whole import graph with it.
   */
  accountId: string
}

/* ── Constants ────────────────────────────────────────────────────────── */

const DASH = "—"

/** How many rows each ranked table shows. The prototype writes five. */
const TABLE_ROWS = 5

/** How many rows the phone's `.mlist` shows. Vertical space is the scarce thing there. */
const PHONE_ROWS = 3

/** How many named slices the ring carries before the rest becomes one "Other" wedge. */
const DONUT_SLICES = 4

/**
 * The ring's palette, in order, and it is deliberately NEUTRAL.
 *
 * `--mx-1 … --mx-4` are counter.css's monotone chart ramp — the same one the
 * mix bars use — running dark to light, with `--line-strong` as the lightest
 * wedge for the "Other" remainder. No slice is `--bad` or `--good`, and that
 * is the point: a share-of-cost ring says which menu categories cost the
 * most, not which of them is a problem. Painting the biggest wedge red would
 * be the page inventing a verdict about a category nobody set a target for —
 * the same fabrication `targets.ts` refuses six times over.
 *
 * These are `ct-` custom-property references, never literals (`npm run
 * tokens` enforces it over `src/lib/counter/**`).
 */
const DONUT_COLORS = ["var(--mx-1)", "var(--mx-2)", "var(--mx-3)", "var(--mx-4)"]

/** The lightest wedge, for the aggregated remainder. */
const DONUT_OTHER_COLOR = "var(--line-strong)"

/**
 * The window `change30dPct` is measured over, in days.
 *
 * FIXED AT THIRTY, and deliberately not the page's own range: an ingredient
 * price moves on invoice cadence, not on the range a reader happens to have
 * selected, and a seven-day preset would report "nothing moved" on a week
 * that simply caught no second invoice. `MovedSection.note` says so out loud
 * rather than letting a reader assume the section follows the date control.
 */
const MOVED_DAYS = 30

/**
 * Below this many points, a figure has not moved against its plan — it is on
 * it. The same window `format.ts` uses for `delta`/`points`, so the strip
 * cell's arrow and the verdict's words cannot disagree about whether the
 * range cleared its plan.
 */
const ON_PLAN_WITHIN_PTS = 0.05

/** The grain a caption names. `Granularity` reads badly in a sentence. */
const GRAIN_WORD: Record<Granularity, string> = {
  daily: "daily",
  weekly: "weekly",
  monthly: "monthly",
}

/* ── Small formatters ─────────────────────────────────────────────────── */

/** "$2.80", or an em-dash. A price nobody measured is not a price of zero. */
function priceText(v: number | null): string {
  return v === null || !Number.isFinite(v) ? DASH : money(v, { cents: true })
}

/** "12 recipes" / "1 recipe" / an em-dash for an ingredient in none. */
function recipeText(n: number): string {
  if (n <= 0) return DASH
  return `${count(n)} ${n === 1 ? "recipe" : "recipes"}`
}

/** "invoice" / "invoices". */
function invoiceWord(n: number): string {
  return n === 1 ? "invoice" : "invoices"
}

/** "Aug 12, 2026", off a real `Date`. Absence is an em-dash, never today. */
function dateText(d: Date | null): string {
  if (d === null) return DASH
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(d)
}

/* ── Streaming plumbing ───────────────────────────────────────────────── */

/**
 * `mapReadyTo`'s asynchronous sibling: run a LOADER on a section that already
 * has data, and carry every other status through untouched.
 *
 * This is what sequences `loadCogs` behind the statement. C-R1 is the reason
 * it cannot be raced: `loadCogs` takes the statement's Total Sales as its
 * denominator, so starting it before the statement resolves would mean either
 * a second sales figure derived here or a food cost divided by nothing.
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
 * The ingredient price monitor and the invoice backlog are independent of the
 * statement and start in the same tick as it does — but a `pre_open` store
 * must not report them as owed work when the real answer is that the store
 * has not opened. So they load eagerly and are GATED on the scope afterwards,
 * which costs one query on a pre-open store and keeps every section on a
 * trading store streaming in parallel.
 */
function gate<S, T>(scope: SectionData<S>, sd: SectionData<T>): SectionData<T> {
  return hasData(scope) ? sd : carry(scope)
}

/* ── Scope ────────────────────────────────────────────────────────────── */

type StoreFile = Awaited<ReturnType<typeof getStores>>[number]

/**
 * Note 23's outcomes, in note 23's order.
 *
 * A store the account does not own is `no_match` before anything else is
 * asked. An account whose stores have all not opened is `pre_open`, which is
 * a fact about the store rather than a filter problem and has no back-out.
 *
 * There is no `grossSales <= 0` refusal here, for the reason `adapters/
 * labor.ts` gives about hours: a range can carry a COST and no sale — a prep
 * day, a closure, an Otter sync that has not landed — and refusing the whole
 * page for it would hide food that was actually bought and cooked. Each
 * section decides for itself whether the rows it needs exist, and the
 * headline's own `foodPct` is `null` rather than a division by nothing.
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
 * This is C-R1's whole mechanism: summed, it is the denominator `loadCogs`
 * divides by; per day, it is the denominator each bucket of the plan chart
 * divides by. One statement, one Total Sales, two grains — never a second
 * sales figure from a second place.
 *
 * The key comes from the RANGE's own calendar (`range.start + i`), not from a
 * bucket's label: `buildPeriods` formats its daily labels in the server's
 * local time off a UTC-floored cursor, and a reader's day is the restaurant's
 * day. It is the identical construct `adapters/labor.ts`'s `salesByDayOf`
 * uses, and it produces the same `isoDay` string `CogsDay.day` carries.
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

/** What every section below is built from: one statement and one cost load. */
interface CogsData {
  window: CogsWindow
  items: CogsItem[]
  byDay: CogsDay[]
  salesByDay: Map<string, number>
}

/** True when `DailyCogsItem` carries nothing at all for this range. */
function noCostRows(d: CogsData): boolean {
  return d.byDay.length === 0 && d.items.length === 0
}

/** The words every COGS section uses when an operational store simply has no rows. */
const NO_COGS_OWED =
  "a cost of goods for this range — DailyCogsItem carries no line inside it, so nothing was " +
  "sold that a recipe could be costed against"

/* ── The head block ───────────────────────────────────────────────────── */

/**
 * The verdict, DERIVED — and this is where C-R2 is either honoured or thrown
 * away.
 *
 * The prototype's copy assumes an overshoot in three separate places. This
 * restaurant runs INSIDE plan, so the headline word, the tone and the
 * direction all come off the sign of `againstPlan` and nothing here is a
 * ported sentence. A range with no published plan is not judged at all: it
 * says so and stops, because `Store.targetCogsPct` is the only published
 * reference this schema carries and an invented one would be the page grading
 * itself.
 */
function buildVerdict(
  w: CogsWindow,
  invoices: UnpostedInvoices | null,
): CogsVerdict {
  const body: ReadingSegment[] = []
  const say = (text: string) => body.push({ text })
  const strong = (text: string) => body.push({ text, strong: true })

  strong(money(w.cost))
  say(" of food and packaging against ")
  strong(money(w.sales))
  say(" of Total Sales — ")
  strong(pct(w.foodPct, { scaled: true }))
  say(" food cost.")

  let tone: Tone = "good"
  let headline = "Inside the published plan"

  if (w.plan === null) {
    tone = "warn"
    headline = "No published plan"
    say(
      " No food-cost plan is published for this selection, so the figure above is not read " +
        "against one. Store.targetCogsPct is the only published reference this schema carries, " +
        "and either no store here has set it or the stores selected disagree on it.",
    )
  } else if (w.againstPlan === null) {
    tone = "warn"
    headline = "Nothing to read against the plan"
    say(
      ` The plan is ${pct(w.plan, { scaled: true })}, but this range carries no Total Sales, ` +
        "so there is no percentage to compare with it.",
    )
  } else if (Math.abs(w.againstPlan) < ON_PLAN_WITHIN_PTS) {
    headline = "On the published plan"
    say(` That is the published ${pct(w.plan, { scaled: true })} plan, to the point.`)
  } else {
    const under = w.againstPlan < 0
    const dollars = (Math.abs(w.againstPlan) / 100) * w.sales
    tone = under ? "good" : "warn"
    headline = under ? "Inside the published plan" : "Over the published plan"
    say(" The plan is ")
    strong(pct(w.plan, { scaled: true }))
    say(`, so the range came in `)
    strong(`${Math.abs(w.againstPlan).toFixed(1)} points ${under ? "inside" : "over"}`)
    say(
      under
        ? ` it — about ${money(dollars)} of margin the plan did not expect to keep.`
        : ` it — about ${money(dollars)} of margin the plan expected to keep and did not.`,
    )
  }

  if (w.partialLines > 0) {
    say(
      ` ${count(w.partialLines)} of the range's cost lines are marked partial — at least one ` +
        "ingredient in the recipe walk could not be priced — so the cost above is an " +
        "understatement, not an estimate that could go either way.",
    )
  }
  if (w.unmappedLines > 0) {
    say(
      ` ${count(w.unmappedLines)} line${w.unmappedLines === 1 ? " carries" : "s carry"} no recipe ` +
        "at all and costs nothing until one is mapped.",
    )
  }

  if (invoices !== null && invoices.count > 0) {
    say(
      ` ${count(invoices.count)} ${invoiceWord(invoices.count)} worth ${money(invoices.total)} ` +
        "are still in review, so the ingredient prices behind that cost have not seen them yet" +
        (invoices.oldest === null
          ? "."
          : `, and the oldest of them is dated ${dateText(invoices.oldest)}.`),
    )
  }

  return { tone, headline, body }
}

/**
 * The group strip — THREE cells (C-R3).
 *
 * The prototype writes four: Food cost, Theoretical, Waste, Unposted
 * invoices. Theoretical is not a second measure (C-R4) and Waste has no
 * source at all — `InventoryAdjustment` is empty — so two of the four are
 * gone and "Against plan" takes one of the freed slots, because it is the one
 * comparison this schema actually publishes.
 *
 * EVERY qualifier goes in the DELTA slot with an explicit tone, and that is
 * not decoration: `.strip .d` with no tone class is `var(--good)`, so a delta
 * holding a qualifier rather than a movement comes out painted green for
 * having moved nowhere. Nothing here carries a `caption`: `MCell` opens its
 * band only inside `reference ? … : ''`, so a caption with no reference is
 * invisible on the phone and an extra landmark on the desk (A-R22).
 */
function buildStrip(
  w: CogsWindow,
  invoices: UnpostedInvoices | null,
  store: boolean,
): StripCell[] {
  const cells: StripCell[] = [
    {
      label: "Food cost",
      value: pct(w.foodPct, { scaled: true }),
      // Names the denominator out loud, beside the figure that carries it.
      // C-R1 exists because that denominator is not the obvious one.
      delta: `${money(w.cost)} of ${money(w.sales)} Total Sales`,
      deltaTone: "is-flat",
    },
  ]

  if (store) {
    cells.push({
      label: "Cost of goods",
      value: money(w.cost),
      delta:
        w.partialLines > 0
          ? `${count(w.partialLines)} partial line${w.partialLines === 1 ? "" : "s"} — an understatement`
          : "every costed line priced in full",
      deltaTone: w.partialLines > 0 ? "is-down" : "is-flat",
    })
  }

  cells.push({
    label: "Against plan",
    // The SIGN survives. `points()` prints "▼ 1.6 pts" for a range inside
    // plan and "▲ 1.6 pts" for one over it, and making that absolute would
    // make the two indistinguishable — the exact failure C-R2 is about.
    value: points(w.againstPlan),
    delta:
      w.plan === null
        ? "no plan published on this selection"
        : `plan ${pct(w.plan, { scaled: true })} · Store.targetCogsPct`,
    deltaTone: w.againstPlan !== null && w.againstPlan > ON_PLAN_WITHIN_PTS ? "is-down" : "is-flat",
  })

  // An aggregate that failed to load takes its own cell with it rather than
  // printing a zero — no backlog and no answer are different sentences.
  if (invoices !== null) {
    cells.push({
      label: "Unposted invoices",
      value: money(invoices.total),
      delta: `${count(invoices.count)} in review · the whole backlog, not this range`,
      deltaTone: invoices.count > 0 ? "is-down" : "is-flat",
    })
  }

  return cells
}

function buildHeadline(input: {
  window: CogsWindow
  invoices: UnpostedInvoices | null
  store: boolean
}): CogsHeadline {
  const { window: w, invoices, store } = input

  return {
    figure: {
      label: "Food cost",
      value: pct(w.foodPct, { scaled: true }),
      detail: "of Total Sales · the P&L's own denominator",
      detailTone: "is-flat",
    },
    verdict: buildVerdict(w, invoices),
    cells: buildStrip(w, invoices, store),
    // Two, and fixed: neither of these cells can be withheld by a loader
    // failing, so the phone's strip has the same two figures on every
    // request. Slicing `cells` by position would hand it the invoice backlog
    // on exactly the request where something else went wrong.
    phoneCells: [
      {
        label: "Food cost",
        value: pct(w.foodPct, { scaled: true }),
        delta: "of Total Sales",
        deltaTone: "is-flat",
      },
      {
        label: "Against plan",
        value: points(w.againstPlan),
        delta: w.plan === null ? "no plan published" : `plan ${pct(w.plan, { scaled: true })}`,
        deltaTone:
          w.againstPlan !== null && w.againstPlan > ON_PLAN_WITHIN_PTS ? "is-down" : "is-flat",
      },
    ],
    note: store
      ? "The group page answers for every store at once. This one answers for the store whose " +
        "invoices and recipes you are about to change — its own cost, its own published plan, " +
        "and the items losing the most margin on this floor and no other."
      : null,
  }
}

/* ── Food cost against plan ───────────────────────────────────────────── */

/**
 * The cost and the sales, day by day, regrouped into the range's display
 * grain — and the percentage taken AFTER the fold, never before.
 *
 * That ordering is the whole correctness of the chart. A week's food cost is
 * the week's cost over the week's sales, not the mean of seven daily ratios:
 * averaging ratios weights a $900 Monday the same as a $9,000 Saturday, which
 * on the measured window moves the line by more than a point. So both
 * quantities are folded as DOLLARS and divided once per bucket.
 *
 * `buildPeriods` is called with the SAME bounds the statement was loaded
 * with, so these buckets are exactly the ones `getAllStoresPnL` would have
 * returned had it been asked for them — one labeller, not a second vocabulary
 * for the same weeks. It is the analogue of `analytics.ts`'s `foldStatement`,
 * applied to a ratio whose two halves come from two different tables.
 *
 * A bucket with no sales gets `null`, not `0`: a percentage of nothing is not
 * a food cost of zero, and `ChartSeries.data` carries nulls as gaps for
 * exactly this.
 */
function foldPlan(
  byDay: CogsDay[],
  salesByDay: Map<string, number>,
  range: DateRange,
  granularity: Granularity,
): { labels: string[]; pct: (number | null)[]; cost: number[]; sales: number[] } {
  const costByDay = new Map(byDay.map((d) => [d.day, d.cost]))

  const days = dayCount(range)
  const keys: string[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date(
      range.start.getFullYear(),
      range.start.getMonth(),
      range.start.getDate() + i,
    )
    keys.push(isoDay(d))
  }

  const dailyCost = keys.map((k) => costByDay.get(k) ?? 0)
  const dailySales = keys.map((k) => salesByDay.get(k) ?? 0)

  const finish = (labels: string[], cost: number[], sales: number[]) => ({
    labels,
    cost,
    sales,
    pct: cost.map((c, i) => (sales[i] > 0 ? (c / sales[i]) * 100 : null)),
  })

  const { startDate, endDate } = toQueryBounds(range)
  const display = buildPeriods(startDate, endDate, granularity)

  if (granularity === "daily") {
    // One label per day, from the rollup's own labeller when it agrees with
    // the range's day count and from the ISO keys when it does not — a
    // mismatch there is a bounds bug, and a chart labelled with a key is
    // readable where a chart labelled off by one is a lie.
    return finish(
      display.length === keys.length ? display.map((p) => p.label) : keys,
      dailyCost,
      dailySales,
    )
  }

  if (display.length === 0) return finish(keys, dailyCost, dailySales)

  const cost = new Array<number>(display.length).fill(0)
  const sales = new Array<number>(display.length).fill(0)

  keys.forEach((_, i) => {
    const t = Date.UTC(
      range.start.getFullYear(),
      range.start.getMonth(),
      range.start.getDate() + i,
    )
    let b = display.findIndex(
      (p) => t >= p.startDate.getTime() && t <= p.endDate.getTime(),
    )
    if (b === -1) b = display.length - 1
    cost[b] += dailyCost[i]
    sales[b] += dailySales[i]
  })

  return finish(display.map((p) => p.label), cost, sales)
}

function buildPlan(
  d: CogsData,
  range: DateRange,
  granularity: Granularity,
): PlanSection {
  const folded = foldPlan(d.byDay, d.salesByDay, range, granularity)
  const plan = d.window.plan

  const series: ChartSeries[] = [
    {
      name: "Food cost",
      color: "var(--ink)",
      data: folded.pct,
      // Note 35: colour the OVERSHOOT, not the measure. `fillFrom` paints
      // only the area above the plan, so a range spent inside plan paints
      // nothing at all and a single bucket that crosses still shows. With no
      // published plan there is nothing to fill from, so the line gets the
      // ordinary fade instead of a red field measured from an invented line.
      ...(plan === null ? { fill: true } : { fillFrom: plan }),
    },
  ]

  const chart: ChartData = {
    type: "line",
    h: 162,
    labels: folded.labels,
    series,
    ...(plan === null ? {} : { rule: { v: plan, label: "Plan" } }),
    notes: folded.labels.map((_, i) =>
      folded.sales[i] > 0
        ? `${money(folded.cost[i])} of ${money(folded.sales[i])}`
        : `${money(folded.cost[i])} of cost · no sales`,
    ),
    alt:
      plan === null
        ? "Food cost as a share of Total Sales"
        : "Food cost as a share of Total Sales, against the published plan",
  }

  const readable = folded.pct
    .map((v, i) => ({ v, label: folded.labels[i] }))
    .filter((p): p is { v: number; label: string } => p.v !== null)
  const high = readable.reduce<{ v: number; label: string } | null>(
    (acc, p) => (acc === null || p.v > acc.v ? p : acc),
    null,
  )
  const low = readable.reduce<{ v: number; label: string } | null>(
    (acc, p) => (acc === null || p.v < acc.v ? p : acc),
    null,
  )

  let sentence: string
  if (readable.length === 0) {
    sentence =
      "No bucket in this range carries any Total Sales, so no bucket has a food-cost " +
      "percentage to draw."
  } else {
    const w = d.window
    const head =
      w.foodPct === null
        ? "The range carries no Total Sales to divide by."
        : plan === null || w.againstPlan === null
          ? `Food cost ran ${pct(w.foodPct, { scaled: true })} across the range, with no ` +
            "published plan to read it against."
          : Math.abs(w.againstPlan) < ON_PLAN_WITHIN_PTS
            ? `Food cost ran ${pct(w.foodPct, { scaled: true })} across the range — the ` +
              `published ${pct(plan, { scaled: true })} plan, to the point.`
            : `Food cost ran ${pct(w.foodPct, { scaled: true })} across the range, ` +
              `${Math.abs(w.againstPlan).toFixed(1)} points ` +
              `${w.againstPlan < 0 ? "inside" : "over"} the published ` +
              `${pct(plan, { scaled: true })} plan.`

    const spread =
      high === null || low === null || high.label === low.label
        ? ""
        : ` The dearest ${GRAIN_WORD[granularity] === "daily" ? "day" : "bucket"} was ` +
          `${high.label} at ${pct(high.v, { scaled: true })}; the cheapest ${low.label} at ` +
          `${pct(low.v, { scaled: true })}.`

    const over =
      plan === null ? 0 : readable.filter((p) => p.v > plan + ON_PLAN_WITHIN_PTS).length
    const overClause =
      plan === null || readable.length === 0
        ? ""
        : over === 0
          ? " Not one bucket finished above the plan."
          : ` ${count(over)} of ${count(readable.length)} buckets finished above it.`

    sentence = `${head}${spread}${overClause}`
  }

  return {
    chart,
    phoneChart: { ...chart, h: 116, ticks: false },
    sentence,
    meta:
      `${rangeLabel(range, "custom")} · ${GRAIN_WORD[granularity]} buckets · ` +
      "cost from DailyCogsItem over the statement's Total Sales",
    // C-R4, published to the reader rather than left as a silent gap.
    note:
      "One line. DailyCogsItem.lineCost already IS the theoretical cost — recipes valued at " +
      "invoice prices times units sold — so a second “theoretical” series would be the " +
      "same number drawn twice. The only actual available is purchasing, and purchasing is not " +
      "consumption without an inventory bridge: measured month by month the two swing from 37% " +
      "under to 38% over inside six months, which is invoice cadence and not waste, and " +
      "StockCount holds four rows in the whole table. Drawn as a second line it would invite " +
      "reading a heavy invoice month as a leak and a light one as a saving, when neither " +
      "happened.",
  }
}

/* ── What moved ───────────────────────────────────────────────────────── */

/**
 * The ingredient prices that moved, off the price monitor's own thirty-day
 * comparison.
 *
 * `then` is not a second reading of the history: it is `now` divided by the
 * published change, which is the exact inverse of how `change30dPct` was
 * computed. Re-deriving the baseline here would mean re-deriving a thirty-day
 * boundary in a second place, and two boundaries computed from two clocks are
 * how a "then" comes to disagree with the percentage printed beside it.
 *
 * Only ingredients with a real movement are listed. One with a single priced
 * invoice in the window has no movement to report — not a movement of zero —
 * and appears nowhere, which is why the section can resolve `not_computed`
 * on a store whose invoices simply have not landed twice yet.
 */
function movedRows(rows: IngredientPriceMonitorRow[]): Array<{
  row: IngredientPriceMonitorRow
  now: number
  then: number
  change: number
}> {
  return rows
    .flatMap((row) => {
      /*
       * AN INGREDIENT IN NO RECIPE CANNOT HAVE MOVED A RECIPE-WALKED COST.
       *
       * This section answers "which ingredients moved my food cost", and food
       * cost on this page is `DailyCogsItem.lineCost` — recipes valued at
       * invoice prices. An ingredient no recipe references contributes exactly
       * nothing to that number, however violently its own price moved.
       *
       * Without this the table was five rows of packaging and disposables,
       * led by `paper patty 5.5 x 5.5 dry wax` at $0.01 -> $11.41,
       * **+107,949.2%** — the loudest figure on the page, about an item used
       * in zero recipes. That is the pack-metadata mis-parse family this
       * project already knows: `selectNonSpikeCostIndex` (an 8x median guard)
       * protects `ingredient-cost.ts` and `canonical-ingredients.ts`, and
       * `getIngredientPriceMonitoringData` is a THIRD path that has no guard
       * at all — correctly, because surfacing bad extractions is what a
       * monitoring page is for. It is the wrong feed to rank a food-cost
       * table by, and the fix belongs here rather than in the monitor.
       *
       * Measured: 76 canonical ingredients, and `paper patty` is one of
       * several Paper/Supplies rows at 0 recipes. Cups and lids survive this
       * filter at 9 recipes each, which is right — a drink recipe includes
       * its cup, so their price genuinely does move the food line.
       */
      if (row.recipeUsageCount <= 0) return []
      const change = row.change30dPct
      if (change === null || !Number.isFinite(change)) return []
      const priced = row.history.filter(
        (p): p is (typeof row.history)[number] & { normalizedUnitPrice: number } =>
          p.normalizedUnitPrice != null,
      )
      const now = priced.at(-1)?.normalizedUnitPrice
      if (now === undefined || !(now > 0)) return []
      const then = now / (1 + change / 100)
      if (!Number.isFinite(then) || then <= 0) return []
      return [{ row, now, then, change }]
    })
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
}

/**
 * What a price movement MEANS on a cost page: dearer is bad, cheaper is good,
 * and a change inside `format.ts`'s own flat window is neither.
 *
 * It asks `deltaSign` rather than the raw sign so the tone and the string
 * `delta` printed beside it come from one threshold — otherwise a 0.02%
 * movement reads "flat" and is painted red at the same time.
 */
function toneOfMove(change: number): TagTone | undefined {
  const sign = deltaSign(change, { scaled: true })
  return sign === 1 ? "bad" : sign === -1 ? "good" : undefined
}

function buildMoved(rows: IngredientPriceMonitorRow[]): MovedSection {
  const all = movedRows(rows)
  const shown = all.slice(0, TABLE_ROWS)

  const view: MovedRow[] = shown.map(({ row, now, then, change }) => ({
    key: row.canonicalIngredientId,
    ingredient: row.name,
    then: priceText(then),
    now: priceText(now),
    change: delta(change, { scaled: true }),
    // A cost page reads a price RISE as bad news and a fall as good news.
    // `delta` already picked the arrow; this only picks what it means — and
    // it asks `deltaSign`, not the raw sign, so a movement `delta` printed as
    // "flat" cannot come out painted as a rise.
    changeTone: toneOfMove(change),
    recipes: recipeText(row.recipeUsageCount),
  }))

  const phoneRows: MListRow[] = shown.slice(0, PHONE_ROWS).map(({ row, now, then, change }) => ({
    key: row.canonicalIngredientId,
    title: row.name,
    detail: `${priceText(then)} → ${priceText(now)}`,
    value: delta(change, { scaled: true }),
    note: recipeText(row.recipeUsageCount),
    noteTone: toneOfMove(change) === "bad" ? "down" : undefined,
  }))

  const top = shown[0] ?? null
  const risers = all.filter((m) => toneOfMove(m.change) === "bad").length

  const sentence =
    top === null
      ? "No ingredient carries two priced invoices thirty days apart, so nothing has a movement to report."
      : `${top.row.name} moved most: ${priceText(top.then)} to ${priceText(top.now)}, ` +
        `${delta(top.change, { scaled: true })} across ${count(MOVED_DAYS)} days` +
        (top.row.recipeUsageCount > 0
          ? `, and it is in ${recipeText(top.row.recipeUsageCount)}.`
          : ", and no recipe carries it yet.") +
        ` ${count(risers)} of ${count(all.length)} moved ingredients got dearer.`

  return {
    rows: view,
    phoneRows,
    sentence,
    meta:
      `${count(shown.length)} of ${count(all.length)} moved · ${count(MOVED_DAYS)} days · ` +
      "normalized price per recipe unit",
    note:
      `A movement compares the newest normalized invoice price against the last one on or ` +
      `before ${count(MOVED_DAYS)} days ago, per recipe unit, so two vendors quoting the same ` +
      `ingredient in different pack sizes are compared on the same basis. That window is fixed ` +
      `at ${count(MOVED_DAYS)} days and does NOT follow the date control above: an ingredient ` +
      `price moves on invoice cadence, not on the range a reader happens to be looking at, and ` +
      `a seven-day window would report that nothing moved on a week that simply caught no ` +
      `second invoice. Ingredients with only one priced invoice in the window carry no movement ` +
      `and are not listed at all.`,
  }
}

/* ── By menu category ─────────────────────────────────────────────────── */

/**
 * The ring (C-R5).
 *
 * These are MENU categories — the `category` column `DailyCogsItem` carries
 * on each sold item — and the section is titled and captioned for exactly
 * that. The prototype's slices are INGREDIENT categories (Proteins, Produce,
 * Dry goods, Dairy, Packaging), which is a different question our column
 * cannot answer: ingredient-category spend comes from the invoice line →
 * canonical ingredient path, a second query and a second plan. Relabelling
 * menu data with an ingredient word is the one thing this section must not
 * do.
 *
 * The tail is aggregated into one "Other" wedge rather than drawn as a fringe
 * of hairline slivers. Eight categories on a 118px ring gives four wedges
 * under three degrees each and a legend nobody can read; the wedges that are
 * gone are named in `meta` by count so the reader knows what "Other" holds.
 */
function buildCategories(w: CogsWindow): CategoriesSection {
  const named = w.categories.slice(0, DONUT_SLICES)
  const rest = w.categories.slice(DONUT_SLICES)
  const restShare = rest.reduce((t, c) => t + c.share, 0)
  const restCost = rest.reduce((t, c) => t + c.cost, 0)

  const slices: DonutSlice[] = named.map((c, i) => ({
    name: c.category,
    value: c.share,
    color: DONUT_COLORS[i % DONUT_COLORS.length],
  }))
  if (rest.length > 0) {
    slices.push({
      name: `Other · ${count(rest.length)}`,
      value: restShare,
      color: DONUT_OTHER_COLOR,
    })
  }

  const top = w.categories[0] ?? null

  return {
    slices,
    center: moneyCompact(w.cost),
    sentence:
      top === null
        ? "No cost line in this range carries a category."
        : `${top.category} is the biggest single line at ${money(top.cost)}, ` +
          `${pct(top.share, { scaled: true })} of the range's cost.` +
          (rest.length > 0
            ? ` The remaining ${count(rest.length)} categories are ${money(restCost)} between them.`
            : ""),
    meta: `${count(w.categories.length)} menu categories · ${money(w.cost)}`,
    note:
      "These are MENU categories — the category each sold item carries — not ingredient " +
      "categories. Proteins, produce and packaging spend is a different question, answered from " +
      "the invoice line to the canonical ingredient rather than from what was sold, and it is " +
      "not what this ring shows. Shares are of the range's own cost and sum to 100.",
  }
}

/* ── The items costing the most ───────────────────────────────────────── */

/**
 * The group page's table, ranked by what each item loses against the plan.
 *
 * `rankByLoss` drops every item at or under plan rather than ranking it at
 * zero — so on a restaurant running inside plan this list is the handful of
 * individual items that still overshoot, which is a real and actionable thing
 * even when the account total is comfortable. When NOTHING overshoots the
 * section resolves `all_clear` rather than rendering an empty table: an empty
 * worklist is good news and has to read as good news (note 23).
 */
function buildItems(items: CogsItem[], plan: number): ItemsSection {
  const ranked = rankByLoss(items, plan)
  const shown = ranked.slice(0, TABLE_ROWS)
  const lostTotal = ranked.reduce((t, i) => t + (i.lost ?? 0), 0)

  const rows: ItemRow[] = shown.map((i) => ({
    key: i.itemName,
    item: i.itemName,
    foodPct: pct(i.foodPct, { scaled: true }),
    sold: count(Math.round(i.units)),
    againstPlan: points(i.againstPlan),
    // `rankByLoss` only returns items strictly over plan, so this is "bad"
    // in every row it actually renders — but the guard is the same
    // `ON_PLAN_WITHIN_PTS` window the verdict and the strip use, so a
    // hairline overshoot `points()` prints as "flat" is not painted red.
    againstPlanTone:
      i.againstPlan !== null && i.againstPlan > ON_PLAN_WITHIN_PTS ? "bad" : undefined,
    lost: money(i.lost),
  }))

  const phoneRows: MListRow[] = shown.slice(0, PHONE_ROWS).map((i) => ({
    key: i.itemName,
    title: i.itemName,
    detail: `${pct(i.foodPct, { scaled: true })} · ${count(Math.round(i.units))} sold`,
    value: money(i.lost),
    note: points(i.againstPlan),
    noteTone: "down",
  }))

  return {
    rows,
    phoneRows,
    meta:
      `${count(shown.length)} of ${count(ranked.length)} items over the ` +
      `${pct(plan, { scaled: true })} plan · ${money(lostTotal)} between them`,
    note:
      "An item's percentage is its own cost over its own menu revenue, because there is no " +
      "statement-level Total Sales for one item to divide by. That is a different denominator " +
      "from the headline's, which is the statement's Total Sales for the whole store — so these " +
      "rows do not sum to the figure above, and are not meant to. “Lost” is the points " +
      "over plan applied to that item's own revenue: what the overshoot cost, not what the item " +
      "is worth.",
  }
}

/**
 * The store page's table: the worst-margin items on this floor, ranked by
 * their own food cost.
 *
 * A DIFFERENT question from the group page's `items`, deliberately. That one
 * ranks by dollars lost, so a cheap item sold in volume outranks an expensive
 * one sold twice; this one ranks by the ratio, which is what a manager
 * standing in this kitchen looks at when deciding what to re-cost or re-price.
 * An item inside plan gets an em-dash in the Lost column, never "$0" — it did
 * not lose nothing measurable, it did not lose.
 */
function buildWorst(items: CogsItem[], plan: number | null): WorstSection {
  const ranked = items
    .filter((i): i is CogsItem & { foodPct: number } => i.foodPct !== null)
    .sort((a, b) => b.foodPct - a.foodPct)
  const shown = ranked.slice(0, TABLE_ROWS)

  const lostOf = (i: CogsItem & { foodPct: number }): number | null =>
    plan === null || i.foodPct <= plan ? null : ((i.foodPct - plan) / 100) * i.revenue

  const rows: WorstRow[] = shown.map((i) => {
    const lost = lostOf(i)
    return {
      key: i.itemName,
      item: i.itemName,
      foodPct: pct(i.foodPct, { scaled: true }),
      units: count(Math.round(i.units)),
      lost: lost === null ? DASH : money(lost),
      lostTone: lost === null ? undefined : "bad",
    }
  })

  const phoneRows: MListRow[] = shown.slice(0, PHONE_ROWS).map((i) => {
    const lost = lostOf(i)
    return {
      key: i.itemName,
      title: i.itemName,
      detail: `${count(Math.round(i.units))} sold`,
      value: pct(i.foodPct, { scaled: true }),
      note: lost === null ? "inside plan" : `${money(lost)} lost`,
      noteTone: lost === null ? undefined : "down",
    }
  })

  const overCount = plan === null ? 0 : ranked.filter((i) => i.foodPct > plan).length

  return {
    rows,
    phoneRows,
    meta:
      `${count(shown.length)} of ${count(ranked.length)} costed items · ` +
      (plan === null
        ? "no published plan to rank against"
        : `${count(overCount)} over the ${pct(plan, { scaled: true })} plan`),
    note:
      "Ranked by each item's own food cost — its cost over its own menu revenue — which is a " +
      "different denominator from the headline's Total Sales and does not roll up into it. " +
      (plan === null
        ? "No plan is published for this store, so no row carries a loss figure."
        : "“Lost” is the points over the store's own published plan applied to that " +
          "item's revenue; an item inside plan carries an em-dash rather than a zero, because " +
          "it did not lose nothing measurable — it did not lose."),
  }
}

/* ── The loads, shared by both routes ─────────────────────────────────── */

/**
 * Everything both pages load, started in one tick.
 *
 * The only sequencing here is the one C-R1 forces: statement → cost. Nothing
 * else waits on anything — the ingredient price monitor and the invoice
 * backlog are their own queries and their own failures, so a slow invoice
 * table holds up the strip's fourth cell and nothing else.
 */
function loadEverything(input: CogsSectionsInput) {
  const { range, storeId, accountId } = input

  // Rule 1 / A-R13: DAILY, once, whatever the display grain is.
  const dailyP = classify(() => loadStatement({ range, storeId, granularity: "daily" }), {
    retryAction: "retryStatement",
  })

  const filesP = classify(() => getStores(), { retryAction: "retryStores" })

  const invoicesP = classify(() => loadUnpostedInvoices({ storeId, accountId }), {
    retryAction: "retryInvoices",
  })

  const movedP = classify(
    () =>
      getIngredientPriceMonitoringData({
        days: MOVED_DAYS,
        ...(storeId ? { storeId } : {}),
      }),
    { retryAction: "retryMoved" },
  )

  // ONE decision about what this page is looking at, applied to every
  // section, so no section works out for itself whether a pre-open store is
  // an error.
  const scopeP = Promise.all([dailyP, filesP]).then(([dailySd, filesSd]) => {
    const files = dataOf(filesSd) ?? []
    return mapReadyTo(dailySd, (s) => {
      const reason = scopeReason(s, files, storeId)
      return reason === null ? ready(s) : empty<Statement>(reason)
    })
  })

  const cogsP = scopeP.then((scopeSd) =>
    chainReady(scopeSd, async (statement) => {
      const salesByDay = salesByDayOf(statement, range)
      // C-R1: the denominator is the statement's Total Sales, summed over the
      // range's own calendar days — the same map the chart divides bucket by
      // bucket, so the headline and every column of the chart are the same
      // division of the same two numbers.
      const sales = Array.from(salesByDay.values()).reduce((t, n) => t + n, 0)
      const sd = await classify(() => loadCogs({ range, storeId, accountId, sales }), {
        retryAction: "retryCogs",
      })
      return mapReady(sd, (raw) => ({
        window: raw.window,
        items: raw.items,
        byDay: raw.byDay,
        salesByDay,
      }))
    }),
  )

  return { scopeP, cogsP, invoicesP, movedP }
}

/** The cost data a section needs, or the reasoned refusal that replaces it. */
function cogsSection<T>(
  sd: SectionData<CogsData>,
  owed: string,
  build: (d: CogsData) => T,
): SectionData<T> {
  return mapReadyTo(sd, (d) => (noCostRows(d) ? notComputed<T>(owed) : ready(build(d))))
}

/** The headline, on either route: the same figures, a different strip. */
function headlineSection(
  cogsSd: SectionData<CogsData>,
  invoiceSd: SectionData<UnpostedInvoices>,
  store: boolean,
): SectionData<CogsHeadline> {
  return cogsSection(cogsSd, NO_COGS_OWED, (d) =>
    buildHeadline({
      window: d.window,
      // A backlog that has not loaded or failed leaves the strip one cell
      // shorter and the verdict one clause shorter — never a zero, which
      // would read as "nothing is waiting".
      invoices: dataOf(invoiceSd),
      store,
    }),
  )
}

/** The plan chart, on either route. */
function planSection(
  cogsSd: SectionData<CogsData>,
  range: DateRange,
  granularity: Granularity,
): SectionData<PlanSection> {
  return cogsSection(cogsSd, NO_COGS_OWED, (d) => buildPlan(d, range, granularity))
}

/** "What moved", on either route. */
function movedSection(
  sd: SectionData<IngredientPriceMonitoringData>,
): SectionData<MovedSection> {
  return mapReadyTo(sd, (data) =>
    movedRows(data.rows).length === 0
      ? notComputed<MovedSection>(
          `an ingredient price movement — no canonical ingredient carries two normalized ` +
            `invoice prices ${count(MOVED_DAYS)} days apart, so there is nothing to compare a ` +
            `price against`,
        )
      : ready(buildMoved(data.rows)),
  )
}

/* ── The group page ───────────────────────────────────────────────────── */

/**
 * The group page's five sections, as five promises.
 *
 * Every load starts in `loadEverything` and none is awaited here. The
 * ingredient price monitor is its own query and its own failure, so a slow
 * invoice-line walk holds up the strip and the plan chart for exactly as long
 * as it holds up nothing.
 */
export function getCogsSectionPromises(
  input: CogsSectionsInput,
): StreamedSections<CogsSections> {
  const { range } = input
  const granularity = granularityFor(range)
  const { scopeP, cogsP, invoicesP, movedP } = loadEverything(input)

  return {
    headline: guardSection(
      Promise.all([cogsP, invoicesP]).then(([cogsSd, invoiceSd]) =>
        headlineSection(cogsSd, invoiceSd, false),
      ),
      "retryCogs",
    ),

    plan: guardSection(
      cogsP.then((cogsSd) => planSection(cogsSd, range, granularity)),
      "retryCogs",
    ),

    moved: guardSection(
      Promise.all([scopeP, movedP]).then(([scopeSd, sd]) => movedSection(gate(scopeSd, sd))),
      "retryMoved",
    ),

    categories: guardSection(
      cogsP.then((cogsSd) =>
        mapReadyTo(cogsSd, (d) =>
          d.window.categories.length === 0
            ? notComputed<CategoriesSection>(
                "a category split for this range — no DailyCogsItem line inside it carries a " +
                  "menu category, so there is nothing to divide the cost between",
              )
            : ready(buildCategories(d.window)),
        ),
      ),
      "retryCogs",
    ),

    items: guardSection(
      cogsP.then((cogsSd) =>
        mapReadyTo(cogsSd, (d) => {
          const plan = d.window.plan
          if (plan === null) {
            return notComputed<ItemsSection>(
              "the items losing the most against plan — no food-cost plan is published for " +
                "this selection, and ranking items against a plan invented here would be the " +
                "page grading itself",
            )
          }
          if (d.items.length === 0) return notComputed<ItemsSection>(NO_COGS_OWED)
          // Every item inside plan is not an empty table — it is an empty
          // WORKLIST, which is good news and has to read as good news.
          return rankByLoss(d.items, plan).length === 0
            ? empty<ItemsSection>("all_clear")
            : ready(buildItems(d.items, plan))
        }),
      ),
      "retryCogs",
    ),
  }
}

/**
 * The same five sections, awaited. `awaitSections` over the streaming variant
 * rather than a second body — two implementations of "what is in the strip"
 * is how two surfaces come to print two different numbers for one week.
 */
export async function getCogsSections(input: CogsSectionsInput): Promise<CogsSections> {
  return awaitSections(getCogsSectionPromises(input))
}

/* ── The store page ───────────────────────────────────────────────────── */

/**
 * One store's four sections.
 *
 * Three of them are the group page's own builders, called with a `storeId` —
 * so `/dashboard/cogs` filtered to Hollywood and `/dashboard/cogs/hollywood`
 * cannot print two food-cost percentages for one week. What this route adds
 * is the worst-margin table, which ranks by the ratio rather than by dollars
 * lost and which the group page has no room to draw once per store.
 */
export function getStoreCogsSectionPromises(
  input: CogsSectionsInput,
): StreamedSections<StoreCogsSections> {
  const { range } = input
  const granularity = granularityFor(range)
  const { scopeP, cogsP, invoicesP, movedP } = loadEverything(input)

  return {
    headline: guardSection(
      Promise.all([cogsP, invoicesP]).then(([cogsSd, invoiceSd]) =>
        headlineSection(cogsSd, invoiceSd, true),
      ),
      "retryCogs",
    ),

    plan: guardSection(
      cogsP.then((cogsSd) => planSection(cogsSd, range, granularity)),
      "retryCogs",
    ),

    moved: guardSection(
      Promise.all([scopeP, movedP]).then(([scopeSd, sd]) => movedSection(gate(scopeSd, sd))),
      "retryMoved",
    ),

    worst: guardSection(
      cogsP.then((cogsSd) =>
        mapReadyTo(cogsSd, (d) =>
          d.items.every((i) => i.foodPct === null)
            ? notComputed<WorstSection>(
                "a worst-margin ranking for this range — no item inside it carries both a cost " +
                  "and menu revenue, so no item has a food-cost ratio of its own",
              )
            : ready(buildWorst(d.items, d.window.plan)),
        ),
      ),
      "retryCogs",
    ),
  }
}

export async function getStoreCogsSections(
  input: CogsSectionsInput,
): Promise<StoreCogsSections> {
  return awaitSections(getStoreCogsSectionPromises(input))
}
