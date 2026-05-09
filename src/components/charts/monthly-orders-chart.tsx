"use client"

import { Bar, BarChart, XAxis, YAxis } from "@/components/charts/recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { cn } from "@/lib/utils"
import type { MonthlyOrderPoint } from "@/types/analytics"

interface MonthlyOrdersChartProps {
  data: MonthlyOrderPoint[]
  className?: string
}

export function MonthlyOrdersChart({ data, className }: MonthlyOrdersChartProps) {
  const chartConfig = {
    orderCount: {
      label: "Orders",
      color: "var(--accent)",
    },
  }

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value)

  return (
    <section className={cn("inv-panel", className)}>
      <header className="inv-panel__head">
        <div className="flex flex-col gap-1">
          <span className="inv-panel__dept">Monthly Volume</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">
            Total orders by month
          </span>
        </div>
      </header>
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
            width={36}
            fontSize={11}
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                formatter={(value, name, item) => {
                  const point = item.payload as MonthlyOrderPoint
                  return (
                    <div className="flex flex-col gap-0.5">
                      <span className="tabular-nums">{Number(value).toLocaleString()} orders</span>
                      <span className="text-(--ink-muted) tabular-nums text-xs">
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
    </section>
  )
}
