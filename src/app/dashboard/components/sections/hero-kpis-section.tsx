import { HeroKpi, formatMoneyLarge, formatUsd, type HeroKpiDelta } from "../hero-kpi"
import { getRangeStamp, type DashboardRange } from "@/lib/dashboard-utils"
import { getHourlyOrderPatterns } from "@/app/actions/hourly-orders-actions"
import { HOUR_LABELS } from "@/lib/hourly-orders"
import type { OrderPatternsHourlyComparison } from "@/types/analytics"
import type { OtterPromise } from "./data"

/**
 * Pace line under a KPI: today-so-far vs the average of the same weekday's
 * same hours over the last 4 weeks (cutoff-aware — partial day compared to
 * partial baselines, never to full days).
 */
function paceDelta(
  cmp: OrderPatternsHourlyComparison | null | undefined,
  pct: number | null | undefined
): HeroKpiDelta | null {
  if (!cmp || pct == null || cmp.baselineWeeks < 2) return null
  const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "·"
  const thru =
    cmp.lastDataHour != null ? ` · thru ${HOUR_LABELS[cmp.lastDataHour]}` : ""
  return {
    value: pct,
    display: `${arrow} ${Math.abs(pct).toFixed(0)}% vs avg ${cmp.weekdayLabel}${thru}`,
  }
}

export async function HeroKpisSection({
  range,
  otterPromise,
}: {
  range: DashboardRange
  otterPromise: OtterPromise
}) {
  const isToday = range.kind === "days" && range.days === 1
  const [otter, patterns] = await Promise.all([
    otterPromise,
    isToday ? getHourlyOrderPatterns(undefined, "today") : Promise.resolve(null),
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

  return (
    <dl className="editorial-kpi-strip editorial-kpi-strip-wide dock-in dock-in-2">
      <HeroKpi
        label="Gross sales"
        value={kpis ? formatMoneyLarge(kpis.gross) : "—"}
        unit={`USD · ${scope}`}
        delta={paceDelta(cmp, cmp?.salesPacePct)}
      />
      <HeroKpi
        label="Net sales"
        value={kpis ? formatMoneyLarge(kpis.net) : "—"}
        unit={`USD · ${scope} · after discounts`}
        delta={null}
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
        delta={null}
      />
    </dl>
  )
}
