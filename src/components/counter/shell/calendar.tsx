"use client"

import { addMonths, getDaysInMonth, isSameDay, startOfMonth } from "date-fns"
import { isoDay, type DateRange } from "@/lib/counter/date-range"

/**
 * `cal(anchor)`, prototype line 1886 — one month, inside `.drpop__cal > .drcals`.
 *
 * ```
 * <div>
 *   <div class="drcal__hd">
 *     <button class="drnav" data-mv="-1" aria-label="Previous month">‹
 *     <b>August 2026</b>
 *     <button class="drnav" data-mv="1" aria-label="Next month">›
 *   <div class="drgrid">
 *     <span class="dw">M</span> … ×7
 *     <span class="drd out"></span>         ← the lead-in blanks, as SPANS
 *     <button class="drd in edge today cmp" data-day="2026-8-21">21</button>
 * ```
 *
 * The week starts on Monday (`lead = (first.getDay() + 6) % 7`), which is the
 * same Monday-start week `date-range.ts` uses for `wtd` and `lastweek` — note
 * 53: weekly is the cadence the trade runs on.
 *
 * Four modifiers, and every one of them is a fact the reader needs:
 *   `in`    — inside the selected range
 *   `edge`  — one of its two ends (or the anchor of a half-finished pick)
 *   `today` — a dot under the number
 *   `cmp`   — inside the COMPARISON window, drawn as a signal-coloured underline
 *
 * ONE DELIBERATE DIVERGENCE FROM THE PROTOTYPE, and it is about truthfulness
 * rather than markup. The prototype's `inCompare()` (line 1905) computes the
 * weekday comparison as the union of four separate windows shifted back 1..4
 * weeks. `comparisonRange(range, "weekday")` in `src/lib/counter/date-range.ts`
 * returns the CONTIGUOUS HULL of those, `[start-28, end-7]`, and documents why:
 * it is a window a caller aggregates across. For a 7-day range the two are the
 * same set of days. For a shorter one the hull is wider. We shade the hull,
 * because the hull is what this application actually compares against — a
 * calendar that shades days the page does not use would be note 19's lie
 * ("a range that only changes the label") wearing a different hat. The caller
 * passes the window; this component only draws it.
 */

const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

/** Monday first, and the prototype's own single letters — two of them "T", two "S". */
const DOW = ["M", "T", "W", "T", "F", "S", "S"]

function Chevron({ dir }: { dir: -1 | 1 }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={dir === -1 ? "M10 3.5L5.5 8 10 12.5" : "M6 3.5L10.5 8 6 12.5"} />
    </svg>
  )
}

function within(day: Date, r: DateRange | null): boolean {
  if (!r) return false
  return day >= r.start && day <= r.end
}

export function Calendar({
  month,
  range,
  compare,
  today,
  pending,
  onPickDay,
  onMonthChange,
}: {
  /** Any date in the month to draw; normalised here. */
  month: Date
  range: DateRange
  /** The window the page compares against, or null when comparison is off. */
  compare: DateRange | null
  today: Date
  /** The first click of a two-click range pick, before it becomes a range. */
  pending?: Date | null
  onPickDay: (day: Date) => void
  onMonthChange: (month: Date) => void
}) {
  const first = startOfMonth(month)
  const year = first.getFullYear()
  const monthIndex = first.getMonth()
  const lead = (first.getDay() + 6) % 7
  const days = getDaysInMonth(first)

  return (
    <div>
      <div className="drcal__hd">
        <button
          className="drnav"
          type="button"
          aria-label="Previous month"
          onClick={() => onMonthChange(addMonths(first, -1))}
        >
          <Chevron dir={-1} />
        </button>
        <b>
          {MONTH_LONG[monthIndex]} {year}
        </b>
        <button
          className="drnav"
          type="button"
          aria-label="Next month"
          onClick={() => onMonthChange(addMonths(first, 1))}
        >
          <Chevron dir={1} />
        </button>
      </div>
      <div className="drgrid">
        {DOW.map((d, i) => (
          <span className="dw" key={i} aria-hidden="true">
            {d}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span className="drd out" key={`lead-${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const day = new Date(year, monthIndex, i + 1)
          const isPending = pending != null && isSameDay(day, pending)
          const classes = ["drd"]
          if (within(day, range) || isPending) classes.push("in")
          if (isSameDay(day, range.start) || isSameDay(day, range.end) || isPending) {
            classes.push("edge")
          }
          if (isSameDay(day, today)) classes.push("today")
          if (within(day, compare)) classes.push("cmp")
          return (
            <button
              key={isoDay(day)}
              className={classes.join(" ")}
              type="button"
              data-day={isoDay(day)}
              // The prototype's cell is a bare number, which is ambiguous read
              // aloud out of the grid's visual context.
              aria-label={day.toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
              onClick={() => onPickDay(day)}
            >
              {i + 1}
            </button>
          )
        })}
      </div>
    </div>
  )
}
