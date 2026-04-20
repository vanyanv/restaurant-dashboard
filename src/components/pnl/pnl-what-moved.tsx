import { cn } from "@/lib/utils"
import type { Period } from "@/lib/pnl"
import { type PnLMover } from "@/app/actions/store-actions"

/**
 * Variance callout: the N biggest $ swings between the latest period and the
 * one before it. Rendered as editorial headlines — who moved, by how much,
 * and a short units-sold gloss.
 */
export interface PnLWhatMovedProps {
  movers: PnLMover[]
  periods: Period[]
  className?: string
}

function formatDollar(v: number): string {
  if (!Number.isFinite(v)) return "—"
  const abs = Math.abs(v)
  const str = abs >= 100
    ? abs.toLocaleString("en-US", { maximumFractionDigits: 0 })
    : abs.toFixed(2)
  return v < 0 ? `−$${str}` : `+$${str}`
}

function formatPct(p: number): string {
  if (!Number.isFinite(p)) return ""
  const abs = Math.abs(p) * 100
  const rounded = abs >= 10 ? abs.toFixed(0) : abs.toFixed(1)
  return p >= 0 ? `+${rounded}%` : `−${rounded}%`
}

function qtyNarrative(qtyDelta: number): string | null {
  if (!Number.isFinite(qtyDelta) || qtyDelta === 0) return null
  const abs = Math.abs(Math.round(qtyDelta))
  if (abs === 0) return null
  return qtyDelta > 0
    ? `${abs} more ${abs === 1 ? "unit" : "units"} sold`
    : `${abs} fewer ${abs === 1 ? "unit" : "units"} sold`
}

export function PnLWhatMoved({ movers, periods, className }: PnLWhatMovedProps) {
  if (movers.length === 0 || periods.length < 2) return null

  const latest = periods[periods.length - 1]
  const prior = periods[periods.length - 2]

  return (
    <section className={cn("pnl-what-moved", className)} aria-label="What moved">
      <div className="pnl-what-moved__header">
        <span className="editorial-section-label">What Moved</span>
        <span className="pnl-what-moved__scope">
          <em>{latest.label}</em> <span className="pnl-what-moved__vs">vs</span>{" "}
          <em>{prior.label}</em>
        </span>
      </div>

      <ol className="pnl-what-moved__list">
        {movers.map((m) => {
          const up = m.delta > 0
          const qty = qtyNarrative(m.qtyDelta)
          return (
            <li
              key={`${m.itemName}:::${m.category}`}
              className={cn(
                "pnl-what-moved__row",
                up ? "pnl-what-moved__row--up" : "pnl-what-moved__row--down"
              )}
            >
              <span className="pnl-what-moved__arrow" aria-hidden>
                {up ? "▲" : "▼"}
              </span>
              <span className="pnl-what-moved__item font-display">
                {m.itemName}
              </span>
              <span className="pnl-what-moved__amount font-mono">
                {formatDollar(m.delta)}
              </span>
              <span className="pnl-what-moved__pct font-mono">
                {formatPct(m.pctDelta)}
              </span>
              {qty ? <span className="pnl-what-moved__gloss">· {qty}</span> : null}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
