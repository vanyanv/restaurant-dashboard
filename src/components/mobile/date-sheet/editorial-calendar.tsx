"use client"

import { useMemo, useState } from "react"
import { localDateStr } from "@/lib/dashboard-utils"

type Props = {
  initialStart: Date | null
  initialEnd: Date | null
  /** YYYY-MM-DD; days strictly after this are disabled. Defaults to today. */
  maxDateStr?: string
  onChange: (start: Date | null, end: Date | null) => void
}

/**
 * Pure two-month range picker. Knows nothing about sheets, URLs, or apply
 * buttons — the parent owns commit. Tap once to set start, tap again to set
 * end. A third tap (or tapping a date earlier than current start) resets
 * start and clears end.
 */
export function EditorialCalendar({
  initialStart,
  initialEnd,
  maxDateStr,
  onChange,
}: Props) {
  // The "anchor" month is the right-hand (newer) of the two visible months.
  // Default to the month containing initialEnd, or the current month.
  const [anchor, setAnchor] = useState<Date>(() => {
    const seed = initialEnd ?? initialStart ?? new Date()
    return new Date(seed.getFullYear(), seed.getMonth(), 1)
  })

  const [start, setStart] = useState<Date | null>(initialStart)
  const [end, setEnd] = useState<Date | null>(initialEnd)

  // Pinned at mount so a sheet left open across midnight doesn't flip
  // the "today" label or future-disable rule mid-session.
  const todayStr = useMemo(() => localDateStr(new Date()), [])
  const maxStr = useMemo(() => maxDateStr ?? localDateStr(new Date()), [maxDateStr])

  const olderMonth = useMemo(() => addMonths(anchor, -1), [anchor])
  const anchorMonthStr = useMemo(() => localDateStr(anchor).slice(0, 7), [anchor])
  const todayMonthStr = todayStr.slice(0, 7)

  function handleDayClick(d: Date) {
    if (!start || (start && end)) {
      // Begin a new range.
      setStart(d)
      setEnd(null)
      onChange(d, null)
      return
    }
    // start is set, end is not.
    if (d.getTime() < start.getTime()) {
      // Earlier than start → treat as new start.
      setStart(d)
      setEnd(null)
      onChange(d, null)
      return
    }
    setEnd(d)
    onChange(start, d)
  }

  return (
    <div className="ed-cal">
      <Month
        month={olderMonth}
        start={start}
        end={end}
        maxStr={maxStr}
        todayStr={todayStr}
        onDayClick={handleDayClick}
        onPrev={() => setAnchor(addMonths(anchor, -1))}
        onNext={null}
      />
      <Month
        month={anchor}
        start={start}
        end={end}
        maxStr={maxStr}
        todayStr={todayStr}
        onDayClick={handleDayClick}
        onPrev={null}
        onNext={() => setAnchor(addMonths(anchor, 1))}
        nextDisabled={anchorMonthStr >= todayMonthStr}
      />
    </div>
  )
}

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
const MONTH_FMT = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
})

function Month({
  month,
  start,
  end,
  maxStr,
  todayStr,
  onDayClick,
  onPrev,
  onNext,
  nextDisabled,
}: {
  month: Date
  start: Date | null
  end: Date | null
  maxStr: string
  todayStr: string
  onDayClick: (d: Date) => void
  onPrev: (() => void) | null
  onNext: (() => void) | null
  nextDisabled?: boolean
}) {
  const year = month.getFullYear()
  const m = month.getMonth()
  const firstWeekday = new Date(year, m, 1).getDay()
  const daysInMonth = new Date(year, m + 1, 0).getDate()

  const cells: Array<{ key: string; date: Date | null }> = []
  for (let i = 0; i < firstWeekday; i++) cells.push({ key: `b${i}`, date: null })
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ key: `d${day}`, date: new Date(year, m, day) })
  }

  return (
    <div className="ed-cal__month">
      <div className="ed-cal__month-head">
        {onPrev ? (
          <button
            type="button"
            className="ed-cal__nav"
            onClick={onPrev}
            aria-label="Previous month"
          >
            ‹
          </button>
        ) : (
          <span style={{ width: 32 }} aria-hidden />
        )}
        <span className="ed-cal__month-title">{MONTH_FMT.format(month)}</span>
        {onNext ? (
          <button
            type="button"
            className="ed-cal__nav"
            onClick={onNext}
            disabled={nextDisabled}
            aria-label="Next month"
          >
            ›
          </button>
        ) : (
          <span style={{ width: 32 }} aria-hidden />
        )}
      </div>

      <div className="ed-cal__weekdays" role="presentation">
        {WEEKDAYS.map((w) => (
          <span key={w} className="ed-cal__weekday">{w}</span>
        ))}
      </div>

      <div className="ed-cal__grid">
        {cells.map((c) => {
          if (!c.date) {
            return <span key={c.key} className="ed-cal__day ed-cal__day--blank" />
          }
          const ds = localDateStr(c.date)
          const disabled = ds > maxStr
          const isStart = !!start && ds === localDateStr(start)
          const isEnd = !!end && ds === localDateStr(end)
          const inRange =
            !!start && !!end && c.date.getTime() > start.getTime() && c.date.getTime() < end.getTime()
          const isToday = ds === todayStr

          const className = [
            "ed-cal__day",
            disabled ? "ed-cal__day--disabled" : "",
            inRange ? "ed-cal__day--in-range" : "",
            isStart ? "ed-cal__day--start" : "",
            isEnd ? "ed-cal__day--end" : "",
            isToday ? "ed-cal__day--today" : "",
          ]
            .filter(Boolean)
            .join(" ")

          return (
            <button
              key={c.key}
              type="button"
              className={className}
              disabled={disabled}
              aria-pressed={isStart || isEnd}
              aria-label={c.date.toDateString()}
              onClick={() => onDayClick(c.date!)}
            >
              {c.date.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function addMonths(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1)
}
