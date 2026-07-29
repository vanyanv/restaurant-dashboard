import { cn } from "@/lib/utils"
import type { Period } from "@/lib/pnl"

/**
 * Compact per-period read under the waterfall: one column per bucket, bottom
 * line as a bar off a shared zero baseline, margin % beneath. This is the
 * component that makes the Day / Week / Month control mean something on the
 * all-stores page — the waterfall and league both collapse periods away.
 *
 * Partial buckets render at reduced opacity with a starred label; the legend
 * explains the star once instead of every column apologizing.
 */
export interface PnLPeriodStripProps {
  periods: Period[]
  /** Per-period total sales, aligned with `periods`. */
  sales: Array<number | null>
  /** Per-period bottom line, aligned with `periods`. */
  bottomLine: Array<number | null>
  className?: string
}

function shortLabel(p: Period): string {
  // "Week of Jun 7" → "Jun 7" · "Jun 3 → Jun 6 (4d, partial)" → "Jun 3" ·
  // "Mon Apr 14" → "Apr 14" · "Apr 2026" → "Apr"
  const week = p.label.match(/^Week of (.+)$/)
  if (week) return week[1]
  const partial = p.label.match(/^(\w{3}\s+\d+)\s+→/)
  if (partial) return partial[1]
  const day = p.label.match(/^\w{3}\s+(.+)$/)
  if (day) return day[1]
  const month = p.label.match(/^(\w{3,})\s+\d{4}$/)
  if (month) return month[1]
  return p.label
}

function formatShortDollar(v: number): string {
  const abs = Math.abs(v)
  const str =
    abs >= 10000
      ? `${(abs / 1000).toFixed(1)}k`
      : abs.toLocaleString("en-US", { maximumFractionDigits: 0 })
  return `${v < 0 ? "−" : ""}$${str}`
}

export function PnLPeriodStrip({
  periods,
  sales,
  bottomLine,
  className,
}: PnLPeriodStripProps) {
  if (periods.length < 2) return null

  const values = periods.map((_, i) => bottomLine[i] ?? 0)
  const maxAbs = Math.max(...values.map((v) => Math.abs(v)), 1)
  const hasNegative = values.some((v) => v < 0)
  const anyPartial = periods.some((p) => p.isPartial)

  return (
    <section className={cn("pnl-periodstrip", className)} aria-label="Bottom line by period">
      <div className="pnl-periodstrip__header">
        <span className="editorial-section-label">Bottom line by period</span>
        <span className="pnl-periodstrip__scope font-mono">
          {periods.length} buckets{anyPartial ? " · * partial" : ""}
        </span>
      </div>
      <div className="pnl-periodstrip__chart">
        {periods.map((p, i) => {
          const v = values[i]
          const sale = sales[i] ?? 0
          const margin = sale === 0 ? null : v / sale
          // Bars share a zero baseline; with no losses the full height is
          // profit. With losses, split the plot area around the midline.
          const frac = Math.abs(v) / maxAbs
          const barPct = Math.max(frac * (hasNegative ? 50 : 100), v === 0 ? 0 : 2)
          return (
            <div
              key={p.label + i}
              className={cn(
                "pnl-periodstrip__col",
                p.isPartial && "pnl-periodstrip__col--partial",
                v < 0 && "pnl-periodstrip__col--negative"
              )}
              title={`${p.label}: ${formatShortDollar(v)} bottom line${
                margin != null ? ` · ${(margin * 100).toFixed(1)}% margin` : ""
              }`}
            >
              <div className="pnl-periodstrip__value font-mono">{formatShortDollar(v)}</div>
              <div className={cn("pnl-periodstrip__plot", hasNegative && "pnl-periodstrip__plot--split")}>
                <div
                  className="pnl-periodstrip__bar"
                  style={
                    hasNegative
                      ? v >= 0
                        ? { bottom: "50%", height: `${barPct}%` }
                        : { top: "50%", height: `${barPct}%` }
                      : { bottom: 0, height: `${barPct}%` }
                  }
                />
              </div>
              <div className="pnl-periodstrip__label font-mono">
                {shortLabel(p)}
                {p.isPartial ? "*" : ""}
              </div>
              <div className="pnl-periodstrip__margin font-mono">
                {margin == null ? "—" : `${(margin * 100).toFixed(1)}%`}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
