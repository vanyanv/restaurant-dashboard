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
    classes: "bg-muted text-muted-foreground",
  },
  positive: {
    icon: TrendingUp,
    classes:
      "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400",
  },
  negative: {
    icon: TrendingDown,
    classes: "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-400",
  },
  warning: {
    icon: AlertTriangle,
    classes:
      "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400",
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
