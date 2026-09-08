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
  /**
   * The 80% conformal interval, when the row carries one.
   *
   * Both or neither — a half-open band cannot be drawn and would be a
   * different claim from the one the model made. Null on rows written before
   * the interval existed, and on aggregate days where a store is missing.
   */
  p10?: number | null
  p90?: number | null
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
 *
 * ## The bar under the cell is the INTERVAL, not the fill
 *
 * It used to be `.bar` — a fill whose width was actual ÷ forecast. On four
 * cells out of seven there is no actual, so four bars sat empty and the one
 * piece of information the week actually has about a forward day, its 80%
 * band, was on file and undrawn.
 *
 * So every cell now draws its own P10–P90 against a scale shared by the whole
 * week, with the point marked inside it. That makes the WIDTH mean something
 * across cells: a wide bar is the model saying it is guessing, and it says so
 * before the owner staffs or orders against the number above it. A settled day
 * keeps the band it was given beforehand and marks where it actually landed —
 * which is the only honest way to show a call being kept or missed.
 *
 * A day with no band draws no bar rather than a full-width one; an interval of
 * unknown width drawn as if it were the whole week is a claim nothing made.
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
  // One scale for the week, so widths compare cell to cell. Padded by a
  // twentieth of the span at each end so a day at the extreme still draws
  // inside its own cell rather than flush against the edge.
  const bounds = days.flatMap((d) => {
    const points: number[] = [d.forecast]
    if (d.actual !== null) points.push(d.actual)
    if (d.p10 != null) points.push(d.p10)
    if (d.p90 != null) points.push(d.p90)
    return points
  })
  const rawLo = bounds.length > 0 ? Math.min(...bounds) : 0
  const rawHi = bounds.length > 0 ? Math.max(...bounds) : 0
  const pad = (rawHi - rawLo) * 0.05 || 1
  const lo = rawLo - pad
  const hi = rawHi + pad
  const at = (v: number) => ((v - lo) / (hi - lo)) * 100

  return (
    <div className="wk">
      {days.map((d) => {
        const settled = d.actual !== null
        const outcome = settled ? (d.actual! >= d.forecast * 0.97 ? " is-hit" : " is-miss") : ""
        const banded = d.p10 != null && d.p90 != null
        const left = banded ? at(d.p10!) : 0
        const width = banded ? at(d.p90!) - left : 0
        const point = at(settled ? d.actual! : d.forecast)
        return (
          <button
            type="button"
            className={`wkd${outcome}${d.key === selected ? " is-sel" : ""}`}
            key={d.key}
            onClick={() => onSelect(d.key)}
            aria-pressed={d.key === selected}
            aria-label={
              banded
                ? `${d.label}, forecast ${money(d.forecast)}, 80% interval ${money(d.p10!)} to ${money(d.p90!)}`
                : `${d.label}, forecast ${money(d.forecast)}`
            }
          >
            <span className="dn">{d.label}</span>
            <span className="fv">{money(d.forecast)}</span>
            <span className="av">
              {settled ? `${money(d.actual!)}` : banded ? "P10–P90" : "forecast"}
            </span>
            {banded ? (
              <span className="iv">
                <span className="track" />
                <span className="span" style={{ left: `${left}%`, width: `${width}%` }} />
                <span className="pt" style={{ left: `calc(${point}% - 1.5px)` }} />
              </span>
            ) : (
              <span className="iv" />
            )}
          </button>
        )
      })}
    </div>
  )
}
