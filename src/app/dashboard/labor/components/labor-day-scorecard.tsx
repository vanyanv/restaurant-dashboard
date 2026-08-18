import type { ScorecardRow, ScorecardTotals } from "@/lib/labor-scorecard"

const usd0 = (n: number) => {
  const sign = n < 0 ? "-" : ""
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`
}
const signedUsd = (n: number) => (n > 0 ? `+${usd0(n)}` : usd0(n))
const h1 = (n: number) => `${n.toFixed(1)}`
const signedH = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}`
const pct1 = (n: number | null) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`)

/**
 * The week as an operator reads it: which day bought more hours than its sales
 * justified, and what that cost. Sorted by date — this is a ledger, and
 * re-ordering it by severity would break the reading of the week.
 */
export function LaborDayScorecard({
  rows,
  totals,
}: {
  rows: ScorecardRow[]
  totals: ScorecardTotals
}) {
  if (rows.length === 0) {
    return <p className="labor-empty">No labor hours recorded for this week yet.</p>
  }

  return (
    <div className="labor-score">
      <table className="labor-score__table">
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Net sales</th>
            <th scope="col">Sched</th>
            <th scope="col">Actual</th>
            <th scope="col">Earned</th>
            <th scope="col">Variance</th>
            <th scope="col">Cost of var.</th>
            <th scope="col">SPLH</th>
            <th scope="col">Labor %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const over = r.status === "over"
            return (
              <tr key={r.date} className="labor-score__row">
                <td>
                  <span className="labor-score__day">
                    {r.weekday} {r.date.slice(8)}
                  </span>
                </td>
                <td>{usd0(r.netSales)}</td>
                <td className="labor-score__muted">
                  {r.scheduledHours > 0 ? h1(r.scheduledHours) : "—"}
                </td>
                <td>{h1(r.actualHours)}</td>
                <td className="labor-score__muted">
                  {r.earnedHours != null ? h1(r.earnedHours) : "—"}
                </td>
                <td className={over ? "labor-score__bad" : "labor-score__muted"}>
                  {r.varianceHours != null ? signedH(r.varianceHours) : "—"}
                </td>
                <td className={over ? "labor-score__bad" : "labor-score__muted"}>
                  {r.varianceDollars != null ? signedUsd(r.varianceDollars) : "—"}
                </td>
                <td className={`labor-score__splh ${over ? "labor-score__bad" : ""}`}>
                  {r.splh != null ? usd0(r.splh) : "—"}
                </td>
                <td className="labor-score__muted">{pct1(r.laborPct)}</td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="labor-score__foot">
            <td>Week</td>
            <td>{usd0(totals.netSales)}</td>
            <td className="labor-score__muted">
              {totals.scheduledHours > 0 ? h1(totals.scheduledHours) : "—"}
            </td>
            <td>{h1(totals.actualHours)}</td>
            <td className="labor-score__muted">{h1(totals.earnedHours)}</td>
            <td className={totals.varianceHours > 0 ? "labor-score__bad" : "labor-score__muted"}>
              {signedH(totals.varianceHours)}
            </td>
            <td className={totals.varianceDollars > 0 ? "labor-score__bad" : "labor-score__muted"}>
              {signedUsd(totals.varianceDollars)}
            </td>
            <td>{totals.splh != null ? usd0(totals.splh) : "—"}</td>
            <td className="labor-score__muted">{pct1(totals.laborPct)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
