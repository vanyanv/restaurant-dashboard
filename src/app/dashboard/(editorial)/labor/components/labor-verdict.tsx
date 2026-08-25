import type { ScorecardTotals } from "@/lib/labor-scorecard"
import type { ClockDrift } from "@/lib/labor-leaks"

const usd0 = (n: number) =>
  `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`
const pct1 = (n: number | null) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`)

/**
 * The week in one sentence, then the four figures an owner decides on.
 *
 * Replaces an eight-tile grid: tiles of equal weight force the reader to rank
 * the numbers themselves, which is the work this page should be doing. The
 * sentence carries the judgement; the figures are the evidence under it.
 */
export function LaborVerdict({
  totals,
  drift,
  costVariance,
}: {
  totals: ScorecardTotals
  drift: ClockDrift
  /** Actual minus forecast labor cost, from Harri's own budget. */
  costVariance: number
}) {
  const overEarned = totals.varianceDollars > 0
  const overForecast = costVariance > 0

  let verdict: React.ReactNode
  if (!overForecast && !overEarned) {
    verdict = (
      <>
        Labor held its forecast, and the sales earned every hour worked.
      </>
    )
  } else if (overEarned) {
    verdict = (
      <>
        {overForecast ? (
          <>Labor ran {usd0(costVariance)} over forecast. </>
        ) : (
          <>Labor came in under forecast, but </>
        )}
        <strong className="labor-verdict__hot">{usd0(totals.varianceDollars)}</strong>{" "}
        of it wasn&rsquo;t earned by the sales.
      </>
    )
  } else {
    verdict = (
      <>
        Labor ran {usd0(costVariance)} over forecast, but the sales carried the
        hours: the week ran{" "}
        {Math.abs(totals.varianceHours).toFixed(1)} hours leaner than earned.
      </>
    )
  }

  return (
    <section className="labor-verdict">
      <span className="labor-verdict__eyebrow">§ The week&rsquo;s verdict</span>
      <p className="labor-verdict__line">{verdict}</p>

      <dl className="labor-verdict__figures">
        <div className="labor-verdict__fig">
          <dt>Actual labor</dt>
          <dd>{usd0(totals.laborCost)}</dd>
          <span>{pct1(totals.laborPct)} of sales</span>
        </div>
        <div className="labor-verdict__fig">
          <dt>Sales / labor hour</dt>
          <dd>{totals.splh == null ? "—" : usd0(totals.splh)}</dd>
          <span>{totals.actualHours.toFixed(0)} hours worked</span>
        </div>
        <div className="labor-verdict__fig">
          <dt>Hours vs earned</dt>
          <dd className={overEarned ? "labor-verdict__hot" : undefined}>
            {totals.varianceHours > 0 ? "+" : ""}
            {totals.varianceHours.toFixed(1)}
          </dd>
          <span>{overEarned ? "overstaffed" : "ran lean"}</span>
        </div>
        <div className="labor-verdict__fig">
          <dt>Unscheduled time</dt>
          <dd className={drift.addedHours > 0 ? "labor-verdict__hot" : undefined}>
            {drift.addedHours.toFixed(1)}h
          </dd>
          <span>{drift.addedCost > 0 ? `${usd0(drift.addedCost)} paid` : "none"}</span>
        </div>
      </dl>
    </section>
  )
}
