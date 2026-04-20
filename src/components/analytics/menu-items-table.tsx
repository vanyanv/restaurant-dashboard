"use client"

import { memo, useMemo, useRef, useState } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  Card,
  CardContent,
  CardDescription,
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
import { Input } from "@/components/ui/input"
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react"
import { formatCurrency, formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { MenuItemRanked } from "@/types/analytics"

interface MenuItemsTableProps {
  data: MenuItemRanked[]
  className?: string
  onItemClick?: (itemName: string, category: string) => void
}

type SortKey = "itemName" | "category" | "fpQuantitySold" | "tpQuantitySold" | "totalQuantitySold" | "fpSales" | "tpSales" | "totalSales" | "avgPricePerUnit" | "fpShare"
type SortDir = "asc" | "desc"

const ROW_HEIGHT = 56

// Grid template for 10 columns: Item(2fr) Category(1fr) + 8 numeric cols(1fr each)
const GRID_TEMPLATE = "2fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr"

const NUMERIC_HEADERS: [SortKey, string][] = [
  ["fpQuantitySold", "FP Qty"],
  ["tpQuantitySold", "3P Qty"],
  ["totalQuantitySold", "Total Qty"],
  ["fpSales", "FP Sales"],
  ["tpSales", "3P Sales"],
  ["totalSales", "Total Sales"],
  ["avgPricePerUnit", "Avg Price"],
  ["fpShare", "FP %"],
]

function MenuItemsTableImpl({ data, className, onItemClick }: MenuItemsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("totalQuantitySold")
  const [sortDir, setSortDir] = useState<SortDir>("desc")
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [search, setSearch] = useState("")

  const categories = useMemo(() => {
    const cats = new Set(data.map((i) => i.category))
    return Array.from(cats).sort()
  }, [data])

  const filtered = useMemo(() => {
    let items = data
    if (categoryFilter !== "all") {
      items = items.filter((i) => i.category === categoryFilter)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter((i) => i.itemName.toLowerCase().includes(q))
    }
    return items
  }, [data, categoryFilter, search])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const aVal = a[sortKey]
      const bVal = b[sortKey]
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDir === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal)
      }
      const aNum = Number(aVal)
      const bNum = Number(bVal)
      return sortDir === "asc" ? aNum - bNum : bNum - aNum
    })
  }, [filtered, sortKey, sortDir])

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, i) => ({
        fpQuantitySold: acc.fpQuantitySold + i.fpQuantitySold,
        tpQuantitySold: acc.tpQuantitySold + i.tpQuantitySold,
        totalQuantitySold: acc.totalQuantitySold + i.totalQuantitySold,
        fpSales: acc.fpSales + i.fpSales,
        tpSales: acc.tpSales + i.tpSales,
        totalSales: acc.totalSales + i.totalSales,
      }),
      { fpQuantitySold: 0, tpQuantitySold: 0, totalQuantitySold: 0, fpSales: 0, tpSales: 0, totalSales: 0 }
    )
  }, [filtered])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir(key === "itemName" || key === "category" ? "asc" : "desc")
    }
  }

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) return <ArrowUpDown className="h-3 w-3 opacity-40" />
    return sortDir === "asc"
      ? <ArrowUp className="h-3 w-3" />
      : <ArrowDown className="h-3 w-3" />
  }

  const parentRef = useRef<HTMLDivElement>(null)
  const rowVirtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  })

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="text-base">All Menu Items</CardTitle>
            <CardDescription>{sorted.length} items</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Input
              placeholder="Search items..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-[160px] text-sm"
            />
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="h-8 w-[160px] text-sm">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <div className="rounded-md border-0">
          {/* Sticky header */}
          <div
            className="grid items-center border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground sticky top-0 z-10"
            style={{ gridTemplateColumns: GRID_TEMPLATE }}
          >
            <button
              type="button"
              className="flex items-center gap-1 cursor-pointer select-none pl-2 text-left"
              onClick={() => handleSort("itemName")}
            >
              Item <SortIcon column="itemName" />
            </button>
            <button
              type="button"
              className="flex items-center gap-1 cursor-pointer select-none text-left"
              onClick={() => handleSort("category")}
            >
              Category <SortIcon column="category" />
            </button>
            {NUMERIC_HEADERS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                className="flex items-center justify-end gap-1 cursor-pointer select-none text-right"
                onClick={() => handleSort(key)}
              >
                {label} <SortIcon column={key} />
              </button>
            ))}
          </div>

          {/* Virtualized rows */}
          <div
            ref={parentRef}
            className="max-h-125 overflow-auto"
            style={{ contain: "strict" }}
          >
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {rowVirtualizer.getVirtualItems().map((vi) => {
                const item = sorted[vi.index]
                return (
                  <div
                    key={`${item.category}-${item.itemName}-${vi.index}`}
                    className="grid items-center border-b px-4 text-sm hover:bg-muted/30 cursor-pointer"
                    onClick={() => onItemClick?.(item.itemName, item.category)}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: `${vi.size}px`,
                      transform: `translateY(${vi.start}px)`,
                      gridTemplateColumns: GRID_TEMPLATE,
                    }}
                  >
                    <span className="pl-2 font-medium truncate">
                      {onItemClick ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            onItemClick(item.itemName, item.category)
                          }}
                          className="text-left hover:underline hover:text-primary cursor-pointer transition-colors"
                        >
                          {item.itemName}
                        </button>
                      ) : (
                        item.itemName
                      )}
                    </span>
                    <span className="text-muted-foreground truncate">{item.category}</span>
                    <span className="text-right font-mono-numbers">{formatNumber(item.fpQuantitySold)}</span>
                    <span className="text-right font-mono-numbers">{formatNumber(item.tpQuantitySold)}</span>
                    <span className="text-right font-mono-numbers font-medium">{formatNumber(item.totalQuantitySold)}</span>
                    <span className="text-right font-mono-numbers">{formatCurrency(item.fpSales)}</span>
                    <span className="text-right font-mono-numbers">{formatCurrency(item.tpSales)}</span>
                    <span className="text-right font-mono-numbers font-medium">{formatCurrency(item.totalSales)}</span>
                    <span className="text-right font-mono-numbers">{formatCurrency(item.avgPricePerUnit)}</span>
                    <span className="text-right font-mono-numbers">
                      <span className={cn(
                        item.fpShare >= 70 ? "text-chart-1" :
                        item.tpShare >= 70 ? "text-chart-5" :
                        "text-muted-foreground"
                      )}>
                        {item.fpShare.toFixed(0)}%
                      </span>
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Totals row — always rendered outside the virtualizer */}
          <div
            className="grid items-center bg-muted/30 font-medium border-t-2 px-4 text-sm"
            style={{
              gridTemplateColumns: GRID_TEMPLATE,
              height: `${ROW_HEIGHT}px`,
            }}
          >
            <span className="pl-2">Total</span>
            <span />
            <span className="text-right font-mono-numbers">{formatNumber(totals.fpQuantitySold)}</span>
            <span className="text-right font-mono-numbers">{formatNumber(totals.tpQuantitySold)}</span>
            <span className="text-right font-mono-numbers">{formatNumber(totals.totalQuantitySold)}</span>
            <span className="text-right font-mono-numbers">{formatCurrency(totals.fpSales)}</span>
            <span className="text-right font-mono-numbers">{formatCurrency(totals.tpSales)}</span>
            <span className="text-right font-mono-numbers">{formatCurrency(totals.totalSales)}</span>
            <span />
            <span />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export const MenuItemsTable = memo(MenuItemsTableImpl)
