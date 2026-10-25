import { SPLH_TOLERANCE, type SplhPoint } from "@/lib/splh"
import type { LaborDay } from "@/lib/counter/labor-week"
import { scheduleHeld } from "@/lib/counter/schedule-hold"

/**
 * Sales per labor hour, read the way an owner reads it.
 *
 * ## Why this figure is a lead and not a strip cell
 *
 * The owner's own ranking: knowing whether an hour of labor paid for itself
 * matters more than knowing where the money went. Net sales says whether the
 * day happened; this says whether it was worth having. So the Overview's head
 * block carries both, and everything about fees and channels sits below them.
 *
 * ## The two references, and the difference between them
 *
 * A figure needs something to be read against, and this file is careful about
 * which of the two it uses for what, because they make different claims:
 *
 * 1. **The published schedule** (`HarriShift`, arriving here as
 *    `LaborDay.scheduledHours`) is a PLAN. The store wrote it down before the
 *    week happened, so "over the published schedule" is a statement about a
 *    commitment that was broken, and it is what the verdict leads with.
 * 2. **The usual** is DESCRIPTIVE and never a plan. It is what these same
 *    weekdays have historically returned per labor hour — `SplhPoint`'s own
 *    `earnedHours`, which `src/lib/splh.ts` derives from the weekday medians
 *    of the store's trailing history. It is always worded "usual", never
 *    "target" and never "plan", because nobody published it.
 *
 * The distinction is the whole reason `floor` stayed `null` on this section
 * for as long as it did. The prototype's `SPLH_FLOOR = 68.00` is a number it
 * invented, and `SplhPoint.targetSplh` used on its own is the figure judging
 * itself — a "target" a store meets by definition half the time. Neither is
 * published, so neither is drawn as one. What IS honest is to draw the usual
 * range as a band and say the word "usual" over it, which is a claim about
 * history rather than about intent, and to keep the verdict on the schedule.
 *
 * ## The band's width is the published tolerance, not a taste
 *
 * `SPLH_TOLERANCE` is `src/lib/splh.ts`'s own constant — how far SPLH may sit
 * from its weekday median before the Labor page flags the day. Reusing it here
 * means the Overview's band and the Labor page's flags cannot disagree about
 * what counts as a normal day, which is the failure mode CLAUDE.md names as
 * judgment the linter cannot check.
 *
 * Nothing in this file rounds, formats or words anything: it returns numbers,
 * and `adapters/overview.ts` turns them into the sentences the page prints.
 */
export interface SplhLead {
  /** Net sales over hours WORKED, across the whole range. The figure itself. */
  value: number
  /** Hours worked, from `HarriPositionDaily.actualSeconds`. */
  hours: number
  /**
   * What these same weekdays usually return per labor hour: this range's net
   * sales over the hours the weekday medians say they should have taken.
   *
   * Total over total, never the mean of the daily ratios — a Saturday and a
   * Tuesday are not equal weights, and `foldSplhSeries` folds the numerator
   * and the denominator for exactly this reason. `null` when no day in the
   * range has enough weekday history behind it to have earned hours at all.
   */
  usual: number | null
  /** `usual` ± `SPLH_TOLERANCE`. `null` whenever `usual` is. */
  band: { lo: number; hi: number } | null
  /** `value - usual`, in dollars per hour. `null` whenever `usual` is. */
  vsUsual: number | null
  /**
   * Whether the figure sits outside its usual range at all. Distinct from
   * `vsUsual < 0`: a day a dollar under the median is not an event.
   */
  outsideUsual: boolean
  /** Hours PUBLISHED over the range. `null` when no shift was published for any day. */
  scheduled: number | null
  /** Actual minus published. Positive is overstaffed. `null` with no schedule. */
  gap: number | null
  /** `cost / hours` — the rate the gap is priced at. `null` with no hours. */
  blendedRate: number | null
  /** `|gap| × blendedRate`. `null` when either input is. */
  gapCost: number | null
  /** `scheduleHold`'s answer, so this page and Labor cannot differ. `null` with no schedule. */
  held: boolean | null
}

/**
 * The lead reading, from the two loads the Overview already makes.
 *
 * `points` are FOLDED (`foldSplhSeries`) — one series for the whole scope,
 * because SPLH is a ratio and the account-wide reading is total net over total
 * hours, not the mean of the per-store ratios.
 *
 * `days` are `loadLaborWeek`'s, which is where the published schedule lives.
 * They are optional: this returns a complete reading with `scheduled`, `gap`,
 * `gapCost` and `held` all `null` when the schedule half has not loaded, so
 * the caption goes short rather than the section going missing.
 */
export function splhLead(input: { points: SplhPoint[]; days?: LaborDay[] }): SplhLead | null {
  const { points, days = [] } = input

  const net = points.reduce((t, p) => t + p.netSales, 0)
  const hours = points.reduce((t, p) => t + p.laborHours, 0)
  // No hours is not "zero sales per hour"; it is a quotient with no
  // denominator. The caller renders the unsynced state instead.
  if (hours <= 0) return null

  // Only the days that HAVE earned hours contribute — to both sides. Folding a
  // day's sales into the numerator while its missing history contributes
  // nothing to the denominator would inflate the usual by exactly the share of
  // the range with no history behind it.
  const scored = points.filter((p) => p.earnedHours != null && p.earnedHours > 0)
  const earned = scored.reduce((t, p) => t + (p.earnedHours as number), 0)
  const scoredNet = scored.reduce((t, p) => t + p.netSales, 0)
  const usual = earned > 0 ? scoredNet / earned : null

  const band =
    usual === null
      ? null
      : { lo: usual * (1 - SPLH_TOLERANCE), hi: usual * (1 + SPLH_TOLERANCE) }

  const value = net / hours

  // `scheduledHours` is null per day when nothing was published for that day.
  // A range where SOME days were published still has a published total, and
  // the caption says how many days it covers rather than pretending the null
  // days were zero-hour days.
  const published = days.filter((d) => d.scheduledHours !== null)
  const scheduled =
    published.length > 0
      ? published.reduce((t, d) => t + (d.scheduledHours as number), 0)
      : null

  const cost = days.reduce((t, d) => t + d.cost, 0)
  const blendedRate = hours > 0 && cost > 0 ? cost / hours : null

  // The gap is only meaningful over the days a schedule covers — comparing a
  // seven-day actual against a four-day schedule is a gap made of the three
  // days nobody published, which reads as overstaffing and is not.
  const actualOverPublished = published.reduce((t, d) => t + d.actualHours, 0)
  const gap = scheduled === null ? null : actualOverPublished - scheduled

  return {
    value,
    hours,
    usual,
    band,
    vsUsual: usual === null ? null : value - usual,
    outsideUsual: band !== null && (value < band.lo || value > band.hi),
    scheduled,
    gap,
    blendedRate,
    gapCost: gap === null || blendedRate === null ? null : Math.abs(gap) * blendedRate,
    held: gap === null || scheduled === null ? null : scheduleHeld(gap, scheduled),
  }
}
