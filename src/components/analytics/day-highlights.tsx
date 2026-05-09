import { TrendingUp, TrendingDown } from "lucide-react"
import { formatCurrency, formatDate } from "@/lib/format"
import type { DailyTrend } from "@/types/analytics"

interface DayHighlightsProps {
  dailyTrends: DailyTrend[]
}

function computeHighlights(dailyTrends: DailyTrend[]) {
  if (dailyTrends.length === 0) return { best: null, worst: null }
  let best = dailyTrends[0]
  let worst = dailyTrends[0]
  for (const d of dailyTrends) {
    if (d.grossRevenue > best.grossRevenue) best = d
    if (d.grossRevenue < worst.grossRevenue) worst = d
  }
  if (best.date === worst.date) return { best, worst: null }
  return { best, worst }
}

export function DayHighlights({ dailyTrends }: DayHighlightsProps) {
  const { best, worst } = computeHighlights(dailyTrends)
  if (!best) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center gap-1.5 rounded-xs border border-(--hairline-bold) bg-(--accent-bg) px-3 py-1.5 text-xs font-medium text-(--accent-dark)">
        <TrendingUp className="h-3 w-3" />
        <span className="text-(--ink-muted)">Best:</span>
        <span>{formatDate(best.date)}</span>
        <span className="font-semibold tabular-nums">{formatCurrency(best.grossRevenue)}</span>
      </div>
      {worst && (
        <div className="inline-flex items-center gap-1.5 rounded-xs border border-(--hairline-bold) bg-(--paper-warm) px-3 py-1.5 text-xs font-medium text-(--subtract)">
          <TrendingDown className="h-3 w-3" />
          <span className="text-(--ink-muted)">Worst:</span>
          <span>{formatDate(worst.date)}</span>
          <span className="font-semibold tabular-nums">{formatCurrency(worst.grossRevenue)}</span>
        </div>
      )}
    </div>
  )
}
