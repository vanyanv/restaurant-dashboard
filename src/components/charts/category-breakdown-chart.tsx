"use client"

import { memo, useMemo } from "react"
import { Pie, PieChart, Cell } from "@/components/charts/recharts"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { formatCurrency } from "@/lib/format"
import type { MenuCategorySalesBreakdown } from "@/types/analytics"

interface CategoryBreakdownChartProps {
  data: MenuCategorySalesBreakdown[]
  className?: string
}

const COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--primary) / 0.6)",
]

function CategoryBreakdownChartImpl({
  data,
  className,
}: CategoryBreakdownChartProps) {
  const { chartData, chartConfig } = useMemo(() => {
    // Group smallest categories into "Other" if >6
    let processed = [...data]
    if (processed.length > 6) {
      const top5 = processed.slice(0, 5)
      const rest = processed.slice(5)
      const otherSales = rest.reduce((s, c) => s + c.totalSales, 0)
      const otherQty = rest.reduce((s, c) => s + c.totalQuantitySold, 0)
      const totalSales = data.reduce((s, c) => s + c.totalSales, 0)
      processed = [
        ...top5,
        {
          category: "Other",
          totalSales: otherSales,
          totalQuantitySold: otherQty,
          fpSales: rest.reduce((s, c) => s + c.fpSales, 0),
          tpSales: rest.reduce((s, c) => s + c.tpSales, 0),
          percentOfTotal: totalSales > 0 ? (otherSales / totalSales) * 100 : 0,
        },
      ]
    }

    const config: Record<string, { label: string; color: string }> = {}
    const items = processed.map((cat, i) => {
      const key = cat.category.replace(/\s+/g, "_").toLowerCase()
      config[key] = {
        label: cat.category,
        color: COLORS[i % COLORS.length],
      }
      return {
        name: cat.category,
        key,
        value: cat.totalSales,
        percent: cat.percentOfTotal,
        fill: COLORS[i % COLORS.length],
      }
    })

    return { chartData: items, chartConfig: config }
  }, [data])

  const total = chartData.reduce((s, d) => s + d.value, 0)
  if (total === 0) return null

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">Category Breakdown</CardTitle>
        <CardDescription>Sales distribution by menu category</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[200px] md:max-h-[250px]">
          <PieChart>
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value) => {
                    const numValue = typeof value === "number" ? value : Number(value)
                    return formatCurrency(numValue)
                  }}
                />
              }
            />
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              innerRadius={60}
              outerRadius={80}
              strokeWidth={2}
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.fill} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
        <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm">
          {chartData.map((entry) => (
            <div key={entry.key} className="flex items-center gap-2">
              <div
                className="h-3 w-3 rounded-full shrink-0"
                style={{ backgroundColor: entry.fill }}
              />
              <span className="text-muted-foreground truncate max-w-[100px]">{entry.name}</span>
              <span className="font-medium">{entry.percent.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export const CategoryBreakdownChart = memo(CategoryBreakdownChartImpl)
