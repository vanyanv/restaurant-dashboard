"use client"

import { useMemo, useState } from "react"
import { useIsMobile } from "@/hooks/use-mobile"
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
import type { MenuItemRanked } from "@/types/analytics"

interface MenuTopItemsChartProps {
  data: MenuItemRanked[]
  className?: string
}

export function MenuTopItemsChart({ data, className }: MenuTopItemsChartProps) {
  const [mode, setMode] = useState<"quantity" | "revenue">("quantity")
  const isMobile = useIsMobile()

  const chartData = useMemo(() => {
    return [...data]
      .sort((a, b) =>
        mode === "quantity"
          ? a.totalQuantitySold - b.totalQuantitySold
          : a.totalSales - b.totalSales
      )
  }, [data, mode])

  const chartConfig = mode === "quantity"
    ? {
        fp: { label: "First Party", color: "hsl(var(--chart-1))" },
        tp: { label: "Third Party", color: "hsl(var(--chart-5))" },
      }
    : {
        fp: { label: "FP Revenue", color: "hsl(var(--chart-1))" },
        tp: { label: "3P Revenue", color: "hsl(var(--chart-5))" },
      }

  const mapped = chartData.map((item) => ({
    name: item.itemName,
    fp: mode === "quantity" ? item.fpQuantitySold : item.fpSales,
    tp: mode === "quantity" ? item.tpQuantitySold : item.tpSales,
  }))

  const chartHeight = Math.max(200, mapped.length * 40 + 40)

  if (mapped.length === 0) return null

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
            <CardTitle className="text-base">Top Selling Items</CardTitle>
            <CardDescription>
              Top {data.length} items by {mode === "quantity" ? "quantity sold" : "revenue"} (FP vs 3P)
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
        <ChartContainer
          config={chartConfig}
          className="w-full"
          style={{ height: chartHeight }}
        >
          <BarChart
            accessibilityLayer
            data={mapped}
            layout="vertical"
            margin={{ left: 12, right: 12 }}
          >
            <XAxis
              type="number"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(v) => formatter(v)}
            />
            <YAxis
              type="category"
              dataKey="name"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={isMobile ? 80 : 120}
              tick={{ fontSize: isMobile ? 11 : 12 }}
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
              stackId="stack"
              fill="var(--color-fp)"
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="tp"
              stackId="stack"
              fill="var(--color-tp)"
              radius={[0, 4, 4, 0]}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
