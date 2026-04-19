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
import { todayInLA } from "@/lib/dashboard-utils"
import type { HourlyOrderPoint } from "@/types/analytics"
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

function getDateStr(period: "today" | "yesterday"): string {
  if (period === "today") return todayInLA()
  const d = new Date(todayInLA() + "T12:00:00Z")
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
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

export function HourlyOrdersDashboardCard({
  stores,
  className,
}: HourlyOrdersDashboardCardProps) {
  const [hourlyData, setHourlyData] = useState<HourlyOrderPoint[] | null>(null)
  const [selectedStore, setSelectedStore] = useState("all")
  const [period, setPeriod] = useState<"today" | "yesterday">("today")
  const [isPending] = useTransition()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const storeId = selectedStore === "all" ? undefined : selectedStore
    const dateStr = getDateStr(period)

    getOrderPatterns(storeId, { startDate: dateStr, endDate: dateStr })
      .then((result) => setHourlyData(result?.hourly ?? null))
      .finally(() => setLoading(false))
  }, [period, selectedStore])

  const handleStoreChange = (value: string) => {
    setSelectedStore(value)
  }

  const isLoading = loading || isPending

  const chartData =
    hourlyData && period === "today"
      ? hourlyData.slice(0, getCurrentLAHour() + 1)
      : hourlyData
  const xInterval = chartData ? Math.max(1, Math.floor(chartData.length / 6)) : 3

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
                v && setPeriod(v as "today" | "yesterday")
              }
              disabled={isLoading}
            >
              <ToggleGroupItem value="today" className="h-6 px-2 text-xs">
                Today
              </ToggleGroupItem>
              <ToggleGroupItem value="yesterday" className="h-6 px-2 text-xs">
                Yday
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          {stores.length > 1 && (
            <Select value={selectedStore} onValueChange={handleStoreChange}>
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
        ) : chartData && chartData.some((h) => h.orderCount > 0) ? (
          <HourlyOrdersChart chartData={chartData} xInterval={xInterval} />
        ) : (
          <div className="h-[280px] md:h-[340px] lg:h-[380px] flex items-center justify-center text-sm text-muted-foreground">
            No order data available
          </div>
        )}
      </CardContent>
    </Card>
  )
}
