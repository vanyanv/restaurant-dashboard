/**
 * The sentence the page leads with, and the facts it is allowed to say.
 *
 * Design principle #7: the LLM narrates, it never predicts. That is enforced
 * mechanically rather than by hoping — `verdictFactBlock` is the single source
 * of every figure, and the narration guard in `decision-verdict-llm.ts` builds
 * its allowlist from the same block. A number the block doesn't contain cannot
 * survive the parse, so the model has no route to inventing one.
 *
 * `composeVerdict` is the deterministic reading of the same facts. It is not a
 * degraded mode — it renders whenever there is no API key, the call fails, or
 * the guard rejects the candidate, and it is held to the same allowlist by its
 * own test. The page always has a verdict.
 */

import type { GapStatus, Vitals } from "@/lib/decisions/vitals"

/** The masthead sets the verdict at display size; past this it wraps badly. */
export const VERDICT_MAX_CHARS = 170

export interface VerdictFacts {
  storeName: string
  isAggregate: boolean
  weekTotal: number | null
  weekP10: number | null
  weekP90: number | null
  peakDay: { weekdayShort: string; predictedRevenue: number } | null
  /** Signed: negative is short. Null when no day could be judged. */
  laborGapHours: number | null
  laborStatus: GapStatus
  shortDays: number
  unscheduledDays: number
  topAction: { title: string; impactUsdPerWeek: number } | null
  potUsdPerWeek: number
  accuracyWape: number | null
  accuracySample: number
  /**
   * The highest-severity briefing line, already a complete sentence from a
   * tested generator. The verdict absorbs it so the list below doesn't repeat
   * it — which is only safe because the composer leads with it too, not just
   * the narrator.
   */
  topBriefing: string | null
}

export const fmtUsd = (n: number): string =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  })

const fmtHours = (n: number): string => {
  const abs = Math.abs(n)
  return Number.isInteger(abs) ? `${abs}` : abs.toFixed(1)
}

export function buildVerdictFacts(input: {
  storeName: string
  isAggregate: boolean
  days: { date: string; weekdayShort: string; predictedRevenue: number }[]
  /**
   * The Mon–Sun keys the page's picker actually draws.
   *
   * `days` is the NEXT SEVEN DAYS from today, which is not the week — on a
   * Friday it runs to next Thursday. Reducing over it unscoped is how a
   * sentence reading "the week's biggest day" came to be allowed to name a day
   * the picker beside it does not contain. Empty means "don't scope", for a
   * caller that has no week in view.
   */
  weekKeys?: string[]
  vitals: Vitals
  actions: { title: string; impactUsdPerWeek: number }[]
  potUsdPerWeek: number
  topBriefing?: string | null
}): VerdictFacts {
  const { storeName, isAggregate, days, vitals, actions, potUsdPerWeek } = input

  const inWeek =
    input.weekKeys && input.weekKeys.length > 0
      ? days.filter((d) => input.weekKeys!.includes(d.date))
      : days
  // `inWeek` can be empty only if every forward day fell outside the week,
  // which cannot happen while `days[0]` is today — but an empty reduce throws,
  // and a verdict is not worth a crash.
  const peakDay =
    inWeek.length > 0
      ? inWeek.reduce((best, d) => (d.predictedRevenue > best.predictedRevenue ? d : best))
      : null

  return {
    storeName,
    isAggregate,
    weekTotal: vitals.weekForecast.total,
    weekP10: vitals.weekForecast.p10,
    weekP90: vitals.weekForecast.p90,
    peakDay: peakDay
      ? { weekdayShort: peakDay.weekdayShort, predictedRevenue: peakDay.predictedRevenue }
      : null,
    laborGapHours: vitals.laborGap.hours,
    laborStatus: vitals.laborGap.status,
    shortDays: vitals.laborGap.shortDays,
    unscheduledDays: vitals.laborGap.unscheduledDays,
    // Already ranked on the 25th percentile upstream (principle #9) — this
    // takes the top of that order rather than re-ranking on the headline.
    topAction: actions.length > 0 ? actions[0] : null,
    potUsdPerWeek,
    accuracyWape: vitals.accuracy?.wape ?? null,
    accuracySample: vitals.accuracy?.sampleSize ?? 0,
    topBriefing: input.topBriefing ?? null,
  }
}

/**
 * Every figure the narration may quote, pre-formatted exactly as it should
 * appear. A key absent from this block is a fact the page does not have; the
 * prompt never sees a placeholder, so the model is never invited to fill one.
 */
