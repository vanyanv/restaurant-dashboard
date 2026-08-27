import {
  getDecisionsView,
  type DecisionAction,
  type DecisionDay,
  type DecisionRecord,
  type DecisionsView,
} from "@/app/actions/decisions/get-decisions-view"
import { count, delta, deltaSign, money, pct } from "@/lib/counter/format"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
import type { ReadingSegment, StripCell } from "@/lib/counter/adapters/pnl"
import {
  dataOf,
  mapReady,
  notComputed,
  ready,
  type SectionData,
} from "@/lib/counter/section-data"
import type { DeltaTone } from "@/components/counter/surface/figure"
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
 * cell — and all three read `vitals.weekForecast.total`, which
 * `computeVitals` derived from the same `days` the picker renders. A second
 * sum taken here would be a fourth opinion about one week.
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
  /** The prototype's sub: "closed" for a day that has settled, else "still ahead". */
  meta: string
  rows: MathRow[]
  /** The "What moves it" paragraph under the rule. Never empty. */
  moves: string
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
  queue: SectionData<DecisionQueueItem[]>
  /**
   * "3 of 5" — what the queue shows against what the loader ranked.
   *
   * A plain string beside the sections rather than a field inside one:
   * `SectionData` carries the section's DATA, and this is the meta the page
   * prints in `.sec__head`. See N-R6 and `OrderItems.meta`, which is the same
   * decision made the same way.
   */
  queueMeta: string
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
}

/* ── Constants the page's shape depends on ────────────────────────────── */

