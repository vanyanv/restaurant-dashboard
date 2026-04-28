"use client"

import { useState, useEffect, useTransition } from "react"
import dynamic from "next/dynamic"
import { Store } from "lucide-react"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { getOrderPatterns } from "@/app/actions/store-actions"
import type {
  HourlyComparisonPeriod,
  HourlyOrderPoint,
  OrderPatternsHourlyComparison,
} from "@/types/analytics"
import { cn } from "@/lib/utils"

const HourlyOrdersChart = dynamic(
  () =>
    import("./hourly-orders-chart-inner").then((m) => ({
      default: m.HourlyOrdersChart,
    })),
  {
    loading: () => (
      <div className="h-[280px] md:h-[340px] lg:h-[380px] flex items-center justify-center text-sm text-muted-foreground">
        Loading chart…
      </div>
    ),
    ssr: false,
  }
)

interface StoreOption {
  id: string
  name: string
}

interface HourlyOrdersDashboardCardProps {
  stores: StoreOption[]
  className?: string
}

function getCurrentLAHour(): number {
  return parseInt(
    new Date().toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "numeric",
      hour12: false,
    })
  )
}

const PERIOD_LABELS: Record<HourlyComparisonPeriod, string> = {
  today: "Today",
  yesterday: "Yday",
  "this-week": "Wk",
  "last-week": "Last Wk",
}

const PACE_LABELS: Record<HourlyComparisonPeriod, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "this-week": "This week",
  "last-week": "Last week",
}

function formatPace(pct: number): string {
  const sign = pct > 0 ? "+" : ""
  return `${sign}${pct.toFixed(0)}%`
}

export function HourlyOrdersDashboardCard({
  stores,
  className,
}: HourlyOrdersDashboardCardProps) {
  const [hourlyData, setHourlyData] = useState<HourlyOrderPoint[] | null>(null)
  const [comparison, setComparison] =
    useState<OrderPatternsHourlyComparison | null>(null)
  const [selectedStore, setSelectedStore] = useState("all")
  const [period, setPeriod] = useState<HourlyComparisonPeriod>("today")
  const [isPending] = useTransition()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const storeId = selectedStore === "all" ? undefined : selectedStore

    getOrderPatterns(storeId, { period })
      .then((result) => {
        setHourlyData(result?.hourly ?? null)
        setComparison(result?.hourlyComparison ?? null)
      })
      .finally(() => setLoading(false))
  }, [period, selectedStore])

  const isLoading = loading || isPending

  // Slice to the current LA hour only for "today" (matches the prior behavior
  // of not showing future-hour empty bars). Other periods show all 24 hours.
  const currentLAHour = period === "today" ? getCurrentLAHour() : null
  const chartData =
    hourlyData && currentLAHour !== null
      ? hourlyData.slice(0, currentLAHour + 1)
      : hourlyData
  const xInterval = chartData ? Math.max(1, Math.floor(chartData.length / 6)) : 3

  const showPace =
    comparison &&
    comparison.pacePct !== null &&
    comparison.baselineWeeks > 0

  return (
    <Card className={cn("flex flex-col py-3 gap-2", className)}>
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm">Busiest Hours</CardTitle>
            <ToggleGroup
              type="single"
              value={period}
              onValueChange={(v) =>
                v && setPeriod(v as HourlyComparisonPeriod)
              }
              disabled={isLoading}
            >
              {(
                [
                  "today",
                  "yesterday",
                  "this-week",
                  "last-week",
                ] as const
              ).map((p) => (
                <ToggleGroupItem
                  key={p}
                  value={p}
                  className="h-6 px-2 text-xs"
                >
                  {PERIOD_LABELS[p]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          {stores.length > 1 && (
            <Select value={selectedStore} onValueChange={setSelectedStore}>
              <SelectTrigger className="h-7 w-[140px] text-xs">
                <Store className="mr-1 h-3 w-3 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stores</SelectItem>
                {stores.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        {showPace && comparison && (
          <div
            className="mt-1 flex items-baseline gap-2 text-xs"
            style={{
              fontFamily: "var(--font-dm-sans), sans-serif",
              fontVariantNumeric: "tabular-nums lining-nums",
            }}
          >
            <span style={{ color: "var(--ink-muted)" }}>
              {PACE_LABELS[comparison.period]}:
            </span>
            <span
              style={{
                fontWeight: 600,
                color: "var(--ink)",
              }}
            >
              {comparison.currentTotal} orders
            </span>
            <span
              style={{
                fontWeight: 600,
                color:
                  comparison.pacePct! > 0
                    ? "var(--accent)"
                    : comparison.pacePct! < 0
                    ? "var(--subtract)"
                    : "var(--ink-muted)",
              }}
            >
              {formatPace(comparison.pacePct!)}
            </span>
            <span style={{ color: "var(--ink-muted)" }}>
              vs avg {comparison.weekdayLabel}
              {comparison.baselineWeeks < 4
                ? ` (${comparison.baselineWeeks} wk${
                    comparison.baselineWeeks === 1 ? "" : "s"
                  })`
                : " (4 wks)"}
            </span>
          </div>
        )}
      </CardHeader>
      <CardContent
        className={cn(
          "flex-1 pb-0",
          isLoading && "opacity-50 pointer-events-none"
        )}
      >
        {isLoading && !hourlyData ? (
          <div className="h-[280px] md:h-[340px] lg:h-[380px] flex items-center justify-center text-sm text-muted-foreground">
            Loading...
          </div>
        ) : chartData &&
          chartData.some(
            (h) => h.orderCount > 0 || h.avgOrderCount > 0
          ) ? (
          <HourlyOrdersChart
            chartData={chartData}
            xInterval={xInterval}
            currentLAHour={currentLAHour}
            showAvgLine={
              comparison !== null && comparison.baselineWeeks > 0
            }
          />
        ) : (
          <div className="h-[280px] md:h-[340px] lg:h-[380px] flex items-center justify-center text-sm text-muted-foreground">
            No order data available
          </div>
        )}
      </CardContent>
    </Card>
  )
}
