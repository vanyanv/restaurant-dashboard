/**
 * The maths behind every judged figure: the bullet meter, its flag words, and
 * the sparkline that sits above it.
 *
 * Ported from the Counter prototype (`docs/counter/counter-prototype.html`):
 * `bstat()` line 3725, `bwords()` 3738, `bullet()` 3745, `spark()` 3770,
 * `shaped()` 3786. Kept here rather than inside the components because these
 * are the numbers, not the markup — a figure shown on two pages has to be
 * judged by one function, and a threshold nobody can unit-test is a threshold
 * nobody is holding.
 *
 * Nothing in this file renders. The components in
 * `src/components/counter/surface/` turn what it returns into the prototype's
 * DOM verbatim.
 */

/**
 * What a figure is judged against.
 *
 * Three shapes, exactly as the prototype's `c[5]`:
 *   - a BAND: `lo`/`hi` — the acceptable range.
 *   - a TARGET: a single line the figure is meant to clear.
 *   - neither: a reference that only carries a `series`, so the cell gets a
 *     sparkline and a caption but no meter and no verdict.
 *
 * `better` is the direction that is GOOD, because avg ticket fails by falling
 * and labour cost fails by rising, and one shared threshold cannot know which
 * without being told.
 */
export interface Reference {
  /** The figure itself, unformatted. */
  v: number
  /** Which direction is good. Breach is computed from the metric's own direction. */
  better: "low" | "high"
  /** Band floor. Present together with `hi`, or not at all. */
  lo?: number
  /** Band ceiling. */
  hi?: number
  /** A single line to clear, used when there is no band. */
  target?: number
  /** The bullet's `aria-label` — it is the only text a screen reader gets. */
  label?: string
  /**
   * Draw the meter, but say nothing about it: no flag words and no breach
   * tint on the sparkline. The prototype's `r.quiet`, for figures where the
   * band is context rather than a verdict.
   */
  quiet?: boolean
  /** The trajectory behind the figure. Fewer than two points draws nothing. */
  series?: number[]
}

export type BulletStatus = "ok" | "near" | "breach"

/**
 * Whether this reference is judged at all — the prototype's
 * `(r.lo != null || r.target != null)`, which gates the meter, the flag words
 * and the sparkline's breach tint in three separate places in `strip()`.
 */
export function isJudged(r: Reference): boolean {
  return r.lo != null || r.target != null
}

/**
 * `ok` | `near` | `breach`, from the reference and the direction that is bad.
 *
 * The two spans are deliberately different quantities. A target has no width,
 * so "near" is defined as 12% of the target's own magnitude; a band already
 * states its width, so "near" is measured against that. In both cases the
 * warning zone is a tenth of the span — see the thresholds asserted in
 * `tests/lib/counter/bullet-state.test.ts`.
 *
 * A reference with neither a band nor a target returns `ok`. The prototype
 * arrives at the same answer by accident (`edge` is `undefined`, every
 * comparison against `NaN` is false, so it falls through to `ok`); stating it
 * is the same behaviour written down.
 */
export function bstat(r: Reference): BulletStatus {
  if (!isJudged(r)) return "ok"

  let edge: number
  let span: number
  if (r.target != null) {
    edge = r.target
    span = Math.abs(edge) * 0.12
  } else {
    edge = r.better === "low" ? (r.hi as number) : (r.lo as number)
    span = (r.hi as number) - (r.lo as number)
  }
  const dist = r.better === "low" ? edge - r.v : r.v - edge

  if (dist < 0) return "breach"
  if (dist < span * 0.1) return "near"
  return "ok"
}

/**
 * The words that go in front of a band caption, or `null` when there is
 * nothing to say. The component renders them as
 * `<span class="flag is-…"><i></i>{word}</span>` followed by a space.
 */
export function bwords(r: Reference): { status: Exclude<BulletStatus, "ok">; word: string } | null {
  const status = bstat(r)
  if (status === "ok") return null
  const word =
    status === "breach" ? (r.better === "low" ? "over" : "under") : "at the edge"
  return { status, word }
}

/** One absolutely-positioned part of the meter, in percent of the track. */
export interface BulletSpan {
  left: string
  width: string
}

export interface BulletGeometry {
  status: BulletStatus
  /** The acceptable range, when there is one. */
  band: BulletSpan | null
  /** The neutral measure bar. Always drawn, always neutral. */
  fill: { width: string }
  /**
   * ONLY the distance past the line, and only on a breach.
   *
   * The prototype's reason, verbatim: "a red bar the whole width of the track
   * reads as 'a lot of bad' rather than 'over'." Its width floors at 1.5% so a
   * hairline breach is still visible.
   */
  over: BulletSpan | null
  /** The reference tick, when the reference is a target rather than a band. */
  tick: { left: string } | null
  /** Where the figure actually sits. */
  now: { left: string }
}

