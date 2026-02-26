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
import type { DayOfWeekOrderPoint } from "@/types/analytics"

interface DayOfWeekChartProps {
  data: DayOfWeekOrderPoint[]
  className?: string
}

export function DayOfWeekChart({ data, className }: DayOfWeekChartProps) {
  const chartConfig = {
    avgOrders: {
      label: "Avg Orders",
      color: "hsl(var(--primary))",
    },
  }

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value)

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Busiest Days</CardTitle>
        <CardDescription>Average orders per day of week</CardDescription>
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
                    const point = item.payload as DayOfWeekOrderPoint
                    return (
                      <div className="flex flex-col gap-0.5">
                        <span>{Number(value)} avg orders/day</span>
                        <span className="text-muted-foreground text-xs">
                          {point.orderCount} total &middot; {formatCurrency(point.totalSales)}
                        </span>
                      </div>
                    )
                  }}
                />
              }
            />
            <Bar
              dataKey="avgOrders"
              fill="var(--color-avgOrders)"
              radius={[3, 3, 0, 0]}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
