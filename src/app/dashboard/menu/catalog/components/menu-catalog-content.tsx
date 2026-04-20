"use client"

import { useMemo, useState } from "react"
import { AlertTriangle, ChevronRight, Search } from "lucide-react"
import { EditorialTopbar } from "../../../components/editorial-topbar"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { MenuItemDetailSheet } from "./menu-item-detail-sheet"

export type MenuCatalogRow = {
  id: string
  itemName: string
  category: string
  isConfirmed: boolean
  ingredientCount: number
  computedCost: number | null
  partialCost: boolean
  updatedAt: Date
  sellPrice: number | null
  qtySold: number
  sellSourceName: string | null
}

type Props = {
  rows: MenuCatalogRow[]
}

export function MenuCatalogContent({ rows }: Props) {
  const [query, setQuery] = useState("")
  const [activeCategory, setActiveCategory] = useState<string | "all">("all")
  const [openRecipeId, setOpenRecipeId] = useState<string | null>(null)

  const categories = useMemo(() => {
    const seen = new Set<string>()
    for (const r of rows) seen.add(r.category)
    return Array.from(seen).sort((a, b) => a.localeCompare(b))
  }, [rows])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (activeCategory !== "all" && r.category !== activeCategory) return false
      if (!q) return true
      return (
        r.itemName.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q)
      )
    })
  }, [rows, query, activeCategory])

  const grouped = useMemo(() => {
    const byCat = new Map<string, MenuCatalogRow[]>()
    for (const r of filtered) {
      const bucket = byCat.get(r.category) ?? []
      bucket.push(r)
      byCat.set(r.category, bucket)
    }
    return Array.from(byCat.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  // Blended margin stamp: weighted by units sold.
  const blendedMargin = useMemo(() => {
    let totalRevenue = 0
    let totalCost = 0
    for (const r of rows) {
      if (r.sellPrice == null || r.computedCost == null) continue
      totalRevenue += r.sellPrice * r.qtySold
      totalCost += r.computedCost * r.qtySold
    }
    if (totalRevenue <= 0) return null
    return ((totalRevenue - totalCost) / totalRevenue) * 100
  }, [rows])

  const activeRow = useMemo(
    () => rows.find((r) => r.id === openRecipeId) ?? null,
    [rows, openRecipeId]
  )

  return (
    <div className="editorial-surface flex min-h-[calc(100vh-3.5rem)] flex-col">
      <EditorialTopbar
        section="§ 12"
        title="Menu"
        stamps={
          <span>
            {rows.length} items
            {blendedMargin != null &&
              ` · ${blendedMargin.toFixed(1)}% blended margin`}
          </span>
        }
      />

      <div className="border-b border-[var(--hairline)] bg-[var(--paper)] px-8 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveCategory("all")}
            className={cn(
              "inline-flex items-center gap-2 border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] transition",
              activeCategory === "all"
                ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]"
                : "border-[var(--hairline-bold)] text-[var(--ink-muted)] hover:border-[var(--ink)] hover:text-[var(--ink)]"
            )}
          >
            All
            <span
              className={cn(
                "tabular-nums",
                activeCategory === "all"
                  ? "text-[var(--paper)]/70"
                  : "text-[var(--ink-faint)]"
              )}
            >
              {rows.length}
            </span>
          </button>
          {categories.map((cat) => {
            const count = rows.filter((r) => r.category === cat).length
            const active = activeCategory === cat
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  "inline-flex items-center gap-2 border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] transition",
                  active
                    ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]"
                    : "border-[var(--hairline-bold)] text-[var(--ink-muted)] hover:border-[var(--ink)] hover:text-[var(--ink)]"
                )}
              >
                {cat}
                <span
                  className={cn(
                    "tabular-nums",
                    active ? "text-[var(--paper)]/70" : "text-[var(--ink-faint)]"
                  )}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-[var(--paper)] px-8 py-8">
        <div className="mb-6 flex items-center gap-2 border-b border-[var(--hairline-bold)] pb-3">
          <Search className="h-3.5 w-3.5 text-[var(--ink-faint)]" />
          <Input
            placeholder="Search menu items…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 max-w-sm border-0 bg-transparent px-0 text-sm focus-visible:ring-0"
          />
          <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-faint)]">
            {filtered.length} shown
          </span>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_90px_90px_90px_20px] gap-4 border-b border-[var(--hairline)] pb-2 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--ink-faint)]">
          <span>Item</span>
          <span className="text-right">Sell</span>
          <span className="text-right">Cost</span>
          <span className="text-right">Margin</span>
          <span />
        </div>

        {grouped.length === 0 && (
          <div className="border border-dashed border-[var(--hairline-bold)] px-8 py-16 text-center">
            <div className="editorial-section-label">§ empty</div>
            <h2 className="mt-2 font-display text-[26px] italic text-[var(--ink)]">
              No menu items match.
            </h2>
            <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">
              Try a different search or category filter.
            </p>
          </div>
        )}

        {grouped.map(([cat, rowsInCat]) => (
          <section key={cat} className="mt-6 first:mt-0">
            <h3 className="border-b border-[var(--hairline)] pb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
              {cat}
              <span className="ml-2 text-[var(--ink-muted)]">
                {rowsInCat.length}
              </span>
            </h3>
            <ul>
              {rowsInCat.map((r) => (
                <MenuRow
                  key={r.id}
                  row={r}
                  onOpen={() => setOpenRecipeId(r.id)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>

      <MenuItemDetailSheet
        row={activeRow}
        open={openRecipeId != null}
        onOpenChange={(o) => {
          if (!o) setOpenRecipeId(null)
        }}
      />
    </div>
  )
}

function MenuRow({ row, onOpen }: { row: MenuCatalogRow; onOpen: () => void }) {
  const cost = row.computedCost
  const sell = row.sellPrice
  const marginPct =
    cost != null && sell != null && sell > 0 ? ((sell - cost) / sell) * 100 : null
  const marginTone =
    marginPct == null
      ? "text-[var(--ink-faint)]"
      : marginPct >= 70
        ? "text-emerald-700"
        : marginPct >= 50
          ? "text-amber-700"
          : "text-red-700"

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group grid w-full grid-cols-[minmax(0,1fr)_90px_90px_90px_20px] items-center gap-4 border-b border-[var(--hairline)] py-3 text-left transition hover:bg-[var(--paper-deep)]"
      >
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="truncate font-display text-[16px] italic text-[var(--ink)]">
              {row.itemName}
            </span>
            {row.partialCost && (
              <span
                title="Some ingredients have no cost — recipe is partial"
                className="inline-flex items-center gap-1 border border-[var(--accent)] bg-[var(--accent-bg)] px-1 py-0.5 font-mono text-[9px] uppercase text-[var(--accent-dark)]"
              >
                <AlertTriangle className="h-2.5 w-2.5" />
                partial
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-faint)]">
            <span>{row.ingredientCount} ingredient{row.ingredientCount === 1 ? "" : "s"}</span>
            {row.qtySold > 0 && (
              <>
                <span>·</span>
                <span>{row.qtySold} sold (30d)</span>
              </>
            )}
            {row.sellSourceName && row.sellSourceName !== row.itemName && (
              <>
                <span>·</span>
                <span title={`Sell price derived from Otter item: ${row.sellSourceName}`}>
                  via "{row.sellSourceName}"
                </span>
              </>
            )}
          </div>
        </div>
        <span className="text-right font-mono text-[13px] tabular-nums text-[var(--ink)]">
          {sell != null ? `$${sell.toFixed(2)}` : <span className="text-[var(--ink-faint)]">—</span>}
        </span>
        <span className="text-right font-mono text-[13px] tabular-nums text-[var(--ink)]">
          {cost != null ? `$${cost.toFixed(2)}` : <span className="text-[var(--ink-faint)]">—</span>}
        </span>
        <span className={cn("text-right font-mono text-[13px] tabular-nums", marginTone)}>
          {marginPct != null ? `${marginPct.toFixed(1)}%` : "—"}
        </span>
        <ChevronRight className="h-4 w-4 text-[var(--ink-faint)] transition group-hover:translate-x-0.5 group-hover:text-[var(--ink)]" />
      </button>
    </li>
  )
}
