"use client"

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Search
} from "lucide-react"
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

type AttentionKey =
  | "missing"
  | "partial"
  | "lowMargin"
  | "topProfit"
  | "noSales"

type EnrichedRow = MenuCatalogRow & {
  marginPct: number | null
  profit30d: number | null
  contribution: number | null
  hasMissingCost: boolean
  searchText: string
  attention: Set<AttentionKey>
}

type SortKey = "name" | "sell" | "cost" | "profit" | "contribution" | "margin"
type SortDir = "asc" | "desc"

const SORT_STORAGE_KEY = "menu-catalog-sort-v1"

const DEFAULT_SORT: { key: SortKey; dir: SortDir } = {
  key: "profit",
  dir: "desc"
}

const ATTENTION_CONFIG: Array<{
  key: AttentionKey
  label: string
  tone: "alert" | "warn" | "ink"
}> = [
  { key: "missing", label: "Missing cost", tone: "alert" },
  { key: "partial", label: "Partial recipe", tone: "warn" },
  { key: "lowMargin", label: "< 50% margin", tone: "warn" },
  { key: "topProfit", label: "Top 10 profit", tone: "ink" },
  { key: "noSales", label: "No sales (30d)", tone: "ink" }
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
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const deferredQuery = useDeferredValue(query)

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
    const counts = new Map<string, number>()
    for (const r of enriched)
      counts.set(r.category, (counts.get(r.category) ?? 0) + 1)
    return Array.from(counts.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [enriched])

  const attentionCounts = useMemo(() => {
    const counts: Record<AttentionKey, number> = {
      missing: 0,
      partial: 0,
      lowMargin: 0,
      topProfit: 0,
      noSales: 0
    }
    for (const r of enriched) {
      for (const k of r.attention) counts[k] += 1
    }
    return counts
  }, [enriched])

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase()
    return enriched.filter((r) => {
      if (activeCategory !== "all" && r.category !== activeCategory)
        return false
      if (activeAttention.size > 0) {
        for (const a of activeAttention) {
          if (!r.attention.has(a)) return false
        }
      }
      if (!q) return true
      return r.searchText.includes(q)
    })
  }, [enriched, deferredQuery, activeCategory, activeAttention])

  const sorted = useMemo(() => sortRows(filtered, sort), [filtered, sort])
  const rowVirtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 78,
    overscan: 8
  })

  const totals = useMemo(() => {
    let profit = 0
    let revenue = 0
    let cost = 0
    for (const r of enriched) {
      if (r.profit30d != null) profit += r.profit30d
      if (r.sellPrice != null) revenue += r.sellPrice * r.qtySold
      if (r.computedCost != null) cost += r.computedCost * r.qtySold
    }
    const blendedMargin =
      revenue > 0 ? ((revenue - cost) / revenue) * 100 : null
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
      <div className="menu-catalog-controls dock-in dock-in-1">
        <div
          className="menu-catalog-controls__summary"
          aria-label="Menu catalog summary"
        >
          <MetricStamp label="Items" value={enriched.length.toLocaleString()} />
          {totals.blendedMargin != null && (
            <MetricStamp
              label="Blended margin"
              value={`${totals.blendedMargin.toFixed(1)}%`}
            />
          )}
          {totals.profit > 0 && (
            <MetricStamp
              label="Profit 30d"
              value={`$${Math.round(totals.profit).toLocaleString()}`}
            />
          )}
        </div>
        <div className="menu-catalog-controls__section">
          <span className="menu-catalog-controls__label">Category</span>
          <div
            className="menu-catalog-controls__scroll"
            role="list"
            aria-label="Category filters"
          >
            <CategoryPill
              label="All"
              count={enriched.length}
              active={activeCategory === "all"}
              onClick={() => setActiveCategory("all")}
            />
            {categories.map(([cat, count]) => (
              <CategoryPill
                key={cat}
                label={cat}
                count={count}
                active={activeCategory === cat}
                onClick={() => setActiveCategory(cat)}
              />
            ))}
          </div>
        </div>
        <div className="menu-catalog-controls__section menu-catalog-controls__section--attention">
          <span className="menu-catalog-controls__label">Attention</span>
          <div
            className="menu-catalog-controls__scroll"
            role="list"
            aria-label="Attention filters"
          >
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
                className="toolbar-btn menu-filter-clear"
              >
                Clear attention
              </button>
            )}
          </div>
        </div>
      </div>

      <div
        ref={scrollRef}
        data-perf-scroll
        className="flex-1 overflow-y-auto bg-[var(--paper)] px-4 py-5 sm:px-8 sm:py-7"
      >
        <div className="menu-catalog-workbench dock-in dock-in-2">
          <label className="search-shell menu-catalog-search">
            <Search
              className="h-3.5 w-3.5 text-[var(--ink-muted)]"
              aria-hidden="true"
            />
            <input
              type="search"
              placeholder="Search menu items"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <span className="kbd-chip tabular-nums">{sorted.length} shown</span>
          </label>
          {query.trim() && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="toolbar-btn menu-filter-clear"
            >
              Clear search
            </button>
          )}
        </div>

        <HeaderRow sort={sort} onSort={handleSort} />

        {sorted.length === 0 ? (
          <div className="inv-empty menu-catalog-empty">
            <div className="inv-empty__mark">§</div>
            <h2 className="inv-empty__title">No menu items match.</h2>
            <p className="inv-empty__body">
              Clear the search or loosen the category and attention filters.
            </p>
          </div>
        ) : (
          <ul
            className="menu-catalog-list relative"
            style={{ height: rowVirtualizer.getTotalSize() }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const r = sorted[virtualRow.index]
              return (
                <li
                  key={r.id}
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <MenuRow row={r} showCategory={activeCategory === "all"} />
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function MetricStamp({ label, value }: { label: string; value: string }) {
  return (
    <span className="menu-metric-stamp">
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
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
      searchText: `${r.itemName} ${r.category}`.toLowerCase(),
      attention: new Set<AttentionKey>()
    }
  })

  const totalProfit = derived.reduce(
    (acc, r) => acc + Math.max(0, r.profit30d ?? 0),
    0
  )

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
  onClick
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className="toolbar-btn menu-filter-pill"
      data-active={active ? "true" : undefined}
    >
      {label}
      <span className="menu-filter-pill__count">{count}</span>
    </button>
  )
}

function AttentionPill({
  label,
  count,
  tone,
  active,
  onClick
}: {
  label: string
  count: number
  tone: "alert" | "warn" | "ink"
  active: boolean
  onClick: () => void
}) {
  const disabled = count === 0 && !active
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      className="toolbar-btn menu-filter-pill"
      data-active={active ? "true" : undefined}
      data-tone={tone}
    >
      {label}
      <span className="menu-filter-pill__count">{count}</span>
    </button>
  )
}

