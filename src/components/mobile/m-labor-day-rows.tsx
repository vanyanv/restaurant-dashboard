"use client"

import { useState } from "react"
import type {
  HarriDailyRow,
  HarriAlertRow,
} from "@/app/actions/harri-actions"

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

const ALERT_LABELS: Record<string, string> = {
  EARLY_CLOCK_IN: "Clocked in early",
  EARLY_CLOCK_OUT: "Clocked out early",
  LATE_CLOCK_IN: "Clocked in late",
  LATE_CLOCK_OUT: "Clocked out late",
  UNSCHEDULED_CLOCK_IN: "Unscheduled clock-in",
  MISSED_CLOCK_IN: "Missed clock-in",
  MISSED_CLOCK_OUT: "Missed clock-out",
  MISSED_CLOCK_OUT_OT_NOW: "Missed clock-out (OT)",
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
    timeZone: "America/Los_Angeles",
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
    month: "numeric",
    day: "numeric",
    timeZone: "UTC",
  })
}

type Props = {
  weekStart: string
  rows: HarriDailyRow[]
  alertsByDate: Record<string, HarriAlertRow[]>
}

/**
 * Mobile twin of the desktop LaborWeekDays. 7 tappable day rows with a slim
 * bar pair (forecast outline + actual fill), right-aligned actual/variance,
 * and an inline alert drawer when a day with alerts is tapped.
 */
