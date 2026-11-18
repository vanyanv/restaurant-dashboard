"use client"

import type { ReactNode } from "react"

/**
 * The last weeks as bars that double as the week picker: tap a bar to open
 * that week. The P&L draws what was kept; the Overview draws sales. A
 * hatched bar is a week whose figure is an upper bound (labor missing).
 */
export type WeekBar = {
  key: string
  /** "10/26" */
  label: string
  /** Bar height, against the tallest bar. Negative draws as nothing. */
  value: number
  /** The figure printed over the bar, already formatted. */
  top: string
  /** The figure is an upper bound: drawn hatched. */
  partial?: boolean
  selected?: boolean
  ariaLabel: string
}

export function WeekBars({
  title,
  weeks,
  onPick,
  partialLabel,
  fullLabel = "complete",
}: {
  title: ReactNode
  weeks: WeekBar[]
  onPick: (key: string) => void
  /** Key for the hatched bar; omitted, no key is drawn. */
  partialLabel?: string
  fullLabel?: string
}) {
  if (weeks.length === 0) return null
  const max = Math.max(1, ...weeks.map((w) => Math.max(0, w.value)))
  return (
    <div className="cu-card cu-weeks">
      <div className="cu-weeks__top">
        <span className="cu-weeks__title">{title}</span>
        {partialLabel ? (
          <span className="cu-weeks__key">
            <span>
              <i />
              {fullLabel}
            </span>
            <span>
              <i className="is-part" />
              {partialLabel}
            </span>
          </span>
        ) : null}
      </div>
      <div className="cu-weeks__bars" style={{ gridTemplateColumns: `repeat(${weeks.length},minmax(0,1fr))` }}>
        {weeks.map((w) => (
          <button key={w.key} type="button" aria-pressed={Boolean(w.selected)} aria-label={w.ariaLabel} onClick={() => onPick(w.key)}>
            <span className="cu-weeks__top-n">{w.top}</span>
            <span
              className={`cu-weeks__bar${w.partial ? " is-part" : ""}`}
              style={{ height: w.value > 0 ? `${Math.max(2, (w.value / max) * 100)}%` : 0 }}
            />
            <span className="cu-weeks__lbl">{w.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
