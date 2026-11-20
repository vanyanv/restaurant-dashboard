import type { CSSProperties, ReactNode } from "react"

/**
 * A short list where each line is a name, a bar and a figure: each day's
 * share, each role's cost. The bar's length is the caller's, already 0..100.
 *
 * Shared block. Rows on a phone-width container; with `cells`, the rows
 * become cells side by side on a wide one (a week of days). `mark` draws one
 * reference line at the same place on every bar. A `hatched` row has an
 * input missing: its bar is hatched and its figure is said in words by the
 * caller ("missing"), never drawn as zero.
 */
export type BarRow = {
  key: string
  title: string
  /** Small words under the title: "Nov 9". */
  sub?: string
  /** The figure, already formatted. */
  value: string
  /** 0..100 of the track. */
  fill: number
  detail?: ReactNode
  /** A dashed tag after the detail: "so far". */
  tag?: string
  hatched?: boolean
  ariaLabel?: string
}

export function BarRows({ rows, mark, cells }: { rows: BarRow[]; mark?: number | null; cells?: boolean }) {
  if (rows.length === 0) return null
  return (
    <div className={`cu-bars${cells ? " cu-bars--cells" : ""}`}>
      <ul className="cu-bars__in">
        {rows.map((r, i) => (
          <li key={r.key} className="cu-bar" data-hatched={Boolean(r.hatched)} aria-label={r.ariaLabel}>
            <span className="cu-bar__title">
              {r.title}
              {r.sub ? <small>{r.sub}</small> : null}
            </span>
            <span className="cu-bar__trk" aria-hidden="true">
              {r.fill > 0 ? <i className="cu-bar__fill" style={{ width: `${Math.min(100, r.fill)}%`, "--i": i } as CSSProperties} /> : null}
              {mark !== null && mark !== undefined && r.fill > 0 ? <i className="cu-bar__mark" style={{ left: `${mark}%` }} /> : null}
            </span>
            <span className="cu-bar__value">{r.value}</span>
            {r.detail || r.tag ? (
              <span className="cu-bar__detail">
                {r.detail}
                {r.tag ? <> <span className="cu-bar__tag">{r.tag}</span></> : null}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
