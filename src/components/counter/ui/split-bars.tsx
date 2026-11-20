"use client"

import type { CSSProperties } from "react"

/**
 * Periods as bars where part of each bar is filled: the whole bar is one
 * figure (sales) and the filled part another (labor), so both the size and
 * the share read at a glance. Tap a bar to open that period.
 *
 * Shared block, the two-figure sibling of `WeekBars`. A `hatched` bar has an
 * input missing. Twelve bars are narrower than their labels on a phone-width
 * container, so there the figure prints over the open bar only and every
 * third bar is dated; each bar still says all of it to a screen reader.
 */
export type SplitBar = {
  key: string
  /** "11/9" */
  label: string
  /** Printed over the bar, already formatted. */
  top: string
  /** Bar height, 0..100 against the tallest. */
  value: number
  /** The filled part, 0..100 of the bar. */
  inner: number
  hatched?: boolean
  selected?: boolean
  ariaLabel: string
}

export function SplitBars({ bars, onPick }: { bars: SplitBar[]; onPick: (key: string) => void }) {
  if (bars.length === 0) return null
  return (
    <div className="cu-split">
      <div className="cu-split__bars" style={{ gridTemplateColumns: `repeat(${bars.length},minmax(0,1fr))` }}>
        {bars.map((b, i) => (
          <button
            key={b.key}
            type="button"
            className="cu-split__b"
            data-hatched={Boolean(b.hatched)}
            aria-pressed={Boolean(b.selected)}
            aria-label={b.ariaLabel}
            onClick={() => onPick(b.key)}
          >
            <span className="cu-split__top">{b.top}</span>
            <span className="cu-split__trk">
              <span className="cu-split__bar" style={{ height: `${Math.max(2, Math.min(100, b.value))}%`, "--i": i } as CSSProperties}>
                {b.inner > 0 ? <i style={{ height: `${Math.min(100, b.inner)}%` }} /> : null}
              </span>
            </span>
            <span className="cu-split__lbl">{b.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
