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
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ArrowUpDown } from "lucide-react"
import { formatCurrency } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { IngredientUsageRow } from "@/types/product-usage"

interface IngredientVarianceTableProps {
  data: IngredientUsageRow[]
  onRowClick?: (ingredientName: string) => void
}

function getVarianceColor(pct: number): string {
  const abs = Math.abs(pct)
  if (abs > 10) return "text-red-600 dark:text-red-400"
  if (abs > 5) return "text-amber-600 dark:text-amber-400"
  return "text-emerald-600 dark:text-emerald-400"
}

function getStatusBadge(status: IngredientUsageRow["status"]) {
  switch (status) {
    case "over_ordered":
      return (
        <Badge variant="destructive" className="text-xs">
          Over
        </Badge>
      )
    case "under_ordered":
      return (
        <Badge
          variant="outline"
          className="text-xs border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400"
        >
          Under
        </Badge>
      )
    case "balanced":
      return (
        <Badge
          variant="outline"
          className="text-xs border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400"
        >
          Good
        </Badge>
      )
    case "no_recipe":
      return (
        <Badge variant="secondary" className="text-xs">
          No Recipe
        </Badge>
      )
  }
}

export function IngredientVarianceTable({
  data,
  onRowClick,
}: IngredientVarianceTableProps) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "wasteEstimatedCost", desc: true },
  ])

  const columns = useMemo<ColumnDef<IngredientUsageRow>[]>(
    () => [
      {
        accessorKey: "canonicalName",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 h-8 text-xs"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Ingredient
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="font-medium">{row.getValue("canonicalName")}</span>
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
        cell: ({ row }) => {
          const cat = row.getValue("category") as string | null
          return cat ? (
            <Badge variant="outline" className="text-xs font-normal">
              {cat}
            </Badge>
          ) : (
            <span className="text-muted-foreground text-xs">--</span>
          )
        },
      },
      {
        accessorKey: "purchasedQuantity",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 h-8 text-xs"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Purchased
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => {
          const orig = row.original
          return (
            <div>
              <span className="font-mono-numbers">
                {orig.purchasedQuantity.toFixed(1)} {orig.purchasedUnit}
              </span>
              <div className="text-xs text-muted-foreground font-mono-numbers">
                {formatCurrency(orig.purchasedCost)}
              </div>
            </div>
          )
        },
      },
      {
        accessorKey: "theoreticalUsage",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 h-8 text-xs"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Theoretical
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="font-mono-numbers">
            {(row.getValue("theoreticalUsage") as number).toFixed(1)}
          </span>
        ),
      },
      {
        accessorKey: "variancePct",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 h-8 text-xs"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Variance %
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => {
          const pct = row.getValue("variancePct") as number
          return (
            <span
              className={cn("font-mono-numbers font-medium", getVarianceColor(pct))}
            >
              {pct > 0 ? "+" : ""}
              {pct.toFixed(1)}%
            </span>
          )
        },
      },
      {
        accessorKey: "wasteEstimatedCost",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 h-8 text-xs"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Waste Cost
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="font-mono-numbers">
            {formatCurrency(row.getValue("wasteEstimatedCost") as number)}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 h-8 text-xs"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Status
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) =>
          getStatusBadge(row.getValue("status") as IngredientUsageRow["status"]),
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
          <CardTitle className="text-base">
            All Ingredients ({data.length})
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <div className="max-h-[500px] overflow-auto">
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
                  <TableRow
                    key={row.id}
                    className={cn(
                      onRowClick && "cursor-pointer hover:bg-muted/50"
                    )}
                    onClick={() =>
                      onRowClick?.(row.original.canonicalName)
                    }
                  >
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
                    No ingredient data available.
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
