"use client"

import { useRef } from "react"
import Link from "next/link"
import { formatCurrency } from "@/lib/format"
import { motion, useReducedMotion } from "framer-motion"
import type { ProductUsageKpis } from "@/types/product-usage"

interface ProductUsageKpiCardsProps {
  kpis: ProductUsageKpis
}

type Tone = "rest" | "warn" | "alert"

function wasteTone(wastePercent: number): Tone {
  if (wastePercent < 5) return "rest"
  if (wastePercent <= 15) return "warn"
  return "alert"
}

const TONE_STYLES: Record<Tone, { bg: string; border: string; valueColor: string }> = {
  rest: {
    bg: "rgba(255, 253, 247, 0.72)",
    border: "var(--hairline-bold)",
    valueColor: "var(--ink)",
  },
  warn: {
    bg: "var(--paper-warm)",
    border: "var(--hairline-bold)",
    valueColor: "var(--ink)",
  },
  alert: {
    bg: "var(--accent-bg)",
    border: "var(--accent)",
    valueColor: "var(--accent)",
  },
}

const CARDS: { key: keyof ProductUsageKpis; label: string; tone: Tone | "dynamic"; valueColor?: string }[] = [
  { key: "totalPurchasedCost", label: "Total Purchased", tone: "rest" },
  { key: "theoreticalIngredientCost", label: "Theoretical Cost", tone: "rest" },
  { key: "wasteEstimatedCost", label: "Waste Cost", tone: "rest", valueColor: "var(--subtract)" },
  { key: "wastePercent", label: "Waste %", tone: "dynamic" },
]

/**
 * Coverage panel shown in place of the waste tiles when the variance maths has
 * no basis. Publishing "99.4% waste" off a theoretical cost twelve times total
 * purchases teaches the owner to stop believing this page; the honest reading
 * is that recipes aren't mapped yet, so that is what we say.
 */
function CoverageNotice({ kpis }: ProductUsageKpiCardsProps) {
  const pct = Math.round(kpis.recipeCoverage * 100)
  return (
    <section className="inv-panel">
      <div className="inv-panel__head">
        <div>
          <div className="inv-panel__dept">Variance · not yet measurable</div>
          <h3 className="inv-panel__title">Recipe coverage is {pct}%</h3>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-muted) tabular-nums">
          {kpis.menuItemsCovered} of {kpis.menuItemsSold} items costed
        </span>
      </div>
      <p className="max-w-[68ch] text-[13px] leading-6 text-(--ink-muted)">
        Theoretical usage is derived from recipes, so with most sold items
        unmapped the theoretical side is unusable and every dollar purchased
        reads as waste. Purchases below are still accurate — the variance,
        waste and efficiency figures are withheld until coverage passes 60%.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-muted)">
            Total purchased
          </div>
          <div className="mt-0.5 text-xl font-semibold tabular-nums">
            {formatCurrency(kpis.totalPurchasedCost)}
          </div>
        </div>
        <Link href="/dashboard/recipes" className="toolbar-btn">
          Map recipes
        </Link>
      </div>
    </section>
  )
}

export function ProductUsageKpiCards({ kpis }: ProductUsageKpiCardsProps) {
  const hasAnimated = useRef(false)
  const prefersReducedMotion = useReducedMotion()

  if (!kpis.varianceReliable) return <CoverageNotice kpis={kpis} />

  const getValue = (key: keyof ProductUsageKpis): string => {
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
        const tone = card.tone === "dynamic" ? wasteTone(kpis.wastePercent) : card.tone
        const styles = TONE_STYLES[tone]
        const valueColor = card.valueColor ?? styles.valueColor

        return (
          <motion.section
            key={card.key}
            className="inv-panel inv-panel--flush relative overflow-hidden"
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
            style={{
              backgroundColor: styles.bg,
              borderColor: styles.border,
            }}
          >
            <div className="px-4 py-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">
                {card.label}
              </span>
              <div
                className="mt-1 text-xl font-semibold tabular-nums sm:text-2xl"
                style={{ color: valueColor }}
              >
                {getValue(card.key)}
              </div>
            </div>
          </motion.section>
        )
      })}
    </div>
  )
}
