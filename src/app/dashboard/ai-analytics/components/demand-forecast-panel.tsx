"use client"

import { useState, useTransition } from "react"
import { motion } from "framer-motion"
import { TrendingUp, Loader2, AlertCircle, CheckCircle2, HelpCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { generateDemandForecast } from "@/app/actions/product-usage-actions"
import type { DemandForecast } from "@/types/product-usage"

interface DemandForecastPanelProps {
  storeId?: string
}

export function DemandForecastPanel({ storeId }: DemandForecastPanelProps) {
  const [forecasts, setForecasts] = useState<DemandForecast[]>([])
  const [isPending, startTransition] = useTransition()
  const [hasGenerated, setHasGenerated] = useState(false)

  function handleGenerate() {
    startTransition(async () => {
      const result = await generateDemandForecast(storeId)
      setForecasts(result)
      setHasGenerated(true)
    })
  }

  if (!hasGenerated) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
        <TrendingUp className="h-8 w-8 text-muted-foreground/50" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">Demand Forecast</p>
          <p className="text-xs text-muted-foreground/80">
            Predict next week&apos;s ingredient needs based on 4-week sales trends
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
            <TrendingUp className="h-4 w-4" />
          )}
          {isPending ? "Forecasting..." : "Forecast Next Week"}
        </Button>
      </div>
    )
  }

  if (forecasts.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">
        <p>No forecast data available.</p>
        <p className="text-xs mt-1">
          Configure recipes and ensure you have recent sales data.
        </p>
      </div>
    )
  }

  // Sort: needs reorder first, then by predicted usage
  const sorted = [...forecasts].sort((a, b) => {
    if (a.needsReorder !== b.needsReorder) return a.needsReorder ? -1 : 1
    return b.predictedUsageNextWeek - a.predictedUsageNextWeek
  })

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium">Next Week Forecast</p>
          <Badge variant="outline" className="text-xs">
            {forecasts.filter((f) => f.needsReorder).length} need reorder
          </Badge>
        </div>
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
            <TrendingUp className="h-3 w-3 mr-1" />
          )}
          Refresh
        </Button>
      </div>

      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ingredient</TableHead>
              <TableHead className="text-right">Predicted</TableHead>
              <TableHead className="text-right">Sug. Order</TableHead>
              <TableHead className="text-right">Stock</TableHead>
              <TableHead className="text-center">Confidence</TableHead>
              <TableHead className="text-center">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TooltipProvider>
              {sorted.map((forecast, i) => (
                <motion.tr
                  key={forecast.ingredientName}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className={cn(
                    "border-b transition-colors hover:bg-muted/50",
                    forecast.needsReorder && "bg-red-50/50 dark:bg-red-950/10"
                  )}
                >
                  <TableCell className="font-medium text-sm">
                    <Tooltip>
                      <TooltipTrigger className="flex items-center gap-1.5 text-left">
                        <span className="truncate max-w-[180px]">
                          {forecast.ingredientName}
                        </span>
                        <HelpCircle className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-[280px]">
                        <p className="text-xs">{forecast.reasoning}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell className="text-right text-sm font-mono">
                    {forecast.predictedUsageNextWeek.toFixed(1)} {forecast.unit}
                  </TableCell>
                  <TableCell className="text-right text-sm font-mono">
                    {forecast.suggestedOrderQty > 0
                      ? `${forecast.suggestedOrderQty.toFixed(1)} ${forecast.unit}`
                      : "-"}
                  </TableCell>
                  <TableCell className="text-right text-sm font-mono">
                    {forecast.currentEstimatedStock.toFixed(1)} {forecast.unit}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px]",
                        forecast.confidence === "high" && "text-emerald-600 border-emerald-200",
                        forecast.confidence === "medium" && "text-amber-600 border-amber-200",
                        forecast.confidence === "low" && "text-muted-foreground"
                      )}
                    >
                      {forecast.confidence}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    {forecast.needsReorder ? (
                      <AlertCircle className="h-4 w-4 text-red-500 inline-block" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 inline-block" />
                    )}
                  </TableCell>
                </motion.tr>
              ))}
            </TooltipProvider>
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
