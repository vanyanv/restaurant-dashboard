"use client"

import { format } from "date-fns"
import type { LaborStaffingData } from "@/app/actions/forecasts/labor-staffing-actions"

interface Props {
  data: LaborStaffingData
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
              <th className="py-2 pl-4 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.days.map((d) => (
              <tr
                key={d.date.toISOString()}
                className="border-t border-[var(--hairline)] hover:bg-[rgba(220,38,38,0.045)] transition-colors"
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
                      title={`${slot?.predictedOrders.toFixed(1)} predicted orders`}
                      style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
                    >
                      {slot?.recommendedStaff ?? 0}
                    </td>
                  )
                })}
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
