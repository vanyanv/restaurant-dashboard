"use client"

import { useRef } from "react"
import { formatCurrency, formatPct, formatNumber } from "@/lib/format"
import type { StoreAnalyticsKpis, PeriodComparison } from "@/types/analytics"
import { TrendingUp, TrendingDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { motion } from "framer-motion"

interface KpiCardsProps {
  kpis: StoreAnalyticsKpis
  comparison: PeriodComparison
}

const CARDS = [
  { key: "netSales" as const, label: "Net Sales" },
  { key: "grossSales" as const, label: "Gross Sales" },
  { key: "totalOrders" as const, label: "Total Orders" },
  { key: "aov" as const, label: "Average Order Value" },
]

export function KpiCards({ kpis, comparison }: KpiCardsProps) {
  const hasAnimated = useRef(false)

  const getValue = (key: string): string => {
    switch (key) {
      case "netSales":
        return formatCurrency(kpis.netRevenue)
      case "grossSales":
        return formatCurrency(kpis.grossRevenue)
      case "totalOrders":
        return formatNumber(kpis.totalOrders)
      case "aov":
        return formatCurrency(kpis.averageOrderValue)
      default:
        return "$0"
    }
  }

  const getGrowth = (key: string): number | undefined => {
    switch (key) {
      case "netSales":
        return comparison.netGrowth
      case "grossSales":
        return comparison.grossGrowth
      default:
        return undefined
    }
  }

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {CARDS.map((card, index) => {
        const growth = getGrowth(card.key)
        const hasGrowth = growth !== undefined
        const isPositive = hasGrowth && growth >= 0

        return (
          <motion.section
            key={card.key}
            className="inv-panel inv-panel--flush relative overflow-hidden"
            initial={hasAnimated.current ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: hasAnimated.current ? 0 : index * 0.08, ease: "easeOut" }}
            onAnimationComplete={() => { hasAnimated.current = true }}
          >
            <div className="px-4 py-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">
                {card.label}
              </span>
              <div className="mt-1 text-xl font-semibold tabular-nums sm:text-2xl text-(--ink)">
                {getValue(card.key)}
              </div>
              {hasGrowth && (
                <div
                  className={cn(
                    "mt-1.5 inline-flex items-center gap-1 rounded-xs border border-(--hairline-bold) bg-(--accent-bg) px-2 py-0.5 text-xs font-medium tabular-nums",
                    isPositive ? "text-(--accent-dark)" : "text-(--accent)"
                  )}
                >
                  {isPositive ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : (
                    <TrendingDown className="h-3 w-3" />
                  )}
                  {formatPct(growth)} vs prior period
                </div>
              )}
            </div>
          </motion.section>
        )
      })}
    </div>
  )
}
