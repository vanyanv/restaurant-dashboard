"use client"

import { useMemo } from "react"
import { useIsMobile } from "@/hooks/use-mobile"
import { Line, LineChart, XAxis, YAxis } from "@/components/charts/recharts"
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
import { formatCurrency, formatDate } from "@/lib/format"
import type { PlatformTrendPoint } from "@/types/analytics"

const PLATFORM_LABELS: Record<string, string> = {
  "css-pos": "Otter POS",
  "bnm-web": "Otter Online",
  doordash: "DoorDash",
  ubereats: "Uber Eats",
  grubhub: "Grubhub",
  caviar: "Caviar",
}

const PLATFORM_COLORS: Record<string, string> = {
  "css-pos": "hsl(var(--chart-1))",
  "bnm-web": "hsl(var(--chart-2))",
  doordash: "hsl(var(--chart-3))",
  ubereats: "hsl(var(--chart-4))",
  grubhub: "hsl(var(--chart-5))",
}

interface PlatformTrendChartProps {
  data: PlatformTrendPoint[]
  title?: string
  description?: string
  className?: string
}

export function PlatformTrendChart({
  data,
  title = "Platform Trends",
  description = "Gross sales per platform over time",
  className,
}: PlatformTrendChartProps) {
  const { chartData, platforms, chartConfig } = useMemo(() => {
    // Get unique platforms
    const platformSet = new Set<string>()
    for (const d of data) platformSet.add(d.platform)
    const platforms = Array.from(platformSet)

    // Pivot: { date, "css-pos": n, "doordash": n, ... }
    const byDate: Record<string, Record<string, number>> = {}
    for (const d of data) {
      if (!byDate[d.date]) byDate[d.date] = {}
      byDate[d.date][d.platform] = d.grossSales
    }

    const chartData = Object.entries(byDate)
      .map(([date, values]) => ({ date, ...values }))
      .sort((a, b) => a.date.localeCompare(b.date))

    // Build chart config
    const chartConfig: ChartConfig = {}
    for (const p of platforms) {
      chartConfig[p] = {
        label: PLATFORM_LABELS[p] || p,
        color: PLATFORM_COLORS[p] || "hsl(var(--primary))",
      }
    }

    return { chartData, platforms, chartConfig }
  }, [data])

  const isMobile = useIsMobile()

  if (data.length === 0) return null

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[240px] md:h-[280px] lg:h-[300px] w-full">
          <LineChart
            accessibilityLayer
            data={chartData}
            margin={{ left: 12, right: 12 }}
          >
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={formatDate}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(v) => formatCurrency(v)}
              width={isMobile ? 55 : 80}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={formatDate}
                  formatter={(value, name) => {
                    const n = typeof value === "number" ? value : Number(value)
                    const label =
                      PLATFORM_LABELS[name as string] || (name as string)
                    return `${label}: ${formatCurrency(n)}`
                  }}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            {platforms.map((platform) => (
              <Line
                key={platform}
                type="monotone"
                dataKey={platform}
                stroke={`var(--color-${platform})`}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
