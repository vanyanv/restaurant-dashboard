"use client"

import { useMemo } from "react"
import { useIsMobile } from "@/hooks/use-mobile"
import { Line, LineChart, XAxis, YAxis } from "@/components/charts/recharts"
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart"
import { cn } from "@/lib/utils"
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
  "css-pos": "var(--ink)",
  "bnm-web": "var(--ink-muted)",
  doordash: "var(--platform-doordash)",
  ubereats: "var(--platform-ubereats)",
  grubhub: "var(--platform-grubhub)",
  caviar: "var(--platform-chownow)",
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
        color: PLATFORM_COLORS[p] || "var(--accent)",
      }
    }

    return { chartData, platforms, chartConfig }
  }, [data])

  const isMobile = useIsMobile()

  if (data.length === 0) return null

  return (
    <section className={cn("inv-panel", className)}>
      <header className="inv-panel__head">
        <div className="flex flex-col gap-1">
          <span className="inv-panel__dept">{title}</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">
            {description}
          </span>
        </div>
      </header>
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
    </section>
  )
}
