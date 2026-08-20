/**
 * Derived columns for the evidence table inside an Answer Block.
 *
 * Both are arithmetic on values already rendered on the same screen, so they
 * stay inside the product's never-invent-a-number rule — nothing here reaches
 * for a figure the reader cannot see. The change column is explicitly
 * previous-row, not period-over-period, and the header must say so.
 */

export interface TrendLike {
  label: string
  value: number
}

export interface TrendDelta {
  text: string
  /** Semantic direction, or null when the movement is flat. */
  direction: "up" | "down" | null
}

export interface TrendRow<T extends TrendLike> {
  point: T
  /** 0–1 against the largest value in the series. */
  intensity: number
  /** Bucketed for the sanctioned opacity ramp (DESIGN.md §6). */
  ramp: "lo" | "mid" | "hi"
  delta: TrendDelta | null
}

/** Ramp buckets. The chart vocabulary allows four steps; three read clearly
 * at a 5px bar and keep the low end from vanishing. */
function rampFor(intensity: number): "lo" | "mid" | "hi" {
  if (intensity >= 0.6) return "hi"
  if (intensity >= 0.3) return "mid"
  return "lo"
}

export function buildTrendRows<T extends TrendLike>(points: readonly T[]): TrendRow<T>[] {
  const max = points.reduce((m, p) => (p.value > m ? p.value : m), 0)
  return points.map((point, i) => {
    const intensity = max > 0 ? Math.max(0, point.value) / max : 0
    const prev = i > 0 ? points[i - 1].value : null
    let delta: TrendDelta | null = null
    // A zero prior has no meaningful percentage — showing "+∞%" or "+100%"
    // would both be lies about a series that started from nothing.
    if (prev !== null && prev !== 0) {
      const pct = ((point.value - prev) / Math.abs(prev)) * 100
      const rounded = Math.abs(pct) < 0.05 ? 0 : pct
      delta = {
        text: `${rounded > 0 ? "+" : rounded < 0 ? "-" : ""}${Math.abs(rounded).toFixed(1)}%`,
        direction: rounded > 0 ? "up" : rounded < 0 ? "down" : null,
      }
    }
    return { point, intensity, ramp: rampFor(intensity), delta }
  })
}

export function trendTotal(points: readonly TrendLike[]): number {
  return points.reduce((sum, p) => sum + p.value, 0)
}
