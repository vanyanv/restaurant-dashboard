import {
  getDecisionsView,
  type DecisionAction,
  type DecisionDay,
  type DecisionRecord,
  type DecisionsView,
} from "@/app/actions/decisions/get-decisions-view"
import { prisma } from "@/lib/prisma"
import { resolveStoreContext } from "@/app/actions/forecasts/_shared"
import { newestGenerationPerDay } from "@/lib/counter/forecast-generation"
import {
  defaultForecastPreference,
  isReconciledStale,
} from "@/lib/forecasts/reconciliation-prefs"
import {
  parseDayKey,
  weekDayKeys,
  weekDayLabel,
  weekStartUTC,
} from "@/lib/counter/week-window"
import { count, delta, deltaSign, money, pct } from "@/lib/counter/format"
import { mergeAttributions, type Attribution } from "@/lib/decisions/attribution"
import { parseAttribution } from "@/lib/decisions/attribution"
import { loadRunOut, type RunOut } from "@/lib/counter/run-out"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
import type { ReadingSegment, StripCell } from "@/lib/counter/adapters/pnl"
import type { OpportunityType } from "@/generated/prisma/client"
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
import type { DeltaTone } from "@/components/counter/surface/figure"
import type { MListRow } from "@/components/counter"
import type { BriefingLine, MathRow, QueueItem, RecordMark, Tone, WeekDay } from "@/components/counter"

/**
 * The Needs-you page's data, classified — the week ahead, on the desk and on
 * the phone.
 *
 * ## What this file is allowed to do
 *
 * `src/app/actions/decisions/get-decisions-view.ts` is 917 lines and already
 * computes almost everything this page prints: the seven forward days with
 * their bands, the labour lane, the hourly coverage, the briefing, the vitals,
 * the scorecard, the ledger and the ranked actions. It is over 400 lines, so
 * `docs/refactor-playbook.md` puts it out of reach of a casual restructure —
 * and it does not need one. **This adapter TRANSLATES that view into sections.
 * It does not recompute a figure the loader already decided.**
 *
 * The rule has teeth here specifically. The week's total is printed three
 * times — the headline figure, the strip's first cell and the phone's first
 * cell — and all three read ONE function, `weekTotal`, over ONE series, the
 * `WeekDay[]` `buildDecisionsWeek` hands the picker. A second sum taken here
 * would be a fourth opinion about one week.
 *
 * ## What it must never do: sum `ForecastDailyRevenue` itself
 *
 * That table is append-only across model generations. On 2026-08-26 the
 * fourteen-day window held 121 rows from 16 generations, and summing them
 * gives $646,442 where the week is $50,754 — five digits either way, no crash,
 * no symptom. `newestGenerationPerDay` in `@/lib/counter/forecast-generation`
 * is the one dedupe, and `getRevenueForecast` (which is where this page's days
 * come from, through `getDecisionsView`) is its caller. This adapter reads
 * `view.days`, which is downstream of that call, so it never sees a raw
 * generation — and if a later change makes it read the table directly, it goes
 * through `newestGenerationPerDay` or it is a bug regardless of what the
 * loader did.
 *
 * ## The headline's week IS the picker's week (ruling N-R17)
 *
 * It was not, between N-R14 and N-R17, and the split was documented rather
 * than fixed. `vitals.weekForecast.total` is the ROLLING window
 * `getDecisionsView` loads — today and the six days after it — while the
 * picker is the CALENDAR week, Monday to Sunday, because a picker of forward
 * days has no actual to show against any of them and "forecast against
 * actual" was therefore seven grey cells. On 2026-08-27 the headline read
 * $51,338 and the seven cells beneath it summed to $52,111: $773 apart, on one
 * page, both labelled "this week".
 *
 * Prototype note 39 — **a total is the sum of the series beside it** — and
 * this codebase has already repaired one violation of it: the tax row in
 * `MathLines`, drawn as a subtraction and then not applied. "The prototype
 * does it too" (its own headline says $38,930 over a `WK` summing $34,930)
 * was the argument rejected then, and the prototype's own comment records the
 * repair.
 *
 * So `weekTotal` sums `buildDecisionsWeek`'s output — the merged Mon–Sun
 * series the picker renders, settled half and forward half — and the headline,
 * the desk strip's first cell and the phone strip's first cell all read it.
 * **This is not a second sum of the week.** It is the one series, summed once,
 * by the one function three callers share; nothing here computes a new window
 * and nothing re-derives a day. `vitals.weekForecast.total` is no longer read
 * by this page.
 *
 * What still comes from the vitals is the DELTA beside the figure ("▲ 6.1% on
 * last week"), because it is not a total: `computeVitals` recovers it from
 * each forward day's own `pctVsTrailing`, and a settled day carries no
 * comparison against the same weekday a week earlier. It is therefore a rate
 * measured over the forward window sitting beside a calendar-week total, which
 * is owed work — a calendar-week comparison needs the PRIOR week's rows, which
 * is a second load and a second ruling, not a sum taken here.
 *
 * ## One promise per section (ruling N-R13)
 *
 * `getDecisionsView` is ONE call, but it is nine independent queries across
 * nine tables inside one `Promise.all`, and they feed genuinely different
 * sections: the scorecard is `MlForecastEvaluation`, the ledger is
 * `DecisionLog`, the week is `ForecastDailyRevenue`. So the adapter hands back
 * a promise per section derived from one shared load, exactly as the P&L and
 * Overview adapters do. Nothing resolves sooner today — there is one await
 * underneath all of them. THE POINT IS THE PAGE'S SHAPE: when that loader is
 * decomposed, every section streams for free and no page changes. A single
 * awaited object would make that decomposition a page rewrite as well.
 */

/* ── The shapes each section carries ──────────────────────────────────── */

/** The lead figure and the verdict beside it. */
export interface DecisionsHead {
  figure: {
    label: string
    /** Pre-formatted. The SAME string the strip's first cell prints. */
    value: string
    detail: string
    detailTone?: DeltaTone
  }
  verdict: {
    tone: Tone
    headline: string
    /** The one sentence, in segments so a figure inside it can be bolded. */
    body: ReadingSegment[]
    action: { label: string; href: string } | null
  }
  /**
   * The PHONE's strip — two cells, not four (`P.decisions.phone`, line 4763).
   *
   * Carried here rather than sliced off `strip` by the phone client, for the
   * reason `PnlHeadline.phoneCells` gives: a slice picks cells by POSITION out
   * of a list whose length depends on the data, and the labour cell is absent
   * when no shift is published. Both cells are the same figures the desk
   * prints, from the same vitals.
   */
  phoneCells: StripCell[]
}

/** "<day> in detail" — the day the picker has selected, as arithmetic. */
export interface DayDetail {
  /** ISO day. What the URL carries. */
  date: string
  /** "Wed 26" — what the section titles itself with. */
  label: string
  /**
   * The `.sec__head` qualifier: what the day is, and what it was called at.
   *
   * Was the bare word "closed" / "still ahead". It is now the day's own band —
   * "forecast $8,240 · P10–P90 $7,120–$9,480" — because the head is drawn in
   * every state including while the body loads, and the two figures a reader
   * opens a day for should not be the two that arrive last.
   */
  meta: string
  rows: MathRow[]
  /** The "What moves it" paragraph under the rule. Never empty. */
  moves: string
  /**
   * The TreeSHAP waterfall, when the row that made this forecast carried one.
   *
   * Null on a store the booster declined to explain and on rows written before
   * 2026-08-19. The panel then falls back to the arithmetic rows alone, which
   * is what it has always shown.
   */
  attribution: Attribution | null
  /**
   * The day's forecast as a NUMBER, not the formatted row above it.
   *
   * The waterfall's right-hand axis. `attribution`'s parts sum to the
   * prediction by construction, so drawing the axis at `base + Σ groups`
   * instead would make the chart self-consistent and unable to disagree with
   * the figure it is explaining — which is precisely the check worth keeping.
   */
  forecast: number
  /** "$7,120 – $9,480", or the reason there is no band. */
  band: string
  /**
   * How much to trust the number, in a sentence — and what to do about not
   * trusting it. A band is a hedge, and an owner staffing a Saturday needs to
   * be told which side of it to hedge on.
   */
  sureness: string
  /** Which model, how far out, calibrated how. See `Provenance`. */
  provenance: Array<{ label: string; value: string }>
}

/** "How well we have been calling it". */
export interface Accuracy {
  rows: MathRow[]
  /**
   * One mark per evaluated day.
   *
   * `MlForecastEvaluation` publishes a COVERAGE FRACTION and a sample size,
   * not a per-day sequence, so what is known is "six of thirty missed" and not
   * WHICH six. The misses are therefore spread evenly rather than bunched at
   * either end: an even spread reads as a proportion, which is what was
   * measured, where a run of six at the right-hand edge would read as "the
   * model has been missing all week" — a claim nothing here supports. A true
   * chronology needs the evaluator to publish one; until it does, this is the
   * honest rendering of the number it does publish.
   */
  record: RecordMark[]
  note: string
}