/**
 * N-R6. `buildActionCards` ranks and caps at FIVE; the prototype's queue holds
 * THREE, and `.qitem` is a fidelity landmark.
 *
 * Five against three is two extra landmarks, which no absence allowance
 * forgives. The two the reader does not see are not hidden — `queueMeta` says
 * "3 of 5", so the cap is on the page rather than in this file.
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

const WEEKDAY_TITLE: Record<string, string> = {
  SUN: "Sun",
  MON: "Mon",
  TUE: "Tue",
  WED: "Wed",
  THU: "Thu",
  FRI: "Fri",
  SAT: "Sat",
}

/** "MON" + "AUG 24" -> "Mon 24", which is what a `.wkd` cell prints. */
function dayLabel(d: DecisionDay): string {
  const dom = d.monthDayShort.split(" ")[1] ?? ""
  return `${WEEKDAY_TITLE[d.weekdayShort] ?? d.weekdayShort} ${Number(dom) || dom}`
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
 * the phone strip.
 *
 * `vitals.weekForecast.total` and NOT a sum taken here. Note that it is also
 * not `view.potUsdPerWeek`, which is the sum of the ACTIONS' weekly impact —
 * a different quantity that happens to be money per week. The prototype's
 * "This week's pot" is the revenue the week is forecast to take ($38,930
 * against a strip that also says "▲ 6.1% on last week"); an actions total has
 * no last-week to move against.
 */
function weekTotal(view: DecisionsView): number | null {
  return view.vitals.weekForecast.total
}

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

export function buildDecisionsHead(view: DecisionsView): DecisionsHead {
  const total = weekTotal(view)
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

/** The `.state` pill above the verdict sentence. */
function headlineFor(view: DecisionsView): string {
  const first = view.actions[0]
  if (first && first.deadline.kind === "decays") return "One decision cannot wait"
  if (view.vitals.laborGap.status === "short") return "The week is short on cover"
  if (first) return "One decision to make"
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

export function buildDecisionsStrip(view: DecisionsView): StripCell[] {
  const total = weekTotal(view)
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
      delta:
        splh.target === null
          ? "no floor on file"
          : `against ${money(splh.target, { cents: true })}`,
      deltaTone: splh.status === "below" ? "is-down" : splh.status === "above" ? undefined : "is-flat",
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

/**
 * The seven cells of the picker.
 *
 * `actual` is null on every one of them, and that is a measurement rather than
 * a gap: `getRevenueForecast` is asked for the FORWARD window, so the earliest
 * day in `view.days` is today and today has not closed. `WeekPicker` renders a
 * null actual as "forecast" and marks it neither hit nor miss — which is the
 * state this page is genuinely in. Passing zero instead would paint all seven
 * days as misses.
 */
export function buildDecisionsWeek(view: DecisionsView): WeekDay[] {
  return view.days
    .map((d) => ({
      key: d.date,
      label: dayLabel(d),
      forecast: d.predictedRevenue,
      actual: null,
    }))
    // Sorted here as well as upstream, for the reason `newestGenerationPerDay`
    // sorts: the cells are a WEEK and read left to right, so their order is
    // this function's promise rather than an assertion about a query the
    // caller could change.
    .sort((a, b) => a.key.localeCompare(b.key))
}

/** Which day the detail panel is about. The URL asks; the week decides. */
export function selectDay(view: DecisionsView, asked: string | undefined): DecisionDay | null {
  const found = asked === undefined ? undefined : view.days.find((d) => d.date === asked)
  if (found) return found
  return view.days.find((d) => d.date === view.asOf) ?? view.days[0] ?? null
}

export function buildDayDetail(view: DecisionsView, day: DecisionDay): DayDetail {
  const settled = day.date < view.asOf
  const hours = day.labor.scheduledHours
  const impliedSplh = hours > 0 ? day.predictedRevenue / hours : null

  const rows: MathRow[] = [
    { key: "forecast", label: "Forecast", value: money(day.predictedRevenue) },
    {
      key: "actual",
      label: settled ? "Actual" : "Actual so far",
      // An em-dash, not a zero: a day still ahead has taken nothing YET, and
      // `getDecisionsView` reads only the forward window, so there is no
      // actual on file for any day in this picker. See `buildDecisionsWeek`.
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
      label: "Implied sales per labour hour",
      op: true,
      value: money(impliedSplh, { cents: true }),
    },
    { key: "moves", label: "What moves it", strong: true, rule: true, value: "" },
  ]

  return { date: day.date, label: dayLabel(day), meta: settled ? "closed" : "still ahead", rows, moves: movesFor(day) }
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
export function buildDecisionQueue(actions: DecisionAction[]): DecisionQueueItem[] {
  return actions.slice(0, QUEUE_SHOWN).map((a) => {
    const note = deadlineWords(a)
    return {
      key: a.id,
      tone: toneFor(a),
      lead: money(a.impactUsdPerWeek),
      unit: "/wk",
      title: a.title,
      body: `${a.why} ${confidenceWords(a)} · ${note}`.trim(),
      act: `Open ${categoryLabel(a)}`,
      href: hrefFor(a),
      dots: a.dots,
      note,
    }
  })
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
 * The Needs-you page's nine sections, as nine promises over ONE load.
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
  input: DecisionsSectionsInput = {},
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

  const simple = <T,>(f: (view: DecisionsView) => T): Promise<SectionData<T>> =>
    guardSection(
      viewP.then((sd) => mapReady(sd, f)),
      "retryDecisions",
    )

  return {
    head: simple(buildDecisionsHead),
    strip: simple(buildDecisionsStrip),
    briefing: simple(buildDecisionsBriefing),
    week: simple(buildDecisionsWeek),

    // The one section that can be asked about a day the week does not have.
    // A week with no days at all is owed work rather than a failure — the
    // forecast has not been written for this store yet, which is a real state
    // for a store that has not opened.
    day: on<DayDetail>((view) => {
      const day = selectDay(view, input.day)
      return day === null
        ? notComputed<DayDetail>(
            "a day to detail — no forecast rows have been written for this store's week",
          )
        : ready(buildDayDetail(view, day))
    }),

    accuracy: on<Accuracy>(buildAccuracy),

    // N-R5: ready-and-empty, never `empty()`. `DecisionLog` holds zero rows in
    // production and `simple` classifies an empty array as READY, because
    // `classify`'s `isEmpty` is not passed — deliberately, and this comment is
    // the reason it never should be.
    ledger: simple((view) => buildLedger(view.decisions)),

    // N-R6: three of the loader's five.
    queue: simple((view) => buildDecisionQueue(view.actions)),

    /*
     * The cap, made visible. Not a `SectionData` — it is the meta line in
     * `.sec__head`, and it is a string on the sections object for the same
     * reason `OrderItems.meta` is a field: `SectionData` carries a section's
     * DATA.
     *
     * An em-dash when the view did not load, by the same rule every other
     * absent figure follows — "0 of 0" would be a measurement of a queue
     * nobody managed to read.
     */
    queueMeta: viewP.then((sd) => {
      const view = dataOf(sd)
      if (view === null) return count(null)
      return `${Math.min(QUEUE_SHOWN, view.actions.length)} of ${view.actions.length}`
    }),
  }
}

/**
 * The same nine, awaited.
 *
 * `awaitSections` over the streaming variant rather than a second body — two
 * implementations of "what is in the queue" is how a desk and a phone come to
 * show one restaurant two different weeks.
 */
export async function getDecisionsSections(
  input: DecisionsSectionsInput = {},
): Promise<DecisionsSections> {
  return awaitSections(getDecisionsSectionPromises(input))
}
