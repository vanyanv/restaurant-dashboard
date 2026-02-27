"use client"

import { useState, useMemo } from "react"
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type SortingState,
  type ColumnDef,
} from "@tanstack/react-table"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ArrowUpDown, TriangleAlert } from "lucide-react"
import Link from "next/link"
import { formatCurrency, formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { MenuItemCostRow } from "@/types/product-usage"

interface MenuItemCostTableProps {
  data: MenuItemCostRow[]
}

function getMarginColor(pct: number | null): string {
  if (pct === null) return "text-muted-foreground"
  if (pct > 60) return "text-emerald-600 dark:text-emerald-400"
  if (pct >= 40) return "text-amber-600 dark:text-amber-400"
  return "text-red-600 dark:text-red-400"
}

function getProfitColor(value: number): string {
  if (value >= 0) return "text-emerald-600 dark:text-emerald-400"
  return "text-red-600 dark:text-red-400"
}

export function MenuItemCostTable({ data }: MenuItemCostTableProps) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "totalSalesRevenue", desc: true },
  ])

  const withRecipe = data.filter((d) => d.hasRecipe).length
  const coveragePct = data.length > 0 ? Math.round((withRecipe / data.length) * 100) : 100

  const columns = useMemo<ColumnDef<MenuItemCostRow>[]>(
    () => [
      {
        accessorKey: "itemName",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 h-8 text-xs"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Item Name
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="font-medium">{row.getValue("itemName")}</span>
        ),
      },
      {
        accessorKey: "category",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 h-8 text-xs"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Category
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <Badge variant="outline" className="text-xs font-normal">
            {row.getValue("category") as string}
          </Badge>
        ),
      },
      {
        accessorKey: "totalQuantitySold",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 h-8 text-xs"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Units Sold
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="font-mono-numbers">
            {formatNumber(row.getValue("totalQuantitySold") as number)}
          </span>
        ),
      },
      {
        accessorKey: "totalSalesRevenue",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 h-8 text-xs"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Revenue
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="font-mono-numbers">
            {formatCurrency(row.getValue("totalSalesRevenue") as number)}
          </span>
        ),
      },
      {
        accessorKey: "theoreticalCOGS",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 h-8 text-xs"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            COGS
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="font-mono-numbers">
            {formatCurrency(row.getValue("theoreticalCOGS") as number)}
          </span>
        ),
      },
      {
        accessorKey: "grossProfitEstimate",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 h-8 text-xs"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Gross Profit
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => {
          const value = row.getValue("grossProfitEstimate") as number
          return (
            <span
              className={cn(
                "font-mono-numbers font-medium",
                getProfitColor(value)
              )}
            >
              {formatCurrency(value)}
            </span>
          )
        },
      },
      {
        accessorKey: "grossMarginPct",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 h-8 text-xs"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Margin %
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => {
          const pct = row.getValue("grossMarginPct") as number | null
          if (pct === null) {
            return (
              <span className="text-muted-foreground text-xs">--</span>
            )
          }
          return (
            <span
              className={cn(
                "font-mono-numbers font-medium",
                getMarginColor(pct)
              )}
            >
              {pct.toFixed(1)}%
            </span>
          )
        },
        sortingFn: (rowA, rowB) => {
          const a = rowA.getValue("grossMarginPct") as number | null
          const b = rowB.getValue("grossMarginPct") as number | null
          if (a === null && b === null) return 0
          if (a === null) return -1
          if (b === null) return 1
          return a - b
        },
      },
      {
        accessorKey: "hasRecipe",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 h-8 text-xs"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Recipe
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => {
          const hasRecipe = row.getValue("hasRecipe") as boolean
          return hasRecipe ? (
            <Badge
              variant="outline"
              className="text-xs border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400"
            >
              Yes
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-xs">
              No
            </Badge>
          )
        },
      },
    ],
    []
  )

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">
              All Menu Items ({data.length})
            </CardTitle>
            <CardDescription className="text-xs">
              Cost and margin analysis per menu item
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      {coveragePct < 100 && (
        <div className="px-4 pb-3">
          <Alert className="border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30">
            <TriangleAlert className="h-4 w-4 text-amber-600! dark:text-amber-400!" />
            <AlertDescription className="text-amber-800 dark:text-amber-300">
              {withRecipe} of {data.length} items have recipes configured ({coveragePct}% coverage).
              Items without recipes show $0 COGS and 100% margin.{" "}
              <Link
                href="/dashboard/operations/recipes"
                className="font-medium underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-200"
              >
                Configure recipes
              </Link>
            </AlertDescription>
          </Alert>
        </div>
      )}
      <CardContent className="px-0 pb-0">
        <div className="max-h-125 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id} className="pl-4">
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length > 0 ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="pl-4">
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No menu item cost data available.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
