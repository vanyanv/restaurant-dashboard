import {
  RailCell,
  formatBandCaption,
  formatMoneyLarge,
  formatUsd,
  type HeroKpiDelta,
  type RailBand,
} from "../hero-kpi"
import { getRangeStamp, type DashboardRange } from "@/lib/dashboard-utils"
import { getHourlyPatternsForRange } from "@/app/actions/hourly-orders-actions"
import { getRevenueTrendData } from "@/app/actions/store-actions"
import { getDailyLaborSeries } from "@/app/actions/store/labor-series-actions"
import { sumPnLDays } from "@/lib/pnl-pace"
import { avgTicketPacePct, formatPaceLine } from "@/lib/hourly-orders"
import { fmtPctFromRatio } from "@/lib/format"
import type { OrderPatternsHourlyComparison } from "@/types/analytics"
import type { OtterPromise, PnLBaseline, PnLSummaryPromise } from "./data"

/**
 * Pace line under a rail figure: the selected range against the average of the
 * same dates shifted back one to four weeks — same weekdays, same shape, and
 * (when the range ends today) the same hours. Cutoff-aware, so a day in
 * progress is never measured against four complete days. Shared with /m so the
 * two surfaces report the same direction; see `formatPaceLine`.
 */
function paceDelta(
  cmp: OrderPatternsHourlyComparison | null | undefined,
  pct: number | null | undefined
): HeroKpiDelta | null {
  return formatPaceLine(cmp, pct)
}

/**
 * Per-week average tickets, so the avg-ticket cell gets a real band instead of
 * a band derived from two independent means. Weeks are aligned by index because
 * `groupTotals` and `groupSalesTotals` are both filtered the same way.
 */
function avgTicketSeries(cmp: OrderPatternsHourlyComparison): number[] {
  const orders = cmp.groupTotals
  const sales = cmp.groupSalesTotals
  if (orders.length !== sales.length) return []
  return orders
    .map((n, i) => (n > 0 ? sales[i] / n : 0))
    .filter((v) => v > 0)
}

function band(
  values: number[],
  current: number,
  fmt: (n: number) => string,
  breachDirection: RailBand["breachDirection"] = "below"
): RailBand | null {
  if (values.length < 2 || !Number.isFinite(current)) return null
  return { values, current, caption: formatBandCaption(values, fmt), breachDirection }
}

