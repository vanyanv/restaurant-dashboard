"use client"

import { money } from "@/lib/counter/format"

export type WeekDay = {
  /** Stable id — an ISO day. What `onSelect` reports. */
  key: string
  /** What the cell prints: "Sat 29". */
  label: string
  forecast: number
  /** null while the day is still ahead. NOT zero — zero is a real revenue. */
  actual: number | null
}

/**
 * `.wk` / `.wkd` — the week read as forecast against actual, one cell a day.
 *
 * A day with no actual is neither a hit nor a miss. Treating a null actual as
 * zero would paint every day of the coming week as a miss, which is the state
 * the page is in for four days out of seven.
 *
 * Renders `.wkd` as a `<button>`, not the prototype's `<div>` (ruling N-R10),
 * so the cell is keyboard-reachable. `src/styles/counter-repairs.css` carries
 * the declarations `.wkd` itself never sets, which a `<button>` would
 * otherwise pick up from the UA stylesheet instead of inheriting.
 */
export function WeekPicker({
  days,
  selected,
  onSelect,
}: {
  days: WeekDay[]
  selected: string
  onSelect: (key: string) => void
}) {
  return (
    <div className="wk">
      {days.map((d) => {
        const settled = d.actual !== null
        const pct =
          settled && d.forecast > 0
            ? Math.min(100, Math.round((d.actual! / d.forecast) * 100))
            : 0
        const outcome = settled ? (d.actual! >= d.forecast * 0.97 ? " is-hit" : " is-miss") : ""
        return (
          <button
            type="button"
            className={`wkd${outcome}${d.key === selected ? " is-sel" : ""}`}
            key={d.key}
            onClick={() => onSelect(d.key)}
            aria-pressed={d.key === selected}
          >
            <span className="dn">{d.label}</span>
            <span className="fv">{money(d.forecast)}</span>
            <span className="av">{settled ? `actual ${money(d.actual!)}` : "forecast"}</span>
            <span className="bar">
              <i style={{ width: `${pct}%` }} />
            </span>
          </button>
        )
      })}
    </div>
  )
}
