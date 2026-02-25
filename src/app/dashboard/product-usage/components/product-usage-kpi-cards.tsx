"use client"

import { useRef } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { formatCurrency } from "@/lib/format"
import { motion } from "framer-motion"
import type { ProductUsageKpis } from "@/types/product-usage"

interface ProductUsageKpiCardsProps {
  kpis: ProductUsageKpis
}

function getWasteBorderColor(wastePercent: number): string {
  if (wastePercent < 5) return "hsl(142, 71%, 45%)"
  if (wastePercent <= 15) return "hsl(38, 92%, 50%)"
  return "hsl(0, 72%, 51%)"
}

function getWasteBgTint(wastePercent: number): string {
  if (wastePercent < 5) return "hsl(142, 71%, 45%, 0.04)"
  if (wastePercent <= 15) return "hsl(38, 92%, 50%, 0.04)"
  return "hsl(0, 72%, 51%, 0.04)"
}

const CARDS = [
  {
    key: "totalPurchasedCost" as const,
    label: "Total Purchased",
    borderColor: "hsl(20, 91%, 48%)",
    bgTint: "hsl(20, 91%, 48%, 0.04)",
  },
  {
    key: "theoreticalIngredientCost" as const,
    label: "Theoretical Cost",
    borderColor: "hsl(0, 72%, 51%)",
    bgTint: "hsl(0, 72%, 51%, 0.04)",
  },
  {
    key: "wasteEstimatedCost" as const,
    label: "Waste Cost",
    borderColor: "hsl(38, 92%, 50%)",
    bgTint: "hsl(38, 92%, 50%, 0.04)",
  },
  {
    key: "wastePercent" as const,
    label: "Waste %",
    borderColor: "dynamic",
    bgTint: "dynamic",
  },
]

export function ProductUsageKpiCards({ kpis }: ProductUsageKpiCardsProps) {
  const hasAnimated = useRef(false)

  const getValue = (key: string): string => {
    switch (key) {
      case "totalPurchasedCost":
        return formatCurrency(kpis.totalPurchasedCost)
      case "theoreticalIngredientCost":
        return formatCurrency(kpis.theoreticalIngredientCost)
      case "wasteEstimatedCost":
        return formatCurrency(kpis.wasteEstimatedCost)
      case "wastePercent":
        return `${kpis.wastePercent.toFixed(1)}%`
      default:
        return "$0"
    }
  }

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {CARDS.map((card, index) => {
        const borderColor =
          card.key === "wastePercent"
            ? getWasteBorderColor(kpis.wastePercent)
            : card.borderColor
        const bgTint =
          card.key === "wastePercent"
            ? getWasteBgTint(kpis.wastePercent)
            : card.bgTint

        return (
          <motion.div
            key={card.key}
            initial={hasAnimated.current ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.4,
              delay: hasAnimated.current ? 0 : index * 0.08,
              ease: "easeOut",
            }}
            onAnimationComplete={() => {
              hasAnimated.current = true
            }}
          >
            <Card
              className="relative overflow-hidden border-t-[3px] py-3"
              style={{
                borderTopColor: borderColor,
                backgroundColor: bgTint,
              }}
            >
              <CardContent className="p-3">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {card.label}
                </span>
                <div className="mt-1 font-mono-numbers text-xl font-bold tracking-tight sm:text-2xl">
                  {getValue(card.key)}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )
      })}
    </div>
  )
}
