"use client"

import { AlertTriangle, Lightbulb, TrendingDown, TrendingUp } from "lucide-react"
import { motion } from "framer-motion"

import { cn } from "@/lib/utils"
import type { QuickInsight } from "@/types/analytics"

interface QuickInsightsProps {
  insights: QuickInsight[]
  className?: string
}

const typeConfig = {
  info: {
    icon: Lightbulb,
    classes: "bg-(--paper) text-(--ink-muted) border border-(--hairline-bold)",
  },
  positive: {
    icon: TrendingUp,
    classes: "bg-(--accent-bg) text-(--accent-dark) border border-(--hairline-bold)",
  },
  negative: {
    icon: TrendingDown,
    classes: "bg-(--accent-bg) text-(--accent) border border-(--hairline-bold)",
  },
  warning: {
    icon: AlertTriangle,
    classes: "bg-(--paper-warm) text-(--ink) border border-(--hairline-bold)",
  },
} as const

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.05,
    },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
}

export function QuickInsights({ insights, className }: QuickInsightsProps) {
  return (
    <motion.div
      className={cn(
        "flex gap-2 overflow-x-auto md:flex-wrap",
        className
      )}
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {insights.map((insight) => {
        const config = typeConfig[insight.type]
        const Icon = config.icon

        return (
          <motion.div
            key={insight.id}
            variants={itemVariants}
            className={cn(
              "rounded-full px-3 py-1.5 flex items-center gap-1.5 text-xs font-medium whitespace-nowrap",
              config.classes
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {insight.text}
          </motion.div>
        )
      })}
    </motion.div>
  )
}
