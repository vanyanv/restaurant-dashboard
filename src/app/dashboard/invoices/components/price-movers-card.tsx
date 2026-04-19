"use client"

import { ArrowDownRight, ArrowUpRight, TrendingUp } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatCurrency } from "@/lib/format"
import type { PriceMoverRow } from "@/types/invoice"

interface PriceMoversCardProps {
  rows: PriceMoverRow[]
}

export function PriceMoversCard({ rows }: PriceMoversCardProps) {
  const increases = rows.filter((r) => r.pctChange > 0).length
  const decreases = rows.filter((r) => r.pctChange < 0).length

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Price Movers
            </CardTitle>
            <CardDescription>
              Products whose latest unit price differs 5% or more from the prior order (last 90 days).
            </CardDescription>
          </div>
          <div className="flex gap-2 text-xs">
            {increases > 0 && (
              <Badge variant="outline" className="border-red-500/50 text-red-600">
                ↑ {increases} up
              </Badge>
            )}
            {decreases > 0 && (
              <Badge variant="outline" className="border-emerald-500/50 text-emerald-600">
                ↓ {decreases} down
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No significant price changes in the past 90 days.
          </div>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Prev</TableHead>
                  <TableHead className="text-right">Latest</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => {
                  const up = r.pctChange > 0
                  return (
                    <TableRow key={`${r.vendorName}-${r.sku ?? r.productName}-${i}`}>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {r.vendorName}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[280px]">
                        <div className="truncate font-medium">{r.productName}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.sku ? `SKU ${r.sku}` : "—"}
                          {r.unit ? ` · ${r.unit}` : ""}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(r.prevPrice)}
                        <div className="text-xs text-muted-foreground">{r.prevDate}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatCurrency(r.latestPrice)}
                        <div className="text-xs text-muted-foreground">{r.latestDate}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span
                          className={`inline-flex items-center gap-1 font-semibold ${
                            up ? "text-red-600" : "text-emerald-600"
                          }`}
                        >
                          {up ? (
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          ) : (
                            <ArrowDownRight className="h-3.5 w-3.5" />
                          )}
                          {up ? "+" : ""}
                          {r.pctChange.toFixed(1)}%
                        </span>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
