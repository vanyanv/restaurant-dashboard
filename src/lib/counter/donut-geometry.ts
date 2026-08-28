/**
 * The arc maths behind the category ring — the arithmetic half of `donut()`
 * at line 3367 of `docs/counter/counter-prototype.html`, kept pure so a
 * wedge's shape can be reasoned about without a renderer. Same split as
 * `chart-geometry.ts` (paired with `chart.tsx`) and `bullet-state.ts` (paired
 * with `bullet.tsx`).
 *
 * Nothing here is a colour. `DonutSlice.color` carries a CSS custom-property
 * REFERENCE (`var(--bad)`) or another `ct-` value the caller already
 * resolved — never a literal. See `npm run tokens`.
 */

/** The prototype's fixed geometry: a 118×118 viewBox, centre (59,59), outer radius 52, inner radius 33. */
export const DONUT_SIZE = 118
const CX = 59
const CY = 59
const R_OUTER = 52
const R_INNER = 33

export interface DonutSlice {
  name: string
  /**
   * The slice's own share, in percent (0..100) — the same number the legend
   * prints via `pct(value, { scaled: true })`. The wedge is drawn to scale
   * against the OTHER slices' `value`s, not against an assumed 100: the arc
   * angle is this slice's value over the SUM of every slice's value, exactly
   * as the prototype's `s[1] / total`. Every caller today (`cogsWindow`'s
   * `CogsCategory.share`) already sums its slices to 100, so in practice this
   * is a percent of the whole; the geometry itself never assumes it.
   */
  value: number
  /** A `ct-` custom-property reference (`var(--bad)`), never a literal colour. */
  color: string
}

export interface DonutArc {
  name: string
  value: number
  color: string
  /** The wedge's `path` `d`, wound exactly the way the prototype winds it. */
  d: string
}

export interface DonutGeometry {
  /** One arc per slice, in the caller's order. Empty when `total <= 0` — see below. */
  arcs: DonutArc[]
  /** The sum of every slice's `value`. Governs proportion only; the legend prints each slice's own `value`, not a share of this. */
  total: number
}

/**
 * `segs.reduce(...)`, then one wedge per slice, ported point for point:
 * `a`/`b` is the running start/end angle in radians (12 o'clock is
 * `-Math.PI/2`, sweeping clockwise), `big` is the large-arc-flag, and the
 * wedge is `M A A R,R 0 big 1 B L C A r,r 0 big 0 D Z` — out to the outer
 * radius, across the outer edge, in to the inner radius, back across the
 * inner edge, close. Coordinates are `toFixed(2)`, the prototype's own
 * precision.
 *
 * A slice whose own `value` is 0 needs no special case: `ang` is 0, so `a`
 * and `b` (and the outer/inner point pairs) coincide and the wedge collapses
 * to a zero-area path — present in the DOM, same as the prototype, invisible
 * on screen, same as the prototype. It still gets a legend row, because a
 * category that measured zero this window is still a category the page
 * should list.
 *
 * KNOWN, HARDENED: the prototype divides every slice's angle by `total`
 * unconditionally (`(s[1] / total) * Math.PI * 2`). At `total <= 0` — every
 * slice reads zero, a caller passes an empty array, or (not expected here,
 * but not guarded there either) slices sum negative — that division is
 * `0/0` or `x/0`, i.e. `NaN`, on every wedge. A `NaN` coordinate makes the
 * `d` attribute invalid, which SVG treats as an error in that path and
 * typically just fails to paint it — but "typically" is doing the work of a
 * decision nobody made. `chart-geometry.ts` hardens the identical shape
 * (`Math.min.apply(null, [])` → `Infinity`) rather than trust the DOM to
 * fail safely, and this does too: `total <= 0` short-circuits to `arcs: []`
 * — an empty ring, not a full one, and never a `NaN` path. The legend is
 * unaffected: it is built from `slices` directly, in the component, not from
 * `arcs`.
 */
export function donutGeometry(slices: DonutSlice[]): DonutGeometry {
  const total = slices.reduce((sum, s) => sum + s.value, 0)
  if (total <= 0) return { arcs: [], total }

  const point = (rad: number, t: number): [string, string] => [
    (CX + rad * Math.cos(t)).toFixed(2),
    (CY + rad * Math.sin(t)).toFixed(2),
  ]

  let a = -Math.PI / 2
  const arcs: DonutArc[] = []
  for (const s of slices) {
    const ang = (s.value / total) * Math.PI * 2
    const b = a + ang
    const big = ang > Math.PI ? 1 : 0

    const [ax, ay] = point(R_OUTER, a)
    const [bx, by] = point(R_OUTER, b)
    const [cx, cy] = point(R_INNER, b)
    const [dx, dy] = point(R_INNER, a)

    arcs.push({
      name: s.name,
      value: s.value,
      color: s.color,
      d: `M${ax},${ay}A${R_OUTER},${R_OUTER} 0 ${big} 1 ${bx},${by}L${cx},${cy}A${R_INNER},${R_INNER} 0 ${big} 0 ${dx},${dy}Z`,
    })
    a = b
  }
  return { arcs, total }
}
