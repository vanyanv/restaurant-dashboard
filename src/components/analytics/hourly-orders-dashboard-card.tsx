"use client"

import { useState, useEffect, useTransition } from "react"
import { Store } from "lucide-react"
import { Bar, BarChart, XAxis, YAxis } from "recharts"
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
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { getOrderPatterns } from "@/app/actions/store-actions"
import { todayInLA } from "@/lib/dashboard-utils"
import type { HourlyOrderPoint } from "@/types/analytics"
import { cn } from "@/lib/utils"

interface StoreOption {
  id: string
  name: string
}

interface HourlyOrdersDashboardCardProps {
  stores: StoreOption[]
  className?: string
}

const chartConfig = {
  orderCount: {
    label: "Orders",
    color: "hsl(var(--primary))",
  },
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value)

function getDateStr(period: "today" | "yesterday"): string {
  if (period === "today") return todayInLA()
  const d = new Date(todayInLA() + "T12:00:00Z") // noon to avoid DST edge
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
  const [isPending, startTransition] = useTransition()
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

  // Today: trim to current hour so chart grows live; Yesterday: full 24h
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
              onValueChange={(v) => v && setPeriod(v as "today" | "yesterday")}
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
      <CardContent className={cn("flex-1 pb-0", isLoading && "opacity-50 pointer-events-none")}>
        {isLoading && !hourlyData ? (
          <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
            Loading...
          </div>
        ) : chartData && chartData.some((h) => h.orderCount > 0) ? (
          <ChartContainer config={chartConfig} className="h-[200px] w-full">
            <BarChart accessibilityLayer data={chartData} margin={{ left: 0, right: 4, top: 4, bottom: 0 }}>
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={6}
                fontSize={10}
                interval={xInterval}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={4}
                width={28}
                fontSize={10}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    formatter={(value, name, item) => {
                      const point = item.payload as HourlyOrderPoint
                      return (
                        <div className="flex flex-col gap-0.5">
                          <span>{Number(value)} orders</span>
                          <span className="text-muted-foreground text-xs">
                            {formatCurrency(point.totalSales)} in sales
                          </span>
                        </div>
                      )
                    }}
                  />
                }
              />
              <Bar
                dataKey="orderCount"
                fill="var(--color-orderCount)"
                radius={[2, 2, 0, 0]}
              />
            </BarChart>
          </ChartContainer>
        ) : (
          <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
            No order data available
          </div>
        )}
      </CardContent>
    </Card>
  )
}
