"use client"

import { Lock, AlertCircle, ArrowUpRight, ArrowDownRight } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  categorySwatch,
  prettifyIngredientName,
} from "../../recipes/components/ingredient-picker-utils"
import type {
  CanonicalIngredientSummary,
  IngredientTrend,
} from "@/types/recipe"

/** Threshold at which a 30-day price swing is considered material enough to surface. */
const TREND_MIN_PCT = 5

type Props = {
  ingredient: CanonicalIngredientSummary
  onClick: () => void
}

export function IngredientTile({ ingredient, onClick }: Props) {
  const sw = categorySwatch(ingredient.category)
  const cost = ingredient.costPerRecipeUnit ?? ingredient.latestUnitCost
  const unit =
    ingredient.recipeUnit ?? ingredient.latestUnit ?? ingredient.defaultUnit
  const hasCost = cost != null
  const isManual = ingredient.costSource === "manual"

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex h-[120px] flex-col overflow-hidden border-2 bg-[var(--paper)] text-left transition",
        "border-[var(--hairline-bold)] hover:border-[var(--ink)] hover:shadow-[3px_3px_0_var(--hairline-bold)]",
        !hasCost && "border-dashed"
      )}
    >
      <div className="flex items-start gap-2.5 px-3 pt-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center font-mono text-[15px] font-bold text-(--paper)"
          style={{ background: sw.bg }}
          title={sw.label}
        >
          {sw.letter}
        </span>
        <div className="min-w-0 flex-1">
          <div
            className="line-clamp-2 font-display text-[16px] leading-[1.15] text-[var(--ink)]"
            title={ingredient.name}
          >
            {prettifyIngredientName(ingredient.name)}
          </div>
          <div className="mt-0.5 flex items-center gap-1 truncate font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
            <span className="truncate">{ingredient.category ?? sw.label}</span>
            {ingredient.costLocked && (
              <Lock
                className="h-2.5 w-2.5 shrink-0 text-[var(--ink-muted)]"
                aria-label="locked"
              />
            )}
          </div>
        </div>
      </div>

      <div
        className={cn(
          "mt-auto flex items-center justify-between border-t border-dashed px-3 py-1.5",
          hasCost
            ? "border-[var(--hairline)] bg-[var(--paper-deep)]/50"
            : "border-[var(--accent)]/30 bg-[var(--accent-bg)]/40"
        )}
      >
        {hasCost ? (
          <>
            <span className="font-mono text-[12px] tabular-nums text-[var(--ink)]">
              <span className="text-[var(--ink-muted)]">$</span>
              {cost.toFixed(2)}
              <span className="ml-0.5 text-[var(--ink-faint)]">/{unit}</span>
            </span>
            {ingredient.trend30d &&
            Math.abs(ingredient.trend30d.pctChange) >= TREND_MIN_PCT ? (
              <TrendChip trend={ingredient.trend30d} />
            ) : (
              <span className="font-mono text-[8px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
                {isManual ? "manual" : "invoice"}
              </span>
            )}
          </>
        ) : (
          <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--accent-dark)]">
            <AlertCircle className="h-3 w-3" />
            needs price
          </span>
        )}
      </div>

      {ingredient.aliasCount > 0 && (
        <span
          className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center px-1 font-mono text-[8px] tabular-nums text-[var(--ink-muted)]"
          title={`${ingredient.aliasCount} alias${ingredient.aliasCount === 1 ? "" : "es"}`}
        >
          +{ingredient.aliasCount}
        </span>
      )}
    </button>
  )
}

function TrendChip({ trend }: { trend: IngredientTrend }) {
  const up = trend.pctChange > 0
  const pct = Math.abs(trend.pctChange)
  const unitLabel = trend.unit ? ` · ${trend.unit.toLowerCase()}` : ""
  return (
    <span
      className={cn("trend-chip", up ? "trend-chip--up" : "trend-chip--down")}
      title={`${trend.vendor}${unitLabel} · $${trend.baselinePrice.toFixed(2)} → $${trend.latestPrice.toFixed(2)} since ${trend.baselineDate}`}
    >
      {up ? <ArrowUpRight /> : <ArrowDownRight />}
      {up ? "+" : "−"}
      {pct.toFixed(pct >= 10 ? 0 : 1)}%
    </span>
  )
}
