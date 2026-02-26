"use client"

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
import type { HourlyOrderPoint } from "@/types/analytics"

interface HourlyOrdersChartProps {
  data: HourlyOrderPoint[]
  className?: string
}

export function HourlyOrdersChart({ data, className }: HourlyOrdersChartProps) {
  const chartConfig = {
    orderCount: {
      label: "Orders",
      color: "hsl(var(--primary))",
    },
  }

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value)

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Busiest Hours</CardTitle>
        <CardDescription>Order volume by hour of day</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig}>
          <BarChart accessibilityLayer data={data} margin={{ left: 0, right: 4 }}>
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              fontSize={11}
              interval={2}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={4}
              width={32}
              fontSize={11}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  formatter={(value, name, item) => {
                    const point = item.payload as HourlyOrderPoint
                    return (
                      <div className="flex flex-col gap-0.5">
                        <span>{Number(value)} orders</span>
                        <span className="text-muted-foreground text-xs">
                          {formatCurrency(point.totalSales)} in sales
                        </span>
                      </div>
                    )
                  }}
                />
              }
            />
            <Bar
              dataKey="orderCount"
              fill="var(--color-orderCount)"
              radius={[3, 3, 0, 0]}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
