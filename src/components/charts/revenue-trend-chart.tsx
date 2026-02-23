"use client"

import { useEffect, useState, useTransition } from "react"
import { useIsMobile } from "@/hooks/use-mobile"
import { Line, LineChart, XAxis, YAxis, CartesianGrid } from "recharts"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { formatCurrency, formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { getRevenueTrendData } from "@/app/actions/store-actions"
import { ChartSkeleton } from "@/components/skeletons"
import type { DailyTrend } from "@/types/analytics"

const TREND_PRESETS = [
  { label: "7D", value: "7" },
  { label: "14D", value: "14" },
  { label: "30D", value: "30" },
  { label: "90D", value: "90" },
] as const

const chartConfig: ChartConfig = {
  grossRevenue: {
    label: "Gross Revenue",
    color: "hsl(var(--primary))",
  },
  netRevenue: {
    label: "Net Revenue",
    color: "hsl(var(--chart-2))",
  },
}

interface RevenueTrendChartProps {
  className?: string
  compact?: boolean
}

export function RevenueTrendChart({ className, compact }: RevenueTrendChartProps) {
  const isMobile = useIsMobile()
  const [data, setData] = useState<DailyTrend[] | null>(null)
  const [days, setDays] = useState(7)
  const [isPending, startTransition] = useTransition()
  const [initialLoading, setInitialLoading] = useState(true)

  useEffect(() => {
    startTransition(async () => {
      const result = await getRevenueTrendData({ days })
      setData(result?.dailyTrends ?? null)
      setInitialLoading(false)
    })
  }, [days])

  const handleDaysChange = (newDays: number) => {
    setDays(newDays)
  }

  const chartHeight = compact
    ? "h-[250px] md:h-[280px] lg:h-[300px]"
    : "h-[280px] md:h-[340px] lg:h-[380px]"

  if (initialLoading) {
    return (
      <ChartSkeleton
        height={chartHeight}
        showToggle
        className={className}
      />
    )
  }

  if (!data || data.length === 0) return null

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <CardTitle className="text-base">Revenue Trend</CardTitle>
            <CardDescription>Gross vs net revenue across all stores</CardDescription>
          </div>
          <ToggleGroup
            type="single"
            value={String(days)}
            onValueChange={(v) => v && handleDaysChange(Number(v))}
            disabled={isPending}
          >
            {TREND_PRESETS.map((p) => (
              <ToggleGroupItem
                key={p.value}
                value={p.value}
                size="sm"
                className="text-xs px-2.5 h-7"
              >
                {p.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </CardHeader>
      <CardContent className={cn(isPending && "opacity-50 transition-opacity duration-200")}>
        <ChartContainer config={chartConfig} className={cn(chartHeight, "w-full")}>
          <LineChart
            accessibilityLayer
            data={data}
            margin={{ left: 12, right: 12, top: 8 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="hsl(var(--border))"
              strokeOpacity={0.5}
            />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={12}
              tickFormatter={formatDate}
              fontSize={12}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(v) => formatCurrency(v)}
              width={isMobile ? 55 : 80}
              fontSize={12}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={formatDate}
                  formatter={(value) => {
                    const n = typeof value === "number" ? value : Number(value)
                    return formatCurrency(n)
                  }}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Line
              dataKey="grossRevenue"
              type="monotone"
              stroke="var(--color-grossRevenue)"
              strokeWidth={2.5}
              dot={false}
              connectNulls
            />
            <Line
              dataKey="netRevenue"
              type="monotone"
              stroke="var(--color-netRevenue)"
              strokeWidth={2}
              strokeDasharray="5 3"
              dot={false}
              connectNulls
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
