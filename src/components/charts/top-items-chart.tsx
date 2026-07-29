"use client"

import { useMemo } from "react"
import { useIsMobile } from "@/hooks/use-mobile"
import { Bar, BarChart, XAxis, YAxis } from "@/components/charts/recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { cn } from "@/lib/utils"
import type { MenuCategoryData } from "@/types/analytics"

interface TopItemsChartProps {
  data: MenuCategoryData
  title?: string
  description?: string
  className?: string
}

export function TopItemsChart({
  data,
  title = "Top Selling Items",
  description = "Best-selling items by quantity (FP vs 3P)",
  className,
}: TopItemsChartProps) {
  const chartData = useMemo(() => {
    const allItems = data.categories.flatMap((cat) =>
      cat.items.map((item) => ({
        name: item.itemName,
        fpQty: item.fpQuantitySold,
        tpQty: item.tpQuantitySold,
        totalQty: item.totalQuantitySold,
      }))
    )
    return allItems
      .sort((a, b) => b.totalQty - a.totalQty)
      .slice(0, 10)
      .reverse()
  }, [data])

  const isMobile = useIsMobile()

  // Editorial tones, not the stock shadcn chart palette: first-party in
  // solid ink, third-party in muted ink — labeled via the tooltip.
  const chartConfig = {
    fpQty: {
      label: "First Party",
      color: "var(--ink)",
    },
    tpQty: {
      label: "Third Party",
      color: "var(--ink-muted)",
    },
  }

  const chartHeight = Math.max(200, chartData.length * 40 + 40)

  if (chartData.length === 0) return null

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
            />
            <YAxis
              type="category"
              dataKey="name"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={isMobile ? 96 : 190}
              tick={{ fontSize: isMobile ? 10 : 11 }}
              tickFormatter={(name: string) =>
                name.length > 26 ? `${name.slice(0, 25)}…` : name
              }
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  formatter={(value, name) => {
                    const label = name === "fpQty" ? "FP" : "3P"
                    return `${label}: ${value}`
                  }}
                />
              }
            />
            <Bar
              dataKey="fpQty"
              stackId="qty"
              fill="var(--color-fpQty)"
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="tpQty"
              stackId="qty"
              fill="var(--color-tpQty)"
              radius={[0, 4, 4, 0]}
            />
          </BarChart>
        </ChartContainer>
    </section>
  )
}
