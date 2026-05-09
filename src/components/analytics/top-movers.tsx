"use client"

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
      <p className="py-6 text-center text-sm text-(--ink-muted)">
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
          className="flex items-center justify-between gap-3 border-b border-(--hairline) py-3 last:border-0"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{item.itemName}</div>
            <div className="text-xs text-(--ink-muted)">{item.category}</div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span
              className={cn(
                "inline-flex items-center rounded-xs border border-(--hairline-bold) bg-(--accent-bg) px-2 py-0.5 text-xs font-medium tabular-nums",
                isRiser ? "text-(--accent-dark)" : "text-(--accent)"
              )}
            >
              {formatPct(item.quantityChangePercent)}
            </span>
            <span className="text-xs text-(--ink-muted) tabular-nums">
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
      <section className="inv-panel">
        <header className="inv-panel__head">
          <span className="inv-panel__dept flex items-center gap-2">
            <TrendingUp className="h-3 w-3 text-(--ink)" />
            Rising Items
          </span>
        </header>
        <MoverList items={risers} type="riser" />
      </section>

      <section className="inv-panel">
        <header className="inv-panel__head">
          <span className="inv-panel__dept flex items-center gap-2">
            <TrendingDown className="h-3 w-3 text-(--subtract)" />
            Declining Items
          </span>
        </header>
        <MoverList items={decliners} type="decliner" />
      </section>
    </div>
  )
}
