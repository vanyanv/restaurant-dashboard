import type { HarriDailyRow } from "@/app/actions/harri-actions"

function fmtUsd(n: number, dp = 0): string {
  const sign = n < 0 ? "-" : ""
  return `${sign}$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })}`
}

function fmtPct(p: number, signed = true): string {
  const sign = signed ? (p > 0 ? "+" : p < 0 ? "" : "") : ""
  return `${sign}${(p * 100).toFixed(1)}%`
}

export function LaborWeekKpis({
  rows,
  alertsCount,
  priorWeekActual,
}: {
  rows: HarriDailyRow[]
  alertsCount: number
  priorWeekActual: number | null
}) {
  const totalActual = rows.reduce((a, r) => a + (r.actualCost ?? 0), 0)
  const totalForecast = rows.reduce((a, r) => a + (r.forecastCost ?? 0), 0)
  const variance = totalActual - totalForecast
  const variancePct = totalForecast === 0 ? 0 : variance / totalForecast
  const wowDelta =
    priorWeekActual != null && priorWeekActual !== 0
      ? (totalActual - priorWeekActual) / priorWeekActual
      : null

  const variantClass =
    Math.abs(variance) >= 50 && variance > 0 ? "labor-kpi__num--bad" : ""

  return (
    <section className="labor-kpi-strip">
      <div className="labor-kpi inv-panel">
        <span className="labor-kpi__label">Actual labor</span>
        <strong className="labor-kpi__num">{fmtUsd(totalActual)}</strong>
        <em className="labor-kpi__sub">
          {wowDelta == null ? "no prior week" : `${fmtPct(wowDelta)} vs last week`}
        </em>
      </div>
      <div className="labor-kpi inv-panel">
        <span className="labor-kpi__label">Forecast</span>
        <strong className="labor-kpi__num labor-kpi__num--muted">{fmtUsd(totalForecast)}</strong>
        <em className="labor-kpi__sub">scheduled budget</em>
      </div>
      <div className="labor-kpi inv-panel">
        <span className="labor-kpi__label">Variance</span>
        <strong className={`labor-kpi__num ${variantClass}`}>
          {variance === 0 ? "$0" : `${variance > 0 ? "+" : ""}${fmtUsd(variance)}`}
        </strong>
        <em className="labor-kpi__sub">
          {totalForecast === 0 ? "—" : `${fmtPct(variancePct)} vs forecast`}
        </em>
      </div>
      <div className="labor-kpi inv-panel">
        <span className="labor-kpi__label">Timekeeping</span>
        <strong className="labor-kpi__num">{alertsCount}</strong>
        <em className="labor-kpi__sub">
          {alertsCount === 0 ? "clean week" : alertsCount === 1 ? "alert flagged" : "alerts flagged"}
        </em>
      </div>
    </section>
  )
}