/** One row of "What you decided". */
export interface LedgerRow {
  key: string
  date: string
  decision: string
  worth: string
  outcome: string
  outcomeTone: Tone
}

/**
 * One item of "What to do this week", plus the two things `QueueItem` has no
 * slot for.
 *
 * `dots` and `note` are the tail of the prototype's body — `<span class="dots">
 * …</span> high confidence · <b>decays daily</b>` — which cannot be built in a
 * `.ts` module because it is markup. The prose stays here (an adapter owns
 * what the page SAYS); a client that wants the meter renders `Dots` beside
 * `body` from these two fields. A page that ignores them still gets a complete
 * sentence, because `body` already ends with the confidence and the deadline
 * in words.
 *
 * An intersection rather than an `interface … extends`, because `QueueItem` is
 * a union — `act`/`onAct`/`href` arrive as a checked triple — and an interface
 * cannot extend one.
 */
export type DecisionQueueItem = QueueItem & {
  dots: number
  note: string
  /**
   * Everything `recordDecision` needs to write this item's outcome.
   *
   * `title` on this same object is jargon-stripped for display; `ref.title` is
   * the generator's own string, which is what `DecisionLog`'s unique key is
   * built from. They are different fields on purpose — see the note on
   * `DecisionAction.rawTitle`, and the one on `recordDecision`.
   */
  ref: {
    storeId: string
    type: OpportunityType
    title: string
    asOf: string
    impactUsdPerWeek: number
    p10: number | null
    p90: number | null
  }
  /**
   * The claim, on its own — the first half of `body`.
   *
   * `body` stays the COMPLETE sentence, so a surface that ignores every field
   * below still prints something a reader can act on. These three are what a
   * surface that wants the prototype's shape composes instead: `why`, then the
   * meter, then `confidence`, then the deadline in bold. Splitting `body` back
   * apart in a page would be string surgery on prose the adapter wrote.
   */
  why: string
  /** "high confidence" / "medium confidence" / "low confidence". */
  confidence: string
  /**
   * Narrowed from `QueueItem`'s `ReactNode`. An adapter is a server module and
   * writes prose, never markup — and `buildPhoneQueue` has to take this
   * string's first sentence for the phone row, which a `ReactNode` could not
   * be asked for.
   */
  body: string
}

/**
 * "What to do this week" — the three items, and the cap made visible.
 *
 * `meta` is INSIDE the section rather than a string beside it, exactly as
 * `OrderItems.meta` is. It was a sibling field on this object until the desk
 * page was written and could not use it: under the streaming shape every key
 * on `DecisionsSections` becomes a `Promise`, and `Section`'s `meta` prop
 * takes a string or a function of the section's own data — never a promise.
 * A `.sec__head` qualifier derived from a section's data belongs to that
 * section, which is what `Section`'s `meta` callback exists for.
 */
export interface DecisionQueue {
  items: DecisionQueueItem[]
  /** "3 of 5" — what is shown against what the loader ranked. See N-R6. */
  meta: string
}

/** The shelf, in `.mli` shape. See `DecisionsSections.phoneRunOut`. */
export interface PhoneRunOut {
  items: MListRow[]
  /** "2 before delivery" — the same claim the desk's head makes. */
  meta: string
  /** How many are past the reorder line. Drives the head's one pulse. */
  hot: number
}

/** The same, in `.mli` shape. See `DecisionsSections.phoneQueue`. */
export interface PhoneQueue {
  items: MListRow[]
  meta: string
  /**
   * The top-ranked item, for the phone's one button.
   *
   * `P.decisions.phone()` ends on a single `<button class="mbtn mbtn--primary">
   * Commit the first one</button>`, and this is what it commits. Null when the
   * queue is empty, which is how the page knows not to draw a control over
   * nothing.
   */
  first: { title: string; ref: DecisionQueueItem["ref"] } | null
}

export interface DecisionsSections {
  head: SectionData<DecisionsHead>
  strip: SectionData<StripCell[]>
  briefing: SectionData<BriefingLine[]>
  week: SectionData<WeekDay[]>
  day: SectionData<DayDetail>
  accuracy: SectionData<Accuracy>
  /** EMPTY TODAY — ready with zero rows, never `empty()`. See N-R5 below. */
  ledger: SectionData<LedgerRow[]>
  queue: SectionData<DecisionQueue>
  /**
   * "What you will run out of" — the shelf read against the week ahead.
   *
   * The one section on this page that is not a rearrangement of what the
   * loader already computed. `src/lib/counter/run-out.ts` joins the on-hand
   * quantity, the flat trailing depletion rate the product ships today, and a
   * NEW forecast-shaped rate (`src/lib/inventory/forecast-depletion.ts`) that
   * consumes stock at the week's own predicted menu-item demand instead of at
   * a fourteen-day mean.
   *
   * It is the difference between the verdict at the top of this page saying
   * "1 Slider and Fries ran out, −$2,034" — which it can already do, after the
   * fact — and saying it four days early.
   */
  runOut: SectionData<RunOut>
  /**
   * The same shelf, as the phone's `.mlist` rows.
   *
   * Only the rows that need an order — now or this week. The desk draws all
   * four so the reader can watch the two readings diverge on a row that is
   * fine as well as on one that is not; the phone is the glance-and-do
   * surface, and an item with nothing to do about it is not a phone row.
   * (The head still counts only what goes before the next delivery, which is
   * the smaller number and the one that pulses.) Built here beside the desk's, the same
   * rule `phoneQueue` follows — a phone that mapped `runOut` itself is one
   * edit away from rounding cover differently from the desk.
   */
  phoneRunOut: SectionData<PhoneRunOut>
  /**
   * The same three items, as the phone's `.mlist` rows (ruling N-R16).
   *
   * A FIELD beside `queue`, built here from the same items — not a mapping in
   * the phone client. `MListRow.value` is the desk's own `lead` string and
   * `note` is the desk's own deadline words, so the two surfaces cannot print
   * one item's figure two ways. A page that maps `queue` into `MListRow`s
   * itself is one edit away from formatting the impact differently from the
   * desk, and nothing would catch it.
   *
   * It carries `meta` for the same reason `DecisionQueue` does: the phone's
   * `.sec__head` prints the same "3 of 5" the desk's does, and a section's
   * head qualifier belongs to that section's data.
   */
  phoneQueue: SectionData<PhoneQueue>
}

export interface DecisionsSectionsInput {
  storeId?: string
  /**
   * The day the picker has selected, from the URL.
   *
   * UNTRUSTED, exactly as `readCounterParams` treats every other param: a key
   * that is not in this week falls back to today rather than throwing or
   * rendering an empty panel.
   */
  day?: string
  /**
   * The tenancy boundary — see `src/lib/auth-scope.ts`. Read from the session
   * by the page and passed in here; this adapter does not fetch its own
   * session (`loadSettledDays` used to, via `getCachedSession`, which is the
   * defect this field closes). Required, not optional: every caller has a
   * session by the time it reaches an adapter, same as `IngredientsInput`.
   */
  accountId: string
}

/* ── Constants the page's shape depends on ────────────────────────────── */

/**
 * N-R6. `buildActionCards` ranks and caps at FIVE; the prototype's queue holds
 * THREE, and `.qitem` is a fidelity landmark.
 *
 * Five against three is two extra landmarks, which no absence allowance
 * forgives. The two the reader does not see are not hidden — `DecisionQueue.meta`
 * says "3 of 5", so the cap is on the page rather than in this file.
 */
const QUEUE_SHOWN = 3

/** The prototype's coverage target, and the scorecard's own. */
const COVERAGE_TARGET = 0.8

/**
 * Where a queue item's button goes.
 *
 * The prototype's `act: 'Commit'` is a `<button data-goto>` wired to a global
 * delegate we do not have, and `QueueItem` refuses an `act` without either a
 * handler or a destination — a button that does nothing is worse than no
 * button. An adapter is a server module and has no handler to give, so each
 * item links to the page where the work is actually done. Committing a
 * decision from this queue needs a client action and is owed work, not
 * something to fake with a link labelled "Commit".
 */
const ACTION_ROUTE: Record<string, string> = {
  reprice: "/dashboard/menu-profit",
  menu_engineering: "/dashboard/menu-profit",
  channel_mix: "/dashboard/orders",
  food_cost_risk: "/dashboard/ingredients",
  profit_risk: "/dashboard/pnl",
}

/**
 * "Mon 24", which is what a `.wkd` cell prints and what the day-detail section
 * titles itself with.
 *
 * `weekDayLabel` from `@/lib/counter/week-window` rather than a local format
 * of `DecisionDay.weekdayShort`/`monthDayShort`, because the SETTLED half of
 * the picker has no `DecisionDay` at all — those cells come from this file's
 * own query — and because the desk client has to print the same label in a
 * section heading before that section's data has landed. One function, three
 * callers. See that module's note.
 */
function dayLabel(date: string): string {
  return weekDayLabel(date)
}

