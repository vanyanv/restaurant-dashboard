import Link from "next/link"
import type { HarriWeeklyRow } from "@/app/actions/harri-actions"

function fmtUsd(n: number, dp = 0): string {
  const sign = n < 0 ? "-" : ""
  return `${sign}$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })}`
}

function fmtMd(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}

export function LaborWeekTrend({
  trend,
  selectedWeek,
  storeId,
}: {
  trend: HarriWeeklyRow[]
  selectedWeek: string
  storeId: string
}) {
  // Scale across both actual & forecast so bars are comparable.
  let max = 0
  for (const w of trend) {
    if (w.totalActual > max) max = w.totalActual
    if (w.totalForecast > max) max = w.totalForecast
  }
  if (max === 0) max = 1

  return (
    <div className="labor-trend">
      <div className="labor-trend__chart">
        {trend.map((w) => {
          const empty = w.daysWithData === 0
          const actualH = empty ? 0 : Math.max(2, (w.totalActual / max) * 100)
          const forecastH = empty ? 0 : Math.max(2, (w.totalForecast / max) * 100)
          const isSelected = w.weekStart === selectedWeek
          const variance = w.variance
          const cls =
            !empty && Math.abs(variance) >= 50 && variance > 0
              ? "labor-trend__col labor-trend__col--bad"
              : "labor-trend__col"

          const href = storeId
            ? `/dashboard/labor/${storeId}?week=${w.weekStart}`
            : `/dashboard/labor?week=${w.weekStart}`
          const summary = empty
            ? `Week of ${fmtMd(w.weekStart)}, no data recorded`
            : `Week of ${fmtMd(w.weekStart)}, actual ${fmtUsd(w.totalActual)}, forecast ${fmtUsd(w.totalForecast)}, ${w.daysWithData} of 7 days recorded`
          return (
            <Link
              key={w.weekStart}
              href={href}
              className={`${cls} ${isSelected ? "labor-trend__col--selected" : ""}`}
              aria-label={summary}
              title={summary}
            >
              <div className="labor-trend__col-bars" aria-hidden>
                <div
                  className="labor-trend__bar labor-trend__bar--forecast"
                  style={{ height: `${forecastH}%` }}
                />
                <div
                  className="labor-trend__bar labor-trend__bar--actual"
                  style={{ height: `${actualH}%` }}
                />
              </div>
              <span className="labor-trend__label">{fmtMd(w.weekStart)}</span>
            </Link>
          )
        })}
      </div>

      <div className="labor-trend__legend">
        <span className="labor-trend__swatch labor-trend__swatch--actual" /> actual
        <span className="labor-trend__swatch labor-trend__swatch--forecast" /> forecast
        <span className="labor-trend__legend-spacer" />
        <span>each bar links to its week.</span>
      </div>
    </div>
  )
}
