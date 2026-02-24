"use client"

import { useMemo, useState } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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

export function MenuItemsTable({ data, className, onItemClick }: MenuItemsTableProps) {
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
        <div className="max-h-[500px] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead
                  className="pl-6 cursor-pointer select-none"
                  onClick={() => handleSort("itemName")}
                >
                  <div className="flex items-center gap-1">
                    Item <SortIcon column="itemName" />
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none"
                  onClick={() => handleSort("category")}
                >
                  <div className="flex items-center gap-1">
                    Category <SortIcon column="category" />
                  </div>
                </TableHead>
                {([
                  ["fpQuantitySold", "FP Qty"],
                  ["tpQuantitySold", "3P Qty"],
                  ["totalQuantitySold", "Total Qty"],
                  ["fpSales", "FP Sales"],
                  ["tpSales", "3P Sales"],
                  ["totalSales", "Total Sales"],
                  ["avgPricePerUnit", "Avg Price"],
                  ["fpShare", "FP %"],
                ] as [SortKey, string][]).map(([key, label]) => (
                  <TableHead
                    key={key}
                    className="text-right cursor-pointer select-none"
                    onClick={() => handleSort(key)}
                  >
                    <div className="flex items-center justify-end gap-1">
                      {label} <SortIcon column={key} />
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((item, idx) => (
                <TableRow key={`${item.category}-${item.itemName}-${idx}`}>
                  <TableCell className="pl-6 font-medium">
                    {onItemClick ? (
                      <button
                        type="button"
                        onClick={() => onItemClick(item.itemName, item.category)}
                        className="text-left hover:underline hover:text-primary cursor-pointer transition-colors"
                      >
                        {item.itemName}
                      </button>
                    ) : (
                      item.itemName
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{item.category}</TableCell>
                  <TableCell className="text-right font-mono-numbers">{formatNumber(item.fpQuantitySold)}</TableCell>
                  <TableCell className="text-right font-mono-numbers">{formatNumber(item.tpQuantitySold)}</TableCell>
                  <TableCell className="text-right font-mono-numbers font-medium">{formatNumber(item.totalQuantitySold)}</TableCell>
                  <TableCell className="text-right font-mono-numbers">{formatCurrency(item.fpSales)}</TableCell>
                  <TableCell className="text-right font-mono-numbers">{formatCurrency(item.tpSales)}</TableCell>
                  <TableCell className="text-right font-mono-numbers font-medium">{formatCurrency(item.totalSales)}</TableCell>
                  <TableCell className="text-right font-mono-numbers">{formatCurrency(item.avgPricePerUnit)}</TableCell>
                  <TableCell className="text-right font-mono-numbers">
                    <span className={cn(
                      item.fpShare >= 70 ? "text-chart-1" :
                      item.tpShare >= 70 ? "text-chart-5" :
                      "text-muted-foreground"
                    )}>
                      {item.fpShare.toFixed(0)}%
                    </span>
                  </TableCell>
                </TableRow>
              ))}
              {/* Totals row */}
              <TableRow className="bg-muted/30 font-medium border-t-2">
                <TableCell className="pl-6">Total</TableCell>
                <TableCell />
                <TableCell className="text-right font-mono-numbers">{formatNumber(totals.fpQuantitySold)}</TableCell>
                <TableCell className="text-right font-mono-numbers">{formatNumber(totals.tpQuantitySold)}</TableCell>
                <TableCell className="text-right font-mono-numbers">{formatNumber(totals.totalQuantitySold)}</TableCell>
                <TableCell className="text-right font-mono-numbers">{formatCurrency(totals.fpSales)}</TableCell>
                <TableCell className="text-right font-mono-numbers">{formatCurrency(totals.tpSales)}</TableCell>
                <TableCell className="text-right font-mono-numbers">{formatCurrency(totals.totalSales)}</TableCell>
                <TableCell />
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
