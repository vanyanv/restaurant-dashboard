"use client"

import { useState } from "react"
import type { DecisionDay } from "@/app/actions/decisions/get-decisions-view"
import { DayDetailPanel } from "./day-detail-panel"
import { computeRibbon } from "../lib/ribbon"
import type { LaborLane } from "../lib/labor-lane"

interface Props {
  days: DecisionDay[]
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

/** Compact band for the column, which has ~90px to work with: "4.6k–5.8k". */
function fmtBand(p10: number | null, p90: number | null): string | null {
  if (p10 == null || p90 == null) return null
  const k = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}k` : Math.round(n).toString()
  return `${k(p10)}–${k(p90)}`
}

/**
 * Act II — the week.
 *
 * Seven hairline-seamed columns rather than seven detached cards: the week is
 * one object, the way a table of figures is one object. Each column is the
 * day's forecast with its 80% band drawn on the same axis, over the labor lane,
 * so the shape of the week and the shape of the schedule can be read against
 * each other in a single pass. The busy/normal/slow pill is gone — it was an
 * adjective sitting on top of money the page already had.
 */
export function DecisionWeekCalendar({ days }: Props) {
  const initial = days.find((d) => d.bucket === "busy")?.date ?? days[0]?.date ?? null
  const [selected, setSelected] = useState<string | null>(initial)
  const selectedDay = days.find((d) => d.date === selected) ?? null

  const ribbon = computeRibbon(days)

  return (
    <section aria-label="Week at a glance">
      <header className="decisions-ribbon-head">
        <h2 className="decisions-ribbon-head__title">
          <em>The week ahead</em>
        </h2>
        <span className="decisions-ribbon-head__meta">
          forecast · 80% band · scheduled vs needed hours
        </span>
      </header>

      <div className="decisions-ribbon">
        {days.map((day, i) => {
          const cell = ribbon.cells[i]
          const isSelected = day.date === selected
          const band = fmtBand(day.p10, day.p90)

          return (
            <button
              key={day.date}
              type="button"
              onClick={() => setSelected(day.date)}
              className={
                "decisions-rday" +
                (cell.isPeak ? " is-peak" : "") +
                (isSelected ? " is-open" : "")
              }
              aria-pressed={isSelected}
              aria-label={[
                `${day.weekdayShort} ${day.monthDayShort}`,
                `${fmtUsd(day.predictedRevenue)} forecast`,
                band ? `80% band ${band}` : null,
                laborReadout(day.labor),
                ...cell.signals.map((s) => s.label),
              ]
                .filter(Boolean)
                .join(", ")}
            >
              <span className="decisions-rday__folio">
                {day.weekdayShort} · {day.monthDayShort}
              </span>

              {/* The chart is decoration for a screen reader — the label above
                  already carries the forecast, the band and the lane. */}
              <span className="decisions-bar" aria-hidden="true">
                <span
                  className="decisions-bar__fill"
                  style={{ height: `${cell.barPct}%` }}
                >
                  {cell.whisker ? (
                    <span
                      className="decisions-bar__whisk"
                      style={{
                        top: `${cell.whisker.topPct}%`,
                        height: `${cell.whisker.heightPct}%`,
                      }}
                    />
                  ) : null}
                </span>
              </span>

              <span className="decisions-rday__amt" style={TABULAR}>
                {fmtUsd(day.predictedRevenue)}
              </span>
              {band ? (
                <span className="decisions-rday__band" style={TABULAR}>
                  {band}
                </span>
              ) : null}

              <span className="decisions-rday__sigs" aria-hidden="true">
                {cell.signals.map((s) => (
                  <span
                    key={s.label}
                    className={"decisions-sig" + (s.hot ? " is-hot" : "")}
                  >
                    {s.label}
                  </span>
                ))}
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

/** What the lane says, in words, for the cell's accessible name. */
function laborReadout(labor: LaborLane): string {
  if (labor.status === "unknown") return "labor: no benchmark yet"
  if (labor.status === "unscheduled") return "labor: none published"
  return `labor: ${labor.scheduledHours} of ${labor.neededHours} hours, ${labor.status}`
}

/**
 * Scheduled hours against hours needed, drawn as one bar.
 *
 * The bar is scaled to whichever of the two is larger, so a short day shows a
 * red remainder and a heavy day shows an ochre overhang — the reading is the
 * shape, and the numbers underneath confirm it. Unfilled slots used to hang off
 * this label; they are a chip above now, where the other signals live.
 */
function LaborLaneCell({ labor }: { labor: LaborLane }) {
  const { scheduledHours, neededHours, gapHours, status } = labor

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
  const extraPct = (Math.abs(gapHours ?? 0) / span) * 100

  return (
    <span className="decisions-lane">
      <span className="decisions-lane__label">Labor</span>
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
