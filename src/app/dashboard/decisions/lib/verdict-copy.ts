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

import type { GapStatus, Vitals } from "@/app/dashboard/decisions/lib/vitals"

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
  days: { weekdayShort: string; predictedRevenue: number }[]
  vitals: Vitals
  actions: { title: string; impactUsdPerWeek: number }[]
  potUsdPerWeek: number
  topBriefing?: string | null
}): VerdictFacts {
  const { storeName, isAggregate, days, vitals, actions, potUsdPerWeek } = input

  const peakDay =
    days.length > 0
      ? days.reduce((best, d) => (d.predictedRevenue > best.predictedRevenue ? d : best))
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

  if (f.weekTotal != null) block.week_forecast = fmtUsd(f.weekTotal)
  if (f.weekP10 != null) block.week_low = fmtUsd(f.weekP10)
  if (f.weekP90 != null) block.week_high = fmtUsd(f.weekP90)

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

/** The deterministic reading. Also the fallback whenever narration is rejected. */
export function composeVerdict(f: VerdictFacts): string {
  const where = f.isAggregate ? "across all stores" : f.storeName

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
}

/**
 * Split the verdict into prose and figures.
 *
 * The sentence is set in Fraunces italic, and the two-tier rule is explicit
 * that Fraunces never appears on a number — a Fraunces-italic dollar amount
 * fails the system. The figures are lifted into DM Sans tabular by the
 * component; this decides where they are. The `$` and `%` travel with the
 * figure so a currency mark never dangles in the wrong face.
 */
export function splitVerdictChunks(line: string): VerdictChunk[] {
  const out: VerdictChunk[] = []
  const re = /\$?\d[\d,]*(?:\.\d+)?%?/g
  let last = 0

  for (const m of line.matchAll(re)) {
    const at = m.index
    if (at > last) out.push({ kind: "text", value: line.slice(last, at) })
    out.push({ kind: "num", value: m[0] })
    last = at + m[0].length
  }
  if (last < line.length) out.push({ kind: "text", value: line.slice(last) })

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

  // FNV-1a. This keys a cache; it is not a security boundary, and keeping it
  // dependency-free keeps this module importable without node:crypto.
  let h = 0x811c9dc5
  for (let i = 0; i < stable.length; i++) {
    h ^= stable.charCodeAt(i)
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