/** Why a load failed, in words a reader can act on. */
function loadError(error: "no_session" | "store_not_in_account" | "no_stores"): string {
  switch (error) {
    case "no_session":
      return "Your session has expired. Sign in again to see the week."
    case "store_not_in_account":
      return "That store is not on this account."
    case "no_stores":
      return "This account has no stores yet, so there is no week to call."
  }
}

/* ── The builders, one per section ────────────────────────────────────── */

/**
 * The week's forecast — ONE number, read by the headline, the desk strip and
 * the phone strip, and it is the sum of the series the picker draws.
 *
 * Ruling N-R17, and the module note above is the argument. `week` is
 * `buildDecisionsWeek`'s output: the merged Mon–Sun cells, the settled half
 * from `loadSettledDays` and the forward half from `view.days`. Summing THAT
 * is not a second opinion about the week — it is the only opinion, taken once,
 * over the exact seven figures printed underneath it. Reading
 * `vitals.weekForecast.total` here instead is what put $51,338 above a picker
 * summing $52,111.
 *
 * A cell's `forecast` is what the cell PRINTS, so this total cannot drift from
 * the row below it even if the merge changes which half a day comes from.
 * Null when the week has no cells at all — distinct from a forecast of zero,
 * and the state a store with no forecast rows written is genuinely in.
 *
 * Note it is also not `view.potUsdPerWeek`, which is the sum of the ACTIONS'
 * weekly impact — a different quantity that happens to be money per week. The
 * prototype's "This week's pot" is the revenue the week is forecast to take
 * ($38,930 against a strip that also says "▲ 6.1% on last week"); an actions
 * total has no last-week to move against.
 */
function weekTotal(week: WeekDay[]): number | null {
  if (week.length === 0) return null
  return week.reduce((sum, d) => sum + d.forecast, 0)
}

/**
 * "▲ 6.1% on last week", or that there is nothing to compare against.
 *
 * A RATE, not a total, which is why N-R17 leaves it on the vitals:
 * `computeVitals` recovers the prior week by dividing each forward day by its
 * own `pctVsTrailing`, and a settled cell carries no such comparison. So this
 * is measured over the forward window while the figure beside it is the
 * calendar week. Stated in the module note as owed work rather than closed by
 * inventing a prior week here.
 */
function weekDelta(view: DecisionsView): { text: string; tone?: DeltaTone } {
  const v = view.vitals.weekForecast.vsPriorWeek
  if (v === null) return { text: "no comparison set", tone: "is-flat" }
  const sign = deltaSign(v)
  return {
    text: `${delta(v)} on last week`,
    tone: sign === 0 ? "is-flat" : sign === -1 ? "is-down" : undefined,
  }
}

/** "24 of 30", or an em-dash when the evaluator has not run. */
function insideOf(view: DecisionsView): { inside: number | null; sample: number } {
  const s = view.scorecard
  if (!s || s.sampleSize <= 0 || s.intervalCoverage80 == null) {
    return { inside: null, sample: s?.sampleSize ?? 0 }
  }
  return { inside: Math.round(s.intervalCoverage80 * s.sampleSize), sample: s.sampleSize }
}

export function buildDecisionsHead(view: DecisionsView, week: WeekDay[]): DecisionsHead {
  const total = weekTotal(week)
  const d = weekDelta(view)
  const value = money(total)
  const { inside, sample } = insideOf(view)

  // The verdict is one sentence from `getVerdictLine` — the LLM's, or the
  // deterministic composer's when it declined. It is prose about the week and
  // arrives whole, so it is one segment: bolding a clause here would mean
  // guessing which of its words carries the figure, and guessing wrong bolds
  // the wrong half of the only sentence on the page.
  const body: ReadingSegment[] = [{ text: view.verdict.line }]

  // The one action worth naming beside the verdict is the one the loader
  // ranked first — the same item the queue prints at the top, by construction
  // rather than by a second ranking here.
  const first = view.actions[0] ?? null

  return {
    figure: {
      label: "The call this week",
      value,
      detail: d.text,
      detailTone: d.tone,
    },
    verdict: {
      // A week with something that decays today is warned about; a week whose
      // worst item has a date is not an emergency. `good` emits no modifier.
      tone: first ? toneFor(first) : "good",
      headline: view.verdict.line.length > 0 ? headlineFor(view) : "The week is called",
      body,
      action:
        first === null
          ? null
          : { label: `Open ${categoryLabel(first)}`, href: hrefFor(first) },
    },
    phoneCells: [
      { label: "This week's pot", value, delta: d.text, deltaTone: d.tone },
      {
        label: "Accuracy",
        value: inside === null ? count(null) : `${inside}/${sample}`,
        delta: coverageWord(view),
        deltaTone: "is-flat",
      },
    ],
  }
}

/**
 * The `.state` pill above the verdict sentence.
 *
 * It used to read `actions` and the labor gap and nothing else, so it could
 * say "Nothing needs you this week" while the sentence DIRECTLY BELOW IT
 * narrated the briefing's most urgent line. Measured on 2026-09-04 at
 * `/dashboard/decisions`:
 *
 *   NOTHING NEEDS YOU THIS WEEK
 *   This week All stores require your focus on closing the books late …
 *
 * Two adjacent lines, one contradicting the other. The briefing is not an
 * action — nothing about it is a decision with a deadline — but it is
 * unambiguously something that needs the reader, which is the only question
 * this pill answers. So it is consulted, and the pill says how much is here
 * rather than claiming nothing is.
 */
function headlineFor(view: DecisionsView): string {
  const first = view.actions[0]
  if (first && first.deadline.kind === "decays") return "One decision cannot wait"
  if (view.vitals.laborGap.status === "short") return "The week is short on cover"
  if (first) return "One decision to make"
  if (view.verdict.fromBriefing) return "One thing to look at"
  return "Nothing needs you this week"
}

/**
 * The judgement colour of an action, from its DEADLINE and not its size.
 *
 * The prototype paints the eleven-hour Saturday `bad`, the beef reprice `warn`
 * and the milkshake `good` — which is not a ranking by dollars (the milkshake
 * is the smallest of the three and the reprice is NEGATIVE). It is how long
 * the reader has: value that decays daily is red, a dated window is amber, a
 * play with a horizon is green.
 */
function toneFor(a: DecisionAction): Tone {
  if (a.deadline.kind === "decays") return "bad"
  if (a.deadline.kind === "date") return "warn"
  return "good"
}

function categoryLabel(a: DecisionAction): string {
  return a.category.toLowerCase()
}

function hrefFor(a: DecisionAction): string {
  return ACTION_ROUTE[a.type] ?? "/dashboard/forecasts"
}

/** "80% interval, calibrated" — or what it is instead. */
function coverageWord(view: DecisionsView): string {
  const s = view.scorecard
  if (!s || s.intervalCoverage80 == null) return "not yet measured"
  if (s.coverageMeetsTarget === true) return "80% interval, calibrated"
  return s.intervalCoverage80 < COVERAGE_TARGET
    ? "80% interval, over-confident"
    : "80% interval, wide"
}

export function buildDecisionsStrip(view: DecisionsView, week: WeekDay[]): StripCell[] {
  const total = weekTotal(week)
  const d = weekDelta(view)
  const { inside, sample } = insideOf(view)
  const gap = view.vitals.laborGap
  const splh = view.vitals.splh

  return [
    {
      label: "This week's pot",
      value: money(total),
      delta: d.text,
      deltaTone: d.tone,
    },
    {
      label: "Forecast accuracy",
      value: inside === null ? count(null) : `${inside} of ${sample}`,
      delta: coverageWord(view),
      deltaTone: "is-flat",
    },
    {
      label: "Labor gap",
      // The lane's own arithmetic, absolute: the WORD says which side of level
      // it falls on, so a minus sign in front of "11 hrs" would say it twice.
      value: gap.hours === null ? count(null) : `${Math.abs(gap.hours)} hrs`,
      delta: laborWord(view),
      deltaTone: gap.status === "short" ? "is-down" : "is-flat",
    },
    {
      label: "Sales / labor hour",
      value: splh.actual === null ? count(null) : money(splh.actual, { cents: true }),
      /*
       * WHY THERE IS NO RATE, when there is no rate — never the floor it is
       * not being measured against.
       *
       * `splh.actual` is the week's forecast divided by its SCHEDULED hours,
       * so a week with no schedule published has no rate at all. The cell then
       * rendered an em dash under the words "against $116.95", which reads as
       * a measurement that came out level, and sat immediately beside a Labor
       * gap cell already saying "no schedule to judge" — one cause, two cells,
       * and only one of them admitting it.
       */
      delta:
        splh.actual === null
          ? "no schedule to divide by"
          : splh.target === null
            ? "no floor on file"
            : `against ${money(splh.target, { cents: true })}`,
      deltaTone: splh.status === "below" ? "is-down" : splh.status === "above" ? undefined : "is-flat",
      /*
       * THE SPARKLINE SLOT, FILLED.
       *
       * `.strip .sp` has been declared in the ported sheet since the first
       * Counter commit and `Figure` has drawn into it since `Spark` shipped —
       * on a `reference.series`, which no cell on this page ever carried. The
       * figure said $61.40 against a median and gave the reader no way to see
       * whether it had been climbing to it or falling away from it.
       *
       * `quiet` because the verdict is already in the delta beside it: the
       * meter is context here, and flag words would say "under" twice.
       * Omitted entirely when there is no rate, rather than drawn against a
       * floor nothing is being measured against.
       */
      reference:
        splh.actual === null || view.splhSeries.length < 2
          ? undefined
          : {
              v: splh.actual,
              better: "high",
              target: splh.target ?? undefined,
              quiet: true,
              series: view.splhSeries,
              label: `Sales per labor hour over the last ${view.splhSeries.length} closed days`,
            },
    },
  ]
}

