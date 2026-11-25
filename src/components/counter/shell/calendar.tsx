"use client"

import { isSameDay, startOfMonth } from "date-fns"
import {
  Calendar as SdkCalendar,
  CalendarDay,
  CalendarGrid,
  CalendarHeading,
  CalendarNext,
  CalendarPrevious,
  CalendarWeekday,
} from "@ui-sdk/react/calendar"
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
 * `compare` IS A LIST, and that is about truthfulness rather than markup. The
 * prototype's `inCompare()` (line 1905) computes the weekday comparison as the
 * union of four separate windows shifted back 1..4 weeks, and
 * `comparisonWindows(range, "weekday")` in `src/lib/counter/date-range.ts`
 * returns exactly those four. For a 7-day range they tile into one contiguous
 * span; for a shorter one they do not, and the days between them are compared
 * against nothing.
 *
 * This drew the contiguous HULL of the four instead — `comparisonRange`'s
 * `[start-28, end-7]` — on the grounds that the hull was what the application
 * actually compared against. That was true, and it was the bug: every page
 * summed the hull and divided by four, so a single day was read against five
 * and a half days of trade. The loaders now read the four windows themselves,
 * so the hull is no longer what anything compares against and shading it would
 * be note 19's lie ("a range that only changes the label") wearing a different
 * hat. The caller passes the windows; this component only draws them.
 */

/**
 * ## The grid is ui-sdk's Calendar
 *
 * The month is a ui-sdk Calendar (`@ui-sdk/react/calendar`) drawn with this
 * file's own markup and classes, so it looks as it did. What the SDK adds is
 * what a calendar is expected to do from a keyboard or a screen reader: the
 * month is one grid with one Tab stop, the arrow keys move a day or a week
 * (crossing into the next month), Page Up/Down turn the month, Home/End go to
 * the week's ends, and each day is read with its full date and whether it is
 * in the range.
 *
 * What a press MEANS stays the caller's: one day, or the first then last day
 * of a range (`pending`). The SDK runs in range mode so it marks the selected
 * days for screen readers, but every press arrives as a range START, which is
 * cancelled and handed to `onPickDay` — the SDK never holds a half-picked
 * range of its own.
 */

/** "2026-08" for the SDK's `month`. */
function isoMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

/** An SDK ISO date ("2026-08-21") as a local midnight, like every Date here. */
function fromIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y, m - 1, d)
}

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

/**
 * ISO week number of a Monday: the week belongs to the year its Thursday is
 * in. Written out rather than taken from date-fns `getISOWeek`, which brings
 * its ISO-week-year helpers into every phone route's bundle.
 */
function isoWeekOfMonday(monday: Date): number {
  const thursday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 3)
  const jan1 = new Date(thursday.getFullYear(), 0, 1)
  return Math.floor(Math.round((thursday.getTime() - jan1.getTime()) / 86_400_000) / 7) + 1
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
  onPickWeek,
  onMonthChange,
}: {
  /** Any date in the month to draw; normalised here. */
  month: Date
  range: DateRange
  /**
   * The windows the page compares against, or null when comparison is off.
   * One for `prev` and `year`, four for `weekday` — see `comparisonWindows`.
   */
  compare: DateRange[] | null
  today: Date
  /** The first click of a two-click range pick, before it becomes a range. */
  pending?: Date | null
  onPickDay: (day: Date) => void
  /**
   * When given, each row opens with its week number, and pressing it picks
   * that Monday-to-Sunday week in one tap. Receives the row's Monday.
   */
  onPickWeek?: (monday: Date) => void
  onMonthChange: (month: Date) => void
}) {
  const first = startOfMonth(month)
  const classFor = (day: Date) => {
    const isPending = pending != null && isSameDay(day, pending)
    const classes = ["drd"]
    if (within(day, range) || isPending) classes.push("in")
    if (isSameDay(day, range.start) || isSameDay(day, range.end) || isPending) classes.push("edge")
    if (isSameDay(day, today)) classes.push("today")
    if (compare?.some((w) => within(day, w))) classes.push("cmp")
    return classes.join(" ")
  }

  return (
    <SdkCalendar
      className="drcal"
      mode="range"
      value={[isoDay(range.start), isoDay(range.end)]}
      month={isoMonth(first)}
      onMonthChange={(next) => onMonthChange(fromIso(`${next}-01`))}
      onAnchorChange={(anchor, details) => {
        details.cancel()
        if (anchor) onPickDay(fromIso(anchor))
      }}
      today={isoDay(today)}
      weekStartsOn={1}
      showOutsideDays={false}
      weekdayFormat="narrow"
      locale="en-US"
    >
      <div className="drcal__hd">
        <CalendarPrevious className="drnav" aria-label="Previous month">
          <Chevron dir={-1} />
        </CalendarPrevious>
        <CalendarHeading />
        <CalendarNext className="drnav" aria-label="Next month">
          <Chevron dir={1} />
        </CalendarNext>
      </div>
      <CalendarGrid className={onPickWeek ? "drgrid drgrid--wk" : "drgrid"}>
        {(grid) => (
          <>
            <thead>
              <tr>
                {onPickWeek && (
                  <th scope="col" className="dw">
                    <abbr title="Week">Wk</abbr>
                  </th>
                )}
                {grid.weekdays.map((weekday, index) => (
                  <CalendarWeekday key={weekday} index={index} className="dw" />
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.weeks.map((week) => {
                const monday = fromIso(week[0]!.date)
                return (
                  <tr key={week[0]!.date}>
                    {onPickWeek && (
                      <th scope="row" className="drwkc">
                        <button
                          className="drwk"
                          type="button"
                          aria-label={`Pick the week of ${monday.toLocaleDateString("en-US", { month: "long", day: "numeric" })}`}
                          // A week that has not started has nothing to show, and
                          // `weekOf` would have no day in it to end on.
                          disabled={monday > today}
                          onClick={() => onPickWeek(monday)}
                        >
                          {isoWeekOfMonday(monday)}
                        </button>
                      </th>
                    )}
                    {week.map((cell) =>
                      cell.hidden ? (
                        <td key={cell.date} className="drd out" />
                      ) : (
                        <CalendarDay key={cell.date} value={cell.date} className={classFor(fromIso(cell.date))}>
                          {String(Number(cell.date.slice(8)))}
                        </CalendarDay>
                      ),
                    )}
                  </tr>
                )
              })}
            </tbody>
          </>
        )}
      </CalendarGrid>
    </SdkCalendar>
  )
}