export function verdictFactBlock(f: VerdictFacts): Record<string, string> {
  const block: Record<string, string> = {
    store: f.storeName,
  }

  /*
   * NO WEEK TOTAL. This is the one figure the narrator may not quote, and the
   * omission is the whole point of it.
   *
   * `vitals.weekForecast.total` is the sum of the NEXT SEVEN DAYS from today.
   * The page that prints this sentence is `/dashboard/decisions`, whose
   * masthead, day picker, strip and lead figure are all the Mon–Sun calendar
   * week — a different seven days, and a different number. On 2026-09-02 the
   * two were $52,158 and $51,743, and both were on screen at once: the lead
   * figure said "THE CALL THIS WEEK $51,743" and the sentence four inches to
   * its right said "total week forecast $52,158".
   *
   * The adapter already learned this once. `weekTotal` in
   * `src/lib/counter/adapters/decisions.ts` carries ruling N-R17 and the note
   * that reading `vitals.weekForecast.total` "is what put $51,338 above a
   * picker summing $52,111" — the same drift, fixed for the figure and left
   * standing in the sentence beside it.
   *
   * The right total is the sum of the seven cells the picker prints, it is
   * taken once, and the lead figure is where it is taken. The narrator has no
   * access to that sum here (it needs the settled half of the week, which this
   * module never loads), so per this file's own rule — "a key absent from this
   * block is a fact the page does not have" — it gets no key at all rather
   * than a plausible number from the wrong window.
   *
   * `weekTotal` stays on `VerdictFacts`: `composeVerdict` uses it to decide
   * whether there is a forecast to talk about, and `verdictSources` cites the
   * forecast as a source it read. Neither prints it.
   */

  if (f.peakDay) {
    block.peak_day = f.peakDay.weekdayShort
    block.peak_day_forecast = fmtUsd(f.peakDay.predictedRevenue)
  }

  if (f.laborGapHours != null && f.laborStatus !== "unknown") {
    block.labor_gap_hours = fmtHours(f.laborGapHours)
    block.labor_direction = f.laborStatus === "short" ? "short" : f.laborStatus === "heavy" ? "over" : "level"
  }
  if (f.shortDays > 0) block.short_days = `${f.shortDays}`
  if (f.unscheduledDays > 0) block.days_with_no_schedule = `${f.unscheduledDays}`

  if (f.topAction) {
    block.top_action = f.topAction.title
    block.top_action_impact = fmtUsd(f.topAction.impactUsdPerWeek)
  }
  if (f.potUsdPerWeek > 0) block.actions_worth_per_week = fmtUsd(f.potUsdPerWeek)

  // Its figures join the allowlist by being here, which is correct: they were
  // computed by the briefing generators, not by the model.
  if (f.topBriefing) block.headline_note = f.topBriefing

  if (f.accuracyWape != null && f.accuracySample > 0) {
    block.forecast_accuracy = `${(f.accuracyWape * 100).toFixed(1)}%`
    block.reconciled_days = `${f.accuracySample}`
  }

  return block
}

/**
 * Whether these facts are worth paying a model to narrate.
 *
 * Measured on 2026-09-04 against an account with two pre-open stores: no
 * forecast row, no action, no briefing line, no schedule. `buildVerdictFacts`
 * therefore produced a block whose every optional field was absent, the model
 * was asked for one sentence about it anyway, and it returned
 *
 *   "This week All stores require your focus on closing the books late to
 *    ensure accurate financial tracking."
 *
 * Nothing in the block says anything about books, or about closing them late.
 * The page printed that verbatim, directly beneath its own headline reading
 * "Nothing needs you this week" — and it was cached for the day, so the
 * contradiction was stable rather than a flicker.
 *
 * A narrator given nothing narrates something. The fix is not a better prompt:
 * it is not asking. `composeVerdict` already has the right sentence for this
 * state ("No forecast for X this week yet."), and skipping the call also stops
 * buying a completion for a week that has no figures in it.
 *
 * The test mirrors the composer's own first two branches: a briefing line is
 * something to say, and so is a week with a total and a peak day. Neither, and
 * there is nothing for a sentence to be about.
 */
export function isNarratable(f: VerdictFacts): boolean {
  if (f.topBriefing) return true
  return f.weekTotal != null && f.peakDay != null
}

/** The deterministic reading. Also the fallback whenever narration is rejected. */
export function composeVerdict(f: VerdictFacts): string {
  /*
   * "for any store", not "across all stores" — this reads inside "No forecast
   * for ___ this week yet.", and the adverbial produced "No forecast for
   * across all stores this week yet." It is used in that one sentence and
   * nowhere else, so it is written to fit it.
   */
  const where = f.isAggregate ? "any store" : f.storeName

  // The page drops this line from the list below on the assumption the verdict
  // carries it. That assumption has to hold when there is no narrator, so the
  // composer leads with it too — unless it is too long to set at display size.
  if (f.topBriefing && f.topBriefing.length <= VERDICT_MAX_CHARS) {
    return f.topBriefing
  }

  if (f.weekTotal == null || f.peakDay == null) {
    return `No forecast for ${where} this week yet.`
  }

  const peak = `${f.peakDay.weekdayShort} is the week's biggest day at ${fmtUsd(
    f.peakDay.predictedRevenue,
  )}`

  if (f.laborStatus === "short" && f.laborGapHours != null) {
    return `${peak}, and you are ${fmtHours(f.laborGapHours)} hours short on the schedule.`
  }

  if (f.laborStatus === "heavy" && f.laborGapHours != null) {
    return `${peak}, and the schedule runs ${fmtHours(f.laborGapHours)} hours over what it earns.`
  }

  if (f.unscheduledDays > 0 && f.laborStatus === "unknown") {
    return `${peak}, and there is no schedule published to judge it against.`
  }

  if (f.potUsdPerWeek > 0) {
    return `${peak}, and ${fmtUsd(f.potUsdPerWeek)} a week is sitting in actions you haven't called yet.`
  }

  return `${peak}, and the schedule matches what the week earns.`
}

