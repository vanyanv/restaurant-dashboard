import { cn } from "@/lib/utils"

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
  costStyle?: boolean
}

export interface PnLKpiStripProps {
  kpis: PnLKpi[]
  className?: string
}

export function PnLKpiStrip({ kpis, className }: PnLKpiStripProps) {
  return (
    <div className={cn("grid gap-3 grid-cols-2 lg:grid-cols-4", className)}>
      {kpis.map((k) => {
        const positive = k.value >= 0
        const toneClass = k.costStyle
          ? positive
            ? "text-(--subtract)"
            : "text-(--ink)"
          : positive
          ? "text-(--ink)"
          : "text-(--subtract)"

        return (
          <section key={k.label} className="inv-panel inv-panel--flush">
            <div className="p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">
                {k.label}
              </div>
              <div className={cn("mt-1 text-2xl font-semibold tabular-nums", toneClass)}>
                {formatDollar(k.value)}
              </div>
              {k.percentOfSales != null && (
                <div className="mt-0.5 text-xs text-(--ink-muted) tabular-nums">
                  {formatPercent(k.percentOfSales)} of sales
                </div>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
