"use client"

import { useState, useTransition } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Sparkles, Loader2, AlertTriangle, Lightbulb, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { generateAiInsights } from "@/app/actions/product-usage-actions"
import type { ProductUsageData, AnomalyExplanation } from "@/types/product-usage"

interface AiInsightsPanelProps {
  data: ProductUsageData
}

export function AiInsightsPanel({ data }: AiInsightsPanelProps) {
  const [insights, setInsights] = useState<string[]>([])
  const [anomalyExplanations, setAnomalyExplanations] = useState<AnomalyExplanation[]>([])
  const [isPending, startTransition] = useTransition()
  const [hasGenerated, setHasGenerated] = useState(false)
  const [expanded, setExpanded] = useState(true)

  function handleGenerate() {
    startTransition(async () => {
      const topVariance = data.ingredientUsage
        .filter((i) => i.status === "over_ordered")
        .sort((a, b) => b.wasteEstimatedCost - a.wasteEstimatedCost)
        .slice(0, 10)
        .map((i) => ({
          name: i.ingredientName,
          variancePct: i.variancePct,
          wasteEstimatedCost: i.wasteEstimatedCost,
        }))

      const result = await generateAiInsights({
        kpis: data.kpis,
        topVarianceItems: topVariance,
        priceAlerts: data.priceAlerts,
        orderAnomalies: data.orderAnomalies,
        dateRange: data.dateRange,
      })

      setInsights(result.insights)
      setAnomalyExplanations(result.anomalyExplanations)
      setHasGenerated(true)
    })
  }

  if (!hasGenerated) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
        <Sparkles className="h-8 w-8 text-muted-foreground/50" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">AI-Powered Insights</p>
          <p className="text-xs text-muted-foreground/80">
            Analyze your purchasing patterns, waste, and price trends
          </p>
        </div>
        <Button
          onClick={handleGenerate}
          disabled={isPending}
          size="sm"
          className="gap-2"
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {isPending ? "Analyzing..." : "Generate Insights"}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors"
        >
          <Sparkles className="h-4 w-4 text-primary" />
          AI Analysis
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 text-muted-foreground transition-transform",
              !expanded && "-rotate-90"
            )}
          />
        </button>
        <Button
          onClick={handleGenerate}
          disabled={isPending}
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
        >
          {isPending ? (
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
          ) : (
            <Sparkles className="h-3 w-3 mr-1" />
          )}
          Refresh
        </Button>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-2">
              {/* Insights */}
              {insights.map((insight, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.08 }}
                  className="flex items-start gap-2.5 rounded-lg border bg-card p-3"
                >
                  <Lightbulb className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                  <p className="text-xs leading-relaxed">{insight}</p>
                </motion.div>
              ))}

              {/* Anomaly Explanations */}
              {anomalyExplanations.length > 0 && (
                <div className="pt-1 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Anomaly Explanations</p>
                  {anomalyExplanations.map((exp, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: (insights.length + i) * 0.08 }}
                      className="flex items-start gap-2.5 rounded-lg border bg-card p-3"
                    >
                      <AlertTriangle className="h-4 w-4 text-orange-500 mt-0.5 shrink-0" />
                      <div className="space-y-1 min-w-0">
                        <p className="text-xs leading-relaxed">{exp.explanation}</p>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px]",
                              exp.confidence === "high" && "text-emerald-600",
                              exp.confidence === "medium" && "text-amber-600",
                              exp.confidence === "low" && "text-muted-foreground"
                            )}
                          >
                            {exp.confidence} confidence
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">
                            {exp.suggestedAction}
                          </span>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}

              {insights.length === 0 && anomalyExplanations.length === 0 && (
                <div className="text-center py-4 text-xs text-muted-foreground">
                  No insights generated. Try configuring more recipes for better analysis.
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
