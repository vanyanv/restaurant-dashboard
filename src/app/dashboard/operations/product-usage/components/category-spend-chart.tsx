"use client"

import { useMemo } from "react"
import { Bar, BarChart, XAxis, YAxis } from "@/components/charts/recharts"
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
import type { CategorySummaryRow } from "@/types/product-usage"

interface CategorySpendChartProps {
  data: CategorySummaryRow[]
}

const chartConfig = {
  purchasedCost: {
    label: "Purchased",
    color: "hsl(20, 91%, 48%)",
  },
  theoreticalUsageCost: {
    label: "Theoretical",
    color: "hsl(0, 72%, 51%)",
  },
}

export function CategorySpendChart({ data }: CategorySpendChartProps) {
  const chartData = useMemo(() => {
    return [...data].sort((a, b) => b.purchasedCost - a.purchasedCost)
  }, [data])

  if (chartData.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Category Spend</CardTitle>
        <CardDescription>
          Purchased vs theoretical cost by invoice category
        </CardDescription>
      </CardHeader>
      <CardContent>
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
              tick={{ fontSize: 11 }}
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
              tick={{ fontSize: 11 }}
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
              radius={[4, 4, 0, 0]}
            />
            <Bar
              dataKey="theoreticalUsageCost"
              fill="var(--color-theoreticalUsageCost)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ChartContainer>
        <div className="mt-4 flex items-center justify-center gap-x-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <div
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: "hsl(20, 91%, 48%)" }}
            />
            <span>Purchased</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: "hsl(0, 72%, 51%)" }}
            />
            <span>Theoretical</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
