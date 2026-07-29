"use client"

import { useIsMobile } from "@/hooks/use-mobile"
import { Bar, BarChart, XAxis, YAxis } from "@/components/charts/recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { cn } from "@/lib/utils"
import { formatCompact } from "@/lib/format"

interface StoreComparisonChartProps {
  data: Array<{
    storeName: string
    grossSales: number
    netSales: number
  }>
  title?: string
  description?: string
  className?: string
}

export function StoreComparisonChart({
  data,
  title = "Store Comparison",
  description = "Gross and net sales by location",
  className,
}: StoreComparisonChartProps) {
  const isMobile = useIsMobile()

  // Chart vocabulary: solid ink = gross, muted ink = net. Red is reserved
  // for flagged/over-target state — never a routine data series.
  const chartConfig = {
    grossSales: {
      label: "Gross Sales",
      color: "var(--ink)",
    },
    netSales: {
      label: "Net Sales",
      color: "var(--ink-muted)",
    },
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value)
  }

  const chartData = [...data].sort((a, b) => b.grossSales - a.grossSales)

  const barHeight = 40
  const chartHeight = Math.max(180, chartData.length * barHeight + 40)

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
      <ChartContainer
        config={chartConfig}
        className="w-full"
        style={{ height: chartHeight }}
      >
        <BarChart
          accessibilityLayer
          data={chartData}
          layout="vertical"
          margin={{ left: 12, right: 12 }}
        >
          <XAxis
            type="number"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tick={{ fontSize: 10 }}
            tickFormatter={formatCompact}
          />
          <YAxis
            type="category"
            dataKey="storeName"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            width={isMobile ? 90 : 150}
            tick={{ fontSize: isMobile ? 10 : 12 }}
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                formatter={(value) => {
                  const numValue =
                    typeof value === "number" ? value : Number(value)
                  return formatCurrency(numValue)
                }}
              />
            }
          />
          <Bar
            dataKey="grossSales"
            fill="var(--color-grossSales)"
            radius={[0, 2, 2, 0]}
          />
          <Bar
            dataKey="netSales"
            fill="var(--color-netSales)"
            radius={[0, 2, 2, 0]}
          />
        </BarChart>
      </ChartContainer>
    </section>
  )
}