function laborWord(view: DecisionsView): string {
  const gap = view.vitals.laborGap
  if (gap.status === "unknown") return "no schedule to judge"
  if (gap.unscheduledDays > 0) {
    return `${gap.unscheduledDays} day${gap.unscheduledDays === 1 ? "" : "s"} unposted`
  }
  if (gap.status === "short") {
    return `${gap.shortDays} day${gap.shortDays === 1 ? "" : "s"} short`
  }
  if (gap.status === "heavy") {
    return `${gap.heavyDays} day${gap.heavyDays === 1 ? "" : "s"} heavy`
  }
  return "level across the week"
}

/**
 * The loader's briefing lines, as the page's.
 *
 * Two different `BriefingLine` types meet here: `build-briefing`'s is a list
 * of text/num CHUNKS, and the component's is a lead, a body and one right-hand
 * figure. The lead is the first sentence — `buildBriefing` writes every line
 * as "<claim>. <evidence>", and the prototype bolds exactly that claim.
 *
 * The right-hand figure is the LAST `num` chunk rather than the first: the
 * first is usually inside the claim ("$4.86 a pound"), and repeating it in the
 * gutter would print one number twice on one line. A line with no `num` chunk
 * gets no figure, and `Briefing` then renders no `.n` — the gutter number is
 * the line's POSITION and is never affected.
 */
export function buildDecisionsBriefing(view: DecisionsView): BriefingLine[] {
  return view.briefing.map((line, i) => {
    const text = line.chunks.map((c) => c.value).join("")
    const stop = text.indexOf(". ")
    const lead = stop === -1 ? text : text.slice(0, stop + 1)
    const body = stop === -1 ? "" : text.slice(stop + 1)
    const nums = line.chunks.filter((c) => c.kind === "num")
    return {
      key: `${line.kind}-${i}`,
      lead,
      body,
      figure: nums.length > 0 ? nums[nums.length - 1].value.trim() : null,
    }
  })
}

/* ── The half of the week that has already happened (ruling N-R14) ────── */

/**
 * One day of the week that has closed: what was called, and what came in.
 *
 * `p10`/`p90` travel with it because the detail panel prints the band for a
 * settled day exactly as it does for a forward one — the whole question the
 * panel answers is whether the actual landed inside it.
 */
export interface SettledDay {
  date: string
  forecast: number
  /** Null until reconciliation backfills it. NOT zero — see `loadSettledDays`. */
  actual: number | null
  p10: number | null
  p90: number | null
  /**
   * The TreeSHAP waterfall this day's forecast was written with.
   *
   * `view.days` is the FORWARD window, so `DecisionDay.attribution` covers
   * only days that have not happened yet — which meant pressing a settled cell
   * in the picker opened a panel with no explanation, on exactly the days
   * where the explanation can be checked against what actually came in.
   * Selected in the same `findMany` that gets the settled forecasts and merged
   * across stores by `mergeAttributions`, the same way the loader does it.
   */
  attribution: Attribution | null
}

/**
 * The week's settled days, read here rather than through `getDecisionsView`.
 *
 * ## Why this query exists at all (ruling N-R14)
 *
 * `getDecisionsView` asks `getRevenueForecast` for the FORWARD window —
 * `forecastDate >= today` — and never selects `actualRevenue`. So every
 * `WeekDay.actual` was null, and "forecast against actual · click a day" had
 * nothing to compare: the section drew seven grey cells and called it a week.
 * `actualRevenue` is populated on 1,321 of `ForecastDailyRevenue`'s 1,442
 * rows; the figures are on file and were simply never asked for.
 *
 * ## Why it is not a widened loader
 *
 * `src/app/actions/decisions/get-decisions-view.ts` is 917 lines and over the
 * 400-line line `docs/refactor-playbook.md` draws, so widening its forecast
 * query is a restructure with a playbook attached rather than a parameter
 * change. This adapter is the layer that decides what the picker holds, and
 * one `findMany` over one table is the smallest honest way to get it.
 *
 * ## `newestGenerationPerDay`, on the settled window too
 *
 * The settled window has exactly the same append-only shape as the forward
 * one — the nightly rewrites the whole horizon each run and deletes nothing,
 * so a closed Monday carries one row per generation that ever covered it.
 * Summing them would inflate the week the same way it inflates the forecast
 * ($646,442 against $50,754 on 2026-08-26). Newest generation wins, keyed on
 * (store, day), exactly as `getRevenueForecast` does going forward.
 *
 * ## An aggregate day is settled only when EVERY store's is
 *
 * Reconciliation runs per store. Summing the stores that have reconciled and
 * calling that "the actual" understates the day by whatever the others took,
 * and an understated actual against a whole-account forecast reads as a miss
 * the restaurant never had. So a day where any row is still unreconciled
 * carries `actual: null` — the picker leaves it unmarked, which is the truth:
 * we do not know yet.
 */
