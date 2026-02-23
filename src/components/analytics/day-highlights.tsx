"use client"

import { useMemo } from "react"
import { TrendingUp, TrendingDown } from "lucide-react"
import { formatCurrency, formatDate } from "@/lib/format"
import type { DailyTrend } from "@/types/analytics"

interface DayHighlightsProps {
  dailyTrends: DailyTrend[]
}

export function DayHighlights({ dailyTrends }: DayHighlightsProps) {
  const { best, worst } = useMemo(() => {
    if (dailyTrends.length === 0) return { best: null, worst: null }
    let best = dailyTrends[0]
    let worst = dailyTrends[0]
    for (const d of dailyTrends) {
      if (d.grossRevenue > best.grossRevenue) best = d
      if (d.grossRevenue < worst.grossRevenue) worst = d
    }
    // Don't show if best === worst (single day range)
    if (best.date === worst.date) return { best, worst: null }
    return { best, worst }
  }, [dailyTrends])

  if (!best) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
        <TrendingUp className="h-3 w-3" />
        <span className="text-muted-foreground">Best:</span>
        <span>{formatDate(best.date)}</span>
        <span className="font-semibold tabular-nums">{formatCurrency(best.grossRevenue)}</span>
      </div>
      {worst && (
        <div className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 dark:bg-red-950/40 dark:text-red-400">
          <TrendingDown className="h-3 w-3" />
          <span className="text-muted-foreground">Worst:</span>
          <span>{formatDate(worst.date)}</span>
          <span className="font-semibold tabular-nums">{formatCurrency(worst.grossRevenue)}</span>
        </div>
      )}
    </div>
  )
}
