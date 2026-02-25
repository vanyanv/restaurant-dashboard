"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Package,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { PriceAlert, OrderAnomaly } from "@/types/product-usage"

interface AlertsBannerProps {
  priceAlerts: PriceAlert[]
  orderAnomalies: OrderAnomaly[]
}

function getPriceAlertStyle(alert: PriceAlert) {
  if (alert.severity === "decrease") {
    return {
      icon: TrendingDown,
      bg: "bg-emerald-50 dark:bg-emerald-950/30",
      border: "border-emerald-200 dark:border-emerald-800",
      iconColor: "text-emerald-600 dark:text-emerald-400",
      badgeVariant: "outline" as const,
      badgeClass:
        "border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400",
    }
  }
  if (Math.abs(alert.changePercent) > 15) {
    return {
      icon: AlertTriangle,
      bg: "bg-red-50 dark:bg-red-950/30",
      border: "border-red-200 dark:border-red-800",
      iconColor: "text-red-600 dark:text-red-400",
      badgeVariant: "destructive" as const,
      badgeClass: "",
    }
  }
  return {
    icon: TrendingUp,
    bg: "bg-amber-50 dark:bg-amber-950/30",
    border: "border-amber-200 dark:border-amber-800",
    iconColor: "text-amber-600 dark:text-amber-400",
    badgeVariant: "outline" as const,
    badgeClass:
      "border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400",
  }
}

function getAnomalyStyle(anomaly: OrderAnomaly) {
  if (anomaly.type === "new_product") {
    return {
      icon: Sparkles,
      bg: "bg-purple-50 dark:bg-purple-950/30",
      border: "border-purple-200 dark:border-purple-800",
      iconColor: "text-purple-600 dark:text-purple-400",
      badgeClass:
        "border-purple-300 text-purple-700 dark:border-purple-700 dark:text-purple-400",
    }
  }
  return {
    icon: Package,
    bg: "bg-blue-50 dark:bg-blue-950/30",
    border: "border-blue-200 dark:border-blue-800",
    iconColor: "text-blue-600 dark:text-blue-400",
    badgeClass:
      "border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400",
  }
}

export function AlertsBanner({
  priceAlerts,
  orderAnomalies,
}: AlertsBannerProps) {
  const totalAlerts = priceAlerts.length + orderAnomalies.length
  const [isOpen, setIsOpen] = useState(totalAlerts > 0)

  if (totalAlerts === 0) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <CardTitle className="text-base">
              {totalAlerts} Alert{totalAlerts !== 1 ? "s" : ""}
            </CardTitle>
            <Badge variant="secondary" className="text-xs">
              {priceAlerts.length} price
            </Badge>
            <Badge variant="secondary" className="text-xs">
              {orderAnomalies.length} order
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsOpen(!isOpen)}
            className="h-8 w-8 p-0"
          >
            {isOpen ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardHeader>
      {isOpen && (
        <CardContent className="space-y-2 pt-0">
          {priceAlerts.map((alert, idx) => {
            const style = getPriceAlertStyle(alert)
            const Icon = style.icon
            return (
              <div
                key={`price-${idx}`}
                className={cn(
                  "flex items-start gap-3 rounded-md border p-3",
                  style.bg,
                  style.border
                )}
              >
                <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", style.iconColor)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">
                      {alert.productName}
                    </span>
                    <Badge
                      variant={style.badgeVariant}
                      className={cn("text-xs shrink-0", style.badgeClass)}
                    >
                      {alert.changePercent > 0 ? "+" : ""}
                      {alert.changePercent.toFixed(1)}%
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {alert.message}
                  </p>
                </div>
              </div>
            )
          })}
          {orderAnomalies.map((anomaly, idx) => {
            const style = getAnomalyStyle(anomaly)
            const Icon = style.icon
            return (
              <div
                key={`anomaly-${idx}`}
                className={cn(
                  "flex items-start gap-3 rounded-md border p-3",
                  style.bg,
                  style.border
                )}
              >
                <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", style.iconColor)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">
                      {anomaly.productName}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn("text-xs shrink-0", style.badgeClass)}
                    >
                      {anomaly.type === "new_product"
                        ? "New Product"
                        : anomaly.type === "quantity_spike"
                          ? "Qty Spike"
                          : "New Vendor"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {anomaly.details}
                  </p>
                </div>
              </div>
            )
          })}
        </CardContent>
      )}
    </Card>
  )
}
