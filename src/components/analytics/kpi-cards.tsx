"use client"

import { useRef } from "react"
import { Card, CardContent } from "@/components/ui/card"
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
  {
    key: "netSales" as const,
    label: "Net Sales",
    borderColor: "hsl(0, 72%, 51%)",
    bgTint: "hsl(0, 72%, 51%, 0.04)",
  },
  {
    key: "grossSales" as const,
    label: "Gross Sales",
    borderColor: "hsl(20, 91%, 48%)",
    bgTint: "hsl(20, 91%, 48%, 0.04)",
  },
  {
    key: "totalOrders" as const,
    label: "Total Orders",
    borderColor: "hsl(221, 83%, 53%)",
    bgTint: "hsl(221, 83%, 53%, 0.04)",
  },
  {
    key: "aov" as const,
    label: "Average Order Value",
    borderColor: "hsl(142, 71%, 45%)",
    bgTint: "hsl(142, 71%, 45%, 0.04)",
  },
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
          <motion.div
            key={card.key}
            initial={hasAnimated.current ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: hasAnimated.current ? 0 : index * 0.08, ease: "easeOut" }}
            onAnimationComplete={() => { hasAnimated.current = true }}
          >
            <Card
              className="relative overflow-hidden border-t-[3px] py-3"
              style={{
                borderTopColor: card.borderColor,
                backgroundColor: card.bgTint,
              }}
            >
              <CardContent className="p-3">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {card.label}
                </span>
                <div className="mt-1 font-mono-numbers text-xl font-bold tracking-tight sm:text-2xl">
                  {getValue(card.key)}
                </div>
                {hasGrowth && (
                  <div
                    className={cn(
                      "mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                      isPositive
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                        : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400"
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
              </CardContent>
            </Card>
          </motion.div>
        )
      })}
    </div>
  )
}
