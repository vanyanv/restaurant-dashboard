"use client"

import { formatUnitPrice } from "@/lib/pantry-format"
import type { PantryPricePoint } from "@/app/actions/pantry-ledger-actions"

/**
 * Unit price over time for one ingredient, segmented by SKU.
 *
 * The line BREAKS at every SKU change instead of sloping across it. A
 * different SKU is a different product: `lamb potato fry ss 1/4 stealth`
 * carries four SKUs across three brands, and drawing one continuous line
 * through them turns a supplier switch into a price rise.
 *
 * Only the dominant unit is plotted — a $/case series and a $/lb series share
 * no axis, and overlaying them would be a lie rather than a chart.
 */

const W = 640
const H = 124
const PAD_L = 4
const PAD_R = 4
const PAD_T = 12
const PAD_B = 22

type Props = {
  series: PantryPricePoint[]
  /** True when the loader trimmed older points to the 60 most recent. */
  capped: boolean
}

const shortDate = (iso: string): string => {
  const [, m, d] = iso.split("-")
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return `${months[Number(m) - 1]} ${Number(d)}`
}

export function PriceChart({ series, capped }: Props) {
  if (series.length < 2) {
    const dates = new Set(series.map((p) => p.date)).size
    return (
      <p className="pl-none pl-panel__wide">
        Only {dates} purchase date{dates === 1 ? "" : "s"} on record — not enough for a trend line.
      </p>
    )
  }

  // Plot the unit the ingredient is mostly bought in.
  const unitCounts = new Map<string, number>()
  for (const p of series) {
    const u = p.unit ?? "?"
    unitCounts.set(u, (unitCounts.get(u) ?? 0) + 1)
  }
  const unit = [...unitCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const points = series.filter((p) => (p.unit ?? "?") === unit)

  if (points.length < 2) {
    return (
      <p className="pl-none pl-panel__wide">
        Prices are recorded in mixed units, so there is no comparable series to plot.
      </p>
    )
  }

  const times = points.map((p) => Date.parse(p.date))
  const prices = points.map((p) => p.unitPrice)
  const tMin = Math.min(...times)
  const tMax = Math.max(...times)
  const pMin = Math.min(...prices)
  const pMax = Math.max(...prices)
  const pad = (pMax - pMin) * 0.18 || Math.max(pMax * 0.1, 0.01)
  const lo = pMin - pad
  const hi = pMax + pad

  const x = (ms: number) => PAD_L + ((ms - tMin) / Math.max(tMax - tMin, 1)) * (W - PAD_L - PAD_R)
  const y = (p: number) => PAD_T + (1 - (p - lo) / Math.max(hi - lo, 1e-9)) * (H - PAD_T - PAD_B)

  // Consecutive runs of the same SKU. Each run is drawn on its own.
  const runs: { sku: string; points: PantryPricePoint[] }[] = []
  for (const p of points) {
    const key = p.sku ?? "∅"
    const current = runs[runs.length - 1]
    if (current && current.sku === key) current.points.push(p)
    else runs.push({ sku: key, points: [p] })
  }

  const first = points[0]
  const last = points[points.length - 1]
  const rose = last.unitPrice > first.unitPrice
  const switches = runs.length - 1

  const gridLines = [hi, (hi + lo) / 2, lo]

  return (
    <figure className="pl-chart pl-panel__wide">
      <figcaption>
        <span>unit price · {unit.toLowerCase()}</span>
        <span>
          {shortDate(first.date)} – {shortDate(last.date)} · {points.length} deliveries
          {capped ? " · most recent 60" : ""}
        </span>
      </figcaption>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={
          `Unit price per ${unit} from ${first.date} to ${last.date}, ` +
          `${formatUnitPrice(first.unitPrice)} to ${formatUnitPrice(last.unitPrice)}` +
          (switches > 0 ? `, across ${runs.length} different products` : "")
        }
      >
        {gridLines.map((g, n) => (
          <line
            key={`g${n}`}
            x1={PAD_L}
            y1={y(g)}
            x2={W - PAD_R}
            y2={y(g)}
            className="pl-chart__grid"
          />
        ))}

        {runs.slice(1).map((run, n) => (
          <line
            key={`b${n}`}
            x1={x(Date.parse(run.points[0].date))}
            y1={PAD_T - 4}
            x2={x(Date.parse(run.points[0].date))}
            y2={H - PAD_B}
            className="pl-chart__break"
          />
        ))}

        {runs.map((run, n) =>
          run.points.length === 1 ? (
            <circle
              key={`r${n}`}
              cx={x(Date.parse(run.points[0].date))}
              cy={y(run.points[0].unitPrice)}
              r={2}
              className="pl-chart__lone"
            />
          ) : (
            <path
              key={`r${n}`}
              d={run.points
                .map(
                  (p, i) =>
                    `${i ? "L" : "M"}${x(Date.parse(p.date)).toFixed(1)} ${y(p.unitPrice).toFixed(1)}`
                )
                .join(" ")}
              className="pl-chart__line"
            />
          )
        )}

        <circle
          cx={x(Date.parse(last.date))}
          cy={y(last.unitPrice)}
          r={3.5}
          className={rose ? "pl-chart__dot pl-chart__dot--up" : "pl-chart__dot"}
        />
      </svg>

      <div className="pl-chart__axis">
        <span>{formatUnitPrice(first.unitPrice)}</span>
        {switches > 0 && (
          <span className="pl-chart__switch">
            product changed {switches}
            {"×"}
          </span>
        )}
        <span className={rose ? "pl-chart__hi" : undefined}>
          {formatUnitPrice(last.unitPrice)}
        </span>
      </div>
    </figure>
  )
}
