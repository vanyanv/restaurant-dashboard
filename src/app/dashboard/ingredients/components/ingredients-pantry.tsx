"use client"

import { useMemo, useState } from "react"
import { AlertCircle, EyeOff, Search, Sparkles, TrendingUp } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  bucketFor,
  CATEGORY_BUCKETS,
  categorySwatch,
  isLikelyNonFood,
  type CategoryBucket,
} from "../../recipes/components/ingredient-picker-utils"
import { IngredientTile } from "./ingredient-tile"
import { IngredientDetailSheet } from "./ingredient-detail-sheet"
import type { CanonicalIngredientSummary } from "@/types/recipe"

type Props = {
  canonicals: CanonicalIngredientSummary[]
  initialOpenId?: string | null
}

type Filter = "all" | "unpriced" | "recent" | "moved"

/** Must match the threshold used for the tile's TrendChip. */
const TREND_MIN_PCT = 5

function hasMoved(c: CanonicalIngredientSummary): boolean {
  return (
    c.trend30d != null && Math.abs(c.trend30d.pctChange) >= TREND_MIN_PCT
  )
}

export function IngredientsPantry({ canonicals, initialOpenId }: Props) {
  const [query, setQuery] = useState("")
  const [bucket, setBucket] = useState<CategoryBucket | "All">("All")
  const [showSupplies, setShowSupplies] = useState(false)
  const [filter, setFilter] = useState<Filter>("all")
  // If we arrived from a deep link, the canonical may be hidden by the supplies
  // filter — so toggle that off to guarantee the sheet has an ingredient to
  // render.
  const initialMatches =
    initialOpenId != null && canonicals.some((c) => c.id === initialOpenId)
  const [openId, setOpenId] = useState<string | null>(
    initialMatches ? initialOpenId! : null
  )

  const nonFoodIds = useMemo(() => {
    const set = new Set<string>()
    canonicals.forEach((c) => {
      if (isLikelyNonFood(c.name, c.category)) set.add(c.id)
    })
    return set
  }, [canonicals])

  const hiddenSuppliesCount = nonFoodIds.size

  const visiblePool = useMemo(() => {
    if (showSupplies) return canonicals
    return canonicals.filter((c) => !nonFoodIds.has(c.id))
  }, [canonicals, nonFoodIds, showSupplies])

  const bucketCounts = useMemo(() => {
    const counts = new Map<CategoryBucket, number>()
    visiblePool.forEach((c) => {
      const b = bucketFor(c.category)
      counts.set(b, (counts.get(b) ?? 0) + 1)
    })
    return counts
  }, [visiblePool])

  const unpricedCount = useMemo(
    () => visiblePool.filter((c) => c.costPerRecipeUnit == null).length,
    [visiblePool]
  )

  const movedCount = useMemo(
    () => visiblePool.filter(hasMoved).length,
    [visiblePool]
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return visiblePool.filter((c) => {
      if (bucket !== "All" && bucketFor(c.category) !== bucket) return false
      if (filter === "unpriced" && c.costPerRecipeUnit != null) return false
      if (filter === "recent" && !c.costUpdatedAt) return false
      if (filter === "moved" && !hasMoved(c)) return false
      if (q) {
        if (
          !c.name.toLowerCase().includes(q) &&
          !(c.category ?? "").toLowerCase().includes(q)
        ) {
          return false
        }
      }
      return true
    })
  }, [visiblePool, bucket, filter, query])

  const sorted = useMemo(() => {
    if (filter === "recent") {
      return [...filtered].sort((a, b) => {
        const at = a.costUpdatedAt ? new Date(a.costUpdatedAt).getTime() : 0
        const bt = b.costUpdatedAt ? new Date(b.costUpdatedAt).getTime() : 0
        return bt - at
      })
    }
    if (filter === "moved") {
      return [...filtered].sort((a, b) => {
        const at = a.trend30d ? Math.abs(a.trend30d.pctChange) : 0
        const bt = b.trend30d ? Math.abs(b.trend30d.pctChange) : 0
        return bt - at
      })
    }
    return filtered
  }, [filtered, filter])

  const openIngredient =
    openId != null ? canonicals.find((c) => c.id === openId) ?? null : null

  return (
    <>
      {/* Proactive alert — visible only when something has moved */}
      {movedCount > 0 && filter !== "moved" && (
        <div className="pantry-alert">
          <span>
            <span className="pantry-alert__dot" aria-hidden />
            <span className="pantry-alert__count">{movedCount}</span>
            ingredient{movedCount === 1 ? "" : "s"} moved ≥{TREND_MIN_PCT}% in
            the last 30 days
          </span>
          <button
            type="button"
            onClick={() => setFilter("moved")}
            className="pantry-alert__cta"
          >
            Review →
          </button>
        </div>
      )}

      {/* Toolbar — search + filters */}
      <div className="border-b border-[var(--hairline-bold)] bg-[var(--paper)]/60 px-8 py-5">
        <div className="flex items-center gap-3 border-2 border-[var(--ink)] bg-[var(--paper)] px-4">
          <Search className="h-4 w-4 text-[var(--ink-muted)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your pantry — cilantro, mozzarella, olive oil…"
            className="h-12 flex-1 bg-transparent font-display text-[18px] italic text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)] hover:text-[var(--ink)]"
            >
              clear
            </button>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <FilterPill active={filter === "all"} onClick={() => setFilter("all")}>
            All
            <span className="ml-1.5 tabular-nums text-[var(--ink-faint)]">
              {visiblePool.length}
            </span>
          </FilterPill>
          <FilterPill
            active={filter === "unpriced"}
            onClick={() => setFilter("unpriced")}
            accent
          >
            <AlertCircle className="h-3 w-3" />
            Needs price
            <span className="ml-1 tabular-nums">
              {unpricedCount}
            </span>
          </FilterPill>
          <FilterPill
            active={filter === "recent"}
            onClick={() => setFilter("recent")}
          >
            <Sparkles className="h-3 w-3" />
            Recently updated
          </FilterPill>
          {movedCount > 0 && (
            <FilterPill
              active={filter === "moved"}
              onClick={() => setFilter("moved")}
              accent
            >
              <TrendingUp className="h-3 w-3" />
              Price moved
              <span className="ml-1 tabular-nums">{movedCount}</span>
            </FilterPill>
          )}

          <div className="ml-auto flex items-center gap-2">
            {hiddenSuppliesCount > 0 && (
              <button
                type="button"
                onClick={() => setShowSupplies((v) => !v)}
                title={
                  showSupplies
                    ? "Hide cleaning supplies, fees, and equipment"
                    : `Show ${hiddenSuppliesCount} hidden non-food items`
                }
                className={cn(
                  "inline-flex items-center gap-1.5 border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] transition",
                  showSupplies
                    ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]"
                    : "border-[var(--hairline-bold)] bg-[var(--paper)] text-[var(--ink-muted)] hover:border-[var(--ink)] hover:text-[var(--ink)]"
                )}
              >
                <EyeOff className="h-3 w-3" />
                {showSupplies ? "Hide supplies" : `Show all (+${hiddenSuppliesCount})`}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main: rail + grid */}
      <div className="flex flex-1 overflow-hidden">
        {/* Category rail */}
        <nav className="w-[200px] shrink-0 overflow-y-auto border-r border-[var(--hairline)] bg-[var(--paper)]/50 px-4 py-6">
          <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
            Stations
          </div>
          <ul className="mt-3 space-y-0.5">
            <RailItem
              active={bucket === "All"}
              onClick={() => setBucket("All")}
              count={visiblePool.length}
              swatch={null}
            >
              All
            </RailItem>
            {CATEGORY_BUCKETS.map((b) => {
              const count = bucketCounts.get(b) ?? 0
              if (count === 0) return null
              const sw = categorySwatch(b)
              return (
                <RailItem
                  key={b}
                  active={bucket === b}
                  onClick={() => setBucket(b)}
                  count={count}
                  swatch={sw}
                >
                  {b}
                </RailItem>
              )
            })}
          </ul>

          <div className="mt-8 border-t border-dashed border-[var(--hairline-bold)] pt-5">
            <p className="font-mono text-[9px] uppercase leading-relaxed tracking-[0.14em] text-[var(--ink-faint)]">
              Tip
            </p>
            <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-[var(--ink-muted)]">
              Tap a tile to edit its cost, unit, or merge duplicates.
            </p>
          </div>
        </nav>

        {/* Grid */}
        <div className="relative flex-1 overflow-y-auto px-8 py-6">
          {sorted.length === 0 ? (
            <EmptyGrid
              query={query}
              filter={filter}
              bucket={bucket}
              canonicalCount={canonicals.length}
            />
          ) : (
            <>
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="font-display text-[26px] italic leading-tight text-[var(--ink)]">
                  {bucket === "All" ? "Everything" : bucket}
                  {filter === "unpriced" && " · unpriced"}
                  {filter === "recent" && " · recently updated"}
                  {filter === "moved" && " · price moved"}
                </h2>
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
                  {sorted.length} ingredient{sorted.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
                {sorted.map((c) => (
                  <IngredientTile
                    key={c.id}
                    ingredient={c}
                    onClick={() => setOpenId(c.id)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <IngredientDetailSheet
        ingredient={openIngredient}
        allIngredients={canonicals}
        open={openId != null}
        onOpenChange={(o) => {
          if (!o) setOpenId(null)
        }}
      />
    </>
  )
}

function FilterPill({
  active,
  onClick,
  children,
  accent,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  accent?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] transition",
        active
          ? accent
            ? "border-[var(--accent-dark)] bg-[var(--accent-dark)] text-[var(--paper)]"
            : "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]"
          : accent
            ? "border-[var(--accent-dark)]/40 bg-[var(--accent-bg)]/40 text-[var(--accent-dark)] hover:border-[var(--accent-dark)]"
            : "border-[var(--hairline-bold)] bg-[var(--paper)] text-[var(--ink-muted)] hover:border-[var(--ink)] hover:text-[var(--ink)]"
      )}
    >
      {children}
    </button>
  )
}

function RailItem({
  active,
  onClick,
  count,
  swatch,
  children,
}: {
  active: boolean
  onClick: () => void
  count: number
  swatch: { bg: string } | null
  children: React.ReactNode
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "group relative flex w-full items-center gap-2.5 border-l-2 py-2 pl-3 pr-2 text-left transition",
          active
            ? "border-[var(--ink)] bg-[var(--paper-deep)]"
            : "border-transparent hover:border-[var(--hairline-bold)] hover:bg-[var(--paper-deep)]/50"
        )}
      >
        {swatch && (
          <span
            aria-hidden
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: swatch.bg }}
          />
        )}
        <span
          className={cn(
            "flex-1 font-mono text-[11px] uppercase tracking-[0.1em]",
            active ? "text-[var(--ink)]" : "text-[var(--ink-muted)]"
          )}
        >
          {children}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-[var(--ink-faint)]">
          {count}
        </span>
      </button>
    </li>
  )
}

