"use client"

import { isPackagingStation } from "@/lib/pantry-stations"
import type { PantryStationSummary } from "@/app/actions/pantry-ledger-actions"

/**
 * Kitchen stations, ranked by spend and doubling as the ledger's filter.
 *
 * The breakdown IS the control, so grouping costs no extra vertical space —
 * the alternative was a row of filter pills plus a separate chart saying the
 * same thing twice.
 */

const money = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })

export const ALL_FOOD = "__food" as const
export type StationFilter = typeof ALL_FOOD | string

type Props = {
  stations: PantryStationSummary[]
  foodCount: number
  foodSpend: number
  totalSpend: number
  selected: StationFilter
  onSelect: (next: StationFilter) => void
}

export function StationStrip({
  stations,
  foodCount,
  foodSpend,
  totalSpend,
  selected,
  onSelect,
}: Props) {
  // Bars are scaled against food spend so the food stations stay readable
  // against each other rather than all collapsing next to the grand total.
  const scale = Math.max(foodSpend, 1)

  const rows = [
    {
      key: ALL_FOOD,
      label: "All food",
      itemCount: foodCount,
      spend: foodSpend,
      packaging: false,
    },
    ...stations.map((s) => ({
      key: s.station,
      label: s.station,
      itemCount: s.itemCount,
      spend: s.spend,
      packaging: isPackagingStation(s.station),
    })),
  ]

  return (
    <>
      <p className="pl-caption">Stations · bar is share of food spend</p>
      <div className="pl-stations">
        {rows.map((r) => (
          <button
            key={r.key}
            type="button"
            className={r.packaging ? "pl-station pl-station--packaging" : "pl-station"}
            aria-pressed={selected === r.key}
            onClick={() => onSelect(r.key)}
          >
            <span className="pl-station__name">{r.label}</span>
            <span className="pl-station__count">{r.itemCount}</span>
            <span className="pl-station__bar">
              <i style={{ width: `${Math.min((r.spend / scale) * 100, 100).toFixed(1)}%` }} />
            </span>
            <span className="pl-station__spend">{money(r.spend)}</span>
            <span className="pl-station__pct">
              {totalSpend > 0 ? `${((r.spend / totalSpend) * 100).toFixed(1)}%` : "—"}
            </span>
          </button>
        ))}
      </div>
    </>
  )
}
