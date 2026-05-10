"use client"

import { format } from "date-fns"
import type { ProfitRiskData, ProfitRiskLevel } from "@/app/actions/forecasts/profit-risk-actions"

function fmtUsd(n: number | null): string {
  if (n == null) return "—"
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
}

function fmtPct(n: number | null): string {
  if (n == null) return "—"
  return `${(n * 100).toFixed(1)}%`
}

function riskClass(risk: ProfitRiskLevel): string {
  if (risk === "high") return "text-[var(--accent)]"
  if (risk === "medium") return "text-[var(--ink)] font-semibold"
  return "text-[var(--ink-muted)]"
}

export function ProfitRiskCard({ data }: { data: ProfitRiskData }) {
  if (data.days.length === 0) return null
  return (
    <section className="inv-panel">
      <header className="inv-panel__head px-5 pt-4 pb-3 flex items-baseline justify-between">
        <span className="inv-panel__dept">Profit risk · forward {data.days.length}d</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          revenue · busy hours · Harri · food cost
        </span>
      </header>
      <div className="px-5 pb-5 overflow-x-auto">
        <table className="w-full text-[12px] tabular-nums">
          <thead>
            <tr className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)] text-left">
              <th className="py-2 pr-4">Day</th>
              <th className="py-2 px-3 text-right">Revenue</th>
              <th className="py-2 px-3 text-right">Food</th>
              <th className="py-2 px-3 text-right">Labor</th>
              <th className="py-2 px-3 text-right">Profit</th>
              <th className="py-2 px-3 text-right">Risk</th>
              <th className="py-2 pl-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.days.map((day) => (
              <tr key={day.date.toISOString()} className="border-t border-[var(--hairline)]">
                <td className="py-2 pr-4 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                  {format(day.date, "EEE M/d")}
                </td>
                <td className="py-2 px-3 text-right text-[var(--ink)]">{fmtUsd(day.predictedRevenue)}</td>
                <td className="py-2 px-3 text-right text-[var(--ink-muted)]">{fmtPct(day.foodCostPct)}</td>
                <td className="py-2 px-3 text-right text-[var(--ink-muted)]">{fmtPct(day.laborCostPct)}</td>
                <td className="py-2 px-3 text-right text-[var(--ink)]">{fmtUsd(day.contributionProfit)}</td>
                <td className={`py-2 px-3 text-right font-mono text-[10px] uppercase tracking-[0.18em] ${riskClass(day.riskLevel)}`}>
                  {day.riskLevel}
                </td>
                <td className="py-2 pl-4 text-[var(--ink-muted)]">
                  <span className="inline-block max-w-[420px] truncate align-bottom" title={day.actions.join(" · ")}>
                    {day.actions.join(" · ")}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
