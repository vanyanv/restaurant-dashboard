"use client"

import { useId, useState, useTransition, memo } from "react"
import { ChevronRight, Store } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatCurrency, formatNumber } from "@/lib/format"
import { formatDateRange } from "@/lib/dashboard-utils"
import { getMenuCategoryAnalytics } from "@/app/actions/store-actions"
import type { MenuCategoryData, MenuCategoryWithItems } from "@/types/analytics"
import { cn } from "@/lib/utils"

interface StoreOption {
  id: string
  name: string
}

interface MenuCategorySalesCardProps {
  data: MenuCategoryData
  stores: StoreOption[]
  className?: string
}

export function MenuCategorySalesCard({ data: initialData, stores, className }: MenuCategorySalesCardProps) {
  const [data, setData] = useState(initialData)
  const [selectedStore, setSelectedStore] = useState("all")
  const [isPending, startTransition] = useTransition()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Reset data when initialData changes (e.g. parent date range changed)
  const [prevInitial, setPrevInitial] = useState(initialData)
  if (initialData !== prevInitial) {
    setPrevInitial(initialData)
    setData(initialData)
    setSelectedStore("all")
  }

  const handleStoreChange = (value: string) => {
    setSelectedStore(value)
    startTransition(async () => {
      const storeId = value === "all" ? undefined : value
      const result = await getMenuCategoryAnalytics(
        storeId,
        data.dateRange ? { startDate: data.dateRange.startDate, endDate: data.dateRange.endDate } : { days: 1 },
      )
      if (result) setData(result)
    })
  }

  const toggleCategory = (category: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  const totalSales = data.totals.totalSales

  return (
    <section className={cn("inv-panel inv-panel--flush flex flex-col", className)}>
      <header className="inv-panel__head px-4 pt-3">
        <div className="flex items-center justify-between gap-2 w-full">
          <div className="flex items-baseline gap-2">
            <span className="inv-panel__dept">Menu Categories</span>
            {data.dateRange && (
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">
                {formatDateRange(data.dateRange.startDate, data.dateRange.endDate)}
              </span>
            )}
          </div>
          {stores.length > 1 && (
            <Select value={selectedStore} onValueChange={handleStoreChange}>
              <SelectTrigger className="h-7 w-[140px] text-xs">
                <Store className="mr-1 h-3 w-3 text-(--ink-muted)" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stores</SelectItem>
                {stores.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </header>
      <div className={cn("flex-1", isPending && "opacity-50 pointer-events-none")}>
        <div className="max-h-[220px] lg:max-h-[200px] overflow-y-auto">
          {data.categories.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-sm text-(--ink-muted)">
              No menu data available
            </div>
          ) : (
            <div className="divide-y divide-(--hairline)">
              {data.categories.map((cat) => (
                <CategoryRow
                  key={cat.category}
                  category={cat}
                  totalSales={totalSales}
                  isExpanded={expanded.has(cat.category)}
                  onToggle={() => toggleCategory(cat.category)}
                />
              ))}
            </div>
          )}
        </div>
        {/* Totals footer */}
        {data.categories.length > 0 && (
          <div className="border-t border-(--hairline-bold) bg-(--paper-warm) px-4 py-2.5 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-(--ink) font-bold">
              Total
            </span>
            <div className="flex items-center gap-4 tabular-nums text-xs font-semibold">
              <span>{formatNumber(data.totals.totalQuantitySold)} qty</span>
              <span>{formatCurrency(totalSales)}</span>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

const CategoryRow = memo(function CategoryRow({
  category,
  totalSales,
  isExpanded,
  onToggle,
}: {
  category: MenuCategoryWithItems
  totalSales: number
  isExpanded: boolean
  onToggle: () => void
}) {
  const regionId = useId()
  const pct = totalSales > 0 ? (category.totalSales / totalSales) * 100 : 0

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-controls={regionId}
        className="group relative flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-[var(--row-hover-bg)] focus-visible:bg-[var(--row-hover-bg)] focus-visible:outline-none focus-visible:shadow-[inset_3px_0_0_var(--accent)]"
      >
        <span className="absolute left-0 top-[18%] bottom-[18%] w-[3px] origin-center scale-y-0 bg-[var(--accent)] transition-transform duration-200 ease-[cubic-bezier(0.2,0.7,0.2,1)] group-hover:scale-y-100 group-focus-visible:scale-y-100" />
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-[var(--ink-muted)] transition-transform duration-200",
            isExpanded && "rotate-90"
          )}
        />
        <span className="flex-1 text-sm font-medium truncate">{category.category}</span>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs tabular-nums text-[var(--ink-muted)]">
            {formatNumber(category.totalQuantitySold)}
          </span>
          <span className="w-[72px] text-right text-xs font-medium tabular-nums group-hover:text-[var(--accent)] group-focus-visible:text-[var(--accent)]">
            {formatCurrency(category.totalSales)}
          </span>
          {/* Contribution bar */}
          <div className="hidden sm:flex items-center gap-1.5 w-[80px]">
            <div className="flex-1 h-1.5 bg-(--hairline) overflow-hidden">
              <div
                className="h-full bg-(--accent) transition-all duration-300"
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
            <span className="w-[30px] text-right text-[10px] tabular-nums text-(--ink-muted)">
              {pct.toFixed(0)}%
            </span>
          </div>
        </div>
      </button>
      {isExpanded && category.items.length > 0 && (
        <div id={regionId} className="bg-[rgba(26,22,19,0.025)]">
          {category.items.map((item) => {
            const itemPct = totalSales > 0 ? (item.totalSales / totalSales) * 100 : 0
            return (
              <div
                key={item.itemName}
                className="flex items-center gap-2 pl-9 pr-4 py-1.5"
              >
                <span className="flex-1 text-xs text-(--ink-muted) truncate">
                  {item.itemName}
                </span>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-[11px] tabular-nums text-(--ink-faint)">
                    {formatNumber(item.totalQuantitySold)}
                  </span>
                  <span className="text-[11px] tabular-nums text-(--ink-muted) w-[72px] text-right">
                    {formatCurrency(item.totalSales)}
                  </span>
                  <div className="hidden sm:flex items-center gap-1.5 w-[80px]">
                    <div className="flex-1 h-1 bg-(--hairline) overflow-hidden">
                      <div
                        className="h-full bg-(--ink-muted) transition-all duration-300"
                        style={{ width: `${Math.min(itemPct, 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] tabular-nums text-(--ink-faint) w-[30px] text-right">
                      {itemPct.toFixed(0)}%
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
})
