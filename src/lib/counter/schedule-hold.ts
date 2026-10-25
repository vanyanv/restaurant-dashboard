/**
 * Did the hours worked hold to the hours published?
 *
 * The one predicate, and the one way of wording hours, behind every surface
 * that reads actual hours against a published schedule: the Labor page's head
 * verdict, its schedule section, its per-day verdict column, and — since the
 * Overview's second lead figure became sales per labor hour — the Overview's
 * verdict, its SPLH caption and its labor queue items.
 *
 * It lives here rather than inside `adapters/labor.ts` because of the rule
 * CLAUDE.md states as judgment the linter cannot check: **a figure shown on
 * two pages comes from one function in `src/lib/counter/`.** Two pages that
 * each decided for themselves what "the schedule held" means would eventually
 * disagree about a week, in the same way note 60's two labour figures did.
 *
 * The reference is the schedule the store PUBLISHED FOR ITSELF (`HarriShift`)
 * — ruling L-R1, and the only plan this schema carries for hours. Nothing here
 * compares to a typed floor: the prototype's `SPLH_FLOOR = 68.00` is its own
 * invention and remains unimplemented.
 */

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
export const SCHEDULE_FLAT_SHARE = 0.02

/** The floor under the share, in hours — see `SCHEDULE_FLAT_SHARE`. */
export const SCHEDULE_FLAT_FLOOR = 0.25

/**
 * Did the hours worked hold to the hours published?
 *
 * `gap` is actual minus scheduled, so a positive gap is overstaffing. The
 * allowance is symmetric: a week that ran eight hours SHORT of its schedule
 * held it just as much as one that ran eight over, and the direction is the
 * caller's to word.
 */
export function scheduleHeld(gap: number, scheduled: number): boolean {
  const allowance = Math.max(SCHEDULE_FLAT_FLOOR, Math.abs(scheduled) * SCHEDULE_FLAT_SHARE)
  return Math.abs(gap) <= allowance
}

/**
 * "432.1 h", or an em-dash.
 *
 * Hours are a measurement, and absence is not zero hours — a range with no
 * labour posted has not been measured, which is a different fact from a range
 * in which nobody worked. The same em-dash `@/lib/counter/format` writes, so
 * one page cannot spell absence differently from another.
 *
 * ONE DECIMAL by default, and nineteen of twenty-one call sites take it. The
 * two that once passed `0` put "50 h" in a strip cell directly above a
 * sentence reading "49.6 h" — four readings of one quantity inside four
 * hundred pixels, one of them disagreeing.
 */
export function hoursText(v: number | null, digits = 1): string {
  if (v === null || !Number.isFinite(v)) return "—"
  return `${v.toFixed(digits)} h`
}
