"use client"

import { useState, useTransition, memo } from "react"
import { ChevronRight, Store } from "lucide-react"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatCurrency, formatNumber } from "@/lib/format"
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
      // Always fetch today's data regardless of dashboard date range
      const today = new Date().toISOString().split("T")[0]
      const result = await getMenuCategoryAnalytics(
        storeId,
        { startDate: today, endDate: today },
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
    <Card className={cn("flex flex-col", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Menu Categories</CardTitle>
          {stores.length > 1 && (
            <Select value={selectedStore} onValueChange={handleStoreChange}>
              <SelectTrigger className="h-7 w-[140px] text-xs">
                <Store className="mr-1 h-3 w-3 text-muted-foreground" />
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
      </CardHeader>
      <CardContent className={cn("flex-1 px-0 pb-0", isPending && "opacity-50 pointer-events-none")}>
        <div className="max-h-[340px] lg:max-h-[280px] overflow-y-auto">
          {data.categories.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              No menu data available
            </div>
          ) : (
            <div className="divide-y divide-border/50">
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
          <div className="border-t border-border bg-muted/30 px-4 py-2.5 flex items-center justify-between text-xs font-semibold">
            <span>Total</span>
            <div className="flex items-center gap-4 tabular-nums">
              <span>{formatNumber(data.totals.totalQuantitySold)} qty</span>
              <span>{formatCurrency(totalSales)}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
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
  const pct = totalSales > 0 ? (category.totalSales / totalSales) * 100 : 0

  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/50 transition-colors"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
            isExpanded && "rotate-90"
          )}
        />
        <span className="flex-1 text-sm font-medium truncate">{category.category}</span>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatNumber(category.totalQuantitySold)}
          </span>
          <span className="text-xs font-medium tabular-nums w-[72px] text-right">
            {formatCurrency(category.totalSales)}
          </span>
          {/* Contribution bar */}
          <div className="hidden sm:flex items-center gap-1.5 w-[80px]">
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary/70 transition-all duration-300"
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
            <span className="text-[10px] tabular-nums text-muted-foreground w-[30px] text-right">
              {pct.toFixed(0)}%
            </span>
          </div>
        </div>
      </button>
      {isExpanded && category.items.length > 0 && (
        <div className="bg-muted/20">
          {category.items.map((item) => {
            const itemPct = totalSales > 0 ? (item.totalSales / totalSales) * 100 : 0
            return (
              <div
                key={item.itemName}
                className="flex items-center gap-2 pl-9 pr-4 py-1.5"
              >
                <span className="flex-1 text-xs text-muted-foreground truncate">
                  {item.itemName}
                </span>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-[11px] tabular-nums text-muted-foreground/70">
                    {formatNumber(item.totalQuantitySold)}
                  </span>
                  <span className="text-[11px] tabular-nums text-muted-foreground w-[72px] text-right">
                    {formatCurrency(item.totalSales)}
                  </span>
                  <div className="hidden sm:flex items-center gap-1.5 w-[80px]">
                    <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary/40 transition-all duration-300"
                        style={{ width: `${Math.min(itemPct, 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] tabular-nums text-muted-foreground/60 w-[30px] text-right">
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
