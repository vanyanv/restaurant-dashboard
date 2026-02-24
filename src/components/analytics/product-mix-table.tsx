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
import {
  ChevronRight,
  TrendingUp,
  TrendingDown,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
} from "lucide-react"
import { formatCurrency, formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"
import type {
  ProductMixTableCategory,
  ProductMixTableItem,
} from "@/types/analytics"

interface ProductMixTableProps {
  categories: ProductMixTableCategory[]
  totals: { quantitySold: number; revenue: number; modifierRevenue: number }
  className?: string
}

type SortKey =
  | "itemName"
  | "quantitySold"
  | "revenue"
  | "modifierRevenue"
  | "avgPrice"
  | "percentOfCategoryRevenue"
  | "percentOfTotalRevenue"
  | "fpShare"
  | "periodChange"

type SortDir = "asc" | "desc"

export function ProductMixTable({
  categories,
  totals,
  className,
}: ProductMixTableProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    () => new Set(categories.map((c) => c.category))
  )
  const [search, setSearch] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("revenue")
  const [sortDir, setSortDir] = useState<SortDir>("desc")
  const [categoryFilter, setCategoryFilter] = useState("all")

  const categoryNames = useMemo(() => {
    return categories.map((c) => c.category).sort()
  }, [categories])

  const filteredCategories = useMemo(() => {
    let cats = categories

    if (categoryFilter !== "all") {
      cats = cats.filter((c) => c.category === categoryFilter)
    }

    if (search.trim()) {
      const q = search.toLowerCase()
      cats = cats
        .map((cat) => ({
          ...cat,
          items: cat.items.filter((item) =>
            item.itemName.toLowerCase().includes(q)
          ),
        }))
        .filter((cat) => cat.items.length > 0)
    }

    return cats
  }, [categories, categoryFilter, search])

  const sortedCategories = useMemo(() => {
    return filteredCategories.map((cat) => {
      const sortedItems = [...cat.items].sort((a, b) => {
        let aVal: number | string
        let bVal: number | string

        if (sortKey === "itemName") {
          aVal = a.itemName
          bVal = b.itemName
          return sortDir === "asc"
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal)
        }

        if (sortKey === "fpShare") {
          aVal = a.quantitySold > 0 ? a.fpQuantitySold / a.quantitySold : 0
          bVal = b.quantitySold > 0 ? b.fpQuantitySold / b.quantitySold : 0
        } else if (sortKey === "periodChange") {
          aVal = a.periodChange ?? -Infinity
          bVal = b.periodChange ?? -Infinity
        } else {
          aVal = a[sortKey]
          bVal = b[sortKey]
        }

        return sortDir === "asc"
          ? Number(aVal) - Number(bVal)
          : Number(bVal) - Number(aVal)
      })

      return { ...cat, items: sortedItems }
    })
  }, [filteredCategories, sortKey, sortDir])

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir(key === "itemName" ? "asc" : "desc")
    }
  }

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column)
      return <ArrowUpDown className="h-3 w-3 opacity-40" />
    return sortDir === "asc" ? (
      <ArrowUp className="h-3 w-3" />
    ) : (
      <ArrowDown className="h-3 w-3" />
    )
  }

  const formatFpTpSplit = (fpQty: number, tpQty: number) => {
    const total = fpQty + tpQty
    if (total === 0) return "— / —"
    const fpPct = Math.round((fpQty / total) * 100)
    const tpPct = 100 - fpPct
    return `${fpPct}% / ${tpPct}%`
  }

  const renderChange = (change: number | null) => {
    if (change === null) {
      return <span className="text-muted-foreground">—</span>
    }
    if (change > 0) {
      return (
        <span className="flex items-center justify-end gap-1 text-green-600">
          <TrendingUp className="h-3.5 w-3.5" />
          +{change.toFixed(1)}%
        </span>
      )
    }
    if (change < 0) {
      return (
        <span className="flex items-center justify-end gap-1 text-red-600">
          <TrendingDown className="h-3.5 w-3.5" />
          {change.toFixed(1)}%
        </span>
      )
    }
    return <span className="text-muted-foreground">0.0%</span>
  }

  const totalItemCount = sortedCategories.reduce(
    (sum, cat) => sum + cat.items.length,
    0
  )

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="text-base">Product Mix Breakdown</CardTitle>
            <CardDescription>
              {sortedCategories.length} categories, {totalItemCount} items
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search items..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 w-[160px] pl-8 text-sm"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="h-8 w-[160px] text-sm">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categoryNames.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <div className="max-h-[600px] overflow-auto">
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
                {(
                  [
                    ["quantitySold", "Qty Sold"],
                    ["revenue", "Revenue"],
                    ["modifierRevenue", "Mod. Rev"],
                    ["avgPrice", "Avg Price"],
                    ["percentOfCategoryRevenue", "% of Cat"],
                    ["percentOfTotalRevenue", "% of Total"],
                    ["fpShare", "FP/3P"],
                    ["periodChange", "Change"],
                  ] as [SortKey, string][]
                ).map(([key, label]) => (
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
              {sortedCategories.map((cat) => {
                const isExpanded = expandedCategories.has(cat.category)
                return (
                  <CategoryBlock
                    key={cat.category}
                    category={cat}
                    isExpanded={isExpanded}
                    onToggle={() => toggleCategory(cat.category)}
                    formatFpTpSplit={formatFpTpSplit}
                    renderChange={renderChange}
                  />
                )
              })}
              {/* Grand total row */}
              <TableRow className="font-medium border-t-2">
                <TableCell className="pl-6">Grand Total</TableCell>
                <TableCell className="text-right font-mono-numbers">
                  {formatNumber(totals.quantitySold)}
                </TableCell>
                <TableCell className="text-right font-mono-numbers">
                  {formatCurrency(totals.revenue)}
                </TableCell>
                <TableCell className="text-right font-mono-numbers">
                  {formatCurrency(totals.modifierRevenue)}
                </TableCell>
                <TableCell />
                <TableCell />
                <TableCell />
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

function CategoryBlock({
  category,
  isExpanded,
  onToggle,
  formatFpTpSplit,
  renderChange,
}: {
  category: ProductMixTableCategory
  isExpanded: boolean
  onToggle: () => void
  formatFpTpSplit: (fp: number, tp: number) => string
  renderChange: (change: number | null) => React.ReactNode
}) {
  return (
    <>
      {/* Category row */}
      <TableRow
        className="bg-muted/30 cursor-pointer select-none"
        onClick={onToggle}
      >
        <TableCell className="pl-4 font-bold">
          <div className="flex items-center gap-1.5">
            <ChevronRight
              className={cn(
                "h-4 w-4 shrink-0 transition-transform duration-200",
                isExpanded && "rotate-90"
              )}
            />
            {category.category}
          </div>
        </TableCell>
        <TableCell className="text-right font-mono-numbers font-bold">
          {formatNumber(category.quantitySold)}
        </TableCell>
        <TableCell className="text-right font-mono-numbers font-bold">
          {formatCurrency(category.revenue)}
        </TableCell>
        <TableCell className="text-right font-mono-numbers font-bold">
          {formatCurrency(category.modifierRevenue)}
        </TableCell>
        <TableCell />
        <TableCell className="text-right font-mono-numbers text-muted-foreground">
          —
        </TableCell>
        <TableCell className="text-right font-mono-numbers font-bold">
          {category.percentOfTotalRevenue.toFixed(1)}%
        </TableCell>
        <TableCell className="text-right font-mono-numbers font-bold">
          {formatFpTpSplit(category.fpQuantitySold, category.tpQuantitySold)}
        </TableCell>
        <TableCell className="text-right font-mono-numbers font-bold">
          {renderChange(category.periodChange)}
        </TableCell>
      </TableRow>
      {/* Item rows */}
      {isExpanded &&
        category.items.map((item, idx) => (
          <TableRow key={`${item.category}-${item.itemName}-${idx}`}>
            <TableCell className="pl-8">{item.itemName}</TableCell>
            <TableCell className="text-right font-mono-numbers">
              {formatNumber(item.quantitySold)}
            </TableCell>
            <TableCell className="text-right font-mono-numbers">
              {formatCurrency(item.revenue)}
            </TableCell>
            <TableCell className="text-right font-mono-numbers">
              {formatCurrency(item.modifierRevenue)}
            </TableCell>
            <TableCell className="text-right font-mono-numbers">
              {formatCurrency(item.avgPrice)}
            </TableCell>
            <TableCell className="text-right font-mono-numbers">
              {item.percentOfCategoryRevenue.toFixed(1)}%
            </TableCell>
            <TableCell className="text-right font-mono-numbers">
              {item.percentOfTotalRevenue.toFixed(1)}%
            </TableCell>
            <TableCell className="text-right font-mono-numbers">
              {formatFpTpSplit(item.fpQuantitySold, item.tpQuantitySold)}
            </TableCell>
            <TableCell className="text-right font-mono-numbers">
              {renderChange(item.periodChange)}
            </TableCell>
          </TableRow>
        ))}
    </>
  )
}
