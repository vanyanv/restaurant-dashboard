"use client"

import { useMemo } from "react"
import { Bar, BarChart, XAxis, YAxis } from "@/components/charts/recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { formatCurrency } from "@/lib/format"
import type { CategorySummaryRow } from "@/types/product-usage"

interface CategorySpendChartProps {
  data: CategorySummaryRow[]
}

const chartConfig = {
  purchasedCost: {
    label: "Purchased",
    color: "var(--ink-muted)",
  },
  theoreticalUsageCost: {
    label: "Theoretical",
    color: "var(--accent)",
  },
}

export function CategorySpendChart({ data }: CategorySpendChartProps) {
  const chartData = useMemo(() => {
    return [...data].sort((a, b) => b.purchasedCost - a.purchasedCost)
  }, [data])

  if (chartData.length === 0) return null

  return (
    <section className="inv-panel">
      <header className="inv-panel__head">
        <div className="flex flex-col gap-1">
          <span className="inv-panel__dept">Category Spend</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">
            Purchased vs theoretical · by category
          </span>
        </div>
      </header>
      <ChartContainer config={chartConfig} className="h-[300px] w-full">
        <BarChart
          accessibilityLayer
          data={chartData}
          margin={{ left: 12, right: 12 }}
        >
          <XAxis
            dataKey="category"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tick={{ fontSize: 11, fill: "var(--ink-muted)" }}
            interval={0}
            angle={-30}
            textAnchor="end"
            height={60}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={(value) => formatCurrency(value)}
            tick={{ fontSize: 11, fill: "var(--ink-muted)" }}
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
            dataKey="purchasedCost"
            fill="var(--color-purchasedCost)"
            radius={[2, 2, 0, 0]}
          />
          <Bar
            dataKey="theoreticalUsageCost"
            fill="var(--color-theoreticalUsageCost)"
            radius={[2, 2, 0, 0]}
          />
        </BarChart>
      </ChartContainer>
      <div className="mt-4 flex items-center justify-center gap-x-4 text-xs text-(--ink-muted)">
        <div className="flex items-center gap-1.5">
          <div
            className="h-2.5 w-2.5"
            style={{ backgroundColor: "var(--ink-muted)" }}
          />
          <span>Purchased</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="h-2.5 w-2.5"
            style={{ backgroundColor: "var(--accent)" }}
          />
          <span>Theoretical</span>
        </div>
      </div>
    </section>
  )
}
