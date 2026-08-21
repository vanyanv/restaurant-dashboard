import { getHourlyPatternsForRange } from "@/app/actions/hourly-orders-actions"
import { buildLede } from "@/lib/dashboard/lede"
import { sumPnLDays } from "@/lib/pnl-pace"
import type { DashboardRange } from "@/lib/dashboard-utils"
import type { PnLBaseline, PnLSummaryPromise } from "./data"

/**
 * The masthead lede: one sentence saying whether today is good or bad, and a
 * suggestion when there is one worth making. Every clause comes from a figure
 * already on the page — see `buildLede`, which drops a clause rather than
 * softening it when its input is missing.
 */
export async function LedeSection({
  range,
  pnlPromise,
  baseline,
}: {
  range: DashboardRange
  pnlPromise: PnLSummaryPromise | null
  baseline: PnLBaseline | null
}) {
  const [patterns, pnl, baselineResult] = await Promise.all([
    getHourlyPatternsForRange(range),
    pnlPromise ?? Promise.resolve(null),
    baseline?.promise ?? Promise.resolve(null),
  ])

  const cmp = patterns?.hourlyComparison ?? null
  if (!cmp) return null

  const combined =
    pnl != null && !("error" in pnl) && pnl.storeCount > 0 ? pnl.combined : null

  // Labor is withheld early in service for the same reason the P&L block
  // withholds its margin: sales accrue by the minute, labor posts in lumps, and
  // a single-digit labor percentage is "not in yet", not a good day.
  const laborSettled = combined != null && combined.laborPct >= 0.05
  const laborPct = laborSettled ? combined.laborPct : null

  // Baseline labor share: labor dollars over sales dollars across the same
  // weekday-aligned weeks the pace line uses. Weeks with no sales are dropped
  // so a closed week cannot manufacture a gap.
  let baselineLaborPct: number | null = null
  if (baseline && baselineResult && !("error" in baselineResult)) {
    const groups = baseline.comparisonGroups
      .map((group) =>
        sumPnLDays(baselineResult.consolidatedRows, baseline.periodDates, group)
      )
      .filter((g) => g.totalSales > 0 && g.labor != null)
    if (groups.length >= 2) {
      const sales = groups.reduce((a, g) => a + g.totalSales, 0)
      const labor = groups.reduce((a, g) => a + (g.labor ?? 0), 0)
      if (sales > 0) baselineLaborPct = labor / sales
    }
  }

  const lede = buildLede({
    salesPacePct: cmp.salesPacePct,
    ordersPacePct: cmp.pacePct,
    weekdayLabel: cmp.weekdayLabel,
    inProgress: cmp.inProgress,
    laborPct,
    baselineLaborPct,
    totalSales: combined?.grossSales ?? null,
    // Same trust gate the P&L block applies: an unsettled labor line makes the
    // margin a fiction, so the lede must not reason from it either.
    marginPct: laborSettled ? (combined?.marginPct ?? null) : null,
  })

  if (!lede) return null

  return (
    <div className="masthead__lede-block">
      <div className="masthead__proofmark" aria-hidden="true" />
      <p className="masthead__lede">{lede.headline}</p>
      {lede.suggestion && (
        <div className="masthead__suggest">
          <span className="masthead__suggest-label">Suggested</span>
          <span className="masthead__suggest-body">{lede.suggestion}</span>
        </div>
      )}
      <div className="masthead__source">{lede.source}</div>
    </div>
  )
}