export function MLaborDayRows({ weekStart, rows, alertsByDate }: Props) {
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
    <div>
      {Array.from({ length: 7 }).map((_, i) => {
        const dateIso = addDays(weekStart, i)
        const r = byDate.get(dateIso)
        const alerts = alertsByDate[dateIso] ?? []
        const actualPct =
          r?.actualCost != null
            ? Math.max(2, (r.actualCost / scaleMax) * 100)
            : 0
        const forecastPct =
          r?.forecastCost != null
            ? Math.max(2, (r.forecastCost / scaleMax) * 100)
            : 0
        const variance =
          r?.actualCost != null && r?.forecastCost != null
            ? r.actualCost - r.forecastCost
            : null
        const overbudget = variance != null && variance > 50
        const isMissing = !r || r.actualCost == null
        const isOpen = openDate === dateIso
        const canOpen = alerts.length > 0

        return (
          <div key={dateIso}>
            <button
              type="button"
              className="inv-row m-labor-day"
              onClick={() => canOpen && setOpenDate(isOpen ? null : dateIso)}
              disabled={!canOpen}
              aria-expanded={canOpen ? isOpen : undefined}
              aria-controls={
                canOpen ? `m-labor-day-${dateIso}-alerts` : undefined
              }
              style={{
                display: "grid",
                gridTemplateColumns:
                  "[rule] 8px [date] 48px [bars] minmax(0, 1fr) [nums] auto",
                gap: 10,
                padding: "12px 4px",
                alignItems: "center",
                appearance: "none",
                background: "transparent",
                border: "none",
                width: "100%",
                textAlign: "left",
                cursor: canOpen ? "pointer" : "default",
                opacity: isMissing ? 0.55 : 1,
              }}
            >
              <div />
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontFamily:
                      "var(--font-dm-sans), system-ui, sans-serif",
                    fontWeight: 600,
                    fontSize: 12,
                    color: "var(--ink)",
                    fontVariantNumeric: "tabular-nums lining-nums",
                  }}
                >
                  {DOW[i]}
                </div>
                <div
                  style={{
                    fontFamily:
                      "var(--font-jetbrains-mono), ui-monospace, monospace",
                    fontSize: 9.5,
                    letterSpacing: "0.14em",
                    color: "var(--ink-faint)",
                    marginTop: 2,
                    fontVariantNumeric: "tabular-nums lining-nums",
                  }}
                >
                  {fmtMd(dateIso)}
                </div>
              </div>

              <div
                aria-hidden
                style={{
                  display: "grid",
                  gridTemplateRows: "auto auto",
                  gap: 3,
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    height: 6,
                    width: `${forecastPct}%`,
                    border: "1px dashed var(--ink-faint)",
                    background: "transparent",
                    opacity: 0.6,
                  }}
                />
                <div
                  style={{
                    height: 8,
                    width: `${actualPct}%`,
                    background: overbudget ? "var(--accent)" : "var(--ink)",
                    opacity: overbudget ? 1 : 0.86,
                  }}
                />
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                  gap: 2,
                  minWidth: 78,
                }}
              >
                <span
                  style={{
                    fontFamily:
                      "var(--font-dm-sans), system-ui, sans-serif",
                    fontWeight: 600,
                    fontSize: 13,
                    color: "var(--ink)",
                    fontVariantNumeric: "tabular-nums lining-nums",
                  }}
                >
                  {fmtUsd(r?.actualCost ?? null)}
                </span>
                <span
                  style={{
                    fontFamily:
                      "var(--font-jetbrains-mono), ui-monospace, monospace",
                    fontSize: 9.5,
                    letterSpacing: "0.14em",
                    color: overbudget
                      ? "var(--accent)"
                      : "var(--ink-faint)",
                    fontVariantNumeric: "tabular-nums lining-nums",
                    display: "flex",
                    gap: 6,
                    alignItems: "center",
                  }}
                >
                  {variance != null ? (
                    <span>
                      {variance > 0 ? "+" : variance < 0 ? "-" : ""}
                      {fmtUsd(Math.abs(variance))}
                    </span>
                  ) : null}
                  {alerts.length > 0 ? (
                    <span
                      className="inv-stamp"
                      data-tone={
                        alerts.some((a) =>
                          a.alertCode.includes("MISSED"),
                        )
                          ? "alert"
                          : "info"
                      }
                    >
                      {alerts.length}
                      {isOpen ? " ▾" : " ▸"}
                    </span>
                  ) : null}
                </span>
              </div>
            </button>

            {isOpen && alerts.length > 0 ? (
              <div
                id={`m-labor-day-${dateIso}-alerts`}
                role="region"
                aria-label={`Alerts for ${DOW[i]} ${fmtMd(dateIso)}`}
                style={{
                  borderTop: "1px solid var(--hairline)",
                  background: "rgba(220,38,38,0.045)",
                  padding: "8px 4px 10px 18px",
                }}
              >
                <ol
                  style={{
                    listStyle: "none",
                    margin: 0,
                    padding: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  {alerts.map((a) => (
                    <li
                      key={a.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "auto 1fr auto",
                        gap: 10,
                        alignItems: "baseline",
                      }}
                    >
                      <span
                        style={{
                          fontFamily:
                            "var(--font-jetbrains-mono), ui-monospace, monospace",
                          fontSize: 10,
                          letterSpacing: "0.12em",
                          color: "var(--ink-muted)",
                          fontVariantNumeric: "tabular-nums lining-nums",
                        }}
                      >
                        {fmtClockTime(a.alertTime)}
                      </span>
                      <span
                        style={{
                          fontFamily:
                            "var(--font-dm-sans), system-ui, sans-serif",
                          fontSize: 12,
                          color: "var(--ink)",
                          lineHeight: 1.35,
                        }}
                      >
                        {alertLabel(a.alertCode)}
                        <span
                          style={{
                            display: "block",
                            fontFamily:
                              "var(--font-jetbrains-mono), ui-monospace, monospace",
                            fontSize: 9.5,
                            letterSpacing: "0.12em",
                            textTransform: "uppercase",
                            color: "var(--ink-faint)",
                            marginTop: 2,
                          }}
                        >
                          {a.positionName ? `${a.positionName} · ` : ""}
                          {displayName(a)}
                        </span>
                      </span>
                      <span
                        style={{
                          fontFamily:
                            "var(--font-jetbrains-mono), ui-monospace, monospace",
                          fontSize: 9.5,
                          letterSpacing: "0.12em",
                          textTransform: "uppercase",
                          color: "var(--ink-faint)",
                          fontVariantNumeric: "tabular-nums lining-nums",
                        }}
                      >
                        {fmtTimeDiff(a.timeDiffSec)}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