export async function HeroKpisSection({
  range,
  otterPromise,
  pnlPromise,
  baseline,
}: {
  range: DashboardRange
  otterPromise: OtterPromise
  /** Owner-only. Absent means the labor cell reports "—" rather than guessing. */
  pnlPromise: PnLSummaryPromise | null
  /** Weekday-aligned P&L baseline, reused here for the labor band. */
  baseline: PnLBaseline | null
}) {
  // Follows the date picker rather than only firing on "today": the pace line
  // is the one figure that says whether the numbers above it are good, and it
  // used to disappear the moment anyone changed the range.
  const [otter, patterns, pnl, trend, laborSeries, baselineResult] = await Promise.all([
    otterPromise,
    getHourlyPatternsForRange(range),
    pnlPromise ?? Promise.resolve(null),
    // Trailing complete days, for the sparklines. Deliberately excludes today:
    // the action drops the in-progress day so the trace does not end on a
    // partial-day cliff that reads as a collapse.
    getRevenueTrendData({ days: 14 }).catch(() => null),
    getDailyLaborSeries({ days: 14 }).catch(() => []),
    baseline?.promise ?? Promise.resolve(null),
  ])

  const daily = trend?.dailyTrends ?? []
  const netSpark = daily.map((d) => d.netRevenue)
  const orderSpark = daily.map((d) => d.orderCount)
  const ticketSpark = daily
    .filter((d) => d.orderCount > 0)
    .map((d) => d.netRevenue / d.orderCount)

  // Labor share per day: Harri's posted cost over that day's net sales. Both
  // series are daily and complete-days-only, so they join on date directly.
  const netByDate = new Map(daily.map((d) => [d.date, d.netRevenue]))
  const laborSpark = laborSeries
    .map((l) => {
      const net = netByDate.get(l.date)
      return net && net > 0 ? l.actualCost / net : null
    })
    .filter((v): v is number => v != null && v > 0)

  const kpis = otter
    ? {
        gross: otter.kpis.grossRevenue,
        net: otter.kpis.netRevenue,
        orders: otter.kpis.totalOrders,
        // Net-based, NOT `kpis.averageOrderValue` (which is gross / orders).
        // The pace line and the band are both computed from net sales, so a
        // gross-based headline put a $25.85 ticket above a $19.34–$21.26 band
        // and made the cell read as a contradiction.
        avg:
          otter.kpis.totalOrders > 0
            ? otter.kpis.netRevenue / otter.kpis.totalOrders
            : 0,
      }
    : null

  const scope = getRangeStamp(range)
  const cmp = patterns?.hourlyComparison ?? null

  // OtterHourlySummary only banks net sales, so the sales pace is a net-sales
  // pace. Gross and net move together (discounts are a stable share), so the
  // same line reads true on both — but only net is exact by construction.
  const salesPace = paceDelta(cmp, cmp?.salesPacePct)

  // Bands plot the comparison's OWN current total, not the Otter KPI, so the
  // mark and the band are always drawn from one measurement. For a single day
  // the two agree; across a multi-day range the comparison is cutoff-aware and
  // the KPI is not.
  const salesBand = cmp
    ? band(cmp.groupSalesTotals, cmp.salesCurrentTotal, formatMoneyLarge)
    : null
  const ordersBand = cmp
    ? band(cmp.groupTotals, cmp.currentTotal, (n) => Math.round(n).toLocaleString())
    : null
  const ticketBand =
    cmp && cmp.currentTotal > 0
      ? band(
          avgTicketSeries(cmp),
          cmp.salesCurrentTotal / cmp.currentTotal,
          formatUsd
        )
      : null

  const pnlOk = pnl != null && !("error" in pnl) && pnl.storeCount > 0
  const labor = pnlOk ? pnl.combined : null
  // A day in progress collects sales continuously but labor in lumps, so an
  // early-service labor percentage is "not in yet", not a real figure. Same
  // MIN_PLAUSIBLE_LABOR_PCT guard the P&L block applies.
  const laborTrustworthy = labor != null && labor.laborPct >= 0.05

  // Labor band, from the same weekday-shifted weeks the pace line uses. No new
  // query: `sumPnLDays` already returns labor and sales per baseline group.
  const laborWeekPcts =
    baseline && baselineResult && !("error" in baselineResult)
      ? baseline.comparisonGroups
          .map((group) =>
            sumPnLDays(baselineResult.consolidatedRows, baseline.periodDates, group)
          )
          .filter((g) => g.totalSales > 0 && (g.labor ?? 0) > 0)
          .map((g) => (g.labor ?? 0) / g.totalSales)
      : []
  // Labor breaches upward: spending a larger share of sales is the bad end.
  const laborBand =
    laborTrustworthy && laborWeekPcts.length >= 2
      ? band(laborWeekPcts, labor.laborPct, fmtPctFromRatio, "above")
      : null

  return (
    <dl className="masthead-rail dock-in dock-in-2">
      <RailCell
        label="Net sales"
        value={kpis ? formatMoneyLarge(kpis.net) : "—"}
        meta={
          kpis
            ? `Gross ${formatMoneyLarge(kpis.gross)} · after discounts`
            : `USD · ${scope}`
        }
        spark={netSpark}
        band={salesBand}
        delta={salesPace}
      />
      <RailCell
        label="Orders"
        value={kpis ? kpis.orders.toLocaleString() : "—"}
        meta={`Tickets · ${scope}`}
        spark={orderSpark}
        band={ordersBand}
        delta={paceDelta(cmp, cmp?.pacePct)}
      />
      <RailCell
        label="Avg ticket"
        value={kpis ? formatUsd(kpis.avg) : "—"}
        meta={`Net per order · ${scope}`}
        spark={ticketSpark}
        band={ticketBand}
        delta={paceDelta(cmp, avgTicketPacePct(cmp))}
      />
      <RailCell
        label="Labor"
        value={laborTrustworthy ? fmtPctFromRatio(labor.laborPct) : "—"}
        meta={
          laborTrustworthy
            ? `${formatMoneyLarge(labor.laborValue)} of sales · ${scope}`
            : labor != null
              ? "Still posting · settles at close"
              : "P&L unavailable"
        }
        spark={laborSpark}
        band={laborBand}
      />
    </dl>
  )
}
