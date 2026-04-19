"use client"

import { AlertCircle, TrendingUp } from "lucide-react"
import type { RecipeCostResult } from "@/lib/recipe-cost"
import { cn } from "@/lib/utils"

type Props = {
  cost: RecipeCostResult | null
  loading: boolean
  servingSize: number
  foodCostOverride: number | null
}

export function CostPanel({ cost, loading, servingSize, foodCostOverride }: Props) {
  const total = cost?.totalCost ?? 0
  const partial = cost?.partial ?? false
  const perServing = servingSize > 0 ? total / servingSize : total

  const missing =
    cost?.lines.filter((l) => l.missingCost).length ?? 0
  const costedLines = cost?.lines.filter((l) => !l.missingCost) ?? []
  const topDrivers = [...costedLines]
    .sort((a, b) => b.lineCost - a.lineCost)
    .slice(0, 3)
  const maxLineCost = topDrivers[0]?.lineCost ?? 1

  const mostRecentLine = costedLines
    .filter((l) => l.sourceInvoiceDate)
    .sort(
      (a, b) =>
        (b.sourceInvoiceDate?.getTime() ?? 0) -
        (a.sourceInvoiceDate?.getTime() ?? 0)
    )[0]

  return (
    <aside className="flex h-full flex-col overflow-hidden border-l border-[var(--hairline)] bg-[var(--paper)]">
      <div className="border-b border-[var(--hairline)] px-5 py-4">
        <div className="editorial-section-label">§ cost</div>
        <div className="mt-1 font-display text-[22px] italic leading-tight text-[var(--ink)]">
          Costing
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        {/* Total */}
        <div className="border-b border-dashed border-[var(--hairline-bold)] pb-5">
          <div className="editorial-section-label">Total</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              className={cn(
                "font-display text-[40px] leading-none text-[var(--ink)]",
                loading && "opacity-50"
              )}
            >
              ${total.toFixed(2)}
            </span>
            {partial && (
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
                partial
              </span>
            )}
          </div>
          {foodCostOverride != null && total === 0 && (
            <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-faint)]">
              Using override · ${foodCostOverride.toFixed(2)}
            </div>
          )}
        </div>

        {/* Per-serving */}
        {servingSize > 1 && (
          <div className="border-b border-dashed border-[var(--hairline-bold)] py-5">
            <div className="editorial-section-label">Per serving</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-[22px] tabular-nums text-[var(--ink)]">
                ${perServing.toFixed(2)}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--ink-faint)]">
                ÷ {servingSize}
              </span>
            </div>
          </div>
        )}

        {/* Missing cost warning */}
        {missing > 0 && (
          <div className="mt-5 flex items-start gap-2 border-l-2 border-[var(--accent)] bg-[var(--accent-bg)] px-3 py-2.5">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent-dark)]" />
            <div className="text-[11px] leading-snug text-[var(--accent-dark)]">
              <strong className="font-semibold">
                {missing} ingredient{missing === 1 ? "" : "s"}
              </strong>{" "}
              without an invoice price. Total is a lower bound until you map them in
              the review queue.
            </div>
          </div>
        )}

        {/* Cost drivers */}
        {topDrivers.length > 0 && (
          <div className="mt-6">
            <div className="editorial-section-label mb-3 flex items-center gap-1.5">
              <TrendingUp className="h-3 w-3" />
              Top cost drivers
            </div>
            <ul className="space-y-2.5">
              {topDrivers.map((l) => {
                const pct = Math.round((l.lineCost / total) * 100) || 0
                const barPct = maxLineCost > 0 ? (l.lineCost / maxLineCost) * 100 : 0
                return (
                  <li key={`${l.kind}-${l.refId}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-sans text-[13px] text-[var(--ink)]">
                        {l.name}
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-[var(--ink)]">
                        ${l.lineCost.toFixed(2)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="relative h-[2px] flex-1 bg-[var(--hairline)]">
                        <div
                          className="absolute inset-y-0 left-0 bg-[var(--ink)]"
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                      <span className="font-mono text-[9px] tabular-nums text-[var(--ink-faint)]">
                        {pct}%
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>

      {/* Source footer */}
      {mostRecentLine && (
        <div className="border-t border-[var(--hairline)] bg-[var(--paper-deep)] px-5 py-3">
          <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            Last priced from
          </div>
          <div className="mt-1 font-mono text-[11px] text-[var(--ink-muted)]">
            {mostRecentLine.sourceVendor}
            {mostRecentLine.sourceInvoiceDate
              ? ` · ${formatDateShort(mostRecentLine.sourceInvoiceDate)}`
              : ""}
          </div>
        </div>
      )}
    </aside>
  )
}

function formatDateShort(d: Date): string {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}
