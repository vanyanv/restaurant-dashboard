"use client"

import { useState } from "react"
import type { DecisionDay } from "@/app/actions/decisions/get-decisions-view"
import { DayBadge } from "./day-badge"
import { DayDetailPanel } from "./day-detail-panel"
import type { LaborLane } from "../lib/labor-lane"

interface Props {
  days: DecisionDay[]
  storeName: string
}

const TABULAR = {
  fontVariantNumeric: "tabular-nums lining-nums" as const,
}

const fmtUsd = (n: number) =>
  n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  })

/** Compact band for the cell, which has ~90px to work with: "4.6k-5.8k". */
function fmtBand(p10: number | null, p90: number | null): string | null {
  if (p10 == null || p90 == null) return null
  const k = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}k` : Math.round(n).toString()
  return `${k(p10)}–${k(p90)}`
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
              aria-label={`${day.weekdayShort} ${day.monthDayShort} — ${fmtUsd(day.predictedRevenue)} forecast, ${day.bucket}`}
            >
              <span className="decisions-day-cell__folio">
                {day.weekdayShort} · {day.monthDayShort}
              </span>
              <span className="decisions-day-cell__amt" style={TABULAR}>
                {fmtUsd(day.predictedRevenue)}
              </span>
              {fmtBand(day.p10, day.p90) ? (
                <span className="decisions-day-cell__band" style={TABULAR}>
                  {fmtBand(day.p10, day.p90)}
                </span>
              ) : null}
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
              <LaborLaneCell labor={day.labor} />
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

/**
 * Scheduled hours against hours needed, drawn as one bar.
 *
 * The bar is scaled to whichever of the two is larger, so a short day shows a
 * red remainder and a heavy day shows an ochre overhang — the reading is the
 * shape, and the numbers underneath confirm it.
 */
function LaborLaneCell({ labor }: { labor: LaborLane }) {
  const { scheduledHours, neededHours, gapHours, status, unfilledSlots } = labor

  if (status === "unknown") {
    return (
      <span className="decisions-lane">
        <span className="decisions-lane__label">Labor</span>
        <span className="decisions-lane__read is-quiet">no benchmark yet</span>
      </span>
    )
  }

  if (status === "unscheduled") {
    return (
      <span className="decisions-lane">
        <span className="decisions-lane__label">Labor</span>
        <span className="decisions-lane__read is-quiet">
          none published{neededHours != null ? ` · ${neededHours}h needed` : ""}
        </span>
      </span>
    )
  }

  const span = Math.max(scheduledHours, neededHours ?? 0) || 1
  const havePct = (scheduledHours / span) * 100
  const extraPct = Math.abs(gapHours ?? 0) / span * 100

  return (
    <span className="decisions-lane">
      <span className="decisions-lane__label">
        Labor
        {unfilledSlots > 0 ? (
          <em className="decisions-lane__unfilled">
            {unfilledSlots} open
          </em>
        ) : null}
      </span>
      <span className="decisions-lane__track">
        <span
          className="decisions-lane__have"
          style={{ width: `${Math.min(100, havePct)}%` }}
        />
        {status === "short" ? (
          <span className="decisions-lane__gap" style={{ right: 0, width: `${extraPct}%` }} />
        ) : null}
        {status === "heavy" ? (
          <span className="decisions-lane__over" style={{ right: 0, width: `${extraPct}%` }} />
        ) : null}
      </span>
      <span className={`decisions-lane__read is-${status}`} style={TABULAR}>
        {scheduledHours} / {neededHours} hrs
      </span>
    </span>
  )
}
