"use client"

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
import { formatCurrency, formatDate } from "@/lib/format"
import type { DailyTrend } from "@/types/analytics"

interface DailyTableProps {
  data: DailyTrend[]
}

export function DailyTable({ data }: DailyTableProps) {
  // Show newest first
  const sorted = [...data].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Daily Breakdown</CardTitle>
        <CardDescription>Revenue by day, newest first</CardDescription>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
          <Table className="min-w-[500px]">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6 sticky top-0 bg-background">Date</TableHead>
                <TableHead className="text-right sticky top-0 bg-background">Gross</TableHead>
                <TableHead className="text-right sticky top-0 bg-background">Net</TableHead>
                <TableHead className="text-right sticky top-0 bg-background">FP</TableHead>
                <TableHead className="text-right sticky top-0 bg-background">3P</TableHead>
                <TableHead className="text-right sticky top-0 bg-background">Cash</TableHead>
                <TableHead className="text-right sticky top-0 bg-background pr-6">Card</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((row) => (
                <TableRow key={row.date}>
                  <TableCell className="font-medium pl-6 whitespace-nowrap">
                    {formatDate(row.date)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(row.grossRevenue)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(row.netRevenue)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(row.fpGross)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(row.tpGross)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(row.cashSales)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums pr-6">
                    {formatCurrency(row.cardSales)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
