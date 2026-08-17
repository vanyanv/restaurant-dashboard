import { cn } from "@/lib/utils"
import { DeltaStamp } from "./delta-stamp"

function formatDollar(v: number): string {
  const abs = Math.abs(v)
  const str = abs.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
  return v < 0 ? `-$${str}` : `$${str}`
}

function formatPercent(p: number): string {
  return `${(p * 100).toFixed(1)}%`
}

export interface PnLKpi {
  label: string
  value: number
  percentOfSales?: number
  /** Shown in place of the "% of sales" line — use when the ratio would be
   * misleading because an input is still incomplete. */
  note?: string
  costStyle?: boolean
  /** Same figure over the previous equal-length window — renders a Δ stamp. */
  prior?: number | null
  /** Caption after the Δ stamp, e.g. "vs prior". */
  priorSuffix?: string
}

export interface PnLKpiStripProps {
  kpis: PnLKpi[]
  className?: string
}

export function PnLKpiStrip({ kpis, className }: PnLKpiStripProps) {
  return (
    <div className={cn("grid gap-3 grid-cols-2 lg:grid-cols-4", className)}>
      {kpis.map((k) => {
        // Red is earned: a cost being a cost is not an alarm. Only a
        // NEGATIVE headline figure (losing bottom line) reads red — costStyle
        // now only flips the Δ stamp's good/bad direction.
        const toneClass =
          !k.costStyle && k.value < 0 ? "text-(--subtract)" : "text-(--ink)"

        return (
          <section key={k.label} className="inv-panel inv-panel--flush">
            <div className="p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">
                {k.label}
              </div>
              <div className={cn("mt-1 text-2xl font-semibold tabular-nums", toneClass)}>
                {formatDollar(k.value)}
              </div>
              {k.percentOfSales != null ? (
                <div className="mt-0.5 text-xs text-(--ink-muted) tabular-nums">
                  {formatPercent(k.percentOfSales)} of sales
                </div>
              ) : k.note ? (
                <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-(--ink-muted)">
                  {k.note}
                </div>
              ) : null}
              {k.prior != null && (
                <div className="mt-1.5">
                  <DeltaStamp
                    current={k.value}
                    prior={k.prior}
                    format="dollars"
                    costSemantics={k.costStyle}
                    suffix={k.priorSuffix ?? "vs prior"}
                    size="sm"
                  />
                </div>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
