"use client"

import { useState } from "react"
import type { DecisionDay } from "@/app/actions/decisions/get-decisions-view"
import { DayBadge } from "./day-badge"
import { DayDetailPanel } from "./day-detail-panel"

interface Props {
  days: DecisionDay[]
  storeName: string
}

const TABULAR = {
  fontVariantNumeric: "tabular-nums lining-nums" as const,
}

export function DecisionWeekCalendar({ days, storeName }: Props) {
  const initial = days.find((d) => d.bucket === "busy")?.date ?? days[0]?.date ?? null
  const [selected, setSelected] = useState<string | null>(initial)
  const selectedDay = days.find((d) => d.date === selected) ?? null

  return (
    <section aria-label="Week at a glance">
      <header className="decisions-section-head">
        <h2 className="decisions-section-head__title">
          <em>The week ahead</em>
        </h2>
        <span className="decisions-section-head__meta">
          {storeName} · next 7 days
        </span>
      </header>

      <div className="decisions-calendar" role="list">
        {days.map((day) => {
          const isSelected = day.date === selected
          return (
            <button
              key={day.date}
              type="button"
              role="listitem"
              onClick={() => setSelected(day.date)}
              className={
                "decisions-day-cell inv-row" +
                (isSelected ? " is-selected" : "")
              }
              aria-pressed={isSelected}
              aria-label={`${day.weekdayShort} ${day.monthDayShort} — ${day.bucket}`}
            >
              <span className="decisions-day-cell__folio">
                {day.weekdayShort} · {day.monthDayShort}
              </span>
              <span className="decisions-day-cell__badge">
                <DayBadge bucket={day.bucket} />
              </span>
              <span className="decisions-day-cell__signals" aria-hidden="true">
                {day.weatherTone === "rain" || day.weatherTone === "heavy_rain" ? (
                  <SignalIcon kind="rain" />
                ) : null}
                {day.weatherTone === "heat" ? <SignalIcon kind="heat" /> : null}
                {day.weatherTone === "cold" ? <SignalIcon kind="cold" /> : null}
                {day.hasAnomaly ? <SignalIcon kind="anomaly" /> : null}
                {day.topEventTitle ? <SignalIcon kind="event" /> : null}
              </span>
              {day.staffDelta != null && day.staffDelta !== 0 ? (
                <span
                  className={
                    "decisions-day-cell__staff" +
                    (day.staffDelta > 0 ? " is-up" : " is-down")
                  }
                  style={TABULAR}
                >
                  <span className="decisions-day-cell__staff-label">STAFF</span>
                  {day.staffDelta > 0 ? "+" : ""}
                  {day.staffDelta}
                </span>
              ) : (
                <span className="decisions-day-cell__staff is-neutral">
                  <span className="decisions-day-cell__staff-label">STAFF</span>
                  —
                </span>
              )}
            </button>
          )
        })}
      </div>

      {selectedDay ? <DayDetailPanel day={selectedDay} /> : null}
    </section>
  )
}

function SignalIcon({
  kind,
}: {
  kind: "rain" | "heat" | "cold" | "anomaly" | "event"
}) {
  const title = {
    rain: "Rain expected",
    heat: "Hot day",
    cold: "Cold day",
    anomaly: "Something unusual flagged",
    event: "Nearby event",
  }[kind]

  return (
    <svg
      className={`decisions-signal-icon is-${kind}`}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <title>{title}</title>
      {kind === "rain" ? (
        <path d="M8 1.5 C 6 5, 4 6.5, 4 9.5 a 4 4 0 0 0 8 0 C 12 6.5, 10 5, 8 1.5 Z" />
      ) : null}
      {kind === "heat" ? (
        <>
          <circle cx="8" cy="8" r="2.5" />
          <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.2 3.2 4.6 4.6M11.4 11.4l1.4 1.4M3.2 12.8 4.6 11.4M11.4 4.6 12.8 3.2" />
        </>
      ) : null}
      {kind === "cold" ? (
        <>
          <path d="M8 1v14M1 8h14M3 3l10 10M13 3 3 13" />
        </>
      ) : null}
      {kind === "anomaly" ? (
        <path d="M3 14 L 8 2 L 13 14 Z M 8 6 v 4 M 8 11.5 v 0.6" />
      ) : null}
      {kind === "event" ? <circle cx="8" cy="8" r="3" fill="currentColor" /> : null}
    </svg>
  )
}