export async function loadSettledDays(
  view: DecisionsView,
  storeId: string | undefined,
  accountId: string,
): Promise<SettledDay[]> {
  const asOf = parseDayKey(view.asOf)
  if (asOf === null) return []
  const start = weekStartUTC(asOf)
  // Today is Monday: the week has nothing behind it yet.
  if (start.getTime() >= asOf.getTime()) return []

  // `accountId` arrives from `DecisionsSectionsInput` — the page read the
  // session, not this function. The SAME store resolution `getDecisionsView`
  // ran, and `cache()`d, so this is the same set of stores rather than a
  // second opinion about which stores the reader is looking at — and it
  // costs no query.
  const resolved = await resolveStoreContext(storeId, accountId)
  if (!resolved.ok) return []
  const storeIds = resolved.ctx.storeIds
  if (storeIds.length === 0) return []

  const rows = await prisma.forecastDailyRevenue.findMany({
    where: {
      storeId: { in: storeIds },
      // Whole-day rows only. `hourBucket` 1-23 is reserved for an hourly
      // forecast; counting one alongside its own day would double the day.
      hourBucket: 0,
      forecastDate: { gte: start, lt: asOf },
    },
    select: {
      storeId: true,
      forecastDate: true,
      generatedAt: true,
      predictedRevenue: true,
      actualRevenue: true,
      p10: true,
      p90: true,
      attribution: true,
      reconciledRevenue: true,
      reconciledP10: true,
      reconciledP90: true,
      reconciledAt: true,
    },
  })

  /*
   * The SAME reconciled-or-raw choice `getRevenueForecast` makes, and it has
   * to be the same one.
   *
   * These cells sit in one row beside the forward days, which come through
   * that loader: if Monday printed the raw prediction while Thursday printed
   * the reconciled one, the picker would be stating "forecast" two different
   * ways in seven adjacent cells and nothing on the page would say so.
   * `defaultForecastPreference` and `isReconciledStale` are the shared module
   * both read (`src/lib/forecasts/reconciliation-prefs.ts`), so the `raw`
   * rollback switch flips both halves of the week together.
   */
  const prefer = defaultForecastPreference()

  const byDay = new Map<string, SettledDay & { pending: boolean }>()
  // One store's waterfall per day, collected before merging — SHAP
  // contributions are additive, so two stores' "Day of week" effects sum the
  // same way their forecasts do. `mergeAttributions` is the loader's own.
  const waterfallsByDay = new Map<string, Attribution[]>()
  for (const row of newestGenerationPerDay(rows)) {
    const key = row.forecastDate.toISOString().slice(0, 10)
    const parsed = parseAttribution(row.attribution)
    if (parsed) waterfallsByDay.set(key, [...(waterfallsByDay.get(key) ?? []), parsed])
    const held = byDay.get(key) ?? {
      date: key,
      forecast: 0,
      actual: 0,
      p10: null,
      p90: null,
      attribution: null,
      pending: false,
    }
    const useReconciled =
      prefer === "reconciled" &&
      row.reconciledRevenue != null &&
      !isReconciledStale(row.reconciledAt)
    const predicted = useReconciled ? row.reconciledRevenue! : row.predictedRevenue
    const p10 = useReconciled ? row.reconciledP10 : row.p10
    const p90 = useReconciled ? row.reconciledP90 : row.p90

    held.forecast += predicted
    if (row.actualRevenue === null) held.pending = true
    else held.actual = (held.actual ?? 0) + row.actualRevenue
    held.p10 = p10 === null ? held.p10 : (held.p10 ?? 0) + p10
    held.p90 = p90 === null ? held.p90 : (held.p90 ?? 0) + p90
    byDay.set(key, held)
  }

  return [...byDay.values()]
    .map(({ pending, ...d }) => ({
      ...d,
      actual: pending ? null : d.actual,
      attribution: mergeAttributions(waterfallsByDay.get(d.date) ?? []),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * The seven cells of the picker — the week, not the forward window.
 *
 * Monday to Sunday, which is the prototype's own `WK` (Mon 24 → Sun 30) and
 * the week a restaurant schedules against. The days behind today come from
 * `loadSettledDays` and carry an actual; today and the days ahead come from
 * `view.days` and carry `actual: null`.
 *
 * NULL IS NOT ZERO, and this is the one place that matters most. `WeekPicker`
 * renders a null actual as "forecast" and marks the cell neither hit nor miss.
 * Passing zero would paint every day of the coming week — four days out of
 * seven — as a miss against a forecast nothing has yet been measured against.
 * The same applies to a day that has closed but not reconciled: unmarked, not
 * failed.
 *
 * A day the week expects but neither source has is LEFT OUT rather than drawn
 * at zero. That is a store with no forecast row written for that day, and an
 * empty cell claims a call nobody made.
 */
/* ── How the day was called, and by what ──────────────────────────────── */

/**
 * The provenance row under the day panel, per day of the calendar week.
 *
 * READ, never asserted. The interval method is not a constant of this system —
 * `ml/models/revenue.py` fits CQR when `interval_method == "cqr"` and falls
 * back to symmetric split conformal when the calibration window is too thin or
 * the quantile fit fails (`_LOG.warning("cqr unavailable, falling back")`).
 * A page that printed "CQR" unconditionally would be telling the owner the
 * band is quantile-calibrated on exactly the days it is not. So the row prints
 * `modelVersion` and `reconciliationMethod` out of the row that made the
 * forecast, and says "conformal" for the interval without claiming which
 * flavour — the column that would settle it does not exist.
 *
 * Its own small query rather than a widening of `loadSettledDays`: that
 * function's window is the settled half by design, this needs the whole week,
 * and its return shape is read by three call sites. Five columns over seven
 * days is not the cost that matters here.
 */
export interface DayProvenance {
  modelVersion: string | null
  reconciliation: string | null
  reconciled: boolean
}

export async function loadWeekProvenance(
  view: DecisionsView,
  storeId: string | undefined,
  accountId: string,
): Promise<Map<string, DayProvenance>> {
  const out = new Map<string, DayProvenance>()
  const asOf = parseDayKey(view.asOf)
  if (asOf === null) return out
  const start = weekStartUTC(asOf)
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000)

  const resolved = await resolveStoreContext(storeId, accountId)
  if (!resolved.ok) return out
  const storeIds = resolved.ctx.storeIds
  if (storeIds.length === 0) return out

  const rows = await prisma.forecastDailyRevenue.findMany({
    where: {
      storeId: { in: storeIds },
      hourBucket: 0,
      forecastDate: { gte: start, lt: end },
    },
    select: {
      storeId: true,
      forecastDate: true,
      generatedAt: true,
      modelVersion: true,
      reconciliationMethod: true,
      reconciledAt: true,
    },
  })

  for (const row of newestGenerationPerDay(rows)) {
    const key = row.forecastDate.toISOString().slice(0, 10)
    const held = out.get(key)
    // Aggregate: a day is reconciled only when every store's row is, the same
    // rule `loadSettledDays` applies to the actual. One store short and the
    // day has not been reconciled, whatever the others say.
    out.set(key, {
      modelVersion: held?.modelVersion ?? row.modelVersion,
      reconciliation: held?.reconciliation ?? row.reconciliationMethod,
      reconciled: (held?.reconciled ?? true) && row.reconciledAt !== null,
    })
  }
  return out
}

/** "today" / "1 day out" / "3 days out" / "closed". */
function horizonWords(asOf: string, date: string): string {
  if (date < asOf) return "closed"
  const from = parseDayKey(asOf)
  const to = parseDayKey(date)
  if (from === null || to === null) return "—"
  const days = Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000))
  if (days <= 0) return "today"
  return `${days} day${days === 1 ? "" : "s"} out`
}

function provenanceRows(
  asOf: string,
  date: string,
  prov: DayProvenance | undefined,
  hasWaterfall: boolean,
): Array<{ label: string; value: string }> {
  return [
    { label: "Model", value: prov?.modelVersion ?? "not recorded" },
    { label: "Horizon", value: horizonWords(asOf, date) },
    { label: "Interval", value: "conformal, 80%" },
    {
      label: "Reconciled",
      value: prov?.reconciled ? (prov.reconciliation ?? "yes") : "not yet",
    },
    { label: "Attribution", value: hasWaterfall ? "TreeSHAP" : "not published" },
  ]
}

/**
 * What the band is asking the reader to do.
 *
 * A spread is not a disclaimer; it is an instruction about which way to be
 * wrong. On a big day the cost of being short is the whole evening's covers
 * and the cost of being long is one idle hour, so a wide band says staff to
 * the top of it. On a tight band it says the opposite: stop hedging.
 *
 * The threshold is a QUARTER of the point forecast, not a dollar figure — a
 * $2,000 spread means something different on a $6,000 Tuesday than on a
 * $20,000 Saturday, and a fixed cutoff would call the same model confident at
 * one store and hedging at another.
 */
const WIDE_BAND_SHARE = 0.25

function sureness(
  point: number,
  p10: number | null,
  p90: number | null,
  settled: boolean,
): string {
  if (settled) {
    return (
      "This day is closed. The band is what we said beforehand, kept as it was — "
      + "so the call can be judged rather than quietly rewritten."
    )
  }
  if (p10 === null || p90 === null) {
    return (
      "No interval was published for this day, so there is nothing here to say how "
      + "firm the figure is. Treat it as a point estimate and nothing more."
    )
  }
  const spread = p90 - p10
  if (point > 0 && spread / point >= WIDE_BAND_SHARE) {
    return (
      `A ${money(spread)} spread on a ${money(point)} day. Staff and order to the top `
      + "of the band and accept an idle hour — being short on a day this size costs "
      + "more than the hour does."
    )
  }
  return (
    "A band this tight means the model has seen this day many times. Staff to the "
    + "figure itself; the interval is not asking you to hedge."
  )
}

function bandWords(p10: number | null, p90: number | null): string {
  if (p10 === null || p90 === null) return "no interval published"
  return `${money(p10)} – ${money(p90)}`
}

export function buildDecisionsWeek(view: DecisionsView, settled: SettledDay[]): WeekDay[] {
  const asOf = parseDayKey(view.asOf)
  const keys = asOf === null ? view.days.map((d) => d.date) : weekDayKeys(asOf)
  const settledByDay = new Map(settled.map((s) => [s.date, s]))
  const forwardByDay = new Map(view.days.map((d) => [d.date, d]))

  const cells: WeekDay[] = []
  for (const key of keys) {
    const s = settledByDay.get(key)
    if (s) {
      // The band is carried on BOTH halves. A settled day keeps the interval
      // it was given beforehand — that is what makes a kept call checkable
      // rather than quietly rewritten after the fact.
      cells.push({
        key,
        label: dayLabel(key),
        forecast: s.forecast,
        actual: s.actual,
        p10: s.p10,
        p90: s.p90,
      })
      continue
    }
    const f = forwardByDay.get(key)
    if (f) {
      cells.push({
        key,
        label: dayLabel(key),
        forecast: f.predictedRevenue,
        actual: null,
        p10: f.p10,
        p90: f.p90,
      })
    }
  }
  // Sorted here as well as upstream, for the reason `newestGenerationPerDay`
  // sorts: the cells are a WEEK and read left to right, so their order is
  // this function's promise rather than an assertion about a query the
  // caller could change.
  return cells.sort((a, b) => a.key.localeCompare(b.key))
}

/**
 * Which day the detail panel is about. The URL asks; the week decides.
 *
 * Both halves of the picker are selectable, so this answers with either a
 * forward `DecisionDay` or a `SettledDay`. A picker whose left-hand cells
 * snapped the panel back to today when pressed would be a control that lies
 * about being one.
 */
export function selectDay(
  view: DecisionsView,
  settled: SettledDay[],
  asked: string | undefined,
): { kind: "forward"; day: DecisionDay } | { kind: "settled"; day: SettledDay } | null {
  if (asked !== undefined) {
    const forward = view.days.find((d) => d.date === asked)
    if (forward) return { kind: "forward", day: forward }
    const closed = settled.find((d) => d.date === asked)
    if (closed) return { kind: "settled", day: closed }
  }
  const today = view.days.find((d) => d.date === view.asOf) ?? view.days[0] ?? null
  if (today) return { kind: "forward", day: today }
  const last = settled[settled.length - 1]
  return last ? { kind: "settled", day: last } : null
}

/**
 * A day that has closed, as arithmetic.
 *
 * The same six rows the forward panel prints, with the two the schedule
 * supplies left as em-dashes: `HarriShift` publishes forward cover and this
 * adapter does not read a settled day's posted hours, so "12 h" here would be
 * a number nobody looked up. What replaces them is the row a closed day
 * actually has and a forward one cannot — a real Actual — and the sentence
 * under the rule reads the two against each other.
 */
export function buildSettledDayDetail(
  day: SettledDay,
  asOf: string,
  prov?: DayProvenance,
): DayDetail {
  const rows: MathRow[] = [
    { key: "forecast", label: "Forecast", value: money(day.forecast) },
    { key: "actual", label: "Actual", value: money(day.actual) },
    {
      key: "interval",
      label: "80% interval",
      op: true,
      value:
        day.p10 === null || day.p90 === null
          ? money(null)
          : `${money(day.p10)} – ${money(day.p90)}`,
    },
    { key: "hours", label: "Hours planned", op: true, value: count(null) },
    { key: "splh", label: "Implied sales per labor hour", op: true, value: money(null) },
    { key: "moves", label: "How it landed", strong: true, rule: true, value: "" },
  ]

  return {
    date: day.date,
    label: dayLabel(day.date),
    meta:
      day.actual === null
        ? `closed · called ${money(day.forecast)} · not reconciled yet`
        : `closed · called ${money(day.forecast)} · came in ${money(day.actual)}`,
    rows,
    moves: landedFor(day),
    attribution: day.attribution,
    forecast: day.forecast,
    band: bandWords(day.p10, day.p90),
    sureness: sureness(day.forecast, day.p10, day.p90, true),
    provenance: provenanceRows(asOf, day.date, prov, day.attribution !== null),
  }
}

/**
 * The sentence under a closed day's rule.
 *
 * The one piece of arithmetic on this page that is not the loader's, because
 * the loader never had both numbers: actual less forecast, and whether that
 * landed inside the band. `WeekPicker`'s own hit/miss line is 97% of forecast
 * (`week-picker.tsx`), and this sentence deliberately does NOT restate it as a
 * verdict — the cell above already carries the mark, and two different
 * thresholds describing one day is how a page comes to disagree with itself.
 */
function landedFor(day: SettledDay): string {
  if (day.actual === null) {
    return "The day has closed, but reconciliation has not posted what it took yet"
  }
  const gap = day.actual - day.forecast
  const inside =
    day.p10 !== null && day.p90 !== null && day.actual >= day.p10 && day.actual <= day.p90
  const direction =
    Math.round(gap) === 0
      ? "landed on the call"
      : gap > 0
        ? `beat the call by ${money(gap)}`
        : `came in ${money(-gap)} under the call`
  const band =
    day.p10 === null || day.p90 === null
      ? ""
      : inside
        ? ", inside the 80% interval"
        : ", outside the 80% interval"
  return `It ${direction}${band}`
}

export function buildDayDetail(
  view: DecisionsView,
  day: DecisionDay,
  prov?: DayProvenance,
): DayDetail {
  const settled = day.date < view.asOf
  const hours = day.labor.scheduledHours
  const impliedSplh = hours > 0 ? day.predictedRevenue / hours : null

  const rows: MathRow[] = [
    { key: "forecast", label: "Forecast", value: money(day.predictedRevenue) },
    {
      key: "actual",
      label: settled ? "Actual" : "Actual so far",
      // An em-dash, not a zero: a day still ahead has taken nothing YET.
      // This is the FORWARD panel — a closed day is `buildSettledDayDetail`,
      // which prints a real Actual out of this adapter's own query (N-R14).
      value: money(null),
    },
    {
      key: "interval",
      label: "80% interval",
      op: true,
      value:
        day.p10 === null || day.p90 === null
          ? money(null)
          : `${money(day.p10)} – ${money(day.p90)}`,
    },
    {
      key: "hours",
      label: "Hours planned",
      op: true,
      value: hours > 0 ? `${hours} h` : count(null),
    },
    {
      key: "splh",
      label: "Implied sales per labor hour",
      op: true,
      value: money(impliedSplh, { cents: true }),
    },
    { key: "moves", label: "What moves it", strong: true, rule: true, value: "" },
  ]

  return {
    date: day.date,
    label: dayLabel(day.date),
    meta:
      day.p10 === null || day.p90 === null
        ? `forecast ${money(day.predictedRevenue)} · no interval published`
        : `forecast ${money(day.predictedRevenue)} · P10–P90 ${money(day.p10)}–${money(day.p90)}`,
    rows,
    moves: movesFor(day),
    attribution: day.attribution,
    forecast: day.predictedRevenue,
    band: bandWords(day.p10, day.p90),
    sureness: sureness(day.predictedRevenue, day.p10, day.p90, settled),
    provenance: provenanceRows(view.asOf, day.date, prov, day.attribution !== null),
  }
}

/**
 * The sentence under "What moves it".
 *
 * Every clause is something the loader already decided — the hourly coverage's
 * worst stretch, the weather signal's phrase, the event signal's, the open
 * anomaly, the food-cost note. Nothing is derived here, and a day with no
 * signal says so rather than being left blank: an empty paragraph reads as a
 * feature that broke, which is the defect `staffNote` exists to fix one panel
 * over.
 */
function movesFor(day: DecisionDay): string {
  const parts: string[] = []

  const stretch = day.hourly.worstStretch
  if (stretch) {
    parts.push(
      `the forecast wants more cover between ${clockHour(stretch.startHour)} and ` +
        `${clockHour(stretch.endHour)}`,
    )
  }
  if (day.labor.status === "short" && day.labor.gapHours !== null) {
    parts.push(`the schedule is ${Math.abs(day.labor.gapHours)} hours short of what it earns`)
  }
  if (day.weatherPhrase) parts.push(day.weatherPhrase.toLowerCase())
  if (day.eventPhrase) parts.push(day.eventPhrase.toLowerCase())
  if (day.anomalyHint) parts.push(day.anomalyHint.toLowerCase())
  if (day.foodCostNote) parts.push(day.foodCostNote.toLowerCase())

  if (parts.length === 0) {
    return "Nothing in the week's signals moves this day off its own weekday average"
  }
  const sentence = parts.join("; ")
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}

function clockHour(hour: number): string {
  const h = ((hour % 24) + 24) % 24
  const suffix = h < 12 ? "am" : "pm"
  const twelve = h % 12 === 0 ? 12 : h % 12
  return `${twelve}${suffix}`
}

export function buildAccuracy(view: DecisionsView): SectionData<Accuracy> {
  const s = view.scorecard
  // The scorecard is null until the nightly evaluator has run over a
  // reconciled window. That is a real state and it is NOT a failure: nothing
  // broke, the measurement does not exist yet, and saying so is the only
  // honest option. `failed` would blame a query that answered fine.
  if (s === null || s.sampleSize <= 0) {
    return notComputed<Accuracy>(
      "the forecast's own track record — MlForecastEvaluation has published no " +
        "reconciled window for this store yet",
    )
  }

  const { inside, sample } = insideOf(view)
  const expected = Math.round(COVERAGE_TARGET * sample)

  const rows: MathRow[] = [
    {
      key: "inside",
      label: "Inside the 80% interval",
      value: inside === null ? count(null) : `${inside} of ${sample}`,
    },
    { key: "expected", label: "Expected at 80%", value: count(expected) },
    { key: "error", label: "Average error", value: pct(s.wape) },
    {
      key: "baseline",
      label: "Against a four-week average",
      value: s.beatsBaselineBy === null ? count(null) : `${pct(s.beatsBaselineBy)} better`,
      noBorder: true,
    },
  ]

  return ready({ rows, record: buildRecord(inside, sample), note: accuracyNote(view, inside, sample, expected) })
}

/**
 * `sample` marks, `sample - inside` of them misses, spread evenly.
 *
 * See `Accuracy.record` for why they are spread rather than bunched: the
 * evaluator publishes a proportion, so a proportion is what may be drawn.
 */
export function buildRecord(inside: number | null, sample: number): RecordMark[] {
  if (sample <= 0) return []
  const misses = inside === null ? 0 : Math.max(0, sample - inside)
  if (misses === 0) return Array.from({ length: sample }, () => "hit" as const)
  const step = sample / misses
  const missAt = new Set(
    Array.from({ length: misses }, (_, i) => Math.min(sample - 1, Math.floor(i * step + step / 2))),
  )
  return Array.from({ length: sample }, (_, i) => (missAt.has(i) ? "miss" : "hit"))
}

function accuracyNote(
  view: DecisionsView,
  inside: number | null,
  sample: number,
  expected: number,
): string {
  if (inside === null) {
    return `Coverage has not been measured over the last ${sample} reconciled days.`
  }
  const lead = `An 80% interval should catch ${expected} in ${sample}. It caught ${inside}`
  if (view.scorecard?.coverageMeetsTarget === true) {
    return `${lead}, so the interval is calibrated — it is neither over-confident nor useless.`
  }
  return inside < expected
    ? `${lead}, so the interval is too narrow — the model is more confident than its record supports.`
    : `${lead}, so the interval is wider than it needs to be — the band is safe but says less.`
}

/**
 * "What you decided".
 *
 * N-R5. `DecisionLog` has ZERO rows in production, and this section renders
 * READY with an empty array rather than `empty()`. `Empty` emits a `.empty`
 * landmark the prototype does not have on this page, and an extra landmark is
 * never forgivable by the fidelity gate — where a table with its four column
 * headers and no rows is both a correct rendering of "you have decided
 * nothing" and the exact DOM the prototype draws around its rows. `tbl` is a
 * landmark; its rows are not.
 */
export function buildLedger(records: DecisionRecord[]): LedgerRow[] {
  return records.map((r) => ({
    key: `${r.storeId}|${r.opportunityType}|${r.rawTitle}|${r.decidedAt.toISOString()}`,
    date: shortDate(r.decidedAt),
    decision: r.storeName ? `${r.title} · ${r.storeName}` : r.title,
    worth: `${money(r.predictedImpactUsdPerWeek)}/wk`,
    outcome: outcomeWord(r),
    outcomeTone: outcomeTone(r),
  }))
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function shortDate(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}

function outcomeWord(r: DecisionRecord): string {
  if (r.state === "DISMISSED") return "Dismissed"
  const o = r.outcome
  if (!o || o.frozenDays === 0) return "Not measured"
  switch (o.verdict) {
    case "measuring":
      return `Measuring · ${o.daysObserved} of ${o.frozenDays} days`
    case "working":
      return "Holding"
    case "backfiring":
      return "Reversed"
    case "no-clear-effect":
      return "No clear effect"
  }
}

function outcomeTone(r: DecisionRecord): Tone {
  if (r.state === "DISMISSED") return "warn"
  const v = r.outcome?.verdict
  if (v === "working") return "good"
  if (v === "backfiring") return "bad"
  return "warn"
}

/**
 * "What to do this week" — three items, from the loader's five.
 *
 * ## N-R7: the ranking is CHARACTERISED here, not fixed
 *
 * `buildActionCards` sorts on a score that compares two incompatible scales:
 * `impactP25 * weekly` where the generator produced a 25th percentile, and
 * `estimatedDollarImpact * weekly * CONFIDENCE_WEIGHT[confidence]` where it did
 * not — and `impactP25` is null on 27 of 41 live rows. A downside dollar and a
 * confidence-discounted point estimate are not the same quantity, so the sort
 * is partly ordering apples against pears. **This adapter keeps that order
 * exactly.** Correcting a ranking inside a translation layer would change what
 * the page recommends without changing anything the loader believes, and the
 * two would then disagree about which action matters most. The defect is the
 * loader's to fix, in a change that says so.
 *
 * ## The figure is PRINTED, not re-normalised
 *
 * `impactUsdPerWeek` is already per week — `buildActionCards` divides by the
 * generator's own horizon (1 day for a reprice, 30 for menu engineering).
 * Dividing again here is exactly what produced "+$10,839/wk" for one
 * slow-moving combo before the loader was fixed. The unit string says "/wk"
 * because the number IS weekly, not to relabel one that is not.
 */
export function buildDecisionQueue(
  actions: DecisionAction[],
  asOf: string,
): DecisionQueueItem[] {
  return actions.slice(0, QUEUE_SHOWN).map((a) => {
    const note = deadlineWords(a)
    const confidence = confidenceWords(a)
    return {
      key: a.id,
      tone: toneFor(a),
      lead: money(a.impactUsdPerWeek),
      unit: "/wk",
      title: a.title,
      body: `${a.why} ${confidence} · ${note}`.trim(),
      act: `Open ${categoryLabel(a)}`,
      href: hrefFor(a),
      dots: a.dots,
      note,
      why: a.why,
      confidence,
      ref: {
        storeId: a.storeId,
        type: a.type,
        // The GENERATOR's title. `a.title` above is the stripped one the
        // reader sees; keying on it would write a row that never matches.
        title: a.rawTitle,
        asOf,
        impactUsdPerWeek: a.impactUsdPerWeek,
        p10: a.impactRangeUsdPerWeek?.low ?? null,
        p90: a.impactRangeUsdPerWeek?.high ?? null,
      },
    }
  })
}

/** The queue section: the three shown items, and the cap said out loud. */
export function buildQueueSection(view: DecisionsView): DecisionQueue {
  return {
    items: buildDecisionQueue(view.actions, view.asOf),
    meta: `${Math.min(QUEUE_SHOWN, view.actions.length)} of ${view.actions.length}`,
  }
}

/**
 * The same three items, as `.mli` rows (ruling N-R16).
 *
 * Built from `buildDecisionQueue`'s OUTPUT rather than from the actions again:
 * `value` is the desk's `lead` and `note` is the desk's deadline words, so the
 * phone cannot print one item's impact in a different unit or round it
 * differently from the desk. `P.decisions.phone()`'s own rows are the same
 * five slots — title, why, figure, deadline, tone.
 *
 * `noteTone` is `down` only for something that decays, matching the
 * prototype's own single `'down'` on the Saturday row: the tone marks the
 * item you lose by waiting, not every item with a date.
 */
export function buildPhoneQueue(queue: DecisionQueue): PhoneQueue {
  const top = queue.items[0]
  return {
    meta: queue.meta,
    first: top ? { title: top.title, ref: top.ref } : null,
    items: queue.items.map((i) => ({
      key: i.key,
      title: i.title,
      // The claim without the confidence meter's prose — the phone row has
      // two lines and the deadline already has the right-hand slot below.
      detail: firstSentence(i.why),
      value: `${i.lead}${i.unit ?? ""}`,
      note: i.note,
      noteTone: i.note === "decays daily" ? ("down" as const) : undefined,
      href: i.href,
    })),
  }
}

/**
 * The shelf as phone rows — the ones with an order to place.
 *
 * The figure on the right is the FORECAST-shaped cover, not the flat one: the
 * phone has room for one number per row and the whole point of the section is
 * that the flat one is the wrong one. The desk shows both because it has room
 * to make the comparison; the phone shows the one the owner should act on.
 */
export function buildPhoneRunOut(runOut: RunOut): PhoneRunOut {
  const urgent = runOut.rows.filter((r) => r.tagTone !== "good")
  return {
    hot: runOut.hot,
    meta: runOut.hot > 0 ? `${runOut.hot} before delivery` : "all covered",
    items: urgent.map((r) => ({
      key: r.key,
      title: r.name,
      detail: `Out ${r.outLabel}${r.qty ? ` · bring in ${r.qty}` : ""}`,
      value:
        r.forecastCoverDays === null
          ? "—"
          : `${(Math.round(r.forecastCoverDays * 10) / 10).toFixed(1)}d`,
      note: r.tag,
      noteTone: r.tagTone === "bad" ? ("down" as const) : undefined,
      href: r.href,
    })),
  }
}

/** The claim, without the evidence that follows it. `.mli span` is one line. */
function firstSentence(body: string): string {
  const stop = body.indexOf(". ")
  return stop === -1 ? body : body.slice(0, stop)
}

function confidenceWords(a: DecisionAction): string {
  return a.confidence === "high"
    ? "high confidence"
    : a.confidence === "medium"
      ? "medium confidence"
      : "low confidence"
}

function deadlineWords(a: DecisionAction): string {
  if (a.deadline.kind === "decays") return "decays daily"
  if (a.deadline.kind === "horizon") return "no deadline"
  const days = a.deadline.daysLeft
  return `within ${days} day${days === 1 ? "" : "s"}`
}

/* ── The entry points ─────────────────────────────────────────────────── */

/**
 * The Needs-you page's ten sections, as ten promises over ONE load — plus a
 * second, dependent load for the half of the week that has already closed.
 *
 * Ruling N-R13, and the reason it is a ruling: `getDecisionsView` looks like a
 * single call and is nine queries across nine tables, feeding sections that
 * have nothing to do with each other. Deriving each section from a shared
 * promise costs nothing today and means the page never has to change when
 * that loader is decomposed.
 *
 * `getDecisionsSections` below is `awaitSections` over this, so there is one
 * implementation of what a section holds and not two.
 */
export function getDecisionsSectionPromises(
  input: DecisionsSectionsInput,
): StreamedSections<DecisionsSections> {
  // ONE load, started here and awaited by nobody in this function. A loader
  // that answers `{ ok: false }` is a FAILED section and not an empty one:
  // `empty` would tell the reader there is nothing to decide this week, and
  // there may be plenty — we could not load it.
  const viewP: Promise<SectionData<DecisionsView>> = classify(
    async () => {
      const res = await getDecisionsView({ storeId: input.storeId })
      if (!res.ok) throw new Error(loadError(res.error))
      return res.data
    },
    { retryAction: "retryDecisions" },
  )

  const on = <T,>(f: (view: DecisionsView) => SectionData<T>): Promise<SectionData<T>> =>
    guardSection(
      viewP.then((sd) => {
        if (sd.status !== "ready" && sd.status !== "stale") return mapReady(sd, () => undefined as never)
        return f(sd.data)
      }),
      "retryDecisions",
    )

  const simple = <T,>(
    f: (view: DecisionsView) => T,
    /** Which empty, when the built value is one — or null when it is not. */
    emptyReason?: (view: DecisionsView, value: T) => EmptyReason | null,
  ): Promise<SectionData<T>> =>
    guardSection(
      viewP.then((sd) =>
        mapReadyTo(sd, (view) => {
          const value = f(view)
          const reason = emptyReason?.(view, value) ?? null
          return reason === null ? ready(value) : empty<T>(reason)
        }),
      ),
      "retryDecisions",
    )

  /*
   * The week's settled half (N-R14), as a SECOND load hung off the first.
   *
   * It cannot start before `viewP` resolves, because which week it is comes
   * from `view.asOf` — the server's day, and the one the forward days are
   * anchored on. Deriving the week from a `new Date()` here instead would
   * make two halves of one picker capable of disagreeing about which Monday
   * they belong to, across a midnight boundary or a slow request.
   *
   * It never rejects: `loadSettledDays` fails closed to `[]`, which draws the
   * picker with the forward days alone — exactly what it drew before this
   * ruling. A settled query that broke must not take the week down with it.
   */
  const settledP: Promise<SettledDay[]> = viewP
    .then((sd) => {
      const view = dataOf(sd)
      return view === null ? [] : loadSettledDays(view, input.storeId, input.accountId)
    })
    .catch(() => [])

  /*
   * Which model called each day, and whether reconciliation has been over it.
   *
   * Hung off `viewP` for the same reason `settledP` is — the week is
   * `view.asOf`'s week, not `new Date()`'s. Fails closed to an empty map: a
   * missing provenance row costs the panel a `MODEL not recorded` caption, and
   * must never cost it the panel.
   */
  const provenanceP: Promise<Map<string, DayProvenance>> = viewP
    .then((sd) => {
      const view = dataOf(sd)
      return view === null
        ? new Map<string, DayProvenance>()
        : loadWeekProvenance(view, input.storeId, input.accountId)
    })
    .catch(() => new Map<string, DayProvenance>())

  /*
   * The shelf against the week. Its OWN load, in parallel with the view rather
   * than derived from it — it reads inventory and the menu-item forecast,
   * tables `getDecisionsView` never touches, so there is nothing to wait for.
   * It takes `asOf` from the view all the same, so the week it consumes stock
   * over is the week the picker above it draws.
   *
   * Ready with zero rows is EMPTY here, not ready — unlike the ledger. An
   * account with no completed stock count has no anchored on-hand to project
   * forward, which `no_counts` says and tells the reader how to fix; a table
   * of nothing under a heading would say the week is safe.
   */
  const runOutP: Promise<SectionData<RunOut>> = viewP.then(async (sd) => {
    const view = dataOf(sd)
    if (view === null) return mapReady(sd, () => undefined as never)
    const asOf = parseDayKey(view.asOf) ?? new Date()
    const resolved = await resolveStoreContext(input.storeId, input.accountId)
    if (!resolved.ok) {
      return notComputed<RunOut>("what runs out — no store is in view")
    }
    const runOut = await loadRunOut({
      accountId: input.accountId,
      storeIds: resolved.ctx.storeIds,
      asOf,
    })
    return runOut.rows.length === 0 ? empty<RunOut>("no_counts") : ready(runOut)
  })

  /** The two sections that read the settled half as well as the view. */
  const withWeek = <T,>(
    f: (view: DecisionsView, settled: SettledDay[]) => SectionData<T>,
  ): Promise<SectionData<T>> =>
    guardSection(
      Promise.all([viewP, settledP]).then(([sd, settled]) => {
        if (sd.status !== "ready" && sd.status !== "stale") {
          return mapReady(sd, () => undefined as never)
        }
        return f(sd.data, settled)
      }),
      "retryDecisions",
    )

  /**
   * The three sections that print the week's TOTAL, over the same series the
   * picker draws (ruling N-R17).
   *
   * `buildDecisionsWeek` is called once per section rather than hoisted into a
   * shared promise, deliberately: it is a pure merge of two arrays already in
   * memory, so calling it three times costs three map-and-sorts and cannot
   * disagree with itself — whereas a hoisted `weekP` would be a fourth place
   * that decides what the week is. The ONE-FUNCTION rule is about there being
   * one implementation, not one invocation.
   *
   * The cost of the fix is that the headline and the strip now wait for
   * `settledP` as well as `viewP` — one extra `findMany` before the biggest
   * figure on the page can paint. That is the price of the figure being true,
   * and `loadSettledDays` fails closed to `[]`, so a settled query that broke
   * degrades the headline to the forward half rather than taking it down.
   */
  const withWeekDays = <T,>(
    f: (view: DecisionsView, week: WeekDay[]) => SectionData<T>,
  ): Promise<SectionData<T>> => withWeek((view, settled) => f(view, buildDecisionsWeek(view, settled)))

  return {
    head: withWeekDays((view, week) => ready(buildDecisionsHead(view, week))),
    strip: withWeekDays((view, week) => ready(buildDecisionsStrip(view, week))),
    /*
     * The briefing, and the two ways it can be empty.
     *
     * `view.briefing` is `slice(1)` — the verdict absorbs the most urgent line
     * so the page never says the same thing twice — so a briefing holding
     * exactly one line leaves this section an empty array. Measured on
     * 2026-09-04 that rendered as a heading, a meta and an Ask button over
     * nothing at all, which is the blank-panel defect this codebase names
     * everywhere else. Whether there WAS a line is the same fact the headline
     * now needs, and `fromBriefing` carries it.
     */
    briefing: simple((view) => buildDecisionsBriefing(view), (view, lines) =>
      lines.length > 0 ? null : view.verdict.fromBriefing ? "verdict_carried_it" : "all_clear",
    ),

    // Monday to Sunday, forecast against actual — not the forward window.
    // The same series the headline and the strip sum, one function above.
    week: withWeek((view, settled) => ready(buildDecisionsWeek(view, settled))),

    // The one section that can be asked about a day the week does not have.
    // A week with no days at all is owed work rather than a failure — the
    // forecast has not been written for this store yet, which is a real state
    // for a store that has not opened.
    day: guardSection(
      Promise.all([viewP, settledP, provenanceP]).then(([sd, settled, prov]) => {
        if (sd.status !== "ready" && sd.status !== "stale") {
          return mapReady(sd, () => undefined as never)
        }
        const view = sd.data
        const picked = selectDay(view, settled, input.day)
        if (picked === null) {
          return notComputed<DayDetail>(
            "a day to detail — no forecast rows have been written for this store's week",
          )
        }
        return ready(
          picked.kind === "forward"
            ? buildDayDetail(view, picked.day, prov.get(picked.day.date))
            : buildSettledDayDetail(picked.day, view.asOf, prov.get(picked.day.date)),
        )
      }),
      "retryDecisions",
    ),

    accuracy: on<Accuracy>(buildAccuracy),

    // N-R5: ready-and-empty, never `empty()`. `DecisionLog` holds zero rows in
    // production and `simple` classifies an empty array as READY, because
    // `classify`'s `isEmpty` is not passed — deliberately, and this comment is
    // the reason it never should be.
    ledger: simple((view) => buildLedger(view.decisions)),

    // N-R6: three of the loader's five, and the cap said out loud beside them.
    queue: simple(buildQueueSection),

    /*
     * The shelf against the week. Its OWN load, in parallel with the view
     * rather than derived from it — it reads inventory and the menu-item
     * forecast, tables `getDecisionsView` never touches, so there is nothing
     * to wait for. It takes `asOf` from the view all the same, so the week it
     * consumes stock over is the week the picker above it draws.
     *
     * Fails closed to zero rows, which the section renders as `empty` rather
     * than as a failure: an account with no completed stock count has nothing
     * to run out OF, and that is a true answer, not a broken query.
     */
    runOut: guardSection(runOutP, "retryDecisions"),

    // The urgent half of the same object. ONE load, two shapes — see
    // `buildPhoneRunOut`.
    phoneRunOut: guardSection(
      runOutP.then((sd) => mapReadyTo(sd, (r) => ready(buildPhoneRunOut(r)))),
      "retryDecisions",
    ),

    // N-R16: the same three, as the phone's rows. Built from the desk's own
    // section, so one figure has one presentation.
    phoneQueue: simple((view) => buildPhoneQueue(buildQueueSection(view))),
  }
}

/**
 * The same ten, awaited.
 *
 * `awaitSections` over the streaming variant rather than a second body — two
 * implementations of "what is in the queue" is how a desk and a phone come to
 * show one restaurant two different weeks.
 */
export async function getDecisionsSections(
  input: DecisionsSectionsInput,
): Promise<DecisionsSections> {
  return awaitSections(getDecisionsSectionPromises(input))
}
