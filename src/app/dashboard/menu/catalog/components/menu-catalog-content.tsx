"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertTriangle, ArrowDown, ArrowUp, ChevronRight, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { marginBandClass } from "@/lib/menu-margin"

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

type AttentionKey = "missing" | "partial" | "lowMargin" | "topProfit" | "noSales"

type EnrichedRow = MenuCatalogRow & {
  marginPct: number | null
  profit30d: number | null
  contribution: number | null
  hasMissingCost: boolean
  attention: Set<AttentionKey>
}

type SortKey = "name" | "sell" | "cost" | "profit" | "contribution" | "margin"
type SortDir = "asc" | "desc"

const SORT_STORAGE_KEY = "menu-catalog-sort-v1"

const DEFAULT_SORT: { key: SortKey; dir: SortDir } = { key: "profit", dir: "desc" }

const ATTENTION_CONFIG: Array<{
  key: AttentionKey
  label: string
  tone: "red" | "amber" | "ink"
}> = [
  { key: "missing", label: "Missing cost", tone: "red" },
  { key: "partial", label: "Partial recipe", tone: "amber" },
  { key: "lowMargin", label: "< 50% margin", tone: "amber" },
  { key: "topProfit", label: "Top 10 profit", tone: "ink" },
  { key: "noSales", label: "No sales (30d)", tone: "ink" },
]

type Props = {
  rows: MenuCatalogRow[]
}

