"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatCurrency, formatPct } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { MoverItem } from "@/types/analytics"
import { TrendingUp, TrendingDown } from "lucide-react"
import { motion } from "framer-motion"

interface TopMoversProps {
  risers: MoverItem[]
  decliners: MoverItem[]
  className?: string
}

const listItemVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, delay: i * 0.06, ease: "easeOut" as const },
  }),
}

function MoverList({
  items,
  type,
}: {
  items: MoverItem[]
  type: "riser" | "decliner"
}) {
  const isRiser = type === "riser"

  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No {isRiser ? "rising" : "declining"} items for this period
      </p>
    )
  }

  return (
    <div className="space-y-0">
      {items.map((item, index) => (
        <motion.div
          key={item.itemName}
          custom={index}
          initial="hidden"
          animate="visible"
          variants={listItemVariants}
          className={cn(
            "flex items-center justify-between gap-3 border-b py-3 last:border-0"
          )}
        >
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{item.itemName}</div>
            <div className="text-xs text-muted-foreground">{item.category}</div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                isRiser
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                  : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400"
              )}
            >
              {formatPct(item.quantityChangePercent)}
            </span>
            <span className="text-xs text-muted-foreground">
              {formatCurrency(item.previousRevenue)} &rarr;{" "}
              {formatCurrency(item.currentRevenue)}
            </span>
          </div>
        </motion.div>
      ))}
    </div>
  )
}

export function TopMovers({ risers, decliners, className }: TopMoversProps) {
  return (
    <div className={cn("grid gap-4 md:grid-cols-2", className)}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            Rising Items
          </CardTitle>
        </CardHeader>
        <CardContent>
          <MoverList items={risers} type="riser" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingDown className="h-5 w-5 text-red-600 dark:text-red-400" />
            Declining Items
          </CardTitle>
        </CardHeader>
        <CardContent>
          <MoverList items={decliners} type="decliner" />
        </CardContent>
      </Card>
    </div>
  )
}