function EmptyGrid({
  query,
  filter,
  bucket,
  canonicalCount,
}: {
  query: string
  filter: Filter
  bucket: CategoryBucket | "All"
  canonicalCount: number
}) {
  if (canonicalCount === 0) {
    return (
      <div className="mx-auto max-w-md border border-dashed border-[var(--hairline-bold)] px-8 py-16 text-center">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
          § empty pantry
        </div>
        <h3 className="mt-3 font-display text-[28px] italic leading-tight text-[var(--ink)]">
          No ingredients yet.
        </h3>
        <p className="mt-3 font-mono text-[11px] leading-relaxed text-[var(--ink-muted)]">
          Upload invoices and their line items will land here once matched. Or
          head over to the Recipes page and seed from invoice history.
        </p>
      </div>
    )
  }

  let hint = "Try a different search or filter."
  if (query && filter === "all" && bucket === "All") {
    hint = `No match for "${query}". Try checking the Review inbox if this is a brand-new item.`
  } else if (filter === "unpriced") {
    hint = "Every ingredient here has a price — nice."
  } else if (filter === "recent") {
    hint = "Nothing updated recently. Prices will show up here after you edit them."
  } else if (filter === "moved") {
    hint = "Prices have been quiet — nothing moved 5% or more in the last 30 days."
  } else if (bucket !== "All") {
    hint = `Nothing in ${bucket} matches your filters.`
  }

  return (
    <div className="mx-auto max-w-md border border-dashed border-[var(--hairline)] px-8 py-14 text-center">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
        § nothing here
      </div>
      <h3 className="mt-3 font-display text-[22px] italic leading-tight text-[var(--ink)]">
        Empty shelf.
      </h3>
      <p className="mt-3 max-w-xs font-mono text-[10px] leading-relaxed text-[var(--ink-muted)]">
        {hint}
      </p>
    </div>
  )
}
