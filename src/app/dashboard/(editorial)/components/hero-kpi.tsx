import { cn } from "@/lib/utils"

export interface HeroKpiDelta {
  value: number
  display: string
}

/**
 * A four-week band with today's mark on it — the bullet-graph idea, drawn in
 * hairlines. `values` are the per-weekday baseline totals (see
 * `OrderPatternsHourlyComparison.groupTotals`); the band spans their min→max,
 * the light tick is their mean, and the ink mark is today.
 */
export interface RailBand {
  /** Baseline observations the band is drawn from. Two or more, or no band. */
  values: number[]
  /** Today's figure, plotted against the band. */
  current: number
  /** Pre-formatted "band $4,320–$5,940" style caption. */
  caption: string
  /**
   * Which side of the band counts as bad. Costs breach upward, sales downward.
   * A breach is the only thing in a rail cell allowed to spend accent red.
   */
  breachDirection: "above" | "below"
}

export interface RailCellProps {
  label: string
  value: string
  /** Secondary line: the figure's units, its companion number, its scope. */
  meta: string
  /** Fourteen or so points, oldest first. Rendered as a neutral sparkline. */
  spark?: number[]
  band?: RailBand | null
  delta?: HeroKpiDelta | null
}

function bandGeometry(band: RailBand) {
  const clean = band.values.filter((v) => Number.isFinite(v) && v > 0)
  if (clean.length < 2) return null

  const min = Math.min(...clean)
  const max = Math.max(...clean)
  if (!(max > min)) return null

  const mean = clean.reduce((a, b) => a + b, 0) / clean.length
  const pct = (v: number) => ((v - min) / (max - min)) * 100
  const breached =
    band.breachDirection === "above" ? band.current > max : band.current < min

  return {
    avgPct: Math.min(100, Math.max(0, pct(mean))),
    // A breaching mark is pinned to the end it broke through rather than
    // running off the track; the accent colour is what says "outside".
    markPct: breached
      ? band.breachDirection === "above"
        ? 100
        : 0
      : Math.min(100, Math.max(0, pct(band.current))),
    breached,
  }
}

/**
 * Sparkline path over a fixed 66×20 box. Neutral ink-ornament by design — the
 * judgement belongs to the band and the delta beneath it, not the trace colour.
 */
function sparkPoints(values: number[]): string | null {
  const clean = values.filter((v) => Number.isFinite(v))
  if (clean.length < 3) return null

  const min = Math.min(...clean)
  const max = Math.max(...clean)
  const span = max - min || 1
  const step = 66 / (clean.length - 1)

  return clean
    .map((v, i) => {
      const x = Math.round(i * step * 10) / 10
      const y = Math.round((18 - ((v - min) / span) * 16) * 10) / 10
      return `${x},${y}`
    })
    .join(" ")
}

export function RailCell({ label, value, meta, spark, band, delta }: RailCellProps) {
  const geo = band ? bandGeometry(band) : null
  const points = spark ? sparkPoints(spark) : null

  return (
    <div className="masthead-rail__cell">
      <dt className="masthead-rail__label">{label}</dt>
      <div className="masthead-rail__figure">
        <dd className="masthead-rail__value m-0">{value}</dd>
        {points ? (
          <svg
            className="masthead-rail__spark"
            width="66"
            height="20"
            viewBox="0 0 66 20"
            aria-hidden="true"
          >
            <polyline
              points={points}
              fill="none"
              stroke="var(--ink-ornament)"
              strokeWidth="1.25"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
        ) : null}
      </div>
      <div className="masthead-rail__meta">{meta}</div>

      {geo && band ? (
        <>
          <div className="masthead-rail__band" aria-hidden="true">
            <div className="masthead-rail__band-track" />
            <div
              className="masthead-rail__band-avg"
              style={{ left: `${geo.avgPct}%` }}
            />
            <div
              className={cn(
                "masthead-rail__band-mark",
                geo.breached && "is-breach"
              )}
              style={{ left: `${geo.markPct}%` }}
            />
          </div>
          <div
            className={cn(
              "masthead-rail__delta",
              geo.breached && "is-breach"
            )}
          >
            {delta ? `${delta.display} · ${band.caption}` : band.caption}
          </div>
        </>
      ) : delta ? (
        <div className="masthead-rail__delta">{delta.display}</div>
      ) : null}
    </div>
  )
}

export function formatMoneyLarge(n: number): string {
  // Abbreviate only at 7 figures — "$253,412" reads fine at rail size, and
  // mixing "$37.2k" with full-precision dollars on one strip was flagged in
  // the overview audit as formatting inconsistency.
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  return `$${Math.round(n).toLocaleString()}`
}

export function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`
}

export function formatDelta(growth: number): string {
  if (!Number.isFinite(growth) || growth === 0) return "·"
  const pct = (growth * 100).toFixed(1)
  const sign = growth > 0 ? "▲" : "▼"
  return `${sign} ${Math.abs(Number(pct))}% vs prior`
}

/** "band $4,320–$5,940" — the caption under a money bullet track. */
export function formatBandCaption(values: number[], fmt: (n: number) => string): string {
  const clean = values.filter((v) => Number.isFinite(v) && v > 0)
  if (clean.length < 2) return ""
  return `band ${fmt(Math.min(...clean))}–${fmt(Math.max(...clean))}`
}
