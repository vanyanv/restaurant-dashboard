"use client"

import { useState } from "react"
import type { HarriDailyRow, HarriAlertRow } from "@/app/actions/harri-actions"

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

const ALERT_LABELS: Record<string, string> = {
  EARLY_CLOCK_IN: "Clocked in early",
  EARLY_CLOCK_OUT: "Clocked out early",
  LATE_CLOCK_IN: "Clocked in late",
  LATE_CLOCK_OUT: "Clocked out late",
  UNSCHEDULED_CLOCK_IN: "Unscheduled clock-in",
  MISSED_CLOCK_IN: "Missed clock-in",
  MISSED_CLOCK_OUT: "Missed clock-out",
  MISSED_CLOCK_OUT_OT_NOW: "Missed clock-out (overtime)",
}

function alertLabel(code: string): string {
  return ALERT_LABELS[code] ?? code
}

function fmtTimeDiff(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return ""
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function fmtClockTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })
}

function displayName(a: HarriAlertRow): string {
  const f = a.firstName?.trim()
  const l = a.lastName?.trim()
  if (f && l) return `${f} ${l.charAt(0)}.`
  if (f) return f
  return "Unnamed staff"
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function fmtUsd(n: number | null, dp = 0): string {
  if (n == null) return "—"
  const sign = n < 0 ? "-" : ""
  return `${sign}$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })}`
}

function fmtMd(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}

export function LaborWeekDays({
  weekStart,
  rows,
  alertsByDate,
}: {
  weekStart: string
  rows: HarriDailyRow[]
  alertsByDate: Record<string, HarriAlertRow[]>
}) {
  const [openDate, setOpenDate] = useState<string | null>(null)
  const byDate = new Map(rows.map((r) => [r.date, r]))

  let scaleMax = 0
  for (let i = 0; i < 7; i++) {
    const r = byDate.get(addDays(weekStart, i))
    if (!r) continue
    if ((r.actualCost ?? 0) > scaleMax) scaleMax = r.actualCost ?? 0
    if ((r.forecastCost ?? 0) > scaleMax) scaleMax = r.forecastCost ?? 0
  }
  if (scaleMax === 0) scaleMax = 1

  return (
    <div className="labor-days">
      {Array.from({ length: 7 }).map((_, i) => {
        const dateIso = addDays(weekStart, i)
        const r = byDate.get(dateIso)
        const alerts = alertsByDate[dateIso] ?? []
        const actualW = r?.actualCost != null ? Math.max(2, (r.actualCost / scaleMax) * 100) : 0
        const forecastW = r?.forecastCost != null ? Math.max(2, (r.forecastCost / scaleMax) * 100) : 0
        const variance =
          r?.actualCost != null && r?.forecastCost != null ? r.actualCost - r.forecastCost : null
        const varCls =
          variance == null
            ? ""
            : Math.abs(variance) >= 50 && variance > 0
              ? "labor-days__var--bad"
              : "labor-days__var--neutral"
        const isMissing = !r || r.actualCost == null
        const isOpen = openDate === dateIso
        const canOpen = alerts.length > 0

        return (
          <div
            key={dateIso}
            className={`labor-days__row${isMissing ? " labor-days__row--missing" : ""}${isOpen ? " labor-days__row--open" : ""}`}
          >
            <button
              type="button"
              className="labor-days__hit"
              onClick={() => canOpen && setOpenDate(isOpen ? null : dateIso)}
              disabled={!canOpen}
              aria-expanded={isOpen}
              aria-controls={`labor-day-${dateIso}-alerts`}
            >
              <div className="labor-days__date">
                <span className="labor-days__dow">{DOW[i]}</span>
                <span className="labor-days__md">{fmtMd(dateIso)}</span>
              </div>

              <div className="labor-days__bars" aria-hidden>
                <div
                  className="labor-days__bar labor-days__bar--forecast"
                  style={{ width: `${forecastW}%` }}
                />
                <div
                  className="labor-days__bar labor-days__bar--actual"
                  style={{ width: `${actualW}%` }}
                />
              </div>

              <div className="labor-days__nums">
                <span className="labor-days__actual">{fmtUsd(r?.actualCost ?? null)}</span>
                <span className="labor-days__forecast">vs {fmtUsd(r?.forecastCost ?? null)}</span>
                <span className={`labor-days__var ${varCls}`}>
                  {variance == null
                    ? ""
                    : `${variance > 0 ? "+" : variance < 0 ? "-" : ""}${fmtUsd(Math.abs(variance))}`}
                </span>
                <span className="labor-days__alerts">
                  {alerts.length > 0 ? (
                    <>
                      {alerts.length} {alerts.length === 1 ? "alert" : "alerts"}{" "}
                      <span aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
                    </>
                  ) : (
                    ""
                  )}
                </span>
              </div>
            </button>

            {isOpen && alerts.length > 0 && (
              <div
                id={`labor-day-${dateIso}-alerts`}
                className="labor-days__drawer"
                role="region"
                aria-label={`Timekeeping alerts for ${fmtMd(dateIso)}`}
              >
                <ol className="labor-days__alerts-list">
                  {alerts.map((a) => (
                    <li key={a.id} className="labor-days__alert">
                      <span className="labor-days__alert-time">{fmtClockTime(a.alertTime)}</span>
                      <span className="labor-days__alert-code">{alertLabel(a.alertCode)}</span>
                      <span className="labor-days__alert-diff">{fmtTimeDiff(a.timeDiffSec)}</span>
                      <span className="labor-days__alert-meta">
                        {a.positionName ? `${a.positionName} · ` : ""}{displayName(a)}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
