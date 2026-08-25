"use client"

import { useEffect, useState } from "react"
import { BookOpen, Loader2 } from "lucide-react"
import { getRecipeDetail } from "@/app/actions/recipe-actions"
import { ProvenanceChip } from "@/components/recipe/provenance-chip"
import { cn } from "@/lib/utils"
import type { RecipeCostLine, RecipeCostResult } from "@/lib/recipe-cost"

type Detail = NonNullable<Awaited<ReturnType<typeof getRecipeDetail>>>

// Client-side cache of loaded sub-recipe details so expanding re-renders don't
// refetch.
const subRecipeCache = new Map<string, Detail>()

export function MenuIngredientTree({ result }: { result: RecipeCostResult }) {
  const total = Math.max(result.totalCost, 1e-9)
  return (
    <ul className="mt-2 divide-y divide-[var(--hairline)] border-b border-[var(--hairline)]">
      {result.lines.map((ln, i) => (
        <LineRow
          key={`${ln.refId}-${i}`}
          line={ln}
          depth={0}
          parentTotal={total}
        />
      ))}
    </ul>
  )
}

function LineRow({
  line,
  depth,
  parentTotal
}: {
  line: RecipeCostLine
  depth: number
  parentTotal: number
}) {
  const [expanded, setExpanded] = useState(depth < 1)
  const isComponent = line.kind === "component"
  const indentPx = depth * 14
  const sharePct =
    parentTotal > 0 && !line.missingCost
      ? (line.lineCost / parentTotal) * 100
      : 0

  return (
    <li>
      <div
        className={cn(
          "menu-ingredient-row grid gap-3 py-3 md:grid-cols-[minmax(0,1fr)_90px_120px]",
          depth === 0 && "items-start"
        )}
        style={{ paddingLeft: indentPx }}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-1.5">
            {isComponent && (
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className="flex h-4 w-4 items-center justify-center text-[var(--ink-faint)] hover:text-[var(--ink)]"
                aria-label={
                  expanded ? "Collapse component" : "Expand component"
                }
              >
                <BookOpen className="h-3 w-3" />
              </button>
            )}
            <span
              className={cn(
                "break-words",
                isComponent
                  ? "font-display text-[16px] italic leading-snug text-[var(--ink)]"
                  : "text-[14px] text-[var(--ink)]"
              )}
            >
              {line.name}
            </span>
            {line.missingCost && (
              <span className="inline-flex items-center gap-1 border border-[var(--accent)] bg-[var(--accent-bg)] px-1 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--accent-dark)]">
                no cost
              </span>
            )}
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-faint)]">
            {formatQty(line.quantity)} {line.unit}
            {!isComponent && line.unitCost != null && line.costUnit && (
              <>
                {" "}
                · {formatCurrency(line.unitCost, 4)}/{line.costUnit}
              </>
            )}
          </div>
          {depth === 0 && sharePct > 0 && (
            <div className="mt-2 h-[3px] w-full max-w-[260px] bg-[var(--hairline)]">
              <div
                className="h-full bg-[var(--ink)]"
                style={{ width: `${Math.min(100, sharePct).toFixed(2)}%` }}
              />
            </div>
          )}
        </div>
        <div className="menu-ingredient-row__cost flex items-center text-[11px] tabular-nums text-[var(--ink)] md:justify-end">
          {line.missingCost ? (
            <span className="text-[var(--ink-faint)]">-</span>
          ) : (
            <span>{formatCurrency(line.lineCost, 4)}</span>
          )}
        </div>
        <div className="menu-ingredient-row__source flex items-center md:justify-end">
          <ProvenanceChip line={line} />
        </div>
      </div>
      {isComponent && expanded && (
        <SubRecipe
          componentRecipeId={line.refId}
          depth={depth + 1}
          parentTotal={parentTotal}
        />
      )}
    </li>
  )
}

function SubRecipe({
  componentRecipeId,
  depth,
  parentTotal
}: {
  componentRecipeId: string
  depth: number
  parentTotal: number
}) {
  const [detail, setDetail] = useState<Detail | null>(
    () => subRecipeCache.get(componentRecipeId) ?? null
  )
  const [loading, setLoading] = useState(!detail)

  useEffect(() => {
    if (detail) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      const res = await getRecipeDetail(componentRecipeId)
      if (cancelled || !res) return
      subRecipeCache.set(componentRecipeId, res)
      setDetail(res)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [componentRecipeId, detail])

  if (loading) {
    return (
      <div
        className="flex items-center gap-2 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-faint)]"
        style={{ paddingLeft: depth * 14 + 16 }}
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading...
      </div>
    )
  }
  if (!detail?.cost) return null

  return (
    <ul className="border-t border-[var(--hairline)] bg-[var(--paper-deep)]/40">
      {detail.cost.lines.map((ln, i) => (
        <LineRow
          key={`${ln.refId}-${i}`}
          line={ln}
          depth={depth}
          parentTotal={parentTotal}
        />
      ))}
    </ul>
  )
}

function formatCurrency(n: number, digits = 2): string {
  const prefix = n < 0 ? "-$" : "$"
  return `${prefix}${Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })}`
}

function formatQty(n: number): string {
  if (Number.isInteger(n)) return n.toString()
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3
  })
}
