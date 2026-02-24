"use client"

import { useEffect, useState, useTransition } from "react"
import { LineChart, Line, PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts"
import { motion } from "framer-motion"
import { TrendingUp, TrendingDown, Trophy } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency, formatNumber, formatPct } from "@/lib/format"
import { cn } from "@/lib/utils"
import { getMenuItemDetail } from "@/app/actions/store-actions"
import type { ItemExplorerData } from "@/types/analytics"

interface ItemExplorerSheetProps {
  itemName: string | null
  category: string | null
  storeId?: string
  dateOptions?: { days?: number; startDate?: string; endDate?: string }
  onClose: () => void
}

const CHANNEL_COLORS = {
  fp: "hsl(221, 83%, 53%)",
  tp: "hsl(20, 91%, 48%)",
}

export function ItemExplorerSheet({
  itemName,
  category,
  storeId,
  dateOptions,
  onClose,
}: ItemExplorerSheetProps) {
  const [data, setData] = useState<ItemExplorerData | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (!itemName || !category) {
      setData(null)
      return
    }

    startTransition(async () => {
      const result = await getMenuItemDetail(itemName, category, storeId, dateOptions)
      setData(result)
    })
  }, [itemName, category, storeId, dateOptions])

  const isOpen = !!itemName

  const fpPercent = data && data.totalQuantitySold > 0
    ? (data.fpQuantitySold / data.totalQuantitySold) * 100
    : 0
  const tpPercent = 100 - fpPercent

  const pieData = data ? [
    { name: "First Party", value: data.fpQuantitySold, color: CHANNEL_COLORS.fp },
    { name: "Third Party", value: data.tpQuantitySold, color: CHANNEL_COLORS.tp },
  ] : []

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-lg">{itemName}</SheetTitle>
          <SheetDescription className="sr-only">
            Detailed performance metrics for {itemName}
          </SheetDescription>
        </SheetHeader>

        {isPending && !data ? (
          <div className="space-y-4 px-4">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : data ? (
          <div className="space-y-5 px-4 pb-6">
            {/* Badges */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-2 flex-wrap"
            >
              <Badge variant="secondary">{data.category}</Badge>
              <Badge variant="outline" className="gap-1">
                <Trophy className="h-3 w-3" />
                #{data.rank} Best Seller
              </Badge>
            </motion.div>

            {/* Sparkline */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: 0.05 }}
              className="rounded-lg border bg-card p-3"
            >
              <p className="text-xs font-medium text-muted-foreground mb-2">Daily Trend</p>
              <ResponsiveContainer width="100%" height={80}>
                <LineChart data={data.dailyTrend}>
                  <Line
                    type="monotone"
                    dataKey="totalQuantitySold"
                    stroke="hsl(221, 83%, 53%)"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.[0]) return null
                      const d = payload[0].payload
                      return (
                        <div className="bg-popover text-popover-foreground border rounded-md shadow-sm px-2 py-1 text-xs">
                          <div>{d.date}</div>
                          <div>Qty: {formatNumber(d.totalQuantitySold)}</div>
                        </div>
                      )
                    }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </motion.div>

            {/* Channel Split */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: 0.1 }}
              className="rounded-lg border bg-card p-3"
            >
              <p className="text-xs font-medium text-muted-foreground mb-2">Channel Split</p>
              <div className="flex items-center gap-4">
                <ResponsiveContainer width={80} height={80}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      cx="50%"
                      cy="50%"
                      innerRadius={22}
                      outerRadius={36}
                      strokeWidth={0}
                    >
                      {pieData.map((entry, idx) => (
                        <Cell key={idx} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-1 text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CHANNEL_COLORS.fp }} />
                    <span className="text-muted-foreground">FP</span>
                    <span className="ml-auto font-medium">{fpPercent.toFixed(0)}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CHANNEL_COLORS.tp }} />
                    <span className="text-muted-foreground">3P</span>
                    <span className="ml-auto font-medium">{tpPercent.toFixed(0)}%</span>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Stats Grid */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: 0.15 }}
              className="grid grid-cols-2 gap-3"
            >
              <StatCard label="Total Qty" value={formatNumber(data.totalQuantitySold)} />
              <StatCard label="Total Revenue" value={formatCurrency(data.totalRevenue)} />
              <StatCard label="Avg Price" value={formatCurrency(data.avgPricePerUnit)} />
              <StatCard
                label="Growth"
                value={data.growthPercent !== null ? formatPct(data.growthPercent) : "N/A"}
                trend={data.growthPercent}
              />
            </motion.div>

            {/* Revenue Breakdown */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: 0.2 }}
              className="rounded-lg border bg-card p-3 space-y-2"
            >
              <p className="text-xs font-medium text-muted-foreground">Revenue Breakdown</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">FP Sales</span>
                  <div className="font-medium">{formatCurrency(data.fpSales)}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">3P Sales</span>
                  <div className="font-medium">{formatCurrency(data.tpSales)}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">FP Qty</span>
                  <div className="font-medium">{formatNumber(data.fpQuantitySold)}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">3P Qty</span>
                  <div className="font-medium">{formatNumber(data.tpQuantitySold)}</div>
                </div>
              </div>
            </motion.div>
          </div>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No data available for this item.
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function StatCard({
  label,
  value,
  trend,
}: {
  label: string
  value: string
  trend?: number | null
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-1 mt-0.5">
        <span className="text-sm font-semibold">{value}</span>
        {trend !== undefined && trend !== null && (
          trend >= 0 ? (
            <TrendingUp className="h-3 w-3 text-emerald-500" />
          ) : (
            <TrendingDown className="h-3 w-3 text-red-500" />
          )
        )}
      </div>
    </div>
  )
}
