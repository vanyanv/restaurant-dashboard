"use client"

import { Bar, BarChart, XAxis, YAxis } from "recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import type { HourlyOrderPoint } from "@/types/analytics"

const chartConfig = {
  orderCount: {
    label: "Orders",
    color: "hsl(var(--primary))",
  },
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value)

interface HourlyOrdersChartProps {
  chartData: HourlyOrderPoint[]
  xInterval: number
}

export function HourlyOrdersChart({
  chartData,
  xInterval,
}: HourlyOrdersChartProps) {
  return (
    <ChartContainer
      config={chartConfig}
      className="h-[280px] md:h-[340px] lg:h-[380px] w-full"
    >
      <BarChart
        accessibilityLayer
        data={chartData}
        margin={{ left: 0, right: 4, top: 4, bottom: 0 }}
      >
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          fontSize={10}
          interval={xInterval}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          width={28}
          fontSize={10}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              formatter={(value, _name, item) => {
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
          radius={[2, 2, 0, 0]}
        />
      </BarChart>
    </ChartContainer>
  )
}
