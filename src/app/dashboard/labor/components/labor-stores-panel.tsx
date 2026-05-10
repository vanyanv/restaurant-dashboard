import Link from "next/link"
import type { HarriStoreWeekRow } from "@/app/actions/harri-actions"

function fmtUsd(n: number, dp = 0): string {
  const sign = n < 0 ? "-" : ""
  return `${sign}$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })}`
}

function fmtPct(p: number | null): string {
  if (p == null) return "—"
  const sign = p > 0 ? "+" : ""
  return `${sign}${(p * 100).toFixed(1)}%`
}

export function LaborStoresPanel({
  rows,
  weekIso,
}: {
  rows: HarriStoreWeekRow[]
  weekIso: string
}) {
  // Sort: stores with brand + data first (by actual desc), then connected-no-data, then unconnected.
  const sorted = [...rows].sort((a, b) => {
    if (a.hasBrand !== b.hasBrand) return a.hasBrand ? -1 : 1
    if ((a.daysWithData > 0) !== (b.daysWithData > 0)) return a.daysWithData > 0 ? -1 : 1
    return b.actualCost - a.actualCost
  })

  // Scale bars across stores that have data so the eye can compare.
  let scaleMax = 0
  for (const r of sorted) {
    if (r.actualCost > scaleMax) scaleMax = r.actualCost
    if (r.forecastCost > scaleMax) scaleMax = r.forecastCost
  }
  if (scaleMax === 0) scaleMax = 1

  if (sorted.length === 0) {
    return <div className="labor-empty">No stores configured.</div>
  }

  return (
    <div className="labor-stores">
      {sorted.map((r) => {
        const inactive = !r.hasBrand
        const noData = r.hasBrand && r.daysWithData === 0
        const actualW = r.actualCost > 0 ? Math.max(2, (r.actualCost / scaleMax) * 100) : 0
        const forecastW = r.forecastCost > 0 ? Math.max(2, (r.forecastCost / scaleMax) * 100) : 0
        const varCls =
          r.hasBrand && r.daysWithData > 0 && Math.abs(r.variance) >= 50 && r.variance > 0
            ? "labor-stores__var--bad"
            : "labor-stores__var--neutral"

        const inner = (
          <>
            <div className="labor-stores__name">
              <span className="labor-stores__title">{r.storeName}</span>
              <span className="labor-stores__folio">
                {r.hasBrand ? `brand ${r.brandId}` : "no Harri mapping"}
                {noData ? " · awaiting first sync" : ""}
              </span>
            </div>

            <div className="labor-stores__bars" aria-hidden>
              <div
                className="labor-stores__bar labor-stores__bar--forecast"
                style={{ width: `${forecastW}%` }}
              />
              <div
                className="labor-stores__bar labor-stores__bar--actual"
                style={{ width: `${actualW}%` }}
              />
            </div>

            <div className="labor-stores__nums">
              <span className="labor-stores__actual">
                {r.daysWithData > 0 ? fmtUsd(r.actualCost) : "—"}
              </span>
              <span className="labor-stores__forecast">
                vs {r.forecastCost > 0 ? fmtUsd(r.forecastCost) : "—"}
              </span>
              <span className={`labor-stores__var ${varCls}`}>
                {r.daysWithData === 0
                  ? ""
                  : `${r.variance > 0 ? "+" : r.variance < 0 ? "-" : ""}${fmtUsd(Math.abs(r.variance))} (${fmtPct(r.variancePct)})`}
              </span>
              <span className="labor-stores__alerts">
                {r.alertCount > 0 ? `${r.alertCount} alert${r.alertCount === 1 ? "" : "s"}` : ""}
              </span>
            </div>
          </>
        )

        if (inactive) {
          return (
            <div
              key={r.storeId}
              className="labor-stores__row labor-stores__row--off"
              aria-disabled="true"
              title="Configure a HarriBrand mapping to wire this store"
            >
              {inner}
            </div>
          )
        }

        return (
          <Link
            key={r.storeId}
            href={`/dashboard/labor/${r.storeId}?week=${weekIso}`}
            className="labor-stores__row"
          >
            {inner}
          </Link>
        )
      })}
    </div>
  )
}
