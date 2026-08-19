import { HeroKpi, formatMoneyLarge, formatUsd, type HeroKpiDelta } from "../hero-kpi"
import { getRangeStamp, type DashboardRange } from "@/lib/dashboard-utils"
import { getHourlyPatternsForRange } from "@/app/actions/hourly-orders-actions"
import { avgTicketPacePct, formatPaceLine } from "@/lib/hourly-orders"
import type { OrderPatternsHourlyComparison } from "@/types/analytics"
import type { OtterPromise } from "./data"

/**
 * Pace line under a KPI: the selected range against the average of the same
 * dates shifted back one to four weeks — same weekdays, same shape, and (when
 * the range ends today) the same hours. Cutoff-aware, so a day in progress is
 * never measured against four complete days. Shared with /m so the two
 * surfaces report the same direction; see `formatPaceLine`.
 */
function paceDelta(
  cmp: OrderPatternsHourlyComparison | null | undefined,
  pct: number | null | undefined
): HeroKpiDelta | null {
  return formatPaceLine(cmp, pct)
}

export async function HeroKpisSection({
  range,
  otterPromise,
}: {
  range: DashboardRange
  otterPromise: OtterPromise
}) {
  // Follows the date picker rather than only firing on "today": the pace line
  // is the one figure that says whether the numbers above it are good, and it
  // used to disappear the moment anyone changed the range.
  const [otter, patterns] = await Promise.all([
    otterPromise,
    getHourlyPatternsForRange(range),
  ])

  const kpis = otter
    ? {
        gross: otter.kpis.grossRevenue,
        net: otter.kpis.netRevenue,
        orders: otter.kpis.totalOrders,
        avg: otter.kpis.averageOrderValue,
      }
    : null

  const scope = getRangeStamp(range)
  const cmp = patterns?.hourlyComparison

  // OtterHourlySummary only banks net sales, so the sales pace is a net-sales
  // pace. Gross and net move together (discounts are a stable share), so the
  // same line reads true on both — but only net is exact by construction.
  const salesPace = paceDelta(cmp, cmp?.salesPacePct)

  return (
    <dl className="editorial-kpi-strip editorial-kpi-strip-wide dock-in dock-in-2">
      <HeroKpi
        label="Gross sales"
        value={kpis ? formatMoneyLarge(kpis.gross) : "—"}
        unit={`USD · ${scope}`}
        delta={salesPace}
      />
      <HeroKpi
        label="Net sales"
        value={kpis ? formatMoneyLarge(kpis.net) : "—"}
        unit={`USD · ${scope} · after discounts`}
        delta={salesPace}
      />
      <HeroKpi
        label="Orders"
        value={kpis ? kpis.orders.toLocaleString() : "—"}
        unit={`tickets · ${scope}`}
        delta={paceDelta(cmp, cmp?.pacePct)}
      />
      <HeroKpi
        label="Avg ticket"
        value={kpis ? formatUsd(kpis.avg) : "—"}
        unit={`per order · ${scope}`}
        delta={paceDelta(cmp, avgTicketPacePct(cmp))}
      />
    </dl>
  )
}
