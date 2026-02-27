"use client"

import { useMemo } from "react"
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
import { Badge } from "@/components/ui/badge"
import { formatCurrency } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { PriceAlert } from "@/types/product-usage"

interface PriceChangesTableProps {
  data: PriceAlert[]
}

function getChangeColor(pct: number): string {
  if (pct > 5) return "text-red-600 dark:text-red-400"
  if (pct > 0) return "text-amber-600 dark:text-amber-400"
  return "text-emerald-600 dark:text-emerald-400"
}

function getSeverityBadge(severity: PriceAlert["severity"], pct: number) {
  if (severity === "spike") {
    return (
      <Badge variant="destructive" className="text-xs">
        Alert
      </Badge>
    )
  }
  if (severity === "increase") {
    return (
      <Badge
        variant="outline"
        className="text-xs border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400"
      >
        Watch
      </Badge>
    )
  }
  // severity === "decrease"
  if (pct < -5) {
    return (
      <Badge
        variant="outline"
        className="text-xs border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400"
      >
        Decrease
      </Badge>
    )
  }
  return (
    <Badge
      variant="outline"
      className="text-xs border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400"
    >
      Stable
    </Badge>
  )
}

export function PriceChangesTable({ data }: PriceChangesTableProps) {
  const sorted = useMemo(
    () =>
      [...data].sort(
        (a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent)
      ),
    [data]
  )

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">
              Price Changes ({data.length})
            </CardTitle>
            <CardDescription className="text-xs">
              Products with recent price movements vs 30-day average
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <div className="max-h-[500px] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead className="pl-4">Product</TableHead>
                <TableHead className="pl-4">Category</TableHead>
                <TableHead className="pl-4">30d Average</TableHead>
                <TableHead className="pl-4">Latest Price</TableHead>
                <TableHead className="pl-4">Change</TableHead>
                <TableHead className="pl-4">Severity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.length > 0 ? (
                sorted.map((alert, idx) => (
                  <TableRow key={`${alert.productName}-${idx}`}>
                    <TableCell className="pl-4 font-medium">
                      {alert.productName}
                    </TableCell>
                    <TableCell className="pl-4">
                      {alert.category ? (
                        <Badge
                          variant="outline"
                          className="text-xs font-normal"
                        >
                          {alert.category}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">
                          —
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="pl-4 font-mono-numbers">
                      {formatCurrency(alert.previousAvgPrice)}
                    </TableCell>
                    <TableCell className="pl-4 font-mono-numbers">
                      {formatCurrency(alert.currentPrice)}
                    </TableCell>
                    <TableCell className="pl-4">
                      <span
                        className={cn(
                          "font-mono-numbers font-medium",
                          getChangeColor(alert.changePercent)
                        )}
                      >
                        {alert.changePercent > 0 ? "+" : ""}
                        {alert.changePercent.toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell className="pl-4">
                      {getSeverityBadge(alert.severity, alert.changePercent)}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No price changes detected.
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
