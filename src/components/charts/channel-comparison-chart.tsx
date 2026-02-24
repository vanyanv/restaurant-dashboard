"use client"

import { useState } from "react"
import { Bar, BarChart, XAxis, YAxis } from "recharts"
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { formatCurrency, formatNumber } from "@/lib/format"
import type { MenuChannelComparison } from "@/types/analytics"

interface ChannelComparisonChartProps {
  data: MenuChannelComparison[]
  className?: string
}

export function ChannelComparisonChart({
  data,
  className,
}: ChannelComparisonChartProps) {
  const [mode, setMode] = useState<"quantity" | "revenue">("quantity")

  const chartConfig = {
    fp: {
      label: "First Party",
      color: "hsl(var(--chart-1))",
    },
    tp: {
      label: "Third Party",
      color: "hsl(var(--chart-5))",
    },
  }

  const chartData = data.map((item) => ({
    name: item.category,
    fp: mode === "quantity" ? item.fpQuantitySold : item.fpSales,
    tp: mode === "quantity" ? item.tpQuantitySold : item.tpSales,
  }))

  if (chartData.length === 0) return null

  const formatter = mode === "quantity"
    ? (value: number | string) => {
        const n = typeof value === "number" ? value : Number(value)
        return formatNumber(n)
      }
    : (value: number | string) => {
        const n = typeof value === "number" ? value : Number(value)
        return formatCurrency(n)
      }

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <CardTitle className="text-base">Channel Comparison</CardTitle>
            <CardDescription>
              First-party vs third-party {mode === "quantity" ? "quantity" : "revenue"} by category
            </CardDescription>
          </div>
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={(v) => v && setMode(v as "quantity" | "revenue")}
          >
            <ToggleGroupItem value="quantity" size="sm" className="text-xs px-2.5 h-7">
              Qty
            </ToggleGroupItem>
            <ToggleGroupItem value="revenue" size="sm" className="text-xs px-2.5 h-7">
              Revenue
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig}>
          <BarChart
            accessibilityLayer
            data={chartData}
            margin={{ left: 12, right: 12 }}
          >
            <XAxis
              dataKey="name"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              fontSize={12}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(v) => formatter(v)}
              fontSize={12}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  formatter={(value, name) => {
                    const label = name === "fp" ? "FP" : "3P"
                    return `${label}: ${formatter(value as number)}`
                  }}
                />
              }
            />
            <Bar
              dataKey="fp"
              fill="var(--color-fp)"
              radius={[4, 4, 0, 0]}
            />
            <Bar
              dataKey="tp"
              fill="var(--color-tp)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
