import {
  sparkGeometry,
  SPARK_HEIGHT,
  SPARK_WIDTH,
} from "@/lib/counter/bullet-state"

/**
 * 15px of trajectory, in the slot the stylesheet has always declared.
 *
 * Ported from `spark()` at line 3770 of
 * `docs/counter/counter-prototype.html`: a 100×15 viewBox stretched to the
 * cell's width (`preserveAspectRatio="none"`), three children in order — the
 * closed area, the open line, and a dot on the last point.
 *
 * `aria-hidden` because it is decoration: the figure above it and the bullet's
 * own `aria-label` already say everything it shows. `focusable="false"` keeps
 * IE-era SVG out of the tab order.
 */
export function Spark({
  series,
  breach,
}: {
  series: number[] | undefined
  /** Tints the whole mark red. Set by the cell, from the reference's verdict. */
  breach?: boolean
}) {
  const g = sparkGeometry(series)
  if (!g) return null

  return (
    <svg
      className={breach ? "sp is-breach" : "sp"}
      viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path className="ar" d={g.area} />
      <path className="ln" d={g.line} />
      <circle cx={g.last.x} cy={g.last.y} r="1.7" />
    </svg>
  )
}
