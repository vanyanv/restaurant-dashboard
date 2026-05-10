"use client"

import { format } from "date-fns"
import type {
  LaborStaffingData,
  HarriActualRow,
} from "@/app/actions/forecasts/labor-staffing-actions"

interface Props {
  data: LaborStaffingData
}

function fmtUsd(n: number | null): string {
  if (n == null) return "—"
  return `$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`
}

function fmtMoneyPerOrder(n: number | null): string {
  if (n == null) return "—"
  return `$${n.toFixed(2)} / order`
}

function riskLabel(risk: Props["data"]["days"][number]["staffingRisk"]): string {
  if (risk === "understaffed") return "thin schedule"
  if (risk === "overstaffed") return "heavy schedule"
  if (risk === "missing_schedule") return "no Harri schedule"
  if (risk === "balanced") return "balanced"
  return "—"
}

function riskClass(risk: Props["data"]["days"][number]["staffingRisk"]): string {
  if (risk === "understaffed" || risk === "missing_schedule") return "text-[var(--accent)]"
  if (risk === "overstaffed") return "text-[var(--ink)] font-semibold"
  return "text-[var(--ink-muted)]"
}

function driverLabel(day: Props["data"]["days"][number]): string {
  if (day.drivers.length === 0) return "—"
  return day.drivers.map((d) => d.label).join(" · ")
}

function HarriOverlay({ rows }: { rows: HarriActualRow[] }) {
  const hasAny = rows.some((r) => r.actualUsd != null)
  if (!hasAny) return null
  return (
    <div className="mt-3 px-5 pb-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)] mb-2">
        Harri actuals · prior 7 days
      </div>
      <table className="w-full text-[12px] tabular-nums">
        <tbody>
          {rows.map((r) => {
            const variance =
              r.actualUsd != null && r.forecastUsd != null ? r.actualUsd - r.forecastUsd : null
            const cls =
              variance == null
                ? "text-[var(--ink-muted)]"
                : variance > 0
                  ? "text-[var(--accent)]"
                  : "text-[var(--ink)]"
            return (
              <tr key={r.date} className="border-t border-[var(--hairline)]">
                <td className="py-1 pr-4 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                  {format(new Date(`${r.date}T00:00:00.000Z`), "EEE M/d")}
                </td>
                <td
                  className="py-1 px-2 text-right text-[var(--ink)]"
                  style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
                >
                  actual {fmtUsd(r.actualUsd)}
                </td>
                <td
                  className="py-1 px-2 text-right text-[var(--ink-muted)]"
                  style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
                >
                  forecast {fmtUsd(r.forecastUsd)}
                </td>
                <td
                  className={`py-1 pl-2 text-right ${cls}`}
                  style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
                >
                  {variance == null
                    ? "—"
                    : `${variance > 0 ? "+" : variance < 0 ? "-" : ""}${fmtUsd(variance)}`}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const HOUR_LABEL = (h: number) => {
  if (h === 0) return "12a"
  if (h < 12) return `${h}a`
  if (h === 12) return "12p"
  return `${h - 12}p`
}

function staffClass(staff: number): string {
  if (staff === 0) return "text-[var(--ink-faint)]"
  if (staff <= 2) return "text-[var(--ink-muted)]"
  if (staff <= 4) return "text-[var(--ink)]"
  if (staff <= 6) return "text-[var(--ink)] font-semibold"
  return "text-[var(--accent)] font-semibold"
}

export function LaborStaffingCard({ data }: Props) {
  if (data.days.length === 0) {
    return (
      <section className="inv-panel">
        <header className="inv-panel__head px-5 pt-4 pb-2 flex items-baseline justify-between">
          <span className="inv-panel__dept">Hourly staffing · forward 7d</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            awaiting forecast
          </span>
        </header>
        <div className="px-5 py-6 text-[var(--ink-muted)]">
          Need both the revenue forecast and 28 days of hourly history. Appears
          once both are present for {data.storeName}.
        </div>
      </section>
    )
  }

  // Restrict the hour grid to hours that ever had staff recommended on any
  // day in the horizon. Cuts dead overnight hours for fast-casual stores.
  const activeHours: number[] = []
  for (let h = 0; h < 24; h++) {
    if (data.days.some((d) => d.hours[h]?.recommendedStaff > 0)) activeHours.push(h)
  }

  return (
    <section className="inv-panel">
      <header className="inv-panel__head px-5 pt-4 pb-3 flex items-baseline justify-between">
        <span className="inv-panel__dept">Hourly staffing · forward {data.days.length}d</span>
        <div className="flex items-baseline gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          <span>
            {data.coversPerStaffHour} covers / staff / hr · min {data.minStaff}
          </span>
          <span>·</span>
          <span>{data.forecastSource === "ml" ? "ML orders" : data.forecastSource === "mixed" ? "mixed orders" : "share fallback"}</span>
          <span>·</span>
          <span>
            avg ticket ·{" "}
            <span className="normal-case tracking-normal">
              ${data.meanAvgTicket.toFixed(2)}
            </span>
          </span>
          <span>·</span>
          <span>
            total ·{" "}
            <span className="normal-case tracking-normal">
              {data.totalForecastLaborHours} staff-hours
            </span>
          </span>
        </div>
      </header>

      <HarriOverlay rows={data.harriActuals} />

      <div className="px-5 py-4 overflow-x-auto">
        <table className="w-full text-[12px] tabular-nums">
          <thead>
            <tr className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)] text-left">
              <th className="py-2 pr-4">Day</th>
              {activeHours.map((h) => (
                <th key={h} className="py-2 px-1 text-center">
                  {HOUR_LABEL(h)}
                </th>
              ))}
              <th className="py-2 pl-4 text-right">Harri</th>
              <th className="py-2 pl-4 text-right">Pressure</th>
              <th className="py-2 pl-4 text-right">Efficiency</th>
              <th className="py-2 pl-4 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.days.map((d) => (
              <tr
                key={d.date.toISOString()}
                className="border-t border-[var(--hairline)] hover:bg-[var(--row-hover-bg)] transition-colors"
              >
                <td className="py-2 pr-4 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                  {format(d.date, "EEE M/d")}
                </td>
                {activeHours.map((h) => {
                  const slot = d.hours[h]
                  return (
                    <td
                      key={h}
                      className={`py-2 px-1 text-center ${staffClass(slot?.recommendedStaff ?? 0)}`}
                      title={`${slot?.predictedOrders.toFixed(1)} predicted orders${slot?.source === "ml" ? " · ML" : " · fallback"}${slot?.drivers.length ? ` · ${slot.drivers.map((driver) => driver.label).join(" · ")}` : ""}`}
                      style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
                    >
                      {slot?.recommendedStaff ?? 0}
                    </td>
                  )
                })}
                <td
                  className={`py-2 pl-4 text-right ${riskClass(d.staffingRisk)}`}
                  style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
                  title={`scheduled labor ${fmtUsd(d.scheduledLaborCost)}`}
                >
                  {riskLabel(d.staffingRisk)}
                </td>
                <td
                  className="py-2 pl-4 text-right text-[var(--ink-muted)]"
                  title={driverLabel(d)}
                >
                  <span className="inline-block max-w-[180px] truncate align-bottom">
                    {driverLabel(d)}
                  </span>
                </td>
                <td
                  className="py-2 pl-4 text-right text-[var(--ink-muted)]"
                  style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
                >
                  {fmtMoneyPerOrder(d.expectedLaborCostPerOrder)}
                </td>
                <td
                  className="py-2 pl-4 text-right text-[var(--ink)]"
                  style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
                >
                  {d.totalLaborHours}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