export interface VerdictChunk {
  kind: "text" | "num"
  value: string
  /**
   * Inside the clause the page is pointing at, set in accent by the component.
   * Flagging is a rule this module applies to the finished sentence — the model
   * is never asked which words matter, because principle #7 doesn't let it
   * decide anything about the page.
   */
  flagged: boolean
}

/**
 * The labor clause, in the shapes the composer and the narrator both produce:
 * "11 hours short", "you are 11.2 hours short on the line", "runs 22 hours
 * over what it earns", "a labor gap of 11.2 hours".
 */
const LABOR_CLAUSE =
  /(?:a labor gap of\s+)?\d[\d,]*(?:\.\d+)?\s+hours?\s+(?:short|over)\b[^,.;]*|a labor gap of\s+\d[\d,]*(?:\.\d+)?\s+hours?\b/gi

/**
 * Split the verdict into prose and figures.
 *
 * The sentence is set in Fraunces italic, and the two-tier rule is explicit
 * that Fraunces never appears on a number — a Fraunces-italic dollar amount
 * fails the system. The figures are lifted into DM Sans tabular by the
 * component; this decides where they are. The `$` and `%` travel with the
 * figure so a currency mark never dangles in the wrong face.
 */
export function splitVerdictChunks(
  line: string,
  /**
   * Set the labor clause in accent. Only true when the week is genuinely short
   * of the hours it earns — a level week has nothing to point at, and red on
   * every verdict is red on none.
   */
  flagLabor = false,
): VerdictChunk[] {
  const isNum = new Array<boolean>(line.length).fill(false)
  const isFlag = new Array<boolean>(line.length).fill(false)

  for (const m of line.matchAll(/\$?\d[\d,]*(?:\.\d+)?%?/g)) {
    for (let i = m.index; i < m.index + m[0].length; i++) isNum[i] = true
  }
  if (flagLabor) {
    for (const m of line.matchAll(LABOR_CLAUSE)) {
      for (let i = m.index; i < m.index + m[0].length; i++) isFlag[i] = true
    }
  }

  // Walk the line and close a chunk wherever either property changes. Splitting
  // on both keeps a figure inside a flagged clause in DM Sans tabular — a red
  // Fraunces-italic dollar amount would fail the two-tier rule as surely as a
  // black one.
  const out: VerdictChunk[] = []
  let start = 0
  for (let i = 1; i <= line.length; i++) {
    const ended = i === line.length || isNum[i] !== isNum[start] || isFlag[i] !== isFlag[start]
    if (!ended) continue
    out.push({
      kind: isNum[start] ? "num" : "text",
      value: line.slice(start, i),
      flagged: isFlag[start],
    })
    start = i
  }

  return out
}

/**
 * Identity of the facts a sentence was written from.
 *
 * Built from the fact block rather than the raw facts, so it moves exactly when
 * a displayed figure moves. A float that changes in a decimal place nobody
 * renders must not re-cost an API call.
 */
export function verdictInputsHash(f: VerdictFacts): string {
  const block = verdictFactBlock(f)
  const stable = Object.keys(block)
    .sort()
    .map((k) => `${k}=${block[k]}`)
    .join("|")

  return fnv1a(stable)
}

/**
 * FNV-1a, hex. These key a cache; they are not a security boundary, and
 * keeping this dependency-free keeps the module importable without
 * `node:crypto` — which matters, because it is imported by client-reachable
 * code.
 *
 * Exported so `decision-verdict-llm` can hash the PROMPT with the same
 * function. See `VERDICT_NARRATION_VERSION`.
 */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, "0")
}

/** The mono provenance line under the verdict. Cites only what was read. */
export function verdictSources(f: VerdictFacts): string[] {
  const out: string[] = []
  if (f.weekTotal != null) out.push("REVENUE FORECAST")
  // Nothing published means nothing was read — citing Harri would overstate it.
  if (f.laborStatus !== "unknown") out.push("HARRI SCHEDULE")
  if (f.accuracySample > 0) out.push(`${f.accuracySample} RECONCILED DAYS`)
  return out
}
