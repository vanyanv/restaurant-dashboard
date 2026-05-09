"use client"

import { useIsMobile } from "@/hooks/use-mobile"
import { Bar, BarChart, XAxis, YAxis } from "@/components/charts/recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { cn } from "@/lib/utils"

interface RatingStoreChartProps {
  data: Array<{ storeId: string; storeName: string; avgRating: number; count: number }>
  className?: string
}

export function RatingStoreChart({
  data,
  className,
}: RatingStoreChartProps) {
  const isMobile = useIsMobile()

  const chartConfig = {
    avgRating: {
      label: "Avg Rating",
      color: "var(--accent)",
    },
    count: {
      label: "Reviews",
      color: "var(--ink-muted)",
    },
  }

  const chartData = [...data].sort((a, b) => b.avgRating - a.avgRating)
  const barHeight = 40
  const chartHeight = Math.max(180, chartData.length * barHeight + 40)

  return (
    <section className={cn("inv-panel", className)}>
      <header className="inv-panel__head">
        <div className="flex flex-col gap-1">
          <span className="inv-panel__dept">Ratings by Store</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">
            Average rating per location
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
            domain={[0, 5]}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
          />
          <YAxis
            type="category"
            dataKey="storeName"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            width={isMobile ? 80 : 120}
            tick={{ fontSize: isMobile ? 11 : 14 }}
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                formatter={(value, name) => {
                  if (name === "avgRating") return `${Number(value).toFixed(2)} stars`
                  return `${value} reviews`
                }}
              />
            }
          />
          <Bar
            dataKey="avgRating"
            fill="var(--color-avgRating)"
            radius={[0, 2, 2, 0]}
          />
        </BarChart>
      </ChartContainer>
    </section>
  )
}
