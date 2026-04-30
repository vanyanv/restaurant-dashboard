"use client"

import { useEffect, useState, useTransition } from "react"
import { useIsMobile } from "@/hooks/use-mobile"
import { Line, LineChart, XAxis, YAxis, CartesianGrid } from "@/components/charts/recharts"
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { formatCompact, formatCurrency, formatDate } from "@/lib/format"
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
    color: "var(--accent)",
  },
  netRevenue: {
    label: "Net Revenue",
    color: "var(--ink)",
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
    ? "h-[200px] md:h-[220px] lg:h-[240px]"
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
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <h3
          className="font-display italic text-[17px] font-medium leading-tight tracking-[-0.01em] text-(--ink)"
          style={{ fontVariationSettings: '"opsz" 96, "SOFT" 40' }}
        >
          Revenue Trend
        </h3>
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
              className="text-xs px-2.5 h-7 rounded-none font-mono tracking-[0.08em]"
            >
              {p.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className={cn(isPending && "opacity-50 transition-opacity duration-200")}>
        <ChartContainer config={chartConfig} className={cn(chartHeight, "w-full")}>
          <LineChart
            accessibilityLayer
            data={data}
            margin={{ left: 12, right: 12, top: 8 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="var(--hairline)"
              strokeOpacity={1}
            />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={12}
              tickFormatter={formatDate}
              fontSize={11}
              tick={{ fill: "var(--ink-muted)" }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(v) => formatCompact(v)}
              width={isMobile ? 44 : 56}
              fontSize={11}
              tick={{ fill: "var(--ink-muted)" }}
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
              strokeWidth={1.5}
              strokeDasharray="4 3"
              strokeOpacity={0.55}
              dot={false}
              connectNulls
            />
          </LineChart>
        </ChartContainer>
      </div>
    </div>
  )
}
