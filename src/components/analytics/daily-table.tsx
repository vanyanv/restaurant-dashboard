"use client"

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
    <section className="inv-panel inv-panel--flush">
      <header className="inv-panel__head px-6 pt-4">
        <div className="flex flex-col gap-1">
          <span className="inv-panel__dept">Daily Breakdown</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">
            Revenue by day, newest first
          </span>
        </div>
      </header>
      <div>
        <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
          <Table className="min-w-[500px]">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6 sticky top-0 bg-(--paper)">Date</TableHead>
                <TableHead className="text-right sticky top-0 bg-(--paper)">Gross</TableHead>
                <TableHead className="text-right sticky top-0 bg-(--paper)">Net</TableHead>
                <TableHead className="text-right sticky top-0 bg-(--paper)">FP</TableHead>
                <TableHead className="text-right sticky top-0 bg-(--paper)">3P</TableHead>
                <TableHead className="text-right sticky top-0 bg-(--paper)">Cash</TableHead>
                <TableHead className="text-right sticky top-0 bg-(--paper) pr-6">Card</TableHead>
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
      </div>
    </section>
  )
}
