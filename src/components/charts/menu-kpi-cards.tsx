"use client"

import { memo, useRef } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { formatCurrency, formatPct, formatNumber } from "@/lib/format"
import type { MenuPerformanceKpis, MenuPerformanceComparison } from "@/types/analytics"
import { TrendingUp, TrendingDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { motion } from "framer-motion"

interface MenuKpiCardsProps {
  kpis: MenuPerformanceKpis
  comparison: MenuPerformanceComparison
}

const CARDS = [
  {
    key: "itemsSold" as const,
    label: "Items Sold",
    borderColor: "hsl(221, 83%, 53%)",
    bgTint: "hsl(221, 83%, 53%, 0.04)",
  },
  {
    key: "topSeller" as const,
    label: "Top Seller",
    borderColor: "hsl(20, 91%, 48%)",
    bgTint: "hsl(20, 91%, 48%, 0.04)",
  },
  {
    key: "menuRevenue" as const,
    label: "Menu Revenue",
    borderColor: "hsl(142, 71%, 45%)",
    bgTint: "hsl(142, 71%, 45%, 0.04)",
  },
  {
    key: "avgRevenue" as const,
    label: "Avg Revenue / Item",
    borderColor: "hsl(0, 72%, 51%)",
    bgTint: "hsl(0, 72%, 51%, 0.04)",
  },
]

function MenuKpiCardsImpl({ kpis, comparison }: MenuKpiCardsProps) {
  const hasAnimated = useRef(false)

  const getValue = (key: string): string => {
    switch (key) {
      case "itemsSold":
        return formatNumber(kpis.totalItemsSold)
      case "topSeller":
        return kpis.topSellingItem?.name ?? "—"
      case "menuRevenue":
        return formatCurrency(kpis.totalMenuRevenue)
      case "avgRevenue":
        return formatCurrency(kpis.avgRevenuePerItem)
      default:
        return "—"
    }
  }

  const getSubtext = (key: string): string | null => {
    switch (key) {
      case "topSeller":
        if (!kpis.topSellingItem) return null
        return `${formatNumber(kpis.topSellingItem.quantity)} sold · ${kpis.topSellingItem.category}`
      case "avgRevenue":
        return `${formatNumber(kpis.uniqueItemsCount)} unique items`
      default:
        return null
    }
  }

  const getGrowth = (key: string): number | undefined => {
    switch (key) {
      case "itemsSold":
        return comparison.itemsSoldGrowth
      case "menuRevenue":
        return comparison.revenueGrowth
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
        const subtext = getSubtext(card.key)

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
                <div className={cn(
                  "mt-1 font-mono-numbers tracking-tight",
                  card.key === "topSeller"
                    ? "text-base font-bold sm:text-lg truncate"
                    : "text-xl font-bold sm:text-2xl"
                )}>
                  {getValue(card.key)}
                </div>
                {subtext && (
                  <div className="mt-0.5 text-xs text-muted-foreground truncate">
                    {subtext}
                  </div>
                )}
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

export const MenuKpiCards = memo(MenuKpiCardsImpl)