function HeaderRow({
  sort,
  onSort
}: {
  sort: { key: SortKey; dir: SortDir }
  onSort: (key: SortKey) => void
}) {
  return (
    <div className="menu-ledger-head">
      <SortHeader
        label="Item"
        align="left"
        sortKey="name"
        sort={sort}
        onSort={onSort}
      />
      <SortHeader
        label="Sell"
        align="right"
        sortKey="sell"
        sort={sort}
        onSort={onSort}
      />
      <SortHeader
        label="Cost"
        align="right"
        sortKey="cost"
        sort={sort}
        onSort={onSort}
      />
      <SortHeader
        label="Profit 30d"
        align="right"
        sortKey="profit"
        sort={sort}
        onSort={onSort}
      />
      <SortHeader
        label="% P&L"
        align="right"
        sortKey="contribution"
        sort={sort}
        onSort={onSort}
      />
      <SortHeader
        label="Margin"
        align="right"
        sortKey="margin"
        sort={sort}
        onSort={onSort}
      />
      <span />
    </div>
  )
}

function SortHeader({
  label,
  align,
  sortKey,
  sort,
  onSort
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
        "inline-flex items-center gap-1 transition hover:text-[var(--ink)] focus-visible:text-[var(--ink)] focus-visible:outline-none",
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
  showCategory
}: {
  row: EnrichedRow
  showCategory: boolean
}) {
  const {
    computedCost: cost,
    sellPrice: sell,
    marginPct,
    profit30d,
    contribution
  } = row
  const router = useRouter()
  const href = `/dashboard/menu/catalog/${row.id}`

  return (
    <Link
      href={href}
      prefetch={false}
      onMouseEnter={() => router.prefetch(href)}
      onFocus={() => router.prefetch(href)}
      className="inv-row menu-row group"
    >
      <div className="menu-row__item min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-display text-[16px] italic leading-snug text-[var(--ink)] break-words">
            {row.itemName}
          </span>
          {row.hasMissingCost ? (
            <span
              title="No cost is set for this recipe"
              className="menu-status"
              data-tone="alert"
            >
              <AlertTriangle className="h-2.5 w-2.5" />
              missing
            </span>
          ) : row.partialCost ? (
            <span
              title="Some ingredients have no cost; recipe is partial"
              className="menu-status"
              data-tone="warn"
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
            {row.ingredientCount} ingredient
            {row.ingredientCount === 1 ? "" : "s"}
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
              <span
                title={`Sell price derived from Otter item: ${row.sellSourceName}`}
              >
                via &ldquo;{row.sellSourceName}&rdquo;
              </span>
            </>
          )}
        </div>
      </div>
      <span className="menu-row__sell menu-row__figure text-right text-[13px] tabular-nums text-[var(--ink)]">
        {sell != null ? (
          `$${sell.toFixed(2)}`
        ) : (
          <span className="text-[var(--ink-faint)]">-</span>
        )}
      </span>
      <span className="menu-row__cost menu-row__figure text-right text-[13px] tabular-nums text-[var(--ink)]">
        {cost != null ? (
          `$${cost.toFixed(2)}`
        ) : (
          <span className="text-[var(--ink-faint)]">-</span>
        )}
      </span>
      <span className="inv-row__total menu-row__profit menu-row__figure text-right text-[13px] tabular-nums text-[var(--ink)]">
        {profit30d != null ? (
          `$${Math.round(profit30d).toLocaleString()}`
        ) : (
          <span className="text-[var(--ink-faint)]">-</span>
        )}
      </span>
      <span className="menu-row__contribution menu-row__figure text-right text-[12px] tabular-nums text-[var(--ink-muted)]">
        {contribution != null ? (
          `${contribution.toFixed(1)}%`
        ) : (
          <span className="text-[var(--ink-faint)]">-</span>
        )}
      </span>
      <span
        className={cn(
          "menu-row__margin text-right text-[13px] tabular-nums",
          marginBandClass(marginPct)
        )}
      >
        {marginPct != null ? `${marginPct.toFixed(1)}%` : "-"}
      </span>
      <ChevronRight className="inv-row__chev menu-row__chevron h-4 w-4" />
    </Link>
  )
}