/**
 * The bullet's domain, which is the part that goes wrong.
 *
 * The domain is built from every point the meter draws, padded by half its own
 * span so the dot is never welded to an edge. `|| Math.abs(max) * 0.06` is not
 * defensive noise: a single-point domain (a figure sitting exactly on its
 * target, or a band of zero width) has a span of zero and would otherwise
 * divide by zero on every coordinate.
 *
 * KNOWN, PORTED AS-IS: a reference whose points are all exactly `0` still
 * divides by zero — `pad` is `0 || 0`, so `d1 - d0` is `0` and every
 * coordinate is `NaN`. The prototype does this too. `NaN%` is an invalid CSS
 * length, so the browser drops the declaration and the parts collapse rather
 * than render wrongly. Left faithful rather than silently improved.
 */
export function bulletGeometry(r: Reference): BulletGeometry {
  const status = bstat(r)

  const pts = [r.v]
  if (r.lo != null) pts.push(r.lo, r.hi as number)
  if (r.target != null) pts.push(r.target)

  const min = Math.min(...pts)
  const max = Math.max(...pts)
  const pad = (max - min) * 0.5 || Math.abs(max) * 0.06
  const d0 = Math.max(0, min - pad)
  const d1 = max + pad
  const x = (v: number) => ((v - d0) / (d1 - d0)) * 100

  let over: BulletSpan | null = null
  if (status === "breach") {
    const edge = r.target != null ? r.target : r.better === "low" ? (r.hi as number) : (r.lo as number)
    const a = Math.min(x(edge), x(r.v))
    const b = Math.max(x(edge), x(r.v))
    over = { left: `${a.toFixed(1)}%`, width: `${Math.max(1.5, b - a).toFixed(1)}%` }
  }

  return {
    status,
    band:
      r.lo != null
        ? {
            left: `${x(r.lo).toFixed(1)}%`,
            width: `${(x(r.hi as number) - x(r.lo)).toFixed(1)}%`,
          }
        : null,
    fill: { width: `${x(r.v).toFixed(1)}%` },
    over,
    tick: r.target != null ? { left: `${x(r.target).toFixed(1)}%` } : null,
    now: { left: `${x(r.v).toFixed(1)}%` },
  }
}

/** The sparkline's viewBox, fixed by the slot the stylesheet declares. */
export const SPARK_WIDTH = 100
export const SPARK_HEIGHT = 15
/** Vertical padding, so the line never touches the top or bottom edge. */
export const SPARK_PAD = 1.6

export interface SparkGeometry {
  /** The closed area path — the line, then down to the baseline and back. */
  area: string
  /** The open line path. */
  line: string
  last: { x: string; y: string }
}

/**
 * 15px of trajectory. Returns `null` for fewer than two points, because one
 * point is not a trend and the prototype draws nothing for it.
 */
export function sparkGeometry(series: number[] | undefined): SparkGeometry | null {
  if (!series || series.length < 2) return null

  const w = SPARK_WIDTH
  const h = SPARK_HEIGHT
  const p = SPARK_PAD
  const lo = Math.min(...series)
  const hi = Math.max(...series)
  // A flat series has no range to scale into; 1 keeps it on the baseline
  // rather than dividing by zero.
  const rng = hi - lo || 1

  const pt = series.map((v, i) => [
    (i / (series.length - 1)) * w,
    h - p - ((v - lo) / rng) * (h - p * 2),
  ])
  const line = pt.map((q, i) => `${i ? "L" : "M"}${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join("")
  const last = pt[pt.length - 1]

  return {
    area: `${line}L${w} ${h}L0 ${h}Z`,
    line,
    last: { x: last[0].toFixed(1), y: last[1].toFixed(1) },
  }
}

/**
 * Rescales a generated series so its mean equals the figure the page states.
 *
 * The prototype's reason, verbatim: "Keeps a sparkline from ever contradicting
 * the number sitting above it." One line, and load-bearing — a shape whose
 * average sits somewhere else is a second, quieter figure disagreeing with the
 * first.
 */
export function shaped(arr: number[] | undefined, avg: number): number[] | undefined {
  if (!arr || !arr.length) return arr
  let m = 0
  for (const v of arr) m += v
  m = m / arr.length
  const k = avg / Math.max(0.0001, m)
  return arr.map((v) => +(v * k).toFixed(2))
}
