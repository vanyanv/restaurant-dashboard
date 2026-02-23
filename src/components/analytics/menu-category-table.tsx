"use client"

import { useState, memo } from "react"
import { ChevronRight } from "lucide-react"
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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatCurrency, formatNumber } from "@/lib/format"
import type { MenuCategoryData } from "@/types/analytics"

interface MenuCategoryTableProps {
  data: MenuCategoryData
}

export function MenuCategoryTable({ data }: MenuCategoryTableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggleCategory = (category: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Menu Category Sales</CardTitle>
        <CardDescription>
          Quantity sold and sales by category and item
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <div className="max-h-[500px] overflow-x-auto overflow-y-auto">
          <Table className="min-w-[600px]">
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead className="pl-6">Category / Item</TableHead>
                <TableHead className="text-right">FP Qty</TableHead>
                <TableHead className="text-right">FP Sales</TableHead>
                <TableHead className="text-right">3P Qty</TableHead>
                <TableHead className="text-right">3P Sales</TableHead>
                <TableHead className="text-right">Total Qty</TableHead>
                <TableHead className="text-right">Total Sales</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.categories.map((cat) => {
                const isExpanded = expanded.has(cat.category)
                return (
                  <CategoryRows
                    key={cat.category}
                    category={cat}
                    isExpanded={isExpanded}
                    onToggle={() => toggleCategory(cat.category)}
                  />
                )
              })}
            </TableBody>
            <TableFooter>
              <TableRow className="font-semibold">
                <TableCell className="pl-6">Total</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(data.totals.fpQuantitySold)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(data.totals.fpTotalSales)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(data.totals.tpQuantitySold)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(data.totals.tpTotalSales)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(data.totals.totalQuantitySold)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(data.totals.totalSales)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

const CategoryRows = memo(function CategoryRows({
  category,
  isExpanded,
  onToggle,
}: {
  category: import("@/types/analytics").MenuCategoryWithItems
  isExpanded: boolean
  onToggle: () => void
}) {
  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50"
        onClick={onToggle}
      >
        <TableCell className="pl-6 font-medium">
          <div className="flex items-center gap-1.5">
            <ChevronRight
              className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
                isExpanded ? "rotate-90" : ""
              }`}
            />
            {category.category}
          </div>
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {formatNumber(category.fpQuantitySold)}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {formatCurrency(category.fpTotalSales)}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {formatNumber(category.tpQuantitySold)}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {formatCurrency(category.tpTotalSales)}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {formatNumber(category.totalQuantitySold)}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {formatCurrency(category.totalSales)}
        </TableCell>
      </TableRow>
      {isExpanded &&
        category.items.map((item) => (
          <TableRow key={item.itemName} className="bg-muted/30">
            <TableCell className="pl-10 text-muted-foreground">
              {item.itemName}
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {formatNumber(item.fpQuantitySold)}
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {formatCurrency(item.fpTotalSales)}
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {formatNumber(item.tpQuantitySold)}
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {formatCurrency(item.tpTotalSales)}
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {formatNumber(item.totalQuantitySold)}
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {formatCurrency(item.totalSales)}
            </TableCell>
          </TableRow>
        ))}
    </>
  )
})
