import type { HarriDailyRow } from "@/app/actions/harri-actions"
import type { ScorecardTotals } from "@/lib/labor-scorecard"

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
  productivity,
}: {
  rows: HarriDailyRow[]
  alertsCount: number
  priorWeekActual: number | null
  /** Adds the productivity row. Omitted when no labor hours exist yet. */
  productivity?: ScorecardTotals | null
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

      {/* Productivity row. Cost answers "what did we spend"; these answer
          "was it the right amount". Rendered only when hours exist — an
          SPLH tile reading "—" teaches nothing. */}
      {productivity && productivity.actualHours > 0 ? (
        <>
          <div className="labor-kpi inv-panel">
            <span className="labor-kpi__label">Sales / labor hr</span>
            <strong className="labor-kpi__num">
              {productivity.splh == null ? "—" : fmtUsd(productivity.splh)}
            </strong>
            <em className="labor-kpi__sub">
              {productivity.actualHours.toFixed(0)} hours worked
            </em>
          </div>
          <div className="labor-kpi inv-panel">
            <span className="labor-kpi__label">Hours earned</span>
            <strong className="labor-kpi__num labor-kpi__num--muted">
              {productivity.earnedHours.toFixed(0)}
            </strong>
            <em className="labor-kpi__sub">at the weekday target</em>
          </div>
          <div className="labor-kpi inv-panel">
            <span className="labor-kpi__label">Hours variance</span>
            <strong
              className={`labor-kpi__num ${
                productivity.varianceHours > 0 ? "labor-kpi__num--bad" : ""
              }`}
            >
              {productivity.varianceHours > 0 ? "+" : ""}
              {productivity.varianceHours.toFixed(1)}
            </strong>
            <em className="labor-kpi__sub">
              {productivity.varianceHours > 0 ? "overstaffed" : "ran lean"}
            </em>
          </div>
          <div className="labor-kpi inv-panel">
            <span className="labor-kpi__label">Cost of variance</span>
            <strong
              className={`labor-kpi__num ${
                productivity.varianceDollars > 0 ? "labor-kpi__num--bad" : ""
              }`}
            >
              {productivity.varianceDollars > 0 ? "+" : ""}
              {fmtUsd(productivity.varianceDollars)}
            </strong>
            <em className="labor-kpi__sub">vs earned hours</em>
          </div>
        </>
      ) : null}
    </section>
  )
}