export function MenuCatalogContent({ rows }: Props) {
  const [query, setQuery] = useState("")
  const [activeCategory, setActiveCategory] = useState<string | "all">("all")
  const [activeAttention, setActiveAttention] = useState<Set<AttentionKey>>(
    () => new Set()
  )
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>(DEFAULT_SORT)

  // Restore sort preference after mount (avoids SSR/client mismatch).
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(SORT_STORAGE_KEY)
      if (!stored) return
      const parsed = JSON.parse(stored)
      if (parsed?.key && parsed?.dir) setSort(parsed)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    try {
      sessionStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(sort))
    } catch {
      // ignore
    }
  }, [sort])

  const enriched = useMemo(() => enrichRows(rows), [rows])

  const categories = useMemo(() => {
    const seen = new Set<string>()
    for (const r of enriched) seen.add(r.category)
    return Array.from(seen).sort((a, b) => a.localeCompare(b))
  }, [enriched])

  const attentionCounts = useMemo(() => {
    const counts: Record<AttentionKey, number> = {
      missing: 0,
      partial: 0,
      lowMargin: 0,
      topProfit: 0,
      noSales: 0,
    }
    for (const r of enriched) {
      for (const k of r.attention) counts[k] += 1
    }
    return counts
  }, [enriched])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return enriched.filter((r) => {
      if (activeCategory !== "all" && r.category !== activeCategory) return false
      if (activeAttention.size > 0) {
        for (const a of activeAttention) {
          if (!r.attention.has(a)) return false
        }
      }
      if (!q) return true
      return (
        r.itemName.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q)
      )
    })
  }, [enriched, query, activeCategory, activeAttention])

  const sorted = useMemo(() => sortRows(filtered, sort), [filtered, sort])

  const totals = useMemo(() => {
    let profit = 0
    let revenue = 0
    let cost = 0
    for (const r of enriched) {
      if (r.profit30d != null) profit += r.profit30d
      if (r.sellPrice != null) revenue += r.sellPrice * r.qtySold
      if (r.computedCost != null) cost += r.computedCost * r.qtySold
    }
    const blendedMargin = revenue > 0 ? ((revenue - cost) / revenue) * 100 : null
    return { profit, revenue, blendedMargin }
  }, [enriched])

  const toggleAttention = (key: AttentionKey) => {
    setActiveAttention((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleSort = (key: SortKey) => {
    setSort((prev) => {
      if (prev.key !== key) {
        // First click on a new column: default to desc for numeric, asc for name.
        return { key, dir: key === "name" ? "asc" : "desc" }
      }
      return { key, dir: prev.dir === "desc" ? "asc" : "desc" }
    })
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b border-[var(--hairline)] bg-[var(--paper)] px-8 py-3">
        <div className="mb-2 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          <span className="tabular-nums text-[var(--ink-muted)]">
            {enriched.length} items
          </span>
          {totals.blendedMargin != null && (
            <>
              <span className="inline-block h-[3px] w-[3px] rotate-45 bg-[var(--ink-faint)]" />
              <span className="tabular-nums">
                {totals.blendedMargin.toFixed(1)}% blended margin
              </span>
            </>
          )}
          {totals.profit > 0 && (
            <>
              <span className="inline-block h-[3px] w-[3px] rotate-45 bg-[var(--ink-faint)]" />
              <span className="tabular-nums">
                ${Math.round(totals.profit).toLocaleString()} profit 30d
              </span>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CategoryPill
            label="All"
            count={enriched.length}
            active={activeCategory === "all"}
            onClick={() => setActiveCategory("all")}
          />
          {categories.map((cat) => (
            <CategoryPill
              key={cat}
              label={cat}
              count={enriched.filter((r) => r.category === cat).length}
              active={activeCategory === cat}
              onClick={() => setActiveCategory(cat)}
            />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            Attention
          </span>
          {ATTENTION_CONFIG.map((cfg) => (
            <AttentionPill
              key={cfg.key}
              label={cfg.label}
              count={attentionCounts[cfg.key]}
              tone={cfg.tone}
              active={activeAttention.has(cfg.key)}
              onClick={() => toggleAttention(cfg.key)}
            />
          ))}
          {activeAttention.size > 0 && (
            <button
              type="button"
              onClick={() => setActiveAttention(new Set())}
              className="ml-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--ink-faint)] underline-offset-2 hover:underline"
            >
              clear
            </button>
          )}
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
            {sorted.length} shown
          </span>
        </div>

        <HeaderRow sort={sort} onSort={handleSort} />

        {sorted.length === 0 ? (
          <div className="mt-6 border border-dashed border-[var(--hairline-bold)] px-8 py-16 text-center">
            <div className="editorial-section-label">§ empty</div>
            <h2 className="mt-2 font-display text-[26px] italic text-[var(--ink)]">
              No menu items match.
            </h2>
            <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">
              Try a different search, category, or attention filter.
            </p>
          </div>
        ) : (
          <ul>
            {sorted.map((r) => (
              <MenuRow
                key={r.id}
                row={r}
                showCategory={activeCategory === "all"}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ---- helpers ------------------------------------------------------------

function enrichRows(rows: MenuCatalogRow[]): EnrichedRow[] {
  const derived = rows.map<EnrichedRow>((r) => {
    const hasMissingCost = r.computedCost == null
    const marginPct =
      r.computedCost != null && r.sellPrice != null && r.sellPrice > 0
        ? ((r.sellPrice - r.computedCost) / r.sellPrice) * 100
        : null
    const profit30d =
      r.computedCost != null && r.sellPrice != null
        ? (r.sellPrice - r.computedCost) * r.qtySold
        : null
    return {
      ...r,
      hasMissingCost,
      marginPct,
      profit30d,
      contribution: null,
      attention: new Set<AttentionKey>(),
    }
  })

  const totalProfit = derived.reduce((acc, r) => acc + Math.max(0, r.profit30d ?? 0), 0)

  const topProfitIds = new Set(
    [...derived]
      .filter((r) => r.profit30d != null)
      .sort((a, b) => (b.profit30d ?? 0) - (a.profit30d ?? 0))
      .slice(0, 10)
      .map((r) => r.id)
  )

  for (const r of derived) {
    const attention = new Set<AttentionKey>()
    if (r.hasMissingCost) attention.add("missing")
    if (r.partialCost && !r.hasMissingCost) attention.add("partial")
    if (r.marginPct != null && r.marginPct < 50) attention.add("lowMargin")
    if (topProfitIds.has(r.id)) attention.add("topProfit")
    if (r.qtySold === 0) attention.add("noSales")
    r.attention = attention
    r.contribution =
      totalProfit > 0 && r.profit30d != null && r.profit30d > 0
        ? (r.profit30d / totalProfit) * 100
        : null
  }

  return derived
}

function sortRows(
  rows: EnrichedRow[],
  sort: { key: SortKey; dir: SortDir }
): EnrichedRow[] {
  const mul = sort.dir === "asc" ? 1 : -1
  const getKey = (r: EnrichedRow): number | string | null => {
    switch (sort.key) {
      case "name":
        return r.itemName.toLowerCase()
      case "sell":
        return r.sellPrice
      case "cost":
        return r.computedCost
      case "profit":
        return r.profit30d
      case "contribution":
        return r.contribution
      case "margin":
        return r.marginPct
    }
  }
  // Stable-ish sort: always tie-break by name asc.
  const indexed = rows.map((r, i) => ({ r, i }))
  indexed.sort((a, b) => {
    const av = getKey(a.r)
    const bv = getKey(b.r)
    const aNull = av == null
    const bNull = bv == null
    if (aNull && bNull) return a.r.itemName.localeCompare(b.r.itemName)
    if (aNull) return 1 // nulls always last
    if (bNull) return -1
    if (typeof av === "number" && typeof bv === "number") {
      if (av === bv) return a.r.itemName.localeCompare(b.r.itemName)
      return (av - bv) * mul
    }
    const aStr = String(av)
    const bStr = String(bv)
    if (aStr === bStr) return a.i - b.i
    return aStr.localeCompare(bStr) * mul
  })
  return indexed.map((x) => x.r)
}

// ---- subcomponents ------------------------------------------------------

function CategoryPill({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] transition",
        active
          ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]"
          : "border-[var(--hairline-bold)] text-[var(--ink-muted)] hover:border-[var(--ink)] hover:text-[var(--ink)]"
      )}
    >
      {label}
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
}

function AttentionPill({
  label,
  count,
  tone,
  active,
  onClick,
}: {
  label: string
  count: number
  tone: "red" | "amber" | "ink"
  active: boolean
  onClick: () => void
}) {
  const disabled = count === 0 && !active
  const base =
    "inline-flex items-center gap-2 border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition disabled:cursor-not-allowed disabled:opacity-40"
  const activeCls =
    tone === "red"
      ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--paper)]"
      : tone === "amber"
        ? "border-amber-700 bg-amber-700 text-[var(--paper)]"
        : "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]"
  const inactiveCls =
    tone === "red"
      ? "border-[var(--accent)] text-[var(--accent-dark)] hover:bg-[var(--accent-bg)]"
      : tone === "amber"
        ? "border-amber-700/60 text-amber-800 hover:bg-amber-50"
        : "border-[var(--hairline-bold)] text-[var(--ink-muted)] hover:border-[var(--ink)] hover:text-[var(--ink)]"
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(base, active ? activeCls : inactiveCls)}
    >
      {label}
      <span
        className={cn(
          "tabular-nums",
          active ? "text-[var(--paper)]/75" : "text-[var(--ink-faint)]"
        )}
      >
        {count}
      </span>
    </button>
  )
}

const GRID_COLS =
  "grid-cols-[minmax(0,1fr)_88px_88px_112px_80px_88px_20px]"

function HeaderRow({
  sort,
  onSort,
}: {
  sort: { key: SortKey; dir: SortDir }
  onSort: (key: SortKey) => void
}) {
  return (
    <div
      className={cn(
        "grid gap-4 border-b border-[var(--hairline)] pb-2 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--ink-faint)]",
        GRID_COLS
      )}
    >
      <SortHeader label="Item" align="left" sortKey="name" sort={sort} onSort={onSort} />
      <SortHeader label="Sell" align="right" sortKey="sell" sort={sort} onSort={onSort} />
      <SortHeader label="Cost" align="right" sortKey="cost" sort={sort} onSort={onSort} />
      <SortHeader label="Profit 30d" align="right" sortKey="profit" sort={sort} onSort={onSort} />
      <SortHeader label="% P&L" align="right" sortKey="contribution" sort={sort} onSort={onSort} />
      <SortHeader label="Margin" align="right" sortKey="margin" sort={sort} onSort={onSort} />
      <span />
    </div>
  )
}

function SortHeader({
  label,
  align,
  sortKey,
  sort,
  onSort,
}: {
  label: string
  align: "left" | "right"
  sortKey: SortKey
  sort: { key: SortKey; dir: SortDir }
  onSort: (key: SortKey) => void
}) {
  const active = sort.key === sortKey
  const Arrow = active ? (sort.dir === "desc" ? ArrowDown : ArrowUp) : null
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={cn(
        "inline-flex items-center gap-1 transition hover:text-[var(--ink)]",
        align === "right" ? "justify-end" : "justify-start",
        active && "text-[var(--ink)]"
      )}
    >
      {label}
      {Arrow && <Arrow className="h-2.5 w-2.5" />}
    </button>
  )
}

function MenuRow({
  row,
  showCategory,
}: {
  row: EnrichedRow
  showCategory: boolean
}) {
  const { computedCost: cost, sellPrice: sell, marginPct, profit30d, contribution } = row
  const router = useRouter()
  const href = `/dashboard/menu/catalog/${row.id}`

  return (
    <li>
      <Link
        href={href}
        prefetch={false}
        onMouseEnter={() => router.prefetch(href)}
        onFocus={() => router.prefetch(href)}
        className={cn(
          "group grid w-full items-start gap-4 border-b border-[var(--hairline)] py-3 text-left transition hover:bg-[var(--paper-deep)]",
          GRID_COLS
        )}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-display text-[16px] italic leading-snug text-[var(--ink)] break-words">
              {row.itemName}
            </span>
            {row.hasMissingCost ? (
              <span
                title="No cost is set for this recipe"
                className="inline-flex items-center gap-1 border border-[var(--accent)] bg-[var(--accent)] px-1 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--paper)] whitespace-nowrap"
              >
                <AlertTriangle className="h-2.5 w-2.5" />
                missing
              </span>
            ) : row.partialCost ? (
              <span
                title="Some ingredients have no cost — recipe is partial"
                className="inline-flex items-center gap-1 border border-[var(--accent)] bg-[var(--accent-bg)] px-1 py-0.5 font-mono text-[9px] uppercase text-[var(--accent-dark)] whitespace-nowrap"
              >
                <AlertTriangle className="h-2.5 w-2.5" />
                partial
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-faint)]">
            {showCategory && (
              <>
                <span className="text-[var(--ink-muted)]">{row.category}</span>
                <span>·</span>
              </>
            )}
            <span>
              {row.ingredientCount} ingredient{row.ingredientCount === 1 ? "" : "s"}
            </span>
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
                  via &ldquo;{row.sellSourceName}&rdquo;
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
        <span className="text-right font-mono text-[13px] tabular-nums text-[var(--ink)]">
          {profit30d != null ? (
            `$${Math.round(profit30d).toLocaleString()}`
          ) : (
            <span className="text-[var(--ink-faint)]">—</span>
          )}
        </span>
        <span className="text-right font-mono text-[12px] tabular-nums text-[var(--ink-muted)]">
          {contribution != null ? (
            `${contribution.toFixed(1)}%`
          ) : (
            <span className="text-[var(--ink-faint)]">—</span>
          )}
        </span>
        <span
          className={cn(
            "text-right font-mono text-[13px] tabular-nums",
            marginBandClass(marginPct)
          )}
        >
          {marginPct != null ? `${marginPct.toFixed(1)}%` : "—"}
        </span>
        <ChevronRight className="mt-1 h-4 w-4 text-[var(--ink-faint)] transition group-hover:translate-x-0.5 group-hover:text-[var(--ink)]" />
      </Link>
    </li>
  )
}
