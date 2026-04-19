import { Card, CardContent } from "@/components/ui/card"
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
  /** Optional: rendered as "X.X% of sales" beneath the value. */
  percentOfSales?: number
  /** When true, render positive as red, negative as green (cost semantics). */
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
            ? "text-red-600 dark:text-red-400"
            : "text-emerald-600 dark:text-emerald-400"
          : positive
          ? "text-foreground"
          : "text-red-600 dark:text-red-400"

        return (
          <Card key={k.label}>
            <CardContent className="p-4">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {k.label}
              </div>
              <div className={cn("mt-1 text-2xl font-bold tabular-nums", toneClass)}>
                {formatDollar(k.value)}
              </div>
              {k.percentOfSales != null && (
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {formatPercent(k.percentOfSales)} of sales
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
