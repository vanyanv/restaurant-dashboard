"use client"

import { isWeekWindow, monthDay, trailingWeeks, type DateRange } from "@/lib/counter/date-range"

/**
 * The last 8 Monday-to-Sunday weeks as buttons, one tap each, inside both
 * date controls (desk popover and phone sheet).
 *
 * Eight because the P&L page's own week chart shows eight, so the two agree
 * on which weeks are "recent". The running week is the last button and ends
 * today. `trailingWeeks` already owns that arithmetic.
 */
export function RangeWeeks({
  range,
  today,
  onPick,
}: {
  range: DateRange
  today: Date
  onPick: (week: DateRange) => void
}) {
  const weeks = trailingWeeks(today, 8)
  return (
    <div className="drweeks" role="group" aria-label="Last 8 weeks">
      <span className="drpop__k">Weeks</span>
      <div className="drweeks__row">
        {weeks.map((w) => (
          <button
            key={w.start.getTime()}
            type="button"
            aria-pressed={isWeekWindow(range, w.start) && range.end.getTime() === w.end.getTime()}
            aria-label={`Week of ${monthDay(w.start)}${w.partial ? ", so far" : ""}`}
            onClick={() => onPick({ start: w.start, end: w.end })}
          >
            {w.start.getMonth() + 1}/{w.start.getDate()}
          </button>
        ))}
      </div>
    </div>
  )
}
