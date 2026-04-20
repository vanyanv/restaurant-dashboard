"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowUpRight, BookOpen, Loader2 } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ProvenanceChip } from "@/components/recipe/provenance-chip"
import { getRecipeDetail } from "@/app/actions/recipe-actions"
import type { RecipeCostResult, RecipeCostLine } from "@/lib/recipe-cost"
import type { MenuCatalogRow } from "./menu-catalog-content"

type Detail = NonNullable<Awaited<ReturnType<typeof getRecipeDetail>>>

type Props = {
  row: MenuCatalogRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Client-side cache so re-opening the same row doesn't re-fetch. Reset when
// parent component unmounts (page leaves scope), which is what we want.
const cache = new Map<string, Detail>()

export function MenuItemDetailSheet({ row, open, onOpenChange }: Props) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !row) return
    const cached = cache.get(row.id)
    if (cached) {
      setDetail(cached)
      return
    }
    let cancelled = false
    setLoading(true)
    setDetail(null)
    ;(async () => {
      try {
        const res = await getRecipeDetail(row.id)
        if (cancelled || !res) return
        cache.set(row.id, res)
        setDetail(res)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, row])

  const marginPct =
    row && row.sellPrice != null && row.computedCost != null && row.sellPrice > 0
      ? ((row.sellPrice - row.computedCost) / row.sellPrice) * 100
      : null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto border-l border-[var(--hairline-bold)] bg-[var(--paper)] px-0 sm:max-w-[560px]"
      >
        <SheetHeader className="border-b border-[var(--hairline)] px-6 py-4">
          <div className="editorial-section-label">§ recipe</div>
          <SheetTitle className="font-display text-[22px] italic leading-tight text-[var(--ink)]">
            {row?.itemName ?? "…"}
          </SheetTitle>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">
            {row?.category}
          </div>
        </SheetHeader>

        {row && (
          <div className="space-y-6 px-6 py-5">
            <SummaryBar
              sell={row.sellPrice}
              cost={row.computedCost}
              marginPct={marginPct}
              qtySold={row.qtySold}
            />

            {loading && (
              <div className="flex items-center gap-2 py-8 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--ink-faint)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading ingredients…
              </div>
            )}

            {!loading && detail?.cost && (
              <IngredientTree result={detail.cost} />
            )}

            {!loading && detail?.recipe.notes && (
              <div className="border-l-2 border-[var(--hairline-bold)] bg-[var(--paper-deep)] px-3 py-2">
                <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                  Notes
                </div>
                <p className="whitespace-pre-line font-serif text-[13px] leading-relaxed text-[var(--ink)]">
                  {detail.recipe.notes}
                </p>
              </div>
            )}

            {!loading && detail?.recipe && (
              <div className="border-t border-[var(--hairline)] pt-4">
                <Link
                  href={`/dashboard/recipes?recipe=${detail.recipe.id}`}
                  className="inline-flex items-center gap-1 border-b border-[var(--ink)] font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--ink)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  Edit in recipe builder
                  <ArrowUpRight className="h-3 w-3" />
                </Link>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function SummaryBar({
  sell,
  cost,
  marginPct,
  qtySold,
}: {
  sell: number | null
  cost: number | null
  marginPct: number | null
  qtySold: number
}) {
  const marginTone =
    marginPct == null
      ? "text-[var(--ink-faint)]"
      : marginPct >= 70
        ? "text-emerald-700"
        : marginPct >= 50
          ? "text-amber-700"
          : "text-red-700"

  return (
    <div className="grid grid-cols-3 gap-3 border border-[var(--hairline-bold)] bg-[var(--paper-deep)] p-3">
      <Stat label="Avg sell" value={sell != null ? `$${sell.toFixed(2)}` : "—"} />
      <Stat label="Food cost" value={cost != null ? `$${cost.toFixed(2)}` : "—"} />
      <Stat
        label="Margin"
        value={marginPct != null ? `${marginPct.toFixed(1)}%` : "—"}
        tone={marginTone}
      />
      {qtySold > 0 && (
        <div className="col-span-3 -mb-1 mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          {qtySold} sold in last 30d · sell price is a sales-weighted average
        </div>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: string
}) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
        {label}
      </div>
      <div className={`mt-0.5 font-mono text-[20px] tabular-nums ${tone ?? "text-[var(--ink)]"}`}>
        {value}
      </div>
    </div>
  )
}

function IngredientTree({ result }: { result: RecipeCostResult }) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between border-b border-[var(--hairline-bold)] pb-1">
        <h4 className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          Ingredients
        </h4>
        <span className="font-mono text-[11px] tabular-nums text-[var(--ink-muted)]">
          total ${result.totalCost.toFixed(4)}
        </span>
      </div>
      <ul className="space-y-0">
        {result.lines.map((ln, i) => (
          <LineRow key={`${ln.refId}-${i}`} line={ln} depth={0} />
        ))}
      </ul>
    </div>
  )
}

function LineRow({ line, depth }: { line: RecipeCostLine; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 1)
  const isComponent = line.kind === "component"
  const indentPx = depth * 12

  return (
    <li>
      <div
        className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-[var(--hairline)] py-2"
        style={{ paddingLeft: indentPx }}
      >
        <div className="min-w-0">
          <div className="flex items-baseline gap-1.5">
            {isComponent && (
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className="flex h-4 w-4 items-center justify-center text-[var(--ink-faint)] hover:text-[var(--ink)]"
                aria-label={expanded ? "Collapse" : "Expand"}
              >
                <BookOpen className="h-3 w-3" />
              </button>
            )}
            <span
              className={
                isComponent
                  ? "font-display italic text-[14px] leading-snug text-[var(--ink)]"
                  : "text-[13px] text-[var(--ink)]"
              }
            >
              {line.name}
            </span>
          </div>
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--ink-faint)]">
            {line.quantity} {line.unit}
            {!isComponent && line.unitCost != null && line.costUnit && (
              <>
                {" · "}${line.unitCost.toFixed(4)}/{line.costUnit}
              </>
            )}
          </div>
        </div>
        <div className="flex items-center">
          <ProvenanceChip line={line} />
        </div>
      </div>
      {isComponent && expanded && (
        <SubRecipe componentRecipeId={line.refId} depth={depth + 1} />
      )}
    </li>
  )
}

function SubRecipe({
  componentRecipeId,
  depth,
}: {
  componentRecipeId: string
  depth: number
}) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const cached = cache.get(componentRecipeId)
    if (cached) {
      setDetail(cached)
      setLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      const res = await getRecipeDetail(componentRecipeId)
      if (cancelled || !res) return
      cache.set(componentRecipeId, res)
      setDetail(res)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [componentRecipeId])

  if (loading) {
    return (
      <div
        className="py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-faint)]"
        style={{ paddingLeft: depth * 12 + 16 }}
      >
        Loading…
      </div>
    )
  }
  if (!detail?.cost) return null

  return (
    <ul>
      {detail.cost.lines.map((ln, i) => (
        <LineRow key={`${ln.refId}-${i}`} line={ln} depth={depth} />
      ))}
    </ul>
  )
}
