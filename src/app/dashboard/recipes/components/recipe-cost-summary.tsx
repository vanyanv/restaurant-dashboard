"use client"

import { AlertCircle, Loader2 } from "lucide-react"
import type { RecipeCostResult } from "@/lib/recipe-cost"

type Props = {
  cost: RecipeCostResult | null
  loading: boolean
  servingSize: number
}

export function RecipeCostSummary({ cost, loading, servingSize }: Props) {
  if (loading) {
    return (
      <div className="rounded-lg border bg-muted/30 p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Computing cost…
        </div>
      </div>
    )
  }

  if (!cost) {
    return (
      <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
        Pick at least one ingredient to see the cost.
      </div>
    )
  }

  const perServing = servingSize > 0 ? cost.totalCost / servingSize : cost.totalCost

  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Recipe cost
          </div>
          <div className="text-2xl font-semibold tabular-nums">
            ${cost.totalCost.toFixed(2)}
          </div>
        </div>
        {servingSize !== 1 && (
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Per serving
            </div>
            <div className="text-lg font-medium tabular-nums">
              ${perServing.toFixed(2)}
            </div>
          </div>
        )}
      </div>

      {cost.partial && (
        <div className="mb-3 flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Some ingredients have no invoice price yet; cost is a lower bound.
          </span>
        </div>
      )}

      <ul className="space-y-1.5 text-xs">
        {cost.lines.map((l, i) => (
          <li
            key={`${l.kind}-${l.refId}-${i}`}
            className="flex items-baseline justify-between gap-2"
          >
            <span className="truncate">
              {l.quantity} {l.unit} {l.name}
              {l.kind === "component" && (
                <span className="ml-1 text-muted-foreground">(sub-recipe)</span>
              )}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {l.missingCost ? (
                "—"
              ) : (
                <>${l.lineCost.toFixed(2)}</>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
