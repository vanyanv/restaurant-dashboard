"use client"

import { useState, useTransition } from "react"
import { motion } from "framer-motion"
import {
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Loader2,
  GitCompareArrows,
  TrendingUp,
  TrendingDown,
  Package,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { formatCurrency } from "@/lib/format"
import { generateWeeklyComparison } from "@/app/actions/product-usage-actions"
import type { WeeklyComparison } from "@/types/product-usage"

interface WeeklyComparisonPanelProps {
  storeId?: string
}

function ChangeIndicator({ value, suffix = "" }: { value: number; suffix?: string }) {
  if (Math.abs(value) < 0.1) {
    return (
      <span className="flex items-center gap-1 text-muted-foreground">
        <Minus className="h-3 w-3" />
        <span className="text-xs">No change</span>
      </span>
    )
  }
  const isPositive = value > 0
  return (
    <span
      className={cn(
        "flex items-center gap-1 text-sm font-medium",
        isPositive ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
      )}
    >
      {isPositive ? (
        <ArrowUpRight className="h-4 w-4" />
      ) : (
        <ArrowDownRight className="h-4 w-4" />
      )}
      {isPositive ? "+" : ""}
      {value.toFixed(1)}
      {suffix}
    </span>
  )
}

function SalesChangeIndicator({ value, suffix = "" }: { value: number; suffix?: string }) {
  if (Math.abs(value) < 0.1) {
    return (
      <span className="flex items-center gap-1 text-muted-foreground">
        <Minus className="h-3 w-3" />
        <span className="text-xs">No change</span>
      </span>
    )
  }
  const isPositive = value > 0
  return (
    <span
      className={cn(
        "flex items-center gap-1 text-sm font-medium",
        isPositive ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
      )}
    >
      {isPositive ? (
        <TrendingUp className="h-4 w-4" />
      ) : (
        <TrendingDown className="h-4 w-4" />
      )}
      {isPositive ? "+" : ""}
      {value.toFixed(1)}
      {suffix}
    </span>
  )
}

const REASON_CONFIG = {
  price: { label: "Price", color: "text-amber-600 border-amber-200" },
  volume: { label: "Volume", color: "text-blue-600 border-blue-200" },
  both: { label: "Price + Volume", color: "text-purple-600 border-purple-200" },
  new: { label: "New Item", color: "text-emerald-600 border-emerald-200" },
} as const

export function WeeklyComparisonPanel({ storeId }: WeeklyComparisonPanelProps) {
  const [comparison, setComparison] = useState<WeeklyComparison | null>(null)
  const [isPending, startTransition] = useTransition()
  const [hasGenerated, setHasGenerated] = useState(false)

  function handleGenerate() {
    startTransition(async () => {
      const result = await generateWeeklyComparison(storeId)
      setComparison(result)
      setHasGenerated(true)
    })
  }

  if (!hasGenerated) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
        <GitCompareArrows className="h-8 w-8 text-muted-foreground/50" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">Weekly Comparison</p>
          <p className="text-xs text-muted-foreground/80">
            Compare this week&apos;s spending and sales vs last week
          </p>
        </div>
        <Button
          onClick={handleGenerate}
          disabled={isPending}
          size="sm"
          className="gap-2"
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <GitCompareArrows className="h-4 w-4" />
          )}
          {isPending ? "Comparing..." : "Compare This Week"}
        </Button>
      </div>
    )
  }

  if (!comparison) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">
        <p>No comparison data available.</p>
        <p className="text-xs mt-1">
          Ensure you have invoice and sales data for this week and last week.
        </p>
      </div>
    )
  }

  const spendDelta = comparison.currentWeekSpend - comparison.previousWeekSpend

  return (
    <div className="space-y-4">
      {/* Header with refresh */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitCompareArrows className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium">This Week vs Last Week</p>
        </div>
        <Button
          onClick={handleGenerate}
          disabled={isPending}
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
        >
          {isPending ? (
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
          ) : (
            <GitCompareArrows className="h-3 w-3 mr-1" />
          )}
          Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="grid grid-cols-1 sm:grid-cols-2 gap-3"
      >
        {/* Spending */}
        <div className="rounded-lg border bg-card p-4 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Spending</p>
          <div className="flex items-end justify-between">
            <div>
              <p className="text-2xl font-bold font-mono-numbers">
                {formatCurrency(comparison.currentWeekSpend)}
              </p>
              <p className="text-xs text-muted-foreground">
                vs {formatCurrency(comparison.previousWeekSpend)} last week
              </p>
            </div>
            <div className="text-right">
              <ChangeIndicator value={comparison.spendChangePct} suffix="%" />
              <p className="text-xs text-muted-foreground mt-0.5">
                {spendDelta >= 0 ? "+" : ""}
                {formatCurrency(spendDelta)}
              </p>
            </div>
          </div>
        </div>

        {/* Sales */}
        <div className="rounded-lg border bg-card p-4 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Sales Revenue</p>
          <div className="flex items-end justify-between">
            <div>
              <p className="text-2xl font-bold font-mono-numbers">
                {formatCurrency(comparison.currentWeekSales)}
              </p>
              <p className="text-xs text-muted-foreground">
                vs {formatCurrency(comparison.previousWeekSales)} last week
              </p>
            </div>
            <SalesChangeIndicator value={comparison.salesChangePct} suffix="%" />
          </div>
        </div>
      </motion.div>

      {/* Observations */}
      {comparison.observations.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: 0.1 }}
          className="rounded-lg border bg-card p-4 space-y-2"
        >
          <p className="text-xs font-medium text-muted-foreground">What Changed</p>
          <div className="space-y-2">
            {comparison.observations.map((obs, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 + i * 0.06 }}
                className="flex items-start gap-2"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                <p className="text-sm leading-relaxed">{obs}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Top Spend Changes Table */}
      {comparison.topSpendChanges.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: 0.2 }}
          className="rounded-md border overflow-x-auto"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">This Week</TableHead>
                <TableHead className="text-right">Last Week</TableHead>
                <TableHead className="text-right">Change</TableHead>
                <TableHead className="text-center">Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {comparison.topSpendChanges.map((item, i) => {
                const reasonConfig = REASON_CONFIG[item.reason] ?? REASON_CONFIG.both
                const changeDollar = item.thisWeek - item.lastWeek
                return (
                  <motion.tr
                    key={item.productName}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.25 + i * 0.03 }}
                    className="border-b"
                  >
                    <TableCell className="font-medium text-sm">
                      <div className="flex items-center gap-2">
                        <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="truncate max-w-[200px]">{item.productName}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-sm font-mono">
                      {formatCurrency(item.thisWeek)}
                    </TableCell>
                    <TableCell className="text-right text-sm font-mono">
                      {formatCurrency(item.lastWeek)}
                    </TableCell>
                    <TableCell className="text-right text-sm font-mono">
                      <span
                        className={cn(
                          changeDollar > 0
                            ? "text-red-600 dark:text-red-400"
                            : changeDollar < 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-muted-foreground"
                        )}
                      >
                        {changeDollar > 0 ? "+" : ""}
                        {formatCurrency(changeDollar)}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant="outline"
                        className={cn("text-[10px]", reasonConfig.color)}
                      >
                        {reasonConfig.label}
                      </Badge>
                    </TableCell>
                  </motion.tr>
                )
              })}
            </TableBody>
          </Table>
        </motion.div>
      )}
    </div>
  )
}
