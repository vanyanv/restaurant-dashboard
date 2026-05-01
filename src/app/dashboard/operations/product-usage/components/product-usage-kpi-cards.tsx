"use client"

import { useRef } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { formatCurrency } from "@/lib/format"
import { motion, useReducedMotion } from "framer-motion"
import type { ProductUsageKpis } from "@/types/product-usage"

interface ProductUsageKpiCardsProps {
  kpis: ProductUsageKpis
}

function getWasteBorderColor(wastePercent: number): string {
  if (wastePercent < 5) return "var(--platform-chownow)"
  if (wastePercent <= 15) return "var(--platform-grubhub)"
  return "var(--accent)"
}

function getWasteBgTint(wastePercent: number): string {
  if (wastePercent < 5) return "rgba(22, 160, 133, 0.04)"
  if (wastePercent <= 15) return "rgba(241, 92, 38, 0.04)"
  return "rgba(220, 38, 38, 0.04)"
}

const CARDS = [
  {
    key: "totalPurchasedCost" as const,
    label: "Total Purchased",
    borderColor: "var(--platform-grubhub)",
    bgTint: "rgba(241, 92, 38, 0.04)",
  },
  {
    key: "theoreticalIngredientCost" as const,
    label: "Theoretical Cost",
    borderColor: "var(--accent)",
    bgTint: "rgba(220, 38, 38, 0.04)",
  },
  {
    key: "wasteEstimatedCost" as const,
    label: "Waste Cost",
    borderColor: "var(--subtract)",
    bgTint: "rgba(138, 58, 58, 0.04)",
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
  const prefersReducedMotion = useReducedMotion()

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
            initial={hasAnimated.current || prefersReducedMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: prefersReducedMotion ? 0 : 0.22,
              delay: hasAnimated.current || prefersReducedMotion ? 0 : index * 0.03,
              ease: [0.2, 0.7, 0.2, 1],
            }}
            onAnimationComplete={() => {
              hasAnimated.current = true
            }}
          >
            <Card
              className="relative overflow-hidden py-3"
              style={{
                borderColor,
                backgroundColor: bgTint,
              }}
            >
              <CardContent className="p-3">
                <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--ink-muted)]">
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
